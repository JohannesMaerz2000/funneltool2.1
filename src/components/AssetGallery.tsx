import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Asset } from "../types/submission";
import { batchPresignUrls, deleteSubmissionAsset, rotateSubmissionAsset } from "../api/client";
import { ui } from "./ui";

function fileName(key: string) {
  return key.split("/").pop() ?? key;
}

function formatSize(bytes?: number) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isPdf(key: string) {
  return key.toLowerCase().endsWith(".pdf");
}

const ASSET_CATEGORY_LABELS: Record<string, string> = {
  exterior: "Außen",
  interior: "Innenraum",
  rims: "Felgen",
  defects: "Mängel",
  damages: "Schäden",
  registration_document: "Zulassungsdokument",
  tesla_autopilot: "Tesla Autopilot",
  digital_service_log: "Digitales Serviceheft",
};

function downloadAsset(submissionId: string, key: string) {
  const qs = new URLSearchParams({ key });
  const url = `/api/submissions/${encodeURIComponent(submissionId)}/download?${qs}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = key.split("/").pop() ?? "download";
  a.click();
}

export function DownloadIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M10 3a.75.75 0 01.75.75v7.69l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.22 2.22V3.75A.75.75 0 0110 3z" />
      <path d="M3 15.75a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z" />
    </svg>
  );
}

function RotateIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15.5 4.5A7 7 0 1 0 17 10" />
      <path d="M17 3v4h-4" />
    </svg>
  );
}

function TrashIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path
        fillRule="evenodd"
        d="M8.75 2.5a1.25 1.25 0 00-1.233 1.058L7.4 4.25H5.75a.75.75 0 000 1.5h.343l.632 9.173A2.25 2.25 0 008.97 17h2.06a2.25 2.25 0 002.245-2.077l.632-9.173h.343a.75.75 0 000-1.5H12.6l-.117-.692A1.25 1.25 0 0011.25 2.5h-2.5zm2.34 1.75L11 3.807a.25.25 0 00-.247-.207h-1.506a.25.25 0 00-.247.207l-.09.443h2.18zM8.22 7.28a.75.75 0 011.5.04l-.2 6a.75.75 0 11-1.5-.04l.2-6zm3.56 0a.75.75 0 00-1.5.04l.2 6a.75.75 0 001.5-.04l-.2-6z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function normalizeCategoryLabel(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, "_");

  return ASSET_CATEGORY_LABELS[normalized] ??
    normalized
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
}

function inferAssetCategory(asset: Asset): string {
  const filename = fileName(asset.key);
  const dot = filename.lastIndexOf(".");
  const stem = (dot === -1 ? filename : filename.slice(0, dot)).trim();
  if (!stem) return "Ohne Kategorie";

  const parts = stem
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "Ohne Kategorie";

  // Common pattern: "<index>_<category>_<random-id>.<ext>"
  let start = 0;
  let removedLeadingIndex = false;
  if (/^\d+$/.test(parts[0])) {
    start = 1;
    removedLeadingIndex = true;
  }

  let end = parts.length;
  let removedVolatileSuffix = false;

  while (end > start) {
    const last = parts[end - 1];
    if (!last) break;
    const lower = last.toLowerCase();
    const isTimestamp = /^\d{10,}$/.test(last);
    const isAlphaNumUploadId =
      /[a-z]/i.test(last) &&
      /\d/.test(last) &&
      last.length >= 6 &&
      !["m1", "m15", "m1.5"].includes(lower);
    const isLongHexLike = /^[a-f0-9]{8,}$/i.test(last);

    if (isTimestamp || isAlphaNumUploadId || isLongHexLike) {
      end -= 1;
      removedVolatileSuffix = true;
      continue;
    }
    break;
  }

  // Collapse repeated shots like "Exterior 0 1774..." and keep only category name.
  if (end > start + 1) {
    const maybeIndex = parts[end - 1];
    const idx = Number(maybeIndex);
    const isSmallNumericIndex = /^\d+$/.test(maybeIndex) && Number.isFinite(idx) && idx >= 0 && idx <= 20;
    if (isSmallNumericIndex && (removedVolatileSuffix || removedLeadingIndex)) {
      end -= 1;
    }
  }

  const core = parts.slice(start, end).join("_");
  if (!core) return "Ohne Kategorie";
  return normalizeCategoryLabel(core);
}

type CategoryStat = {
  category: string;
  images: number;
  documents: number;
  others: number;
  total: number;
};

function buildCategoryStats(assets: Asset[]): CategoryStat[] {
  const byCategory = new Map<string, CategoryStat>();

  for (const asset of assets) {
    const category = inferAssetCategory(asset);
    const current = byCategory.get(category) ?? {
      category,
      images: 0,
      documents: 0,
      others: 0,
      total: 0,
    };

    if (asset.type === "image") current.images += 1;
    else if (asset.type === "document") current.documents += 1;
    else current.others += 1;
    current.total += 1;
    byCategory.set(category, current);
  }

  return [...byCategory.values()].sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
}

function PdfIcon() {
  return (
    <svg viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-12 h-12">
      <rect x="4" y="2" width="46" height="58" rx="5" fill="#0f172a" stroke="#334155" strokeWidth="2" />
      <path d="M34 2v14a4 4 0 004 4h14" stroke="#334155" strokeWidth="2" strokeLinecap="round" />
      <rect x="10" y="40" width="44" height="24" rx="4" fill="#1e293b" />
      <text x="32" y="57" textAnchor="middle" fill="white" fontSize="11" fontWeight="700" fontFamily="system-ui, sans-serif">PDF</text>
    </svg>
  );
}

function ImageThumb({
  asset,
  submissionId,
  url,
  onClick,
  onDelete,
  onRotate,
  isDeleting,
  isRotating,
}: {
  asset: Asset;
  submissionId: string;
  url?: string;
  onClick: (url: string, name: string) => void;
  onDelete: (key: string) => void;
  onRotate: (key: string) => void;
  isDeleting: boolean;
  isRotating: boolean;
}) {
  const name = fileName(asset.key);
  const category = inferAssetCategory(asset);

  return (
    <div
      className="group relative aspect-square cursor-pointer overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm transition-all duration-300 hover:border-[#3ec099]/50 hover:shadow-lg hover:scale-[1.02]"
      onClick={() => url && onClick(url, name)}
    >
      {!url && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500/20 border-t-sky-500" />
        </div>
      )}
      {url && (
        <>
          <img
            src={url}
            alt={name}
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
          />
          {/* Subtle gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

          <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-2 opacity-0 transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100">
            <div className="flex items-center gap-2">
              <span className="truncate text-[10px] font-black uppercase tracking-widest text-white/90">
                {category}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <button
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-md transition-colors hover:bg-white/40 disabled:cursor-not-allowed disabled:opacity-60"
                  title={`${name} um 90° im Uhrzeigersinn drehen`}
                  disabled={isRotating}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRotate(asset.key);
                  }}
                >
                  <RotateIcon className="h-4 w-4" />
                </button>
                <button
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-md transition-colors hover:bg-white/40"
                  title={`${name} herunterladen`}
                  onClick={(e) => {
                    e.stopPropagation();
                    downloadAsset(submissionId, asset.key);
                  }}
                >
                  <DownloadIcon className="h-4 w-4" />
                </button>
                <button
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-rose-500/30 text-white backdrop-blur-md transition-colors hover:bg-rose-500/60 disabled:cursor-not-allowed disabled:opacity-60"
                  title={`${name} löschen`}
                  disabled={isDeleting}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(asset.key);
                  }}
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PdfThumb({
  asset,
  url,
  onClick,
}: {
  asset: Asset;
  url?: string;
  onClick: (url: string, name: string) => void;
}) {
  const name = fileName(asset.key);

  return (
    <button
      className="group flex w-full cursor-pointer flex-col items-center gap-3 rounded-xl border border-zinc-200 bg-white p-5 text-left shadow-sm transition-all duration-300 hover:border-[#3ec099]/50 hover:bg-zinc-50 hover:shadow-md disabled:cursor-wait disabled:opacity-60"
      onClick={() => url && onClick(url, name)}
      disabled={!url}
      title={name}
    >
      <div className="flex w-full items-center justify-center py-2 transition-transform duration-300 group-hover:scale-110">
        {!url ? (
          <div className="h-12 w-12 animate-pulse rounded bg-zinc-800" />
        ) : (
          <div className="relative">
            <PdfIcon />
            <div className="absolute -inset-2 -z-10 bg-rose-500/10 blur-xl opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        )}
      </div>
      <span className="w-full truncate text-center text-sm font-bold text-zinc-900 transition-colors group-hover:text-[#3ec099]">
        {name}
      </span>
      {asset.size != null && (
        <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
          {formatSize(asset.size)}
        </span>
      )}
    </button>
  );
}

function AssetItem({
  asset,
  url,
}: {
  asset: Asset;
  url?: string;
}) {
  const icon = asset.type === "document" ? "📄" : "📎";

  return (
    <div className="group flex items-center gap-4 rounded-xl border border-zinc-200 bg-white px-5 py-4 shadow-sm transition-all duration-300 hover:border-zinc-300 hover:bg-zinc-50">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-xl shadow-inner group-hover:bg-zinc-200 transition-colors">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-zinc-900 transition-colors group-hover:text-black">
          {fileName(asset.key)}
        </p>
        {asset.size != null && (
          <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
            {formatSize(asset.size)}
          </p>
        )}
      </div>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-bold text-zinc-600 transition-all hover:bg-[#3ec099]/10 hover:text-[#3ec099]"
        >
          ÖFFNEN ↗
        </a>
      ) : (
        <span className="shrink-0 animate-pulse text-xs font-bold text-zinc-300">
          LÄDT…
        </span>
      )}
    </div>
  );
}

function PdfPopout({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-6 backdrop-blur-md"
      onClick={onClose}
    >
      <div
        className={`${ui.card} flex h-[90vh] w-full max-w-6xl flex-col border-zinc-200 bg-white shadow-2xl overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-4 bg-zinc-50 px-6 py-4 border-b border-zinc-100">
          <div className="h-8 w-8 scale-75">
            <PdfIcon />
          </div>
          <span className="flex-1 truncate text-base font-bold text-zinc-900">
            {name}
          </span>
          <div className="flex items-center gap-2">
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-white border border-zinc-200 text-zinc-500 transition hover:bg-[#3ec099]/10 hover:text-[#3ec099] hover:border-[#3ec099]/30"
              title="In neuem Tab öffnen"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path
                  fillRule="evenodd"
                  d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z"
                  clipRule="evenodd"
                />
                <path
                  fillRule="evenodd"
                  d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </a>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-lg bg-white border border-zinc-200 text-zinc-500 transition hover:bg-rose-50 hover:text-rose-500 hover:border-rose-200"
              onClick={onClose}
              aria-label="Schließen"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        </div>

        {/* PDF iframe */}
        <iframe src={url} title={name} className="flex-1 border-0" />
      </div>
    </div>
  );
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const ZOOM_STEP = 0.25;

function Lightbox({
  url,
  name,
  onClose,
}: {
  url: string;
  name: string;
  onClose: () => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const imgContainerRef = useRef<HTMLDivElement | null>(null);

  const resetView = useCallback(() => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, []);

  const clampOffset = useCallback(
    (next: { x: number; y: number }, z: number) => {
      const el = imgContainerRef.current;
      if (!el) return next;
      const rect = el.getBoundingClientRect();
      // Allow panning proportional to zoom overflow.
      const maxX = (rect.width * (z - 1)) / 2;
      const maxY = (rect.height * (z - 1)) / 2;
      return {
        x: Math.max(-maxX, Math.min(maxX, next.x)),
        y: Math.max(-maxY, Math.min(maxY, next.y)),
      };
    },
    []
  );

  const zoomAt = useCallback(
    (delta: number, centerX?: number, centerY?: number) => {
      setZoom((prevZoom) => {
        const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom + delta));
        if (nextZoom === prevZoom) return prevZoom;

        setOffset((prevOffset) => {
          if (nextZoom === MIN_ZOOM) return { x: 0, y: 0 };
          const el = imgContainerRef.current;
          if (!el || centerX == null || centerY == null) {
            return clampOffset(prevOffset, nextZoom);
          }
          const rect = el.getBoundingClientRect();
          // Point on the image (relative to container center) under the cursor.
          const cx = centerX - rect.left - rect.width / 2;
          const cy = centerY - rect.top - rect.height / 2;
          // Keep that image point under the cursor after scaling.
          const ratio = nextZoom / prevZoom;
          const nextOffset = {
            x: cx - (cx - prevOffset.x) * ratio,
            y: cy - (cy - prevOffset.y) * ratio,
          };
          return clampOffset(nextOffset, nextZoom);
        });

        return nextZoom;
      });
    },
    [clampOffset]
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
      zoomAt(delta, e.clientX, e.clientY);
    },
    [zoomAt]
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };

  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: MouseEvent) => {
      if (!dragStart.current) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setOffset(
        clampOffset(
          { x: dragStart.current.ox + dx, y: dragStart.current.oy + dy },
          zoom
        )
      );
    };
    const onUp = () => {
      setIsDragging(false);
      dragStart.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDragging, zoom, clampOffset]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "+" || e.key === "=") zoomAt(ZOOM_STEP);
      else if (e.key === "-" || e.key === "_") zoomAt(-ZOOM_STEP);
      else if (e.key === "0") resetView();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, zoomAt, resetView]);

  const handleDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (zoom > 1) {
      resetView();
    } else {
      zoomAt(1.5, e.clientX, e.clientY);
    }
  };

  const handleBackdropClick = () => {
    if (zoom > 1) {
      resetView();
    } else {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/95 p-4 backdrop-blur-sm"
      onClick={handleBackdropClick}
      onWheel={handleWheel}
    >
      <div
        ref={imgContainerRef}
        className="relative flex max-h-[85vh] max-w-[95vw] items-center justify-center overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleDoubleClick}
        style={{
          cursor: zoom > 1 ? (isDragging ? "grabbing" : "grab") : "zoom-in",
        }}
      >
        <img
          src={url}
          alt={name}
          decoding="async"
          draggable={false}
          className="max-h-[85vh] max-w-[95vw] select-none rounded-lg object-contain shadow-2xl ring-1 ring-white/10"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: "center center",
            transition: isDragging ? "none" : "transform 120ms ease-out",
            willChange: "transform",
          }}
        />
      </div>

      <div
        className="mt-4 flex w-full max-w-3xl items-center justify-between px-2"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="truncate text-sm font-bold text-zinc-100">{name}</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center overflow-hidden rounded-full bg-white/10">
            <button
              className="flex h-9 w-9 items-center justify-center text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => zoomAt(-ZOOM_STEP)}
              disabled={zoom <= MIN_ZOOM}
              title="Verkleinern (-)"
              aria-label="Verkleinern"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M3 10a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75A.75.75 0 013 10z" clipRule="evenodd" />
              </svg>
            </button>
            <span className="min-w-[3.5rem] text-center text-xs font-bold text-white tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              className="flex h-9 w-9 items-center justify-center text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => zoomAt(ZOOM_STEP)}
              disabled={zoom >= MAX_ZOOM}
              title="Vergrößern (+)"
              aria-label="Vergrößern"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v5.5h5.5a.75.75 0 010 1.5h-5.5v5.5a.75.75 0 01-1.5 0v-5.5h-5.5a.75.75 0 010-1.5h5.5v-5.5A.75.75 0 0110 3z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
          <button
            className="rounded-full bg-white/10 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40"
            onClick={resetView}
            disabled={zoom === 1 && offset.x === 0 && offset.y === 0}
            title="Ansicht zurücksetzen (0)"
          >
            Zurücksetzen
          </button>
          <button
            className="rounded-full bg-white/10 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-white/20"
            onClick={onClose}
          >
            SCHLIESSEN
          </button>
        </div>
      </div>

      <button
        className="absolute top-6 right-6 flex h-12 w-12 items-center justify-center rounded-full bg-black/40 text-white transition-all hover:bg-white/10"
        onClick={onClose}
        aria-label="Schließen"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="h-6 w-6"
        >
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

