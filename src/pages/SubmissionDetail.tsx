import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getSubmission } from "../api/client";
import type { Stage } from "../types/submission";
import StageBadge from "../components/StageBadge";
import DataSection from "../components/DataSection";
import AssetGallery from "../components/AssetGallery";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function flattenFormData(
  formData?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!formData) return undefined;
  // Remove keys that already have dedicated sections
  const { vehicle, seller, ...rest } = formData as {
    vehicle?: unknown;
    seller?: unknown;
    [k: string]: unknown;
  };
  void vehicle;
  void seller;
  return Object.keys(rest).length ? rest : undefined;
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
      <div className="flex items-center gap-2 text-gray-500 py-10">
        <span className="animate-spin text-lg">⟳</span> Loading submission…
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <Link to="/submissions" className="text-blue-600 hover:underline text-sm">
          ← Back to list
        </Link>
        <div className="mt-4 rounded bg-red-50 border border-red-200 text-red-800 p-4 text-sm">
          <strong>Error:</strong>{" "}
          {error instanceof Error ? error.message : "Failed to load submission"}
        </div>
      </div>
    );
  }

  if (!data) return null;

  const otherFormData = flattenFormData(data.formData);

  return (
    <div>
      {/* Back */}
      <Link to="/submissions" className="text-blue-600 hover:underline text-sm">
        ← Back to list
      </Link>

      {/* Header */}
      <div className="mt-4 mb-6 p-5 bg-white rounded border border-gray-200">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Submission ID</p>
            <p className="font-mono text-lg font-semibold">{data.id}</p>
          </div>
          {data.vin && (
            <div>
              <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">VIN</p>
              <p className="font-mono text-lg font-semibold">{data.vin}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Stage</p>
            <StageBadge stage={data.stage as Stage} />
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Last updated</p>
            <p className="text-sm text-gray-700">{formatDate(data.updatedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">Assets</p>
            <p className="text-sm text-gray-700">{data.assetCount}</p>
          </div>
        </div>
      </div>

      {/* Body – single column */}
      <div className="flex flex-col gap-6">
        <DataSection title="Vehicle" data={data.vehicle} />
        <DataSection title="Seller" data={data.seller} />
        <DataSection title="Form data" data={otherFormData} />
        {!data.vehicle && !data.seller && !otherFormData && (
          <div className="text-gray-400 text-sm italic">No structured form data available.</div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Assets ({data.assets.length})
          </h3>
          {data.assets.length === 0 ? (
            <p className="text-gray-400 text-sm italic">No assets.</p>
          ) : (
            <AssetGallery assets={data.assets} submissionId={data.id} />
          )}
        </div>
      </div>
    </div>
  );
}
