import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { batchPresignUrls, getSubmission, listSubmissions } from "../api/client";
import type { Asset, SubmissionDetail as SubmissionDetailType } from "../types/submission";
import AssetGallery from "../components/AssetGallery";

function formatDate(iso?: string | null) {
  if (!iso) return "N/A";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatBytes(bytes?: number) {
  if (bytes === undefined || !Number.isFinite(bytes)) return "N/A";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatBool(value: unknown): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "N/A";
}

function IntakeBadge({ intake }: { intake?: string | null }) {
  const normalized = intake?.toLowerCase();
  const style =
    normalized === "advance"
      ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/90"
      : normalized === "initial"
        ? "bg-teal-100 text-teal-800 ring-1 ring-teal-200/90"
        : "bg-gray-100 text-gray-600 ring-1 ring-gray-200/90";
  const label =
    normalized === "advance"
      ? "M1.5"
      : normalized === "initial"
        ? "M1"
        : intake ?? "unknown";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>
      {label}
    </span>
  );
}

function SyncBadge({ status }: { status?: string | null }) {
  const normalized = status?.toLowerCase();
  const style =
    normalized === "completed"
      ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/90"
      : normalized === "pending"
        ? "bg-amber-100 text-amber-800 ring-1 ring-amber-200/90"
        : normalized === "failed"
          ? "bg-red-100 text-red-800 ring-1 ring-red-200/90"
          : "bg-gray-100 text-gray-600 ring-1 ring-gray-200/90";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>
      {status ?? "unknown"}
    </span>
  );
}