export default function AssetGallery({
  assets,
  submissionId,
  onAssetsChanged,
}: {
  assets: Asset[];
  submissionId: string;
  onAssetsChanged?: () => Promise<void> | void;
}) {
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(
    null
  );
  const [pdfPopout, setPdfPopout] = useState<{
    url: string;
    name: string;
  } | null>(null);

  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());
  // Per-key version bumped after rotation so the browser re-fetches the new bytes
  // instead of serving the cached old image under the same presigned URL.
  const [versionByKey, setVersionByKey] = useState<Record<string, number>>({});

  const queryClient = useQueryClient();
  const rotateMutation = useMutation({
    mutationFn: async (key: string) => {
      await rotateSubmissionAsset(submissionId, key, 90);
      return key;
    },
    onSuccess: async (key) => {
      setVersionByKey((prev) => ({ ...prev, [key]: (prev[key] ?? 0) + 1 }));
      // Force a fresh presigned URL (new X-Amz-Date → different URL → browser refetches bytes).
      await queryClient.invalidateQueries({ queryKey: ["asset-urls-batch", submissionId] });
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : "Asset konnte nicht gedreht werden";
      window.alert(message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (key: string) => {
      setDeletedKeys((prev) => new Set([...prev, key]));
      await deleteSubmissionAsset(submissionId, key);
      await onAssetsChanged?.();
    },
    onError: (err, key) => {
      setDeletedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      const message = err instanceof Error ? err.message : "Asset konnte nicht gelöscht werden";
      window.alert(message);
    },
  });

  const visibleAssets = useMemo(
    () => assets.filter((a) => !deletedKeys.has(a.key)),
    [assets, deletedKeys]
  );

  // Memoize all derived lists in a single pass
  const { imagesByCategory, pdfs, docs, others } = useMemo(() => {
    const imagesMap: Record<string, Asset[]> = {};
    const pdfList: Asset[] = [];
    const docList: Asset[] = [];
    const otherList: Asset[] = [];

    for (const a of visibleAssets) {
      if (a.type === "image") {
        const cat = inferAssetCategory(a);
        if (!imagesMap[cat]) imagesMap[cat] = [];
        imagesMap[cat].push(a);
      } else if (isPdf(a.key)) pdfList.push(a);
      else if (a.type === "document") docList.push(a);
      else otherList.push(a);
    }

    // Sortierung: Außen zuerst, danach alphabetisch
    const sortedImages = Object.keys(imagesMap)
      .sort((a, b) => {
        if (a === "Außen") return -1;
        if (b === "Außen") return 1;
        return a.localeCompare(b);
      })
      .reduce((acc, key) => {
        acc[key] = imagesMap[key];
        return acc;
      }, {} as Record<string, Asset[]>);

    return {
      imagesByCategory: sortedImages,
      pdfs: pdfList,
      docs: docList,
      others: otherList,
    };
  }, [visibleAssets]);

  // Stable query key based on asset keys, not array reference
  const batchItems = useMemo(
    () => visibleAssets.map((a) => ({ id: submissionId, key: a.key })),
    [visibleAssets, submissionId]
  );

  // Version signature so rotation bumps force a full refetch (new presigned URLs).
  const versionSig = useMemo(
    () =>
      Object.keys(versionByKey)
        .sort()
        .map((k) => `${k}:${versionByKey[k]}`)
        .join("|"),
    [versionByKey]
  );

  // Single batch request for ALL asset presigned URLs
  const { data: batchResults } = useQuery({
    queryKey: ["asset-urls-batch", submissionId, batchItems.map((i) => i.key), versionSig],
    queryFn: () => batchPresignUrls(batchItems),
    enabled: batchItems.length > 0,
    staleTime: 50 * 60 * 1000,
  });

  // Build a lookup map: S3 key → presigned URL
  const urlMap = useMemo(() => {
    const map = new Map<string, string>();
    if (batchResults) {
      for (const { key, url } of batchResults) {
        if (url) map.set(key, url);
      }
    }
    return map;
  }, [batchResults]);

  return (
    <div className="flex flex-col gap-10">
      {lightbox && (
        <Lightbox
          url={lightbox.url}
          name={lightbox.name}
          onClose={() => setLightbox(null)}
        />
      )}
      {pdfPopout && (
        <PdfPopout
          url={pdfPopout.url}
          name={pdfPopout.name}
          onClose={() => setPdfPopout(null)}
        />
      )}

      {/* Images Section Grouped by Category */}
      {Object.keys(imagesByCategory).length > 0 && (
        <div className="space-y-8">
          {Object.entries(imagesByCategory).map(([category, catImages]) => (
            <div key={category} className="space-y-4">
              <div className="flex items-center gap-4">
                <h5 className="text-[10px] font-bold uppercase tracking-[0.3em] text-zinc-400">
                  {category}
                </h5>
                <div className="h-px flex-1 bg-zinc-100" />
                <span className="text-[10px] font-bold text-zinc-300">
                  {catImages.length} Fotos
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {catImages.map((a) => (
                  <ImageThumb
                    key={a.key}
                    asset={a}
                    submissionId={submissionId}
                    url={urlMap.get(a.key)}
                    onClick={(url, name) => setLightbox({ url, name })}
                    onDelete={(key) => {
                      if (!window.confirm(`Dieses Asset dauerhaft löschen?\n\n${fileName(key)}`)) return;
                      deleteMutation.mutate(key);
                    }}
                    onRotate={(key) => rotateMutation.mutate(key)}
                    isDeleting={deleteMutation.isPending}
                    isRotating={rotateMutation.isPending && rotateMutation.variables === a.key}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* PDFs Section */}
      {pdfs.length > 0 && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
              PDF-Dokumente
            </h4>
            <div className="h-px flex-1 bg-zinc-100" />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {pdfs.map((a) => (
              <PdfThumb
                key={a.key}
                asset={a}
                url={urlMap.get(a.key)}
                onClick={(url, name) => setPdfPopout({ url, name })}
              />
            ))}
          </div>
        </div>
      )}

      {/* Other Assets */}
      {(docs.length > 0 || others.length > 0) && (
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <h4 className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-400">
              Weitere Assets
            </h4>
            <div className="h-px flex-1 bg-zinc-100" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {[...docs, ...others].map((a) => (
              <AssetItem key={a.key} asset={a} url={urlMap.get(a.key)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
