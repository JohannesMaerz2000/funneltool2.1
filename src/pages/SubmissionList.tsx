import { useDeferredValue, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { batchPresignUrls, listSubmissions } from "../api/client";
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
    return <div className="h-16 w-16 rounded-lg border border-slate-600 bg-slate-700/50" />;
  }
  return (
    <img
      src={url}
      alt="Submission thumbnail"
      className="h-16 w-16 rounded-lg border border-slate-600 object-cover"
      loading="lazy"
    />
  );
}

function SyncBadge({ status }: { status?: string | null }) {
  const normalized = status?.toLowerCase();
  const style =
    normalized === "completed"
      ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/50 border border-emerald-400/30"
      : normalized === "pending"
        ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/50 border border-amber-400/30"
        : normalized === "failed"
          ? "bg-red-500/20 text-red-300 ring-1 ring-red-400/50 border border-red-400/30"
          : "bg-slate-600/40 text-slate-300 ring-1 ring-slate-500/50 border border-slate-500/30";
  return (
    <span className={`inline-flex rounded-lg px-3 py-1.5 text-sm font-bold ${style}`}>
      {status ?? "unknown"}
    </span>
  );
}

// CaseRow from the server is now used directly as CaseSummary

function CaseIntakeBadge({ hasM1, hasM15 }: { hasM1: boolean; hasM15: boolean }) {
  if (hasM1 && hasM15) {
    return (
      <span className="inline-flex rounded-lg bg-emerald-500/20 px-3 py-1.5 text-sm font-bold text-emerald-300 ring-1 ring-emerald-400/50 border border-emerald-400/30">
        M1 + M1.5
      </span>
    );
  }

  if (hasM15) {
    return (
      <span className="inline-flex rounded-lg bg-emerald-500/20 px-3 py-1.5 text-sm font-bold text-emerald-300 ring-1 ring-emerald-400/50 border border-emerald-400/30">
        M1.5
      </span>
    );
  }

  if (hasM1) {
    return (
      <span className="inline-flex rounded-lg bg-cyan-500/20 px-3 py-1.5 text-sm font-bold text-cyan-300 ring-1 ring-cyan-400/50 border border-cyan-400/30">
        M1
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-lg bg-slate-600/40 px-3 py-1.5 text-sm font-bold text-slate-300 ring-1 ring-slate-500/50 border border-slate-500/30">
      unknown
    </span>
  );
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
          <h1 className="text-4xl font-bold tracking-tight text-white">Submissions</h1>
          <p className="mt-2 text-lg text-slate-400">VIN-grouped cases (M1 + M1.5)</p>
        </div>
        {data && (
          <span className="rounded-lg border border-emerald-400/30 bg-emerald-500/20 px-4 py-2 text-base font-bold text-emerald-300 shadow-lg">
            {data.total} cases found
          </span>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-end gap-4 rounded-lg border border-slate-700 bg-slate-800/40 p-6 shadow-lg">
        <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          Search (VIN or Deal ID)
          <input
            type="search"
            placeholder="Filter by VIN or Deal ID..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              handleFilterChange();
            }}
            className="w-72 rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-base normal-case tracking-normal text-slate-100 placeholder-slate-500 transition focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
          />
        </label>

        <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          From
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value);
              handleFilterChange();
            }}
            className="rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-base normal-case tracking-normal text-slate-100 transition focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
          />
        </label>

        <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          To
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value);
              handleFilterChange();
            }}
            className="rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-base normal-case tracking-normal text-slate-100 transition focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
          />
        </label>

        <label className="flex flex-col gap-2 text-xs font-bold uppercase tracking-wider text-slate-400">
          Page size
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              handleFilterChange();
            }}
            className="rounded-lg border border-slate-600 bg-slate-700/50 px-4 py-2.5 text-base normal-case tracking-normal text-slate-100 transition focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-400/30"
          >
            <option value={20}>20</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </label>

        {(search || fromDate || toDate || pageSize !== 20) && (
          <button
            onClick={clearFilters}
            className="mb-1 text-base font-bold text-emerald-400 hover:text-emerald-300 transition"
          >
            Clear
          </button>
        )}
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-12 text-slate-400">
          <span className="animate-spin text-2xl">⟳</span> Loading submissions...
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-red-600/40 bg-red-900/20 p-6 text-base text-red-300">
          <strong>Error loading submissions:</strong>{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </div>
      )}

      {data && caseRows.length === 0 && !isLoading && (
        <p className="py-12 text-center text-lg text-slate-400">No submissions match your filters.</p>
      )}

      {data && caseRows.length > 0 && (
        <div className="relative">
          {isFetching && !isLoading && (
            <div className="absolute right-0 top-0 py-2 text-sm text-slate-500">refreshing...</div>
          )}
          <div className="overflow-x-auto rounded-lg border border-slate-700 bg-slate-800/40 shadow-lg">
            <table className="min-w-full text-base">
              <thead className="border-b border-slate-700 bg-slate-800/60">
                <tr>
                  <th className="px-6 py-4 text-left font-bold text-slate-300">Thumbnail</th>
                  <th className="px-6 py-4 text-left font-bold text-slate-300">VIN</th>
                  <th className="px-6 py-4 text-left font-bold text-slate-300">Forms</th>
                  <th className="px-6 py-4 text-left font-bold text-slate-300">Sync</th>
                  <th className="px-6 py-4 text-left font-bold text-slate-300">Updated</th>
                  <th className="px-6 py-4 text-left font-bold text-slate-300">Deal</th>
                  <th className="px-6 py-4 text-left font-bold text-slate-300">Assets</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {caseRows.map((row, idx) => (
                  <tr
                    key={row.caseKey}
                    className={`cursor-pointer transition hover:bg-slate-700/40 ${idx % 2 === 0 ? "bg-slate-800/20" : "bg-slate-800/40"}`}
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
                    <td className="px-6 py-4 font-mono text-sm text-slate-300">{row.vin ?? "N/A"}</td>
                    <td className="px-6 py-4">
                      <CaseIntakeBadge hasM1={!!row.m1} hasM15={!!row.m15} />
                    </td>
                    <td className="px-6 py-4">
                      <SyncBadge status={row.pipedriveSyncStatus} />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-slate-300">{formatDate(row.updatedAt)}</td>
                    <td className="px-6 py-4 text-slate-300">{row.pipedriveDealId ?? "N/A"}</td>
                    <td className="px-6 py-4 text-slate-300 font-semibold">{row.assetCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between text-base">
              <span className="text-slate-400">
                Page <span className="font-bold text-white">{page}</span> of <span className="font-bold text-white">{totalPages}</span>
              </span>
              <div className="flex gap-3">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="rounded-lg border border-slate-600 bg-slate-800/50 px-4 py-2.5 font-bold text-slate-300 transition hover:border-emerald-400 hover:bg-slate-700 hover:text-slate-100 disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="rounded-lg border border-slate-600 bg-slate-800/50 px-4 py-2.5 font-bold text-slate-300 transition hover:border-emerald-400 hover:bg-slate-700 hover:text-slate-100 disabled:opacity-40"
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