function StatusRow({
  label,
  badgeText,
  badgeClass,
  children,
}: {
  label: string;
  badgeText: string;
  badgeClass: string;
  children?: ReactNode;
}) {
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <tbody>
            <tr>
              <td className="w-1/3 whitespace-nowrap px-3 py-2 font-medium text-gray-600">{label}</td>
              <td className="px-3 py-2 text-gray-800">
                <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClass}`}>
                  {badgeText}
                </span>
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>
      {children}
    </div>
  );
}

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
  return raw;
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

function mergeAssets(
  first: Asset[] | undefined,
  second: Asset[] | undefined
): Asset[] {
  const map = new Map<string, Asset>();
  [...(first ?? []), ...(second ?? [])].forEach((asset) => {
    if (!map.has(asset.key)) map.set(asset.key, asset);
  });
  return [...map.values()];
}

function getFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function resolveAssetForFragment(fragment: string, assets: Asset[]): Asset | undefined {
  const normalized = fragment.trim().replace(/^.*raw_images\//i, "").toLowerCase();
  if (!normalized) return undefined;

  return assets.find((asset) => {
    const keyLower = asset.key.toLowerCase();
    if (keyLower.endsWith(`/${normalized}`)) return true;
    return getFileName(asset.key).toLowerCase() === normalized;
  });
}

function ImageProcessingJobsSection({ jobs }: { jobs: Array<Record<string, unknown>> }) {
  if (jobs.length === 0) return null;

  const latestJob = jobs[0];
  const rawStatus = asString(latestJob.status) ?? "unknown";
  const result = isRecord(latestJob.result) ? latestJob.result : null;

  const succeeded = typeof result?.succeeded === "number" ? result.succeeded : undefined;
  const failed = typeof result?.failed === "number" ? result.failed : undefined;
  const totalImages = typeof result?.totalImages === "number" ? result.totalImages : undefined;
  const totalOriginalSize =
    typeof result?.totalOriginalSize === "number" ? result.totalOriginalSize : undefined;
  const totalProcessedSize =
    typeof result?.totalProcessedSize === "number" ? result.totalProcessedSize : undefined;
  const savedSize =
    totalOriginalSize !== undefined && totalProcessedSize !== undefined
      ? totalOriginalSize - totalProcessedSize
      : undefined;

  const completed = rawStatus.toLowerCase() === "completed";
  const badgeClass = completed
    ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/90"
    : "bg-amber-100 text-amber-800 ring-1 ring-amber-200/90";

  return (
    <div>
      <StatusRow label="Image Processing" badgeText={rawStatus} badgeClass={badgeClass} />
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <p className="text-xs text-gray-500">Succeeded</p>
          <p className="text-lg font-semibold text-emerald-700">{succeeded ?? "N/A"}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <p className="text-xs text-gray-500">Failed</p>
          <p className="text-lg font-semibold text-red-700">{failed ?? "N/A"}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <p className="text-xs text-gray-500">Total images</p>
          <p className="text-lg font-semibold text-gray-900">{totalImages ?? "N/A"}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
          <p className="text-xs text-gray-500">Original size</p>
          <p className="text-lg font-semibold text-gray-900">{formatBytes(totalOriginalSize)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-emerald-50 p-3 shadow-sm">
          <p className="text-xs text-emerald-700">Saved after processing</p>
          <p className="text-lg font-semibold text-emerald-800">{formatBytes(savedSize)}</p>
        </div>
      </div>
    </div>
  );
}

function VinHistoryRow({ vinHistory }: { vinHistory?: Record<string, unknown> | null }) {
  if (!vinHistory) return null;
  const matchCount =
    typeof vinHistory.match_count === "number" ? vinHistory.match_count : undefined;
  if (matchCount === undefined) return null;

  const badgeClass =
    matchCount > 0
      ? "bg-amber-100 text-amber-800 ring-1 ring-amber-200/90"
      : "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/90";

  return (
    <StatusRow
      label="VIN History"
      badgeText={`${matchCount} match${matchCount !== 1 ? "es" : ""}`}
      badgeClass={badgeClass}
    />
  );
}

function EquipmentList({
  title,
  items,
  showSelection,
}: {
  title: string;
  items: Array<Record<string, unknown>>;
  showSelection?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;

  const selectedCount = showSelection
    ? items.filter((item) => item.isSelected === true).length
    : undefined;

  return (
    <div>
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center gap-2 text-left text-sm text-gray-600 hover:text-gray-900"
      >
        <span className="text-xs text-gray-400">{expanded ? "▼" : "▶"}</span>
        <span className="font-medium">{title}</span>
        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
          {items.length}
          {showSelection ? ` (${selectedCount} selected)` : ""}
        </span>
      </button>
      {expanded && (
        <ul className="mt-1 ml-5 space-y-1 text-sm">
          {items.map((eq) => {
            const label = String(eq.description ?? "—");
            const key = String(eq.datEquipmentId ?? label);
            const isSelected = eq.isSelected === true;

            if (!showSelection) {
              return (
                <li key={key} className="list-disc text-gray-700">
                  {label}
                </li>
              );
            }

            return (
              <li
                key={key}
                className={`rounded-md px-2 py-1 ${
                  isSelected
                    ? "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200/80"
                    : "bg-gray-50 text-gray-500 ring-1 ring-gray-200"
                }`}
              >
                <span className="mr-2 text-xs">{isSelected ? "✓" : "○"}</span>
                {label}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function VehicleCard({ dat }: { dat: Record<string, unknown> }) {
  const make = asString(dat.make);
  const model = asString(dat.model);
  const variant = asString(dat.variant);
  const vehicleName = [make, model, variant].filter(Boolean).join(" ") || "Unknown vehicle";

  const firstReg = asString(dat.first_registration);
  const mileage = typeof dat.mileage === "number" ? dat.mileage : undefined;
  const powerKw = typeof dat.power_kw === "number" ? dat.power_kw : undefined;
  const fuel = asString(dat.fuel_method);
  const drive = asString(dat.drive_type);
  const capacity = typeof dat.capacity === "number" ? dat.capacity : undefined;
  const country = asString(dat.country);
  const isConfirmed = dat.is_confirmed === true;

  const specialEquipments = Array.isArray(dat.special_equipments) ? dat.special_equipments : [];
  const standardEquipments = Array.isArray(dat.standard_equipments) ? dat.standard_equipments : [];
  const extraEquipments = Array.isArray(dat.extra_equipments) ? dat.extra_equipments : [];

  const specs: Array<{ label: string; value: string }> = [];
  if (firstReg) specs.push({ label: "First registration", value: firstReg });
  if (mileage !== undefined)
    specs.push({ label: "Mileage", value: `${mileage.toLocaleString()} km` });
  if (powerKw !== undefined) specs.push({ label: "Power", value: `${powerKw} kW` });
  if (fuel) specs.push({ label: "Fuel", value: fuel });
  if (drive) specs.push({ label: "Drive", value: drive.toUpperCase() });
  if (capacity !== undefined) specs.push({ label: "Battery", value: `${capacity} kWh` });
  if (country) specs.push({ label: "Country", value: country.toUpperCase() });

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
        Vehicle Information
      </h3>
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="text-base font-semibold text-gray-900">{vehicleName}</span>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                isConfirmed
                  ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/90"
                  : "bg-red-100 text-red-800 ring-1 ring-red-200/90"
              }`}
            >
              DAT {isConfirmed ? "confirmed" : "unconfirmed"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-8 gap-y-2 px-4 py-3 text-sm sm:grid-cols-3 md:grid-cols-4">
          {specs.map((s) => (
            <div key={s.label}>
              <span className="text-xs text-gray-500">{s.label}</span>
              <p className="font-medium text-gray-800">{s.value}</p>
            </div>
          ))}
        </div>

        {(specialEquipments.length > 0 ||
          standardEquipments.length > 0 ||
          extraEquipments.length > 0) && (
          <div className="space-y-2 border-t border-gray-100 px-4 py-3">
            <EquipmentList title="Special equipment" items={specialEquipments} showSelection />
            <EquipmentList title="Standard equipment" items={standardEquipments} />
            <EquipmentList title="Extra equipment" items={extraEquipments} />
          </div>
        )}
      </div>
    </div>
  );
}

