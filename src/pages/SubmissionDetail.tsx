import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { getSubmission } from "../api/client";
import DataSection from "../components/DataSection";
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

function getImageJobStatus(jobs: Array<Record<string, unknown>>) {
  if (jobs.length === 0) return { label: "unknown", isCompleted: false };

  const latestJob = jobs[0];
  const rawStatus = latestJob.status;
  const status = typeof rawStatus === "string" && rawStatus.trim() ? rawStatus : "unknown";

  const result =
    latestJob.result && typeof latestJob.result === "object"
      ? (latestJob.result as Record<string, unknown>)
      : undefined;
  const failed = typeof result?.failed === "number" ? result.failed : undefined;

  const isCompleted = status.toLowerCase() === "completed" && failed === 0;
  return { label: isCompleted ? "completed" : status, isCompleted };
}

function StatusRow({
  label,
  badgeText,
  badgeClass,
  expandLabel,
  children,
}: {
  label: string;
  badgeText: string;
  badgeClass: string;
  expandLabel?: { collapsed: string; expanded: string };
  children?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <tbody>
            <tr>
              <td className="w-1/3 whitespace-nowrap px-3 py-2 font-medium text-gray-600">
                {label}
              </td>
              <td className="px-3 py-2 text-gray-800">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClass}`}
                >
                  {badgeText}
                </span>
              </td>
              {expandLabel && children ? (
                <td className="w-1 whitespace-nowrap px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => setExpanded((p) => !p)}
                    className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                  >
                    {expanded ? expandLabel.expanded : expandLabel.collapsed}
                  </button>
                </td>
              ) : (
                <td />
              )}
            </tr>
          </tbody>
        </table>
      </div>
      {expanded && children ? children : null}
    </div>
  );
}

function ImageProcessingJobsSection({ jobs }: { jobs: Array<Record<string, unknown>> }) {
  if (jobs.length === 0) return null;

  const { label, isCompleted } = getImageJobStatus(jobs);
  const badgeClass = isCompleted
    ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/90"
    : "bg-red-100 text-red-800 ring-1 ring-red-200/90";

  return (
    <StatusRow
      label="Image Processing"
      badgeText={label}
      badgeClass={badgeClass}
      expandLabel={{ collapsed: "Show raw JSON", expanded: "Hide raw JSON" }}
    >
      <pre className="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
        {JSON.stringify(jobs, null, 2)}
      </pre>
    </StatusRow>
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

function str(val: unknown): string | undefined {
  if (val === null || val === undefined || val === "") return undefined;
  return String(val);
}

function EquipmentList({
  title,
  items,
}: {
  title: string;
  items: Array<Record<string, unknown>>;
}) {
  const [expanded, setExpanded] = useState(false);
  if (items.length === 0) return null;
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
        </span>
      </button>
      {expanded && (
        <ul className="mt-1 ml-5 list-disc space-y-0.5 text-sm text-gray-700">
          {items.map((eq) => (
            <li key={String(eq.datEquipmentId ?? eq.description)}>
              {String(eq.description ?? "—")}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VehicleCard({ dat }: { dat: Record<string, unknown> }) {
  const make = str(dat.make);
  const model = str(dat.model);
  const variant = str(dat.variant);
  const vehicleName = [make, model, variant].filter(Boolean).join(" ") || "Unknown vehicle";

  const firstReg = str(dat.first_registration);
  const mileage = typeof dat.mileage === "number" ? dat.mileage : undefined;
  const powerKw = typeof dat.power_kw === "number" ? dat.power_kw : undefined;
  const fuel = str(dat.fuel_method);
  const drive = str(dat.drive_type);
  const capacity = typeof dat.capacity === "number" ? dat.capacity : undefined;
  const country = str(dat.country);
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
            <EquipmentList title="Special equipment" items={specialEquipments} />
            <EquipmentList title="Standard equipment" items={standardEquipments} />
            <EquipmentList title="Extra equipment" items={extraEquipments} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function SubmissionDetail() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["submission", id],
    queryFn: () => getSubmission(id!),
    enabled: !!id,
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

  const dat = data.datInformation as Record<string, unknown> | null | undefined;

  return (
    <div>
      <Link
        to="/submissions"
        className="text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
      >
        ← Back to list
      </Link>

      <div className="mb-6 mt-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.14em] text-gray-500">Submission ID</p>
            <p className="font-mono text-lg font-semibold">{data.id}</p>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.14em] text-gray-500">VIN</p>
            <p className="font-mono text-lg font-semibold">{data.vin ?? "N/A"}</p>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.14em] text-gray-500">Form intake</p>
            <IntakeBadge intake={data.formIntake} />
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.14em] text-gray-500">Sync status</p>
            <SyncBadge status={data.pipedriveSyncStatus} />
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
            <p className="text-sm text-gray-700">{data.pipedriveDealId ?? "N/A"}</p>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase tracking-[0.14em] text-gray-500">Assets</p>
            <p className="text-sm text-gray-700">{data.assetCount}</p>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-6">
        {dat && <VehicleCard dat={dat} />}

        <DataSection title="Submission Data (JSONB)" data={data.submissionData ?? undefined} />

        <VinHistoryRow vinHistory={data.vinHistory} />
        <ImageProcessingJobsSection jobs={data.imageProcessingJobs} />

        {!dat &&
          !data.submissionData &&
          !data.vinHistory &&
          data.imageProcessingJobs.length === 0 && (
            <div className="text-sm italic text-gray-400">No enrichment data available.</div>
          )}

        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-gray-500">
            Assets ({data.assets.length})
          </h3>
          {data.assets.length === 0 ? (
            <p className="text-sm italic text-gray-400">No assets.</p>
          ) : (
            <AssetGallery assets={data.assets} submissionId={data.id} />
          )}
        </div>
      </div>
    </div>
  );
}
