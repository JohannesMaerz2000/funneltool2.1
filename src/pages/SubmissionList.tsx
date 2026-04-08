import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { batchPresignUrls, listSubmissions } from "../api/client";
import { badgeTone, ui } from "../components/ui";
import type { CaseSummary } from "../types/submission";

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
    return <div className="h-16 w-16 rounded-lg border border-zinc-700 bg-zinc-800/70" />;
  }
  return (
    <img
      src={url}
      alt="Submission thumbnail"
      className="h-16 w-16 rounded-lg border border-zinc-700 object-cover"
      loading="lazy"
    />
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

function CaseIntakeBadge({ hasM1, hasM15 }: { hasM1: boolean; hasM15: boolean }) {
  if (hasM1 && hasM15) {
    return <span className={`${ui.badge} ${badgeTone("success")}`}>M1 + M1.5</span>;
  }

  if (hasM15) {
    return <span className={`${ui.badge} ${badgeTone("success")}`}>M1.5</span>;
  }

  if (hasM1) {
    return <span className={`${ui.badge} ${badgeTone("success")}`}>M1</span>;
  }

  return <span className={`${ui.badge} ${badgeTone("neutral")}`}>unknown</span>;
}

export default function SubmissionList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);

  const params = useMemo(
    () => ({
      from: toStartOfDayIso(fromDate),
      to: toEndOfDayIso(toDate),
      page,
      pageSize,
    }),
    [fromDate, toDate, page, pageSize]
  );

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["submissions", params],
    queryFn: () => listSubmissions(params),
    staleTime: 2 * 60_000,
    placeholderData: keepPreviousData,
  });

  const caseRows = useMemo(() => {
    const grouped = data?.data ?? [];
    if (!deferredSearch.trim()) return grouped;

    const searchLower = deferredSearch.toLowerCase().trim();
    return grouped.filter((row: CaseSummary) => {
      const vinMatch = row.vin?.toLowerCase().includes(searchLower);
      const dealIdMatch = row.pipedriveDealId?.toLowerCase().includes(searchLower);
      return vinMatch || dealIdMatch;
    });
  }, [data?.data, deferredSearch]);

  const thumbnailItems = useMemo(
    () =>
      caseRows
        .filter((row) => row.thumbnailKey)
        .map((row) => ({ id: row.openId, key: row.thumbnailKey! })),
    [caseRows]
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
    setSearch("");
    setFromDate("");
    setToDate("");
    setPageSize(20);
    setPage(1);
  }

  return (
    <div>
      <div className="mb-8 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-100">Submissions</h1>
          <p className="mt-2 text-base text-zinc-400">VIN-grouped cases (M1 + M1.5)</p>
        </div>
        {data && <span className={`${ui.badge} ${badgeTone("info")}`}>{data.total} cases found</span>}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="flex h-10 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 focus-within:border-zinc-500 focus-within:ring-2 focus-within:ring-zinc-500/25 transition">
          <svg className="h-3.5 w-3.5 shrink-0 text-zinc-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9 3a6 6 0 100 12A6 6 0 009 3zM1 9a8 8 0 1114.32 4.906l3.387 3.387a1 1 0 01-1.414 1.414l-3.387-3.387A8 8 0 011 9z" clipRule="evenodd" />
          </svg>
          <input
            type="search"
            placeholder="VIN or Deal ID..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); handleFilterChange(); }}
            className="w-52 bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
        </div>

        {/* From date */}
        <div className="flex h-10 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 focus-within:border-zinc-500 focus-within:ring-2 focus-within:ring-zinc-500/25 transition">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">From</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => { setFromDate(e.target.value); handleFilterChange(); }}
            className="bg-transparent text-sm text-zinc-100 focus:outline-none [color-scheme:dark]"
          />
        </div>

        {/* To date */}
        <div className="flex h-10 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 focus-within:border-zinc-500 focus-within:ring-2 focus-within:ring-zinc-500/25 transition">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">To</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => { setToDate(e.target.value); handleFilterChange(); }}
            className="bg-transparent text-sm text-zinc-100 focus:outline-none [color-scheme:dark]"
          />
        </div>

        {/* Page size */}
        <div className="flex h-10 items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 focus-within:border-zinc-500 focus-within:ring-2 focus-within:ring-zinc-500/25 transition">
          <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Show</span>
          <div className="relative flex items-center">
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); handleFilterChange(); }}
              className="appearance-none bg-transparent pr-6 text-sm font-semibold text-zinc-100 focus:outline-none"
            >
              <option value={20}>20</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <svg className="pointer-events-none absolute right-0 h-3.5 w-3.5 text-zinc-500" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </div>
          <span className="text-xs font-medium text-zinc-500">per page</span>
        </div>

        {/* Clear */}
        {(search || fromDate || toDate || pageSize !== 20) && (
          <button
            onClick={clearFilters}
            className="flex h-10 items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900 px-4 text-sm font-semibold text-zinc-400 transition hover:border-zinc-500 hover:text-zinc-100"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
            Clear
          </button>
        )}

      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-12 text-zinc-400">
          <span className="animate-spin text-xl">⟳</span> Loading submissions...
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-rose-900/70 bg-rose-900/20 p-6 text-base text-rose-200">
          <strong>Error loading submissions:</strong> {error instanceof Error ? error.message : "Unknown error"}
        </div>
      )}

      {data && caseRows.length === 0 && !isLoading && (
        <p className="py-12 text-center text-base text-zinc-400">No submissions match your filters.</p>
      )}

      {data && caseRows.length > 0 && (
        <div className="relative">
          {isFetching && !isLoading && (
            <div className="absolute right-0 top-0 py-2 text-sm text-zinc-500">Refreshing...</div>
          )}

          <div className={`${ui.card} overflow-x-auto`}>
            <table className="min-w-full text-sm">
              <thead className="border-b border-zinc-800 bg-zinc-900/90">
                <tr>
                  <th className="px-6 py-4 text-left font-semibold text-zinc-300">Thumbnail</th>
                  <th className="px-6 py-4 text-left font-semibold text-zinc-300">VIN</th>
                  <th className="px-6 py-4 text-left font-semibold text-zinc-300">Forms</th>
                  <th className="px-6 py-4 text-left font-semibold text-zinc-300">Sync</th>
                  <th className="px-6 py-4 text-left font-semibold text-zinc-300">Updated</th>
                  <th className="px-6 py-4 text-left font-semibold text-zinc-300">Deal</th>
                  <th className="px-6 py-4 text-left font-semibold text-zinc-300">Assets</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {caseRows.map((row, idx) => (
                  <tr
                    key={row.caseKey}
                    className={`cursor-pointer transition hover:bg-zinc-800 ${idx % 2 === 0 ? "bg-zinc-900/50" : "bg-zinc-900/20"}`}
                    onClick={() => navigate(`/submissions/${encodeURIComponent(row.openId)}`)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        navigate(`/submissions/${encodeURIComponent(row.openId)}`);
                      }
                    }}
                    tabIndex={0}
                  >
                    <td className="px-6 py-4">
                      <SubmissionThumbnail url={thumbnailUrlMap.get(row.openId)} />
                    </td>
                    <td className="px-6 py-4 font-mono text-xs text-zinc-300">{row.vin ?? "N/A"}</td>
                    <td className="px-6 py-4">
                      <CaseIntakeBadge hasM1={!!row.m1} hasM15={!!row.m15} />
                    </td>
                    <td className="px-6 py-4">
                      <SyncBadge status={row.pipedriveSyncStatus} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-zinc-300">{formatDate(row.updatedAt)}</td>
                    <td className="px-6 py-4 text-zinc-300">{row.pipedriveDealId ?? "N/A"}</td>
                    <td className="px-6 py-4 font-semibold text-zinc-300">{row.assetCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between text-sm">
              <span className="text-zinc-400">
                Page <span className="font-semibold text-zinc-100">{page}</span> of <span className="font-semibold text-zinc-100">{totalPages}</span>
              </span>
              <div className="flex gap-3">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className={`${ui.button} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className={`${ui.button} disabled:cursor-not-allowed disabled:opacity-40`}
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