function SellerCard({ submissionData }: { submissionData: Record<string, unknown> | null }) {
  if (!submissionData) return null;

  const rows = [
    { label: "First name", value: asString(submissionData.firstName) ?? "N/A" },
    { label: "Last name", value: asString(submissionData.lastName) ?? "N/A" },
    { label: "Email", value: asString(submissionData.email) ?? "N/A" },
    { label: "Phone", value: asString(submissionData.phone) ?? "N/A" },
    {
      label: "Mileage",
      value:
        typeof submissionData.mileage === "number"
          ? `${submissionData.mileage.toLocaleString()} km`
          : "N/A",
    },
    { label: "Seller type", value: asString(submissionData.sellerType) ?? "N/A" },
  ];

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">Seller</h3>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            {rows.map((row) => (
              <tr key={row.label}>
                <td className="w-1/3 whitespace-nowrap px-3 py-2 font-medium text-gray-600">{row.label}</td>
                <td className="px-3 py-2 text-gray-800">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VehicleConditionCard({
  submissionData,
  assets,
  assetSubmissionId,
}: {
  submissionData: Record<string, unknown> | null;
  assets: Asset[];
  assetSubmissionId: string;
}) {
  const safeData = submissionData ?? {};

  const tyreTypes = Array.isArray(safeData.tyreTypes)
    ? safeData.tyreTypes.filter((item): item is string => typeof item === "string")
    : [];
  const tyreDetails = isRecord(safeData.tyreDetails) ? safeData.tyreDetails : {};

  const vehicleDefects = Array.isArray(safeData.vehicleDefects)
    ? safeData.vehicleDefects.filter(isRecord)
    : [];

  const defectPhotoKeys = useMemo(() => {
    const keys = new Set<string>();
    vehicleDefects.forEach((defect) => {
      const photos = Array.isArray(defect.photos) ? defect.photos : [];
      photos.forEach((photo) => {
        if (typeof photo !== "string") return;
        const matchedAsset = resolveAssetForFragment(photo, assets);
        if (matchedAsset) keys.add(matchedAsset.key);
      });
    });
    return [...keys];
  }, [assets, vehicleDefects]);

  const { data: defectPhotoUrls } = useQuery({
    queryKey: ["defect-photo-urls", assetSubmissionId, defectPhotoKeys],
    queryFn: () =>
      batchPresignUrls(defectPhotoKeys.map((key) => ({ id: assetSubmissionId, key }))),
    enabled: !!submissionData && defectPhotoKeys.length > 0,
    staleTime: 30 * 60 * 1000,
  });

  const defectUrlMap = useMemo(() => {
    const map = new Map<string, string>();
    (defectPhotoUrls ?? []).forEach((item) => {
      if (item.url) map.set(item.key, item.url);
    });
    return map;
  }, [defectPhotoUrls]);

  const vehicleDocuments = Array.isArray(safeData.vehicleDocuments)
    ? safeData.vehicleDocuments.filter((item): item is string => typeof item === "string")
    : [];

  const chargingCable = isRecord(safeData.chargingCable) ? safeData.chargingCable : {};

  const boolFlags = [
    { label: "Accident free", value: safeData.accidentFree },
    { label: "Pet car", value: safeData.isPetCar },
    { label: "Smoker car", value: safeData.isSmokerCar },
    { label: "Trailer hitch", value: safeData.hasTrailerHitch },
    { label: "Digital checkbook", value: safeData.digitalCheckbook },
    { label: "Service history maintained", value: safeData.serviceHistoryMaintained },
    { label: "Pickup agreement", value: safeData.pickupAgreement },
    { label: "Vehicle agreement", value: safeData.vehicleAgreement },
    { label: "Information disclosure", value: safeData.informationDisclosureAgreement },
  ];

  if (!submissionData) {
    return (
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
          Vehicle Condition
        </h3>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Advance form not yet completed.
        </div>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
        Vehicle Condition
      </h3>
      <div className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs text-gray-500">Mileage</p>
            <p className="font-medium text-gray-800">
              {typeof submissionData.mileage === "number"
                ? `${submissionData.mileage.toLocaleString()} km`
                : "N/A"}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">TUV until</p>
            <p className="font-medium text-gray-800">{asString(submissionData.tuvUntil) ?? "N/A"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Number of owners</p>
            <p className="font-medium text-gray-800">
              {typeof submissionData.numberOfOwners === "number" ? submissionData.numberOfOwners : "N/A"}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Number of keys</p>
            <p className="font-medium text-gray-800">
              {typeof submissionData.numberOfKeys === "number" ? submissionData.numberOfKeys : "N/A"}
            </p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">Tyres</p>
          {tyreTypes.length === 0 ? (
            <p className="text-sm text-gray-500">No tyre information.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {tyreTypes.map((type) => {
                const details = isRecord(tyreDetails[type]) ? tyreDetails[type] : {};
                return (
                  <div key={type} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                    <p className="font-medium text-gray-800">{type}</p>
                    <p className="text-xs text-gray-600">Rim size: {asString(details.rimSize) ?? "N/A"}</p>
                    <p className="text-xs text-gray-600">Rim type: {asString(details.rimType) ?? "N/A"}</p>
                    <p className="text-xs text-gray-600">
                      Tread condition: {asString(details.treadCondition) ?? "N/A"}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">Defects</p>
          {vehicleDefects.length === 0 ? (
            <p className="text-sm text-gray-500">No defects reported.</p>
          ) : (
            <div className="space-y-3">
              {vehicleDefects.map((defect, idx) => {
                const photos = Array.isArray(defect.photos)
                  ? defect.photos.filter((photo): photo is string => typeof photo === "string")
                  : [];

                const matchedAssetKeys = photos
                  .map((photo) => resolveAssetForFragment(photo, assets)?.key)
                  .filter((key): key is string => !!key);

                return (
                  <div key={`${String(defect.type ?? "defect")}-${idx}`} className="rounded-lg border border-gray-200 p-3">
                    <p className="text-sm font-medium text-gray-800">{asString(defect.type) ?? "Defect"}</p>
                    <p className="text-sm text-gray-600">{asString(defect.description) ?? "No description"}</p>

                    {matchedAssetKeys.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {matchedAssetKeys.map((key) => {
                          const url = defectUrlMap.get(key);
                          if (!url) {
                            return (
                              <div
                                key={key}
                                className="flex h-20 w-20 items-center justify-center rounded-lg border border-gray-200 bg-gray-100 text-[10px] text-gray-500"
                              >
                                Loading...
                              </div>
                            );
                          }

                          return (
                            <a
                              key={key}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={getFileName(key)}
                              className="block overflow-hidden rounded-lg border border-gray-200 hover:border-emerald-300"
                            >
                              <img
                                src={url}
                                alt={getFileName(key)}
                                className="h-20 w-20 object-cover"
                                loading="lazy"
                              />
                            </a>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-1 text-xs text-gray-500">No linked defect photos found in assets.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-sm font-medium text-gray-700">Charging cable</p>
            <p className="text-sm text-gray-600">Type 2: {formatBool(chargingCable.typ2)}</p>
            <p className="text-sm text-gray-600">Schuko: {formatBool(chargingCable.schuko)}</p>
          </div>
          <div>
            <p className="mb-1 text-sm font-medium text-gray-700">Vehicle documents</p>
            {vehicleDocuments.length === 0 ? (
              <p className="text-sm text-gray-500">No documents listed.</p>
            ) : (
              <ul className="list-disc pl-5 text-sm text-gray-600">
                {vehicleDocuments.map((doc) => (
                  <li key={doc}>{doc}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-gray-700">Boolean flags</p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {boolFlags.map((item) => (
              <div key={item.label} className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-sm">
                <span className="text-gray-500">{item.label}: </span>
                <span className="font-medium text-gray-800">{formatBool(item.value)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SubmissionDetail() {
  const { id } = useParams<{ id: string }>();

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
      const candidates = related.data
        .filter((item) => item.id !== data.id)
        .filter((item) => item.formIntake?.toLowerCase() === targetIntake)
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));

      if (candidates.length === 0) return null;
      return getSubmission(candidates[0].id);
    },
    staleTime: 2 * 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-10 text-gray-500">
        <span className="animate-spin text-lg">⟳</span> Loading submission...
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <Link
          to="/submissions"
          className="text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
        >
          ← Back to list
        </Link>
        <div className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error:</strong>{" "}
          {error instanceof Error ? error.message : "Failed to load submission"}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const m1Detail = getLatestByIntake(data, linkedSubmission ?? undefined, "initial");
  const m15Detail = getLatestByIntake(data, linkedSubmission ?? undefined, "advance");

  const hasM1 = !!m1Detail;
  const hasM15 = !!m15Detail;

  const caseDat =
    (isRecord(m15Detail?.datInformation) ? m15Detail?.datInformation : null) ??
    (isRecord(m1Detail?.datInformation) ? m1Detail?.datInformation : null) ??
    null;

  const caseAssets = mergeAssets(m15Detail?.assets, m1Detail?.assets);
  const caseImageJobs = m15Detail?.imageProcessingJobs ?? data.imageProcessingJobs;
  const caseVinHistory =
    (isRecord(m15Detail?.vinHistory) ? m15Detail?.vinHistory : null) ??
    (isRecord(m1Detail?.vinHistory) ? m1Detail?.vinHistory : null) ??
    null;

  const sellerSubmissionData = isRecord(m1Detail?.submissionData) ? m1Detail.submissionData : null;
  const vehicleConditionData = normalizeAdvanceData(
    isRecord(m15Detail?.submissionData) ? m15Detail.submissionData : null
  );

  const effectiveDealId = m15Detail?.pipedriveDealId ?? data.pipedriveDealId;
  const effectiveAssetCount = caseAssets.length;

  return (
    <div>
      <Link
        to="/submissions"
        className="text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
      >
        ← Back to list
      </Link>

      <div className="mb-6 mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <IntakeBadge intake={hasM1 && hasM15 ? "M1 + M1.5" : data.formIntake} />
          {hasM1 && hasM15 ? (
            <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200/90">
              Linked case by VIN
            </span>
          ) : null}
          {isFetchingLinked ? (
            <span className="text-xs text-gray-400">Checking linked case...</span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.14em] text-gray-500">Submission ID</p>
            <p className="font-mono text-sm font-semibold break-all">{data.id}</p>
            {linkedSubmission ? (
              <p className="mt-1 text-xs text-gray-500">Linked ID: {linkedSubmission.id}</p>
            ) : null}
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.14em] text-gray-500">VIN</p>
            <p className="font-mono text-lg font-semibold">{data.vin ?? "N/A"}</p>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.14em] text-gray-500">Sync status</p>
            <SyncBadge status={m15Detail?.pipedriveSyncStatus ?? data.pipedriveSyncStatus} />
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.14em] text-gray-500">Updated</p>
            <p className="text-sm text-gray-700">{formatDate(data.updatedAt)}</p>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.14em] text-gray-500">Created</p>
            <p className="text-sm text-gray-700">{formatDate(data.createdAt)}</p>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.14em] text-gray-500">Last synced</p>
            <p className="text-sm text-gray-700">{formatDate(data.lastSyncedAt)}</p>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.14em] text-gray-500">Deal ID</p>
            <p className="text-sm text-gray-700">{effectiveDealId ?? "N/A"}</p>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.14em] text-gray-500">Assets</p>
            <p className="text-sm text-gray-700">{effectiveAssetCount}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {caseDat && <VehicleCard dat={caseDat} />}

        {sellerSubmissionData ? (
          <SellerCard submissionData={sellerSubmissionData} />
        ) : hasM15 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            Initial M1 form is not linked yet for this VIN.
          </div>
        ) : null}

        {hasM15 ? (
          <VehicleConditionCard
            submissionData={vehicleConditionData}
            assets={caseAssets}
            assetSubmissionId={m15Detail?.id ?? data.id}
          />
        ) : (
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
            No M1.5 submission linked yet.
          </div>
        )}

        <VinHistoryRow vinHistory={caseVinHistory} />
        <ImageProcessingJobsSection jobs={caseImageJobs} />

        {!caseDat &&
          !sellerSubmissionData &&
          !vehicleConditionData &&
          !caseVinHistory &&
          caseImageJobs.length === 0 && (
            <div className="text-sm italic text-gray-400">No enrichment data available.</div>
          )}

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
            Assets ({caseAssets.length})
          </h3>
          {caseAssets.length === 0 ? (
            <p className="text-sm italic text-gray-400">No assets.</p>
          ) : (
            <AssetGallery assets={caseAssets} submissionId={m15Detail?.id ?? data.id} />
          )}
        </div>
      </div>
    </div>
  );
}
