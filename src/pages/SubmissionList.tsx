import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { batchPresignUrls, listSubmissions } from "../api/client";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function toStartOfDayIso(date: string): string | undefined {
  if (!date) return undefined;
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function toEndOfDayIso(date: string): string | undefined {
  if (!date) return undefined;
  const d = new Date(`${date}T23:59:59.999`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

function SubmissionThumbnail({ url }: { url?: string }) {
  if (!url) {
    return <div className="h-14 w-14 rounded-lg border border-gray-200 bg-gray-100" />;
  }
  return (
    <img
      src={url}
      alt="Submission thumbnail"
      className="h-14 w-14 rounded-lg border border-gray-200 object-cover"
      loading="lazy"
    />
  );
}

function IntakeBadge({ intake }: { intake?: string | null }) {
  const normalized = intake?.toLowerCase();
  const style =
    normalized === "advance"
      ? "bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/90"
      : normalized === "initial"
        ? "bg-teal-100 text-teal-800 ring-1 ring-teal-200/90"
        : "bg-gray-100 text-gray-600 ring-1 ring-gray-200/90";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${style}`}>
      {intake ?? "unknown"}
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

export default function SubmissionList() {
  const navigate = useNavigate();
  const [vin, setVin] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const deferredVin = useDeferredValue(vin);

  const params = useMemo(
    () => ({
      vin: deferredVin.trim() || undefined,
      from: toStartOfDayIso(fromDate),
      to: toEndOfDayIso(toDate),
      page,
      pageSize,
    }),
    [deferredVin, fromDate, toDate, page, pageSize]
  );

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["submissions", params],
    queryFn: () => listSubmissions(params),
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
  });

  const thumbnailItems = useMemo(
    () =>
      (data?.data ?? [])
        .filter((s) => s.thumbnailKey)
        .map((s) => ({ id: s.id, key: s.thumbnailKey! })),
    [data?.data]
  );
  const { data: thumbnailResults } = useQuery({
    queryKey: ["list-thumbnails", thumbnailItems.map((i) => i.key)],
    queryFn: () => batchPresignUrls(thumbnailItems),
    enabled: thumbnailItems.length > 0,
    staleTime: 50 * 60 * 1000,
  });
  const thumbnailUrlMap = useMemo(() => {
    const map = new Map<string, string>();
    if (thumbnailResults) {
      thumbnailItems.forEach(({ id, key }) => {
        const found = thumbnailResults.find((r) => r.key === key);
        if (found?.url) map.set(id, found.url);
      });
    }
    return map;
  }, [thumbnailResults, thumbnailItems]);

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0;

  function handleFilterChange() {
    setPage(1);
  }

  function clearFilters() {
    setVin("");
    setFromDate("");
    setToDate("");
    setPageSize(20);
    setPage(1);
  }

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Submissions</h1>
          <p className="mt-1 text-sm text-gray-500">
            DB-backed list with S3 asset enrichment
          </p>
        </div>
        {data && (
          <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-sm font-medium text-gray-600 shadow-sm">
            {data.total} total
          </span>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">
          VIN
          <input
            type="search"
            placeholder="Filter by VIN..."
            value={vin}
            onChange={(e) => {
              setVin(e.target.value);
              handleFilterChange();
            }}
            className="w-64 rounded-xl border border-gray-300 px-3 py-2 text-sm normal-case tracking-normal transition focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              handleFilterChange();
            }}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm normal-case tracking-normal transition focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              handleFilterChange();
            }}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm normal-case tracking-normal transition focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs font-medium uppercase tracking-wide text-gray-500">
          Page size
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              handleFilterChange();
            }}
            className="rounded-xl border border-gray-300 px-3 py-2 text-sm normal-case tracking-normal transition focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
          >
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>

        {(vin || fromDate || toDate || pageSize !== 20) && (
          <button
            onClick={clearFilters}
            className="mb-0.5 text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-10 text-gray-500">
          <span className="animate-spin text-lg">⟳</span> Loading submissions...
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error loading submissions:</strong>{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </div>
      )}

      {data && data.data.length === 0 && !isLoading && (
        <p className="py-10 text-center text-gray-500">No submissions match your filters.</p>
      )}

      {data && data.data.length > 0 && (
        <div className="relative">
          {isFetching && !isLoading && (
            <div className="absolute right-0 top-0 py-1 text-xs text-gray-400">refreshing...</div>
          )}
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-200 bg-emerald-50/60">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Thumbnail</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">ID</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">VIN</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Form</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Sync</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Updated</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Deal</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Assets</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.data.map((s) => (
                  <tr
                    key={s.id}
                    className="cursor-pointer transition hover:bg-emerald-50/40"
                    onClick={() => navigate(`/submissions/${encodeURIComponent(s.id)}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(`/submissions/${encodeURIComponent(s.id)}`);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td className="px-4 py-2">
                      <SubmissionThumbnail url={thumbnailUrlMap.get(s.id)} />
                    </td>
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs font-semibold text-emerald-700">
                        {s.id}
                      </span>
                    </td>
                    <td className="px-4 py-2 font-mono text-xs text-gray-700">
                      {s.vin ?? "N/A"}
                    </td>
                    <td className="px-4 py-2">
                      <IntakeBadge intake={s.formIntake} />
                    </td>
                    <td className="px-4 py-2">
                      <SyncBadge status={s.pipedriveSyncStatus} />
                    </td>
                    <td className="px-4 py-2 whitespace-nowrap text-gray-600">
                      {formatDate(s.updatedAt)}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {s.pipedriveDealId ?? "N/A"}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{s.assetCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-3 flex items-center justify-between text-sm">
              <span className="text-gray-500">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="rounded-xl border border-gray-300 bg-white px-3 py-1.5 font-medium text-gray-700 transition hover:border-emerald-300 hover:bg-emerald-50 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
