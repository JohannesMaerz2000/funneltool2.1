import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useCallback, useEffect } from "react";
import { getSubmission, listSubmissions, uploadSubmissionAssetProxy } from "../api/client";
import type { Asset, SubmissionDetail as SubmissionDetailType } from "../types/submission";
import AssetGallery from "../components/AssetGallery";
import { formatDate, formatIfDate } from "../utils/dateUtils";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function normalizeAdvanceData(
  raw: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!raw) return null;
  const nested = raw.submissionData;
  if (isRecord(nested)) return nested;

  const advanceFieldKeys = new Set([
    "mileage",
    "tuvUntil",
    "accidentFree",
    "accidentDescription",
    "numberOfOwners",
    "numberOfKeys",
    "formOfOwnership",
    "isPetCar",
    "isSmokerCar",
    "hasTrailerHitch",
    "tyreTypes",
    "tyreDetails",
    "vehicleDefects",
    "vehicleDocuments",
    "chargingCable",
    "digitalCheckbook",
    "digitalCheckbookPhotos",
    "serviceHistoryMaintained",
    "registrationDocumentOwner",
    "pickupAgreement",
    "vehicleAgreement",
    "informationDisclosureAgreement",
    "additionalAccessories",
    "nonOriginalConditionDescription",
  ]);

  const rawKeys = Object.keys(raw);
  const looksLikeFormEngineEnvelope =
    rawKeys.includes("values") ||
    rawKeys.includes("last_submitted") ||
    rawKeys.includes("submission_start") ||
    rawKeys.includes("user_id");
  if (looksLikeFormEngineEnvelope) return null;

  const hasKnownAdvanceFields = rawKeys.some((key) => advanceFieldKeys.has(key));
  return hasKnownAdvanceFields ? raw : null;
}

function extractSubmissionData(
  detail: SubmissionDetailType | undefined,
  intake: "initial" | "advance"
): Record<string, unknown> | null {
  if (!detail) return null;

  const topLevel = isRecord(detail.submissionData) ? detail.submissionData : null;
  const nestedSnakeCase = isRecord(detail.submission)
    ? detail.submission.submission_data
    : null;
  const snakeCase = isRecord(nestedSnakeCase) ? nestedSnakeCase : null;
  const raw = topLevel ?? snakeCase;

  if (!raw) return null;
  return intake === "advance" ? normalizeAdvanceData(raw) : raw;
}

function getLatestByIntake(
  first: SubmissionDetailType | undefined,
  second: SubmissionDetailType | undefined,
  intake: "initial" | "advance"
): SubmissionDetailType | undefined {
  const candidates = [first, second].filter(
    (item): item is SubmissionDetailType => !!item && item.formIntake?.toLowerCase() === intake
  );
  if (candidates.length === 0) return undefined;
  return [...candidates].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
}

function mergeAssets(first: Asset[] | undefined, second: Asset[] | undefined): Asset[] {
  const map = new Map<string, Asset>();
  [...(first ?? []), ...(second ?? [])].forEach((asset) => {
    if (!map.has(asset.key)) map.set(asset.key, asset);
  });
  return [...map.values()];
}

type FlatField = {
  path: string;
  value: string;
  rawValue: unknown;
};

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return formatIfDate(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function flattenData(value: unknown, prefix = "", out: FlatField[] = []): FlatField[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      if (prefix) out.push({ path: prefix, value: "[]", rawValue: value });
      return out;
    }

    const scalar = value.every((item) => !isRecord(item) && !Array.isArray(item));
    if (scalar) {
      if (prefix) out.push({ path: prefix, value: JSON.stringify(value), rawValue: value });
      return out;
    }

    value.forEach((item, index) => {
      const next = `${prefix}[${index}]`;
      flattenData(item, next, out);
    });
    return out;
  }

  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      if (prefix) out.push({ path: prefix, value: "{}", rawValue: value });
      return out;
    }

    entries.forEach(([key, item]) => {
      const next = prefix ? `${prefix}.${key}` : key;
      flattenData(item, next, out);
    });
    return out;
  }

  if (prefix) out.push({ path: prefix, value: stringifyValue(value), rawValue: value });
  return out;
}

