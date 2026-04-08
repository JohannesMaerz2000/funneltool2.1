import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  batchPresignUrls,
  getSubmission,
  listSubmissions,
  uploadSubmissionAssetProxy,
} from "../api/client";
import type { Asset, SubmissionDetail as SubmissionDetailType } from "../types/submission";
import AssetGallery from "../components/AssetGallery";
import { badgeTone, ui } from "../components/ui";

function formatDate(iso?: string | null) {
  if (!iso) return "N/A";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatBool(value: unknown): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  return "N/A";
}

function IntakeBadge({ intake }: { intake?: string | null }) {
  const normalized = intake?.toLowerCase();
  const tone = normalized?.includes("m1") || normalized === "advance" || normalized === "initial" ? "success" : "neutral";
  const label =
    normalized === "advance"
      ? "M1.5"
      : normalized === "initial"
        ? "M1"
        : intake ?? "unknown";
  return (
    <span className={`${ui.badge} ${badgeTone(tone)}`}>
      {label}
    </span>
  );
}

function SyncBadge({ status }: { status?: string | null }) {
  const normalized = status?.toLowerCase();
  const tone =
    normalized === "completed"
      ? "success"
      : normalized === "pending"
        ? "warn"
        : normalized === "failed"
          ? "danger"
          : "neutral";
  return (
    <span className={`${ui.badge} ${badgeTone(tone)}`}>
      {status ?? "unknown"}
    </span>
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


function AuditTable({
  items,
}: {
  items: Array<{ label: string; userValue: string; datValue: string }>;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-zinc-700">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-zinc-800/60 text-xs font-bold uppercase tracking-wider text-zinc-400">
            <th className="px-4 py-2.5 text-left">Field</th>
            <th className="px-4 py-2.5 text-left">User</th>
            <th className="px-4 py-2.5 text-left">DAT</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-700/50">
          {items.map((item) => {
            const match = item.userValue.toLowerCase() === item.datValue.toLowerCase();
            return (
              <tr
                key={item.label}
                className={match ? "bg-zinc-700/10" : "bg-rose-900/20"}
              >
                <td className="px-4 py-2 font-medium text-zinc-200">{item.label}</td>
                <td className={`px-4 py-2 font-mono ${match ? "text-zinc-200" : "text-rose-200"}`}>
                  {item.userValue}
                </td>
                <td className={`px-4 py-2 font-mono ${match ? "text-zinc-200" : "text-rose-200"}`}>
                  {item.datValue}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DataAuditSection({
  submissionData,
  dat,
  vinHistory,
}: {
  submissionData: Record<string, unknown> | null;
  dat: Record<string, unknown> | null;
  vinHistory: Record<string, unknown> | null;
}) {
  if (!submissionData || !dat) return null;

  const hasEq = (ids: string[]) => {
    const std = Array.isArray(dat.standard_equipments) ? dat.standard_equipments : [];
    const spc = Array.isArray(dat.special_equipments) ? dat.special_equipments : [];
    const ext = Array.isArray(dat.extra_equipments) ? dat.extra_equipments : [];

    const check = (list: any[]) => list.some((e) => ids.includes(String(e.datEquipmentId)));
    
    // For standard/extra, existence is enough. For special, it must be selected.
    const inStd = check(std);
    const inSpc = spc.some((e) => ids.includes(String(e.datEquipmentId)) && e.isSelected === true);
    const inExt = check(ext);

    return inStd || inSpc || inExt;
  };

  const auditItems: Array<{ label: string; userValue: string; datValue: string }> = [];

  // 1. Trailer Hitch
  auditItems.push({
    label: "Trailer Hitch",
    userValue: submissionData.hasTrailerHitch === true ? "Yes" : "No",
    datValue: hasEq(["14200"]) ? "Yes" : "No",
  });

  // 2. Charging Cables (if applicable)
  const chargingCable = isRecord(submissionData.chargingCable) ? submissionData.chargingCable : null;
  if (chargingCable) {
    // Type 2
    auditItems.push({
      label: "Charging Cable (Type 2)",
      userValue: chargingCable.typ2 === true ? "Yes" : "No",
      datValue: hasEq(["73223", "73221", "73226"]) ? "Yes" : "No", // Common Type 2 IDs
    });
    // Schuko
    auditItems.push({
      label: "Charging Cable (Schuko)",
      userValue: chargingCable.schuko === true ? "Yes" : "No",
      datValue: hasEq(["73204", "73210"]) ? "Yes" : "No", // Common Schuko IDs
    });
  }

  // 3. Alloy Rims
  const tyreDetails = isRecord(submissionData.tyreDetails) ? submissionData.tyreDetails : {};
  const userHasAlloys = Object.values(tyreDetails).some(
    (d: any) => isRecord(d) && d.rimType === "leichtmetall"
  );
  auditItems.push({
    label: "Alloy Rims (LM-Felgen)",
    userValue: userHasAlloys ? "Yes" : "No",
    datValue: hasEq(["50140", "50168", "49403", "50120", "50130"]) ? "Yes" : "No",
  });

  // 4. First Registration
  const datFirstReg = asString(dat.first_registration);
  const histFirstReg = vinHistory ? asString(vinHistory.first_registration) : null;
  if (datFirstReg && histFirstReg) {
    auditItems.push({
      label: "First Registration",
      userValue: histFirstReg,
      datValue: datFirstReg,
    });
  }

  return <AuditTable items={auditItems} />;
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
        className="flex w-full items-center gap-2 text-left text-sm font-semibold text-zinc-300 hover:text-zinc-100 transition"
      >
        <span className="text-xs text-zinc-500">{expanded ? "▼" : "▶"}</span>
        <span>{title}</span>
        <span className="rounded-full bg-zinc-700/50 px-3 py-1 text-xs text-zinc-400 border border-zinc-600">
          {items.length}
          {showSelection ? ` (${selectedCount} selected)` : ""}
        </span>
      </button>
      {expanded && (
        <ul className={`mt-3 ${showSelection ? "divide-y divide-zinc-700/50 rounded-lg border border-zinc-700 overflow-hidden" : "ml-6 space-y-2 list-disc"}`}>
          {items.map((eq) => {
            const label = String(eq.description ?? "—");
            const key = String(eq.datEquipmentId ?? label);
            const isSelected = eq.isSelected === true;

            if (!showSelection) {
              return (
                <li key={key} className="text-sm text-zinc-300">
                  {label}
                </li>
              );
            }

            return (
              <li
                key={key}
                className="flex items-center justify-between px-4 py-3 text-sm"
              >
                <span className="text-zinc-300">{label}</span>
                <span
                  className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold ${
                    isSelected
                      ? "bg-emerald-900/40 text-emerald-300 ring-1 ring-emerald-700/50"
                      : "bg-zinc-700/40 text-zinc-400 ring-1 ring-zinc-600"
                  }`}
                >
                  <span>{isSelected ? "✓" : "○"}</span>
                  {isSelected ? "Yes" : "No"}
                </span>
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
  if (powerKw !== undefined) specs.push({ label: "Power", value: `${powerKw} kW` });
  if (fuel) specs.push({ label: "Fuel", value: fuel });
  if (drive) specs.push({ label: "Drive", value: drive.toUpperCase() });
  if (capacity !== undefined) specs.push({ label: "Battery", value: `${capacity} kWh` });
  if (country) specs.push({ label: "Country", value: country.toUpperCase() });

  return (
    <div className={ui.card}>
      {/* Header with badge */}
      <div className="border-l-4 border-l-sky-800/60 bg-sky-950/20 px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">Vehicle</p>
            <p className="text-2xl font-bold text-white">{vehicleName}</p>
          </div>
          <span
            className={`shrink-0 ${ui.badge} ${
              isConfirmed
                ? `${badgeTone("success")}`
                : `${badgeTone("danger")}`
            }`}
          >
            DAT {isConfirmed ? "✓" : "✗"}
          </span>
        </div>
      </div>

      {/* Specs grid */}
      {specs.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 px-6 py-5 border-b border-zinc-700">
          {specs.map((s) => (
            <div key={s.label}>
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">{s.label}</p>
              <p className="text-lg font-bold text-zinc-100">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Equipment lists */}
      {(specialEquipments.length > 0 ||
        standardEquipments.length > 0 ||
        extraEquipments.length > 0) && (
        <div className="space-y-4 px-6 py-5">
          <EquipmentList title="Special equipment" items={specialEquipments} showSelection />
          <EquipmentList title="Standard equipment" items={standardEquipments} />
          <EquipmentList title="Extra equipment" items={extraEquipments} />
        </div>
      )}
    </div>
  );
}

function SellerCard({ submissionData }: { submissionData: Record<string, unknown> | null }) {
  if (!submissionData) return null;

  const firstName = asString(submissionData.firstName) ?? "N/A";
  const lastName = asString(submissionData.lastName) ?? "N/A";
  const email = asString(submissionData.email) ?? "N/A";
  const phone = asString(submissionData.phone) ?? "N/A";
  const mileage = typeof submissionData.mileage === "number"
    ? `${submissionData.mileage.toLocaleString()} km`
    : "N/A";
  const sellerType = asString(submissionData.sellerType) ?? "N/A";

  return (
    <div className={ui.card}>
      <div className="border-l-4 border-l-amber-800/60 bg-amber-950/20 px-6 py-5">
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Seller Information</p>
      </div>
      <div className="space-y-5 px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Name</p>
          <p className="text-lg font-bold text-white">{firstName} {lastName}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Email</p>
          <p className="text-base text-zinc-300 break-all">{email}</p>
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Phone</p>
          <p className="text-base text-zinc-300">{phone}</p>
        </div>
        <div className="grid grid-cols-2 gap-5 pt-2 border-t border-zinc-700">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Type</p>
            <p className="text-base font-semibold text-zinc-100">{sellerType}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Mileage</p>
            <p className="text-base font-semibold text-zinc-100">{mileage}</p>
          </div>
        </div>
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
      <div className={ui.card}>
        <div className="border-l-4 border-l-teal-800/60 bg-teal-950/20 px-6 py-5">
          <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Vehicle Condition</p>
        </div>
        <div className="m-5 rounded-lg border border-zinc-700/60 bg-zinc-800/60 p-5 text-base text-zinc-300">
          Advance form not yet completed.
        </div>
      </div>
    );
  }

  return (
    <div className={ui.card}>
      <div className="border-l-4 border-l-teal-800/60 bg-teal-950/20 px-6 py-5">
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Vehicle Condition</p>
      </div>
      <div className="space-y-6 px-6 py-5">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Mileage</p>
            <p className="text-lg font-bold text-zinc-100">
              {typeof submissionData.mileage === "number"
                ? `${submissionData.mileage.toLocaleString()} km`
                : "N/A"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">TUV until</p>
            <p className="text-lg font-bold text-zinc-100">{asString(submissionData.tuvUntil) ?? "N/A"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Number of owners</p>
            <p className="text-lg font-bold text-zinc-100">
              {typeof submissionData.numberOfOwners === "number" ? submissionData.numberOfOwners : "N/A"}
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Number of keys</p>
            <p className="text-lg font-bold text-zinc-100">
              {typeof submissionData.numberOfKeys === "number" ? submissionData.numberOfKeys : "N/A"}
            </p>
          </div>
        </div>

        <div>
          <p className="mb-4 text-base font-bold text-zinc-100">Tyres</p>
          {tyreTypes.length === 0 ? (
            <p className="text-base text-zinc-400">No tyre information.</p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {tyreTypes.map((type) => {
                const details = isRecord(tyreDetails[type]) ? tyreDetails[type] : {};
                return (
                  <div key={type} className="rounded-lg border border-zinc-600 bg-zinc-700/40 p-4">
                    <p className="font-bold text-zinc-100 mb-3">{type}</p>
                    <p className="text-sm text-zinc-300">Rim size: {asString(details.rimSize) ?? "N/A"}</p>
                    <p className="text-sm text-zinc-300">Rim type: {asString(details.rimType) ?? "N/A"}</p>
                    <p className="text-sm text-zinc-300">
                      Tread condition: {asString(details.treadCondition) ?? "N/A"}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <p className="mb-4 text-base font-bold text-zinc-100">Defects</p>
          {vehicleDefects.length === 0 ? (
            <p className="text-base text-zinc-400">No defects reported.</p>
          ) : (
            <div className="space-y-4">
              {vehicleDefects.map((defect, idx) => {
                const photos = Array.isArray(defect.photos)
                  ? defect.photos.filter((photo): photo is string => typeof photo === "string")
                  : [];

                const matchedAssetKeys = photos
                  .map((photo) => resolveAssetForFragment(photo, assets)?.key)
                  .filter((key): key is string => !!key);

                return (
                  <div key={`${String(defect.type ?? "defect")}-${idx}`} className="rounded-lg border border-zinc-600 bg-zinc-700/40 p-4">
                    <p className="text-base font-bold text-zinc-100 mb-2">{asString(defect.type) ?? "Defect"}</p>
                    <p className="text-sm text-zinc-300">{asString(defect.description) ?? "No description"}</p>

                    {matchedAssetKeys.length > 0 ? (
                      <div className="mt-4 flex flex-wrap gap-3">
                        {matchedAssetKeys.map((key) => {
                          const url = defectUrlMap.get(key);
                          if (!url) {
                            return (
                              <div
                                key={key}
                                className="flex h-24 w-24 items-center justify-center rounded-lg border border-zinc-600 bg-zinc-700/50 text-xs text-zinc-500"
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
                              className="block overflow-hidden rounded-lg border border-zinc-600 hover:border-zinc-600 transition"
                            >
                              <img
                                src={url}
                                alt={getFileName(key)}
                                className="h-24 w-24 object-cover"
                                loading="lazy"
                              />
                            </a>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-zinc-500">No linked defect photos found in assets.</p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <p className="mb-3 text-base font-bold text-zinc-100">Charging cable</p>
            <p className="text-base text-zinc-300">Type 2: {formatBool(chargingCable.typ2)}</p>
            <p className="text-base text-zinc-300">Schuko: {formatBool(chargingCable.schuko)}</p>
          </div>
          <div>
            <p className="mb-3 text-base font-bold text-zinc-100">Vehicle documents</p>
            {vehicleDocuments.length === 0 ? (
              <p className="text-base text-zinc-400">No documents listed.</p>
            ) : (
              <ul className="list-disc pl-6 text-base text-zinc-300 space-y-1">
                {vehicleDocuments.map((doc) => (
                  <li key={doc}>{doc}</li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div>
          <p className="mb-4 text-base font-bold text-zinc-100">Status & Agreements</p>
          <ul className="divide-y divide-zinc-700/50 rounded-lg border border-zinc-700 overflow-hidden">
            {boolFlags.map((item) => {
              const isTrue = item.value === true;
              return (
                <li
                  key={item.label}
                  className="flex items-center justify-between px-4 py-3 text-sm"
                >
                  <span className="text-zinc-300">{item.label}</span>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold ${
                      isTrue
                        ? "bg-emerald-900/40 text-emerald-300 ring-1 ring-emerald-700/50"
                        : "bg-zinc-700/40 text-zinc-400 ring-1 ring-zinc-600"
                    }`}
                  >
                    <span>{isTrue ? "✓" : "○"}</span>
                    {isTrue ? "Yes" : "No"}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
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

function ImageUploadCard({
  submissionId,
  onUploaded,
}: {
  submissionId: string;
  onUploaded: () => Promise<void> | void;
}) {
  const [uploadTarget, setUploadTarget] = useState<UploadTarget>("photos");
  const [category, setCategory] = useState<string>("exterior");
  const [statusText, setStatusText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<Array<{ name: string; url: string; isImage: boolean }>>([]);
  const [isExpanded, setIsExpanded] = useState(false);
  const availableCategories = uploadTarget === "photos" ? PHOTO_UPLOAD_CATEGORIES : PAPER_UPLOAD_CATEGORIES;
  const fileInputAccept = uploadTarget === "photos" ? "image/*" : "image/*,.pdf,application/pdf";

  useEffect(() => {
    setCategory(uploadTarget === "photos" ? "exterior" : "registration_document");
    setSelectedFiles([]);
    setStatusText(null);
    setErrorText(null);
  }, [uploadTarget]);

  useEffect(() => {
    const urls = selectedFiles.map((file) => {
      const isImage = file.type.startsWith("image/");
      return {
        name: file.name,
        url: isImage ? URL.createObjectURL(file) : "",
        isImage,
      };
    });
    setPreviewUrls(urls);

    return () => {
      urls.forEach((item) => {
        if (item.url) URL.revokeObjectURL(item.url);
      });
    };
  }, [selectedFiles]);

  const uploadMutation = useMutation({
    mutationFn: async (selected: File[]) => {
      if (selected.length === 0) {
        throw new Error("Please select at least one image.");
      }

      for (let i = 0; i < selected.length; i += 1) {
        const file = selected[i];
        const isImage = file.type.startsWith("image/");
        const isPdf = file.type === "application/pdf";
        if (uploadTarget === "photos" && !isImage) {
          throw new Error(`"${file.name}" is not an image file.`);
        }
        if (uploadTarget === "papers" && !isImage && !isPdf) {
          throw new Error(`"${file.name}" is not a supported paper file.`);
        }
        setStatusText(`Uploading ${i + 1}/${selected.length}: ${file.name}`);
        await uploadSubmissionAssetProxy({
          submissionId,
          file,
          target: uploadTarget,
          category,
        });
      }
      return selected.length;
    },
    onSuccess: async (count) => {
      setErrorText(null);
      setStatusText(`Uploaded ${count} image${count === 1 ? "" : "s"} successfully.`);
      setSelectedFiles([]);
      await onUploaded();
      setTimeout(() => setStatusText(null), 3000);
    },
    onError: (err) => {
      setErrorText(err instanceof Error ? err.message : "Upload failed.");
      setStatusText(null);
    },
  });

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/20 overflow-hidden shadow-inner translate-z-0">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex w-full items-center justify-between px-6 py-4 transition-colors hover:bg-zinc-800/40"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400">
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
          </div>
          <p className="text-sm font-bold text-zinc-100 uppercase tracking-wider">Upload New Assets</p>
        </div>
        <span className={`text-zinc-500 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}>
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
          </svg>
        </span>
      </button>

      {isExpanded && (
        <div className="px-6 py-5 space-y-6 border-t border-zinc-800/60 bg-zinc-900/40">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500" htmlFor="upload-target">
                Upload Type
              </label>
              <select
                id="upload-target"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
                value={uploadTarget}
                onChange={(event) => setUploadTarget(event.target.value as UploadTarget)}
                disabled={uploadMutation.isPending}
              >
                <option value="photos">Fahrzeugfotos (02_Fahrzeugfotos)</option>
                <option value="papers">Fahrzeugpapiere (01_Fahrzeugpapiere)</option>
              </select>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500" htmlFor="upload-category">
                Select Category
              </label>
              <div className="flex flex-wrap gap-2">
                {availableCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`rounded-lg px-4 py-2 text-xs font-bold uppercase tracking-wider transition-all ${
                      category === cat
                        ? "bg-sky-500/20 text-sky-400 ring-1 ring-sky-500/50"
                        : "bg-zinc-800/50 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                Choose Files
              </label>
              <div className="flex items-center gap-3">
                <label className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-700 bg-zinc-800/30 px-4 py-8 text-sm font-bold text-zinc-400 ring-offset-zinc-950 transition-all hover:border-sky-500/40 hover:bg-sky-500/5 hover:text-zinc-200 focus-within:ring-2 focus-within:ring-sky-500 focus-within:ring-offset-2">
                  <input
                    type="file"
                    className="sr-only"
                    multiple
                    accept={fileInputAccept}
                    disabled={uploadMutation.isPending}
                    onChange={(event) => {
                      const files = event.target.files;
                      if (!files || files.length === 0) return;
                      setStatusText(null);
                      setErrorText(null);
                      const selected = Array.from(files).filter((file) => {
                        if (uploadTarget === "photos") return file.type.startsWith("image/");
                        return file.type.startsWith("image/") || file.type === "application/pdf";
                      });
                      if (selected.length === 0) {
                        setErrorText(uploadTarget === "photos" ? "Please select image files." : "Please select image or PDF files.");
                        setSelectedFiles([]);
                        event.target.value = "";
                        return;
                      }
                      setSelectedFiles(selected);
                      event.target.value = "";
                    }}
                  />
                  <svg viewBox="0 0 20 20" fill="currentColor" className="h-6 w-6 opacity-50">
                    <path fillRule="evenodd" d="M15.621 4.379a3 3 0 00-4.242 0l-7 7a3 3 0 004.242 4.242l7-7a3 3 0 000-4.242zM7.5 13.5l5-5" clipRule="evenodd" />
                  </svg>
                  {selectedFiles.length > 0 ? `${selectedFiles.length} files selected` : "Drop files or click to browse"}
                </label>
              </div>
            </div>
          </div>

          {previewUrls.length > 0 && (
            <div className="space-y-3 pt-2">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
                Preview ({previewUrls.length})
              </p>
              <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-8">
                {previewUrls.map((item, index) => (
                  <div key={`${item.name}-${index}`} className="group relative aspect-square overflow-hidden rounded-lg bg-zinc-800 shadow-lg ring-1 ring-white/5">
                    {item.isImage ? (
                      <img
                        src={item.url}
                        alt={item.name}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-110"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs font-black uppercase tracking-wider text-zinc-300">
                        PDF
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4 pt-4 border-t border-zinc-800/60 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex-1">
              {statusText && (
                <div className="flex items-center gap-2 text-xs font-bold text-sky-400">
                  <div className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
                  {statusText}
                </div>
              )}
              {errorText && (
                <div className="flex items-center gap-2 text-xs font-bold text-rose-400">
                  <div className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                  {errorText}
                </div>
              )}
            </div>
            <div className="flex gap-3">
              {selectedFiles.length > 0 && !uploadMutation.isPending && (
                <button
                  type="button"
                  className="px-4 py-2 text-xs font-black uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors"
                  onClick={() => setSelectedFiles([])}
                >
                  Clear Selection
                </button>
              )}
              <button
                type="button"
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-6 py-2 text-xs font-black uppercase tracking-widest text-emerald-950 transition-all hover:bg-emerald-400 hover:scale-105 disabled:cursor-not-allowed disabled:opacity-40 disabled:scale-100 shadow-[0_0_20px_rgba(16,185,129,0.2)]"
                disabled={uploadMutation.isPending || selectedFiles.length === 0}
                onClick={() => uploadMutation.mutate(selectedFiles)}
              >
                {uploadMutation.isPending ? (
                  <>
                    <div className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-950/20 border-t-emerald-950" />
                    UPLOADING...
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.25a.75.75 0 00-1.5 0v2.5h-2.5a.75.75 0 000 1.5h2.5v2.5a.75.75 0 001.5 0v-2.5h2.5a.75.75 0 000-1.5h-2.5v-2.5z" clipRule="evenodd" />
                    </svg>
                    START UPLOAD
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SubmissionMetaCard({ data, m15Detail }: { data: SubmissionDetailType; m15Detail?: SubmissionDetailType | undefined }) {
  return (
    <div className={ui.card}>
      <div className="border-l-4 border-l-violet-800/60 bg-violet-950/20 px-6 py-5">
        <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Submission Details</p>
      </div>
      <div className="space-y-5 px-6 py-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">ID</p>
          <p className="text-sm font-mono text-zinc-300 break-all">{data.id}</p>
          {data.vin && <p className="text-sm text-zinc-400 mt-3">VIN: <span className="font-mono font-semibold text-zinc-100">{data.vin}</span></p>}
        </div>
        <div className="grid grid-cols-2 gap-5 pt-2 border-t border-zinc-700">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Form</p>
            <p className="text-base font-bold text-zinc-100">{data.formIntake?.toUpperCase() ?? "N/A"}</p>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Sync</p>
            <div className="inline-block">
              <SyncBadge status={m15Detail?.pipedriveSyncStatus ?? data.pipedriveSyncStatus} />
            </div>
          </div>
        </div>
        <div className="border-t border-zinc-700 pt-5">
          <div className="grid grid-cols-2 gap-5 text-sm">
            <div>
              <p className="font-semibold text-zinc-400 mb-2 uppercase text-xs tracking-wider">Created</p>
              <p className="text-zinc-300">{formatDate(data.createdAt)}</p>
            </div>
            <div>
              <p className="font-semibold text-zinc-400 mb-2 uppercase text-xs tracking-wider">Updated</p>
              <p className="text-zinc-300">{formatDate(data.updatedAt)}</p>
            </div>
          </div>
        </div>
        <div className="border-t border-zinc-700 pt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Last Synced</p>
          <p className="text-sm text-zinc-300">{formatDate(data.lastSyncedAt)}</p>
        </div>
        <div className="border-t border-zinc-700 pt-5">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">Deal ID</p>
          <p className="text-base font-bold text-zinc-100">{data.pipedriveDealId ?? "N/A"}</p>
        </div>
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
      
      // related.data is CaseSummary[]. Since we filtered by VIN, we check all returned cases
      // for the "target" submission summary that isn't the one we already have.
      const targetCase = related.data.find(c => 
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
          className="text-sm font-medium text-zinc-300 hover:text-zinc-100 hover:underline"
        >
          ← Back to list
        </Link>
        <div className="mt-4 rounded-xl border border-rose-900/60 bg-rose-900/20 p-4 text-sm text-rose-100">
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
  const uploadTargetSubmissionId = m15Detail?.id ?? data.id;

  return (
    <div className="min-h-screen bg-zinc-950">
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Back button and header */}
        <div className="flex items-center justify-between">
          <Link
            to="/submissions"
            className="inline-flex items-center gap-2 text-base font-semibold text-zinc-300 transition hover:text-sky-200"
          >
            ← Back to list
          </Link>
          <div className="flex gap-3 flex-wrap">
            <IntakeBadge intake={hasM1 && hasM15 ? "M1 + M1.5" : data.formIntake} />
            {hasM1 && hasM15 ? (
              <span className={`${ui.badge} ${badgeTone("success")}`}>
                Linked case by VIN
              </span>
            ) : null}
            {isFetchingLinked ? (
              <span className="text-sm text-zinc-500">Checking linked...</span>
            ) : null}
          </div>
        </div>

        {/* Hero section */}
        <div className={ui.card}>
          <div className="bg-gradient-to-r from-zinc-900/90 via-sky-950/20 to-emerald-950/20 px-8 py-8">
            <div className="flex items-start justify-between gap-6">
              <div>
                {caseDat && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">Vehicle</p>
                    <p className="text-4xl font-bold text-white mb-2">
                      {asString(caseDat.make)} {asString(caseDat.model)}
                    </p>
                    <p className="text-lg text-zinc-300">
                      {asString(caseDat.variant)} · {asString(caseDat.description)}
                    </p>
                  </div>
                )}
                {!caseDat && (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-zinc-400 mb-2">VIN</p>
                    <p className="text-2xl font-mono font-bold text-white">{data.vin ?? "N/A"}</p>
                  </div>
                )}
              </div>
              <div className="flex gap-4 flex-wrap justify-end">
                {caseDat && (
                  <span
                    className={`shrink-0 ${ui.badge} ${
                      caseDat.is_confirmed === true
                        ? `${badgeTone("success")}`
                        : `${badgeTone("danger")}`
                    }`}
                  >
                    DAT {caseDat.is_confirmed === true ? "✓" : "✗"}
                  </span>
                )}
                <SyncBadge status={m15Detail?.pipedriveSyncStatus ?? data.pipedriveSyncStatus} />
                {effectiveDealId && (
                  <span className={`shrink-0 ${ui.badge} ${badgeTone("success")}`}>
                    Deal #{effectiveDealId}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Main 2-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left column (2/3) */}
          <div className="lg:col-span-2 space-y-8">
            {/* Data Audit Section */}
            {vehicleConditionData && caseDat && (
              <div>
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-zinc-400">Data Audit & Comparison</p>
                <DataAuditSection
                  submissionData={vehicleConditionData}
                  dat={caseDat}
                  vinHistory={caseVinHistory}
                />
              </div>
            )}

            {/* Vehicle Card */}
            {caseDat && <VehicleCard dat={caseDat} />}

            {/* Vehicle Condition Card */}
            {hasM15 ? (
              <VehicleConditionCard
                submissionData={vehicleConditionData}
                assets={caseAssets}
                assetSubmissionId={m15Detail?.id ?? data.id}
              />
            ) : (
              <div className={`${ui.card} p-6`}>
                <p className="text-base text-zinc-400">No M1.5 submission linked yet.</p>
              </div>
            )}

            {/* Assets */}
            <div className={ui.card}>
              <div className="border-l-4 border-l-emerald-800/60 bg-emerald-950/20 px-6 py-5">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Assets ({caseAssets.length})</p>
              </div>
              <div className="px-6 py-5">
                <ImageUploadCard
                  submissionId={uploadTargetSubmissionId}
                  onUploaded={async () => {
                    await Promise.all([
                      queryClient.invalidateQueries({ queryKey: ["submission"] }),
                      queryClient.invalidateQueries({ queryKey: ["linked-submission"] }),
                    ]);
                  }}
                />
                {caseAssets.length === 0 ? (
                  <p className="mt-5 text-base text-zinc-400">No assets available.</p>
                ) : (
                  <div className="mt-5">
                    <AssetGallery
                      assets={caseAssets}
                      submissionId={uploadTargetSubmissionId}
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

          {/* Right column (1/3) - Sidebar */}
          <div className="space-y-8">
            {/* Submission Meta */}
            <SubmissionMetaCard data={data} m15Detail={m15Detail} />

            {/* Seller Card */}
            {hasM1 ? (
              sellerSubmissionData ? (
                <SellerCard submissionData={sellerSubmissionData} />
              ) : (
                <div className={`${ui.card} p-6`}>
                  <p className="text-base text-zinc-300">M1 submission found but data is missing.</p>
                </div>
              )
            ) : (hasM15 && !isFetchingLinked) ? (
              <div className={`${ui.card} p-6`}>
                <p className="text-base text-zinc-400">M1 form not linked yet.</p>
              </div>
            ) : null}

            {/* Checks & Status */}
            <div className={ui.card}>
              <div className="border-l-4 border-l-indigo-800/60 bg-indigo-950/20 px-6 py-5">
                <p className="text-xs font-bold uppercase tracking-wider text-zinc-400">Checks & Status</p>
              </div>
              <div className="space-y-5 px-6 py-5">
                {/* VIN History */}
                {caseVinHistory && typeof caseVinHistory.match_count === "number" && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">VIN History</p>
                    <span
                      className={`inline-flex rounded-lg px-4 py-2 text-sm font-bold border ${
                        caseVinHistory.match_count > 0
                          ? "bg-zinc-800 text-zinc-200 ring-1 ring-zinc-600/50 border-zinc-600/30"
                          : "bg-zinc-700/20 text-zinc-200 ring-1 ring-zinc-600/50 border-zinc-600/30"
                      }`}
                    >
                      {caseVinHistory.match_count} match{caseVinHistory.match_count !== 1 ? "es" : ""}
                    </span>
                  </div>
                )}

                {/* Image Processing Jobs */}
                {caseImageJobs.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-3">Image Processing</p>
                    {(() => {
                      const latestJob = caseImageJobs[0];
                      const rawStatus = asString(latestJob.status) ?? "unknown";
                      const completed = rawStatus.toLowerCase() === "completed";
                      return (
                        <span
                          className={`inline-flex rounded-lg px-4 py-2 text-sm font-bold border ${
                            completed
                              ? "bg-zinc-700/20 text-zinc-200 ring-1 ring-zinc-600/50 border-zinc-600/30"
                              : "bg-zinc-800 text-zinc-200 ring-1 ring-zinc-600/50 border-zinc-600/30"
                          }`}
                        >
                          {rawStatus}
                        </span>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
