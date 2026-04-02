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

function ImageProcessingJobsSection({ jobs }: { jobs: Array<Record<string, unknown>> }) {
  const [showRawJson, setShowRawJson] = useState(false);
  if (jobs.length === 0) return null;

  const { label, isCompleted } = getImageJobStatus(jobs);
  const badgeClass =
    isCompleted
      ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/90"
      : "bg-red-100 text-red-800 ring-1 ring-red-200/90";

  return (
    <div>
      <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
        <table className="min-w-full text-sm">
          <tbody className="divide-y divide-gray-100">
            <tr className="even:bg-emerald-50/30">
              <td className="w-1/3 whitespace-nowrap px-3 py-2 font-medium text-gray-600">
                Image Processing Job
              </td>
              <td className="px-3 py-2 text-gray-800">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${badgeClass}`}
                >
                  {label}
                </span>
              </td>
              <td className="w-1 whitespace-nowrap px-3 py-2 text-right">
                <button
                  type="button"
                  onClick={() => setShowRawJson((prev) => !prev)}
                  className="rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100"
                >
                  {showRawJson ? "Hide raw JSON" : "Show raw JSON"}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {showRawJson ? (
        <pre className="mt-2 overflow-x-auto rounded-xl border border-gray-200 bg-gray-50 p-3 text-xs leading-relaxed text-gray-700">
          {JSON.stringify(jobs, null, 2)}
        </pre>
      ) : null}
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
        <DataSection
          title="Submission (DB)"
          data={data.submission}
          excludeKeys={["submission_data"]}
        />
        <DataSection title="Submission Data (JSONB)" data={data.submissionData ?? undefined} />
        <DataSection title="DAT Information" data={data.datInformation ?? undefined} />
        <DataSection title="VIN History" data={data.vinHistory ?? undefined} />
        <ImageProcessingJobsSection jobs={data.imageProcessingJobs} />
        {!data.submissionData &&
          !data.datInformation &&
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