type MergedRow = {
  field: string;
  value: string;
  rawValue: unknown;
  source: "initial" | "advance";
};

function buildMergedRows(
  initialData: Record<string, unknown> | null,
  advanceData: Record<string, unknown> | null
): MergedRow[] {
  const map = new Map<string, MergedRow>();

  const initialFlat = flattenData(initialData ?? {});
  initialFlat.forEach((item) => {
    map.set(item.path, {
      field: item.path,
      value: item.value,
      rawValue: item.rawValue,
      source: "initial",
    });
  });

  const advanceFlat = flattenData(advanceData ?? {});
  advanceFlat.forEach((item) => {
    map.set(item.path, {
      field: item.path,
      value: item.value,
      rawValue: item.rawValue,
      source: "advance",
    });
  });

  return [...map.values()].sort((a, b) => a.field.localeCompare(b.field));
}

function pipedriveUrl(dealId: string): string {
  return `https://app.pipedrive.com/deal/${encodeURIComponent(dealId)}`;
}

function formatFieldName(fieldName: string): string {
  let name = fieldName.replace(/\[(\d+)\]/g, (_, num) => ` ${parseInt(num, 10) + 1}`);
  name = name.replace(/\./g, ' - ');
  name = name.replace(/([A-Z])/g, ' $1');
  return name.charAt(0).toUpperCase() + name.trim().slice(1);
}

const ANALYTICS_KEYS = ["gaClientId", "gClId", "fbClId", "utmSource", "utmMedium", "utmCampaign", "utmContent", "utmTerm", "newsLetter", "policyConfirmation"];

function SubmissionDataViewer({ rows, title, defaultCollapsed = false }: { rows: MergedRow[]; title: string; defaultCollapsed?: boolean }) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
  const [showEmpty, setShowEmpty] = useState(false);

  const isEmpty = (row: MergedRow) => {
    if (row.rawValue === null || row.rawValue === undefined || row.rawValue === "") return true;
    if (Array.isArray(row.rawValue) && row.rawValue.length === 0) return true;
    if (isRecord(row.rawValue) && Object.keys(row.rawValue).length === 0) return true;
    if (row.value === "[]" || row.value === "{}") return true;
    return false;
  };

  const emptyCount = rows.filter(isEmpty).length;
  const nonEmptyRows = rows.filter((row) => !isEmpty(row));
  const emptyRows = rows.filter(isEmpty);
  const visibleRows = showEmpty ? [...nonEmptyRows, ...emptyRows] : nonEmptyRows;
  const mid = Math.ceil(visibleRows.length / 2);
  const leftRows = visibleRows.slice(0, mid);
  const rightRows = visibleRows.slice(mid);

  const renderRow = (row: MergedRow) => {
    const isBool = typeof row.rawValue === "boolean";
    return (
      <div key={row.field} className="flex items-start justify-between py-2.5 border-b border-zinc-800/50">
        <span className="text-xs font-semibold text-zinc-400 truncate pr-4 w-1/2 shrink-0" title={formatFieldName(row.field)}>
          {formatFieldName(row.field)}
        </span>
        <div className="flex-1 min-w-0 text-right mt-[-2px]">
          {isBool ? (
            <div className="flex items-center justify-end gap-1.5">
              {row.rawValue ? (
                <svg className="w-4 h-4 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>
              ) : (
                <svg className="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
              )}
            </div>
          ) : (
            <div className={`text-sm ${isEmpty(row) ? 'text-zinc-600 italic' : 'text-zinc-200 font-medium break-words whitespace-pre-wrap'}`}>
              {isEmpty(row) ? 'Empty' : row.value}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-2 group"
          >
            <div className={`p-1 rounded bg-zinc-800 group-hover:bg-zinc-700 transition-colors ${isCollapsed ? '-rotate-90' : ''}`}>
              <svg className="w-3 h-3 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
              </svg>
            </div>
            <h2 className="text-sm font-bold text-zinc-200">{title}</h2>
          </button>
          {!isCollapsed && (
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider bg-zinc-800/50 px-1.5 py-0.5 rounded">
              {rows.length} fields
            </span>
          )}
        </div>
        {!isCollapsed && emptyCount > 0 && (
          <button
            onClick={() => setShowEmpty(!showEmpty)}
            className="text-xs text-sky-400 hover:text-sky-300 font-medium transition-colors shrink-0"
          >
            {showEmpty ? "Hide empty" : `+${emptyCount} empty`}
          </button>
        )}
      </div>

      {!isCollapsed && (
        <>

      {visibleRows.length === 0 ? (
        <div className="py-8 text-center border-2 border-dashed border-zinc-800 rounded-xl">
          <p className="text-sm text-zinc-500 font-medium">No data available.</p>
        </div>
      ) : (
        <div className="border-t border-zinc-800/60 pt-3">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 text-sm">
              {leftRows.map(renderRow)}
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 px-3 text-sm">
              {rightRows.map(renderRow)}
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}

const PHOTO_UPLOAD_CATEGORIES = [
  "exterior",
  "interior",
  "rims",
  "defects",
  "tesla_autopilot",
  "digital_service_log",
  "damages",
] as const;

const PAPER_UPLOAD_CATEGORIES = [
  "registration_document",
  "coc_certificate",
  "service_book",
  "inspection_report",
  "invoice",
  "other_document",
] as const;

type UploadTarget = "photos" | "papers";

function FilePreviewThumb({ file, onRemove, isPending }: { file: File; onRemove: () => void; isPending: boolean }) {
  const isImage = file.type.startsWith("image/");
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div className="group relative aspect-square overflow-hidden rounded-lg border border-zinc-700 bg-zinc-800">
      {isImage && objectUrl ? (
        <img src={objectUrl} alt={file.name} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8 text-zinc-500">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
          </svg>
          <span className="w-full truncate text-center text-[9px] text-zinc-500">PDF</span>
        </div>
      )}

      {/* Hover overlay: filename + size */}
      <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-0 transition-opacity duration-200 group-hover:opacity-100 p-2">
        <p className="truncate text-[10px] font-semibold text-white leading-tight">{file.name}</p>
        <p className="text-[9px] text-zinc-400">{formatFileSize(file.size)}</p>
      </div>

      {/* Remove button */}
      {!isPending && (
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove file"
          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-zinc-300 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-rose-500/80 hover:text-white"
        >
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
            <path d="M4.22 4.22a.75.75 0 011.06 0L8 6.94l2.72-2.72a.75.75 0 111.06 1.06L9.06 8l2.72 2.72a.75.75 0 11-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 01-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 010-1.06z" />
          </svg>
        </button>
      )}
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function ImageUploadCard({
  submissionId,
  onUploaded,
}: {
  submissionId: string;
  onUploaded: () => Promise<void> | void;
}) {
  const [target, setTarget] = useState<UploadTarget>("photos");
  const [category, setCategory] = useState<string>("exterior");
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);
  const [statusText, setStatusText] = useState<string>("");
  const [errorText, setErrorText] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const availableCategories = target === "photos" ? PHOTO_UPLOAD_CATEGORIES : PAPER_UPLOAD_CATEGORIES;
  const accept = target === "photos" ? "image/*" : "image/*,.pdf,application/pdf";

  const addFiles = useCallback((incoming: File[]) => {
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name + f.size));
      const deduped = incoming.filter((f) => !existing.has(f.name + f.size));
      return [...prev, ...deduped];
    });
    setErrorText("");
    setStatusText("");
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragging(false);
    }
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, [addFiles]);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (files.length === 0) throw new Error("Please select at least one file.");

      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        const isImage = file.type.startsWith("image/");
        const isPdf = file.type === "application/pdf";
        if (target === "photos" && !isImage) {
          throw new Error(`"${file.name}" is not an image file.`);
        }
        if (target === "papers" && !isImage && !isPdf) {
          throw new Error(`"${file.name}" is not a supported document.`);
        }

        setUploadProgress({ current: i + 1, total: files.length });
        await uploadSubmissionAssetProxy({ submissionId, file, target, category });
      }
    },
    onSuccess: async () => {
      const count = files.length;
      setErrorText("");
      setUploadProgress(null);
      setStatusText(`${count} file${count === 1 ? "" : "s"} uploaded successfully.`);
      setFiles([]);
      await onUploaded();
      setTimeout(() => setStatusText(""), 4000);
    },
    onError: (error) => {
      setUploadProgress(null);
      setStatusText("");
      setErrorText(error instanceof Error ? error.message : "Upload failed.");
    },
  });

  const isPending = uploadMutation.isPending;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 space-y-4">
      {/* Header row: title + type/category selects */}
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-sm font-bold text-zinc-200 uppercase tracking-wider">Upload Assets</span>

        <div className="flex items-center gap-2 ml-auto">
          {/* Type toggle */}
          <div className="flex rounded-lg overflow-hidden border border-zinc-700 text-xs font-bold">
            {(["photos", "papers"] as UploadTarget[]).map((t) => (
              <button
                key={t}
                type="button"
                disabled={isPending}
                onClick={() => {
                  setTarget(t);
                  setCategory(t === "photos" ? "exterior" : "registration_document");
                  setErrorText("");
                  setStatusText("");
                }}
                className={`px-4 py-2 transition-colors ${
                  target === t
                    ? "bg-sky-500/20 text-sky-300"
                    : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                } disabled:cursor-not-allowed`}
              >
                {t === "photos" ? "Photos" : "Papers"}
              </button>
            ))}
          </div>

          {/* Category select */}
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            disabled={isPending}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-zinc-200 focus:border-sky-500 focus:outline-none disabled:cursor-not-allowed"
          >
            {availableCategories.map((item) => (
              <option key={item} value={item}>{item.replace(/_/g, " ")}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => !isPending && fileInputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed py-10 cursor-pointer transition-all duration-200 select-none ${
          isDragging
            ? "border-sky-400 bg-sky-500/10"
            : "border-zinc-700 bg-zinc-900/30 hover:border-zinc-500 hover:bg-zinc-800/30"
        } ${isPending ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={accept}
          className="sr-only"
          disabled={isPending}
          onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
        />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className={`h-10 w-10 transition-colors ${isDragging ? "text-sky-400" : "text-zinc-600"}`}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        <div className="text-center">
          <p className={`text-sm font-semibold transition-colors ${isDragging ? "text-sky-300" : "text-zinc-300"}`}>
            {isDragging ? "Drop files here" : "Drag & drop files here"}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            or <span className="text-sky-400 underline underline-offset-2">click to browse</span>
            {" · "}
            {target === "photos" ? "Images only" : "Images & PDFs"}
          </p>
        </div>
      </div>

      {/* Selected files preview grid */}
      {files.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">
              {files.length} file{files.length === 1 ? "" : "s"} queued
            </span>
            <button
              type="button"
              onClick={() => setFiles([])}
              disabled={isPending}
              className="text-[11px] font-bold text-zinc-500 hover:text-rose-400 transition-colors disabled:cursor-not-allowed"
            >
              Clear all
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10">
            {files.map((file, idx) => (
              <FilePreviewThumb
                key={`${file.name}-${file.size}-${idx}`}
                file={file}
                isPending={isPending}
                onRemove={() => setFiles((prev) => prev.filter((_, i) => i !== idx))}
              />
            ))}
          </div>
        </div>
      )}

      {/* Upload progress / action row */}
      <div className="flex items-center gap-3">
        {uploadProgress ? (
          <div className="flex flex-1 items-center gap-3">
            <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className="h-full rounded-full bg-sky-500 transition-all duration-300"
                style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
              />
            </div>
            <span className="shrink-0 text-xs text-zinc-400">
              {uploadProgress.current}/{uploadProgress.total}
            </span>
          </div>
        ) : (
          <div className="flex-1">
            {statusText && <p className="text-xs text-emerald-400">{statusText}</p>}
            {errorText && <p className="text-xs text-rose-400">{errorText}</p>}
          </div>
        )}

        <button
          type="button"
          onClick={() => uploadMutation.mutate()}
          disabled={isPending || files.length === 0}
          className="shrink-0 rounded-lg bg-sky-500 px-5 py-2 text-sm font-bold text-white hover:bg-sky-400 disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
        >
          {isPending ? "Uploading…" : `Upload ${files.length > 0 ? files.length : ""}`}
        </button>
      </div>
    </div>
  );
}

export default function SubmissionDetail() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["submission", id],
    queryFn: () => getSubmission(id!),
    enabled: !!id,
  });

  const {
    data: linkedSubmission,
    isFetching: isFetchingLinked,
  } = useQuery({
    queryKey: ["linked-submission", data?.id, data?.vin, data?.formIntake],
    enabled: !!data?.vin,
    queryFn: async () => {
      if (!data?.vin) return null;

      const currentIntake = data.formIntake?.toLowerCase();
      const targetIntake = currentIntake === "advance" ? "initial" : "advance";
      const related = await listSubmissions({ vin: data.vin, page: 1, pageSize: 50 });

      const targetCase = related.data.find((c) =>
        (targetIntake === "initial" && c.m1 && c.m1.id !== data.id) ||
        (targetIntake === "advance" && c.m15 && c.m15.id !== data.id)
      );

      const targetSummary = targetIntake === "initial" ? targetCase?.m1 : targetCase?.m15;
      if (!targetSummary) return null;
      return getSubmission(targetSummary.id);
    },
    staleTime: 2 * 60_000,
  });

  if (isLoading) {
    return <div className="py-10 text-zinc-400">Loading submission...</div>;
  }

  if (isError) {
    return (
      <div>
        <Link to="/submissions" className="text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:underline">
          ← Back to list
        </Link>
        <div className="mt-4 rounded-xl border border-rose-900/60 bg-rose-900/20 p-4 text-sm text-rose-100">
          <strong>Error:</strong> {error instanceof Error ? error.message : "Failed to load submission"}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const m1Detail = getLatestByIntake(data, linkedSubmission ?? undefined, "initial");
  const m15Detail = getLatestByIntake(data, linkedSubmission ?? undefined, "advance");

  const initialSubmissionData = extractSubmissionData(m1Detail, "initial");
  const advanceSubmissionData = extractSubmissionData(m15Detail, "advance");

  const contactFirstName = asString(initialSubmissionData?.firstName);
  const contactLastName = asString(initialSubmissionData?.lastName);
  const contactName = [contactFirstName, contactLastName].filter(Boolean).join(" ") || "N/A";
  const contactEmail = asString(initialSubmissionData?.email) ?? "N/A";
  const contactPhone = asString(initialSubmissionData?.phone) ?? "N/A";
  const contactSellerType = asString(initialSubmissionData?.sellerType) ?? "N/A";

  const displaySubmissionRows = buildMergedRows(initialSubmissionData, advanceSubmissionData);
  const analyticsSourceRows = buildMergedRows(initialSubmissionData, null);

  const submissionRows = displaySubmissionRows.filter(
    (row) => !["firstName", "lastName", "email", "phone", "sellerType", "vin", ...ANALYTICS_KEYS].includes(row.field)
  );

  const analyticsRows = analyticsSourceRows.filter(
    (row) => ANALYTICS_KEYS.includes(row.field)
  );

  const caseAssets = mergeAssets(m15Detail?.assets, m1Detail?.assets);
  const assetSubmissionId = m15Detail?.id ?? data.id;

  const caseDat =
    (isRecord(m15Detail?.datInformation) ? m15Detail.datInformation : null) ??
    (isRecord(m1Detail?.datInformation) ? m1Detail.datInformation : null) ??
    null;

  const vin = asString(caseDat?.vin) ?? data.vin ?? "N/A";
  const make = asString(caseDat?.make) ?? "N/A";
  const model = asString(caseDat?.model) ?? "N/A";
  const variant = asString(caseDat?.variant) ?? "N/A";
  const firstRegistration = asString(caseDat?.first_registration) ?? "N/A";

  const effectiveDealId = m15Detail?.pipedriveDealId ?? data.pipedriveDealId;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4">
          <Link to="/submissions" className="text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:underline">
            ← Back to list
          </Link>
          {isFetchingLinked ? <span className="text-xs text-zinc-500">Checking linked form...</span> : null}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-lg font-semibold">Deal Details</h1>
            {effectiveDealId ? (
              <a
                href={pipedriveUrl(effectiveDealId)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex shrink-0 rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-emerald-950 hover:bg-emerald-400"
              >
                View in Pipedrive
              </a>
            ) : null}
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <h2 className="text-sm font-semibold text-zinc-200">Car Details</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <tbody className="divide-y divide-zinc-800">
                    <tr>
                      <td className="py-2 pr-4 text-zinc-400">VIN</td>
                      <td className="py-2 font-mono">{vin}</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 text-zinc-400">Make</td>
                      <td className="py-2">{make}</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 text-zinc-400">Model</td>
                      <td className="py-2">{model}</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 text-zinc-400">Variant</td>
                      <td className="py-2">{variant}</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 text-zinc-400">First registration</td>
                      <td className="py-2">{firstRegistration !== "N/A" ? formatDate(firstRegistration) : "N/A"}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4">
              <h2 className="text-sm font-semibold text-zinc-200">Contact Details</h2>
              <div className="mt-3 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <tbody className="divide-y divide-zinc-800">
                    <tr>
                      <td className="py-2 pr-4 text-zinc-400">Name</td>
                      <td className="py-2">{contactName}</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 text-zinc-400">Email</td>
                      <td className="py-2 break-all">{contactEmail}</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 text-zinc-400">Phone</td>
                      <td className="py-2">{contactPhone}</td>
                    </tr>
                    <tr>
                      <td className="py-2 pr-4 text-zinc-400">Seller type</td>
                      <td className="py-2">{contactSellerType}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <SubmissionDataViewer title="Submission Data" rows={submissionRows} />
        <SubmissionDataViewer title="Marketing & Analytics" rows={analyticsRows} defaultCollapsed={true} />

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
          <h2 className="text-base font-semibold">Pictures & Assets ({caseAssets.length})</h2>
          <div className="mt-4">
            <ImageUploadCard
              submissionId={assetSubmissionId}
              onUploaded={async () => {
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: ["submission"] }),
                  queryClient.invalidateQueries({ queryKey: ["linked-submission"] }),
                ]);
              }}
            />
          </div>
          {caseAssets.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-400">No assets available.</p>
          ) : (
            <div className="mt-4">
              <AssetGallery
                assets={caseAssets}
                submissionId={assetSubmissionId}
                onAssetsChanged={async () => {
                  await Promise.all([
                    queryClient.invalidateQueries({ queryKey: ["submission"] }),
                    queryClient.invalidateQueries({ queryKey: ["linked-submission"] }),
                  ]);
                }}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
