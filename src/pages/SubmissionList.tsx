import { useDeferredValue, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { batchPresignUrls, listSubmissions } from "../api/client";
import { badgeTone, ui } from "../components/ui";
import { formatDateTime } from "../utils/dateUtils";
import type { CaseSummary } from "../types/submission";

type ViewTab = "initial" | "partial" | "advance";
const DEFAULT_VIEWS: ViewTab[] = ["initial", "partial", "advance"];

function parseViewsParam(raw: string | null): ViewTab[] {
  if (!raw) return DEFAULT_VIEWS;
  const parsed = raw
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is ViewTab => value === "initial" || value === "partial" || value === "advance");
  const unique = [...new Set(parsed)];
  return unique.length > 0 ? unique : DEFAULT_VIEWS;
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
    return <div className="h-16 w-16 rounded-lg border border-zinc-200 bg-zinc-100" />;
  }
  return (
    <img
      src={url}
      alt="Submission thumbnail"
      className="h-16 w-16 rounded-lg border border-zinc-200 object-cover shadow-sm"
      loading="lazy"
    />
  );
}

function SyncBadge({ status }: { status?: string | null }) {
  const normalized = status?.toLowerCase();
  const tone =
    normalized === "completed"
      ? "success"
      : normalized === "partial" || normalized === "pending"
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

function IntakeBadge({ view }: { view: ViewTab }) {
  if (view === "initial") {
    return <span className={`${ui.badge} ${badgeTone("info")}`}>initial</span>;
  }
  return <span className={`${ui.badge} ${badgeTone("success")}`}>advance</span>;
}

function formatSource(source?: string | null): string {
  if (!source) return "unknown";
  return source.toLowerCase();
}

function SourceBadge({ source }: { source?: string | null }) {
  const normalized = formatSource(source);
  const tone =
    normalized === "internal_form"
      ? "info"
      : normalized === "feathery"
        ? "warn"
        : "neutral";

  return <span className={`${ui.badge} ${badgeTone(tone)}`}>{normalized}</span>;
}

function getAdvanceState(status?: string | null): "partial" | "advance" {
  return status?.toLowerCase() === "completed" ? "advance" : "partial";
}

function getViewData(row: CaseSummary, selectedViews: ViewTab[]) {
  const hasInitial = !!row.m1;
  const advanceState = row.m15 ? getAdvanceState(row.m15.pipedriveSyncStatus) : null;

  if (selectedViews.includes("advance") && advanceState === "advance" && row.m15) {
    return { view: "advance" as const, summary: row.m15, status: "completed" };
  }
  if (selectedViews.includes("partial") && advanceState === "partial" && row.m15) {
    return { view: "partial" as const, summary: row.m15, status: "partial" };
  }
  if (selectedViews.includes("initial") && hasInitial && row.m1) {
    return { view: "initial" as const, summary: row.m1, status: "completed" };
  }
  return null;
}

export default function SubmissionList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedViews = useMemo(() => parseViewsParam(searchParams.get("views")), [searchParams]);
  const [search, setSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [page, setPage] = useState(1);
  const deferredSearch = useDeferredValue(search);

  const params = useMemo(
    () => ({
      views: selectedViews,
      from: toStartOfDayIso(fromDate),
      to: toEndOfDayIso(toDate),
      page,
      pageSize,
    }),
    [selectedViews, fromDate, toDate, page, pageSize]
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
        .map((row) => {
          const viewData = getViewData(row, selectedViews);
          return { id: viewData?.summary.id ?? row.openId, key: viewData?.summary.thumbnailKey ?? row.thumbnailKey };
        })
        .filter((item): item is { id: string; key: string } => !!item.key),
    [selectedViews, caseRows]
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

  function toggleView(view: ViewTab) {
    const nextViews = selectedViews.includes(view)
      ? selectedViews.length === 1
        ? selectedViews
        : selectedViews.filter((v) => v !== view)
      : [...selectedViews, view];

    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("views", nextViews.join(","));
      return next;
    });
    setPage(1);
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        {/* Search */}
        <div className="flex h-11 items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 focus-within:border-[#3ec099] focus-within:ring-2 focus-within:ring-[#3ec099]/10 transition-all shadow-sm">
          <svg className="h-4 w-4 shrink-0 text-zinc-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9 3a6 6 0 100 12A6 6 0 009 3zM1 9a8 8 0 1114.32 4.906l3.387 3.387a1 1 0 01-1.414 1.414l-3.387-3.387A8 8 0 011 9z" clipRule="evenodd" />
          </svg>
          <input
            type="search"
            placeholder="VIN or Deal ID..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              handleFilterChange();
            }}
            className="w-52 bg-transparent text-sm font-medium text-zinc-900 placeholder-zinc-400 focus:outline-none"
          />
        </div>

        {/* View Tabs - Segmented Control (Middle) */}
        <div className="flex h-11 w-72 items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1 shadow-sm">
          {(["initial", "partial", "advance"] as const).map((tab) => {
            const isActive = selectedViews.includes(tab);
            return (
              <button
                key={tab}
                onClick={() => toggleView(tab)}
                className={`flex-1 flex h-full items-center justify-center rounded-lg text-xs font-bold capitalize transition-all ${
                  isActive
                    ? "bg-[#3ec099] text-white shadow-sm"
                    : "text-zinc-500 hover:text-zinc-900 hover:bg-zinc-50"
                }`}
              >
                {tab}
              </button>
            );
          })}
        </div>

        {/* Date Range - Compact & Modern */}
        <div className="flex items-center gap-2 bg-white rounded-xl border border-zinc-200 p-1 shadow-sm h-11">
          <div className="flex items-center px-3 h-full rounded-lg hover:bg-zinc-50 transition-colors">
            <span className="text-[9px] font-black text-zinc-400 uppercase tracking-tighter mr-2">From</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                handleFilterChange();
              }}
              className="bg-transparent text-xs font-bold text-zinc-900 focus:outline-none [color-scheme:light] w-28 cursor-pointer"
            />
          </div>
          
          <div className="w-px h-4 bg-zinc-200" />
          
          <div className="flex items-center px-3 h-full rounded-lg hover:bg-zinc-50 transition-colors">
            <span className="text-[9px] font-black text-zinc-400 uppercase tracking-tighter mr-2">To</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                handleFilterChange();
              }}
              className="bg-transparent text-xs font-bold text-zinc-900 focus:outline-none [color-scheme:light] w-28 cursor-pointer"
            />
          </div>
        </div>
      </div>

        {data && createPortal(
          <div className="flex items-center gap-2 border-l border-zinc-200 pl-4 ml-2">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest leading-none">Total</span>
            <span className={`${ui.badge} ${badgeTone("info")} tabular-nums`}>{data.total} cases</span>
          </div>,
          document.getElementById("header-portal-root")!
        )}

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

          <div className={`${ui.card} border-zinc-200 overflow-x-auto shadow-md`}>
            <table className="min-w-full text-sm">
              <thead className="border-b border-zinc-100 bg-zinc-50/50">
                <tr>
                  <th className="px-6 py-4 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500">Thumbnail</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500">VIN</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500">Intake</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500">Sync</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500">Source</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500">Updated</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500">Deal</th>
                  <th className="px-6 py-4 text-left text-[10px] font-bold uppercase tracking-wider text-zinc-500">Assets</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {caseRows.map((row, idx) => {
                  const viewData = getViewData(row, selectedViews);
                  if (!viewData) return null;
                  const { view, summary, status } = viewData;
                  const openId = summary.id;
                  const updatedAt = summary.updatedAt;
                  const dealId = summary.pipedriveDealId;
                  const assetCount = summary.assetCount;
                  return (
                    <tr
                      key={`${row.caseKey}:${view}`}
                      className={`cursor-pointer transition-colors hover:bg-zinc-50 ${idx % 2 === 0 ? "bg-white" : "bg-zinc-50/30"}`}
                      onClick={() =>
                        navigate({
                          pathname: `/submissions/${encodeURIComponent(openId)}`,
                          search: searchParams.toString() ? `?${searchParams.toString()}` : "",
                        })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigate({
                            pathname: `/submissions/${encodeURIComponent(openId)}`,
                            search: searchParams.toString() ? `?${searchParams.toString()}` : "",
                          });
                        }
                      }}
                      tabIndex={0}
                    >
                      <td className="px-6 py-4">
                        <SubmissionThumbnail url={thumbnailUrlMap.get(openId)} />
                      </td>
                      <td className="px-6 py-4 font-mono text-xs font-medium text-zinc-600">{row.vin ?? "N/A"}</td>
                      <td className="px-6 py-4">
                        <IntakeBadge view={view} />
                      </td>
                      <td className="px-6 py-4">
                        <SyncBadge status={status} />
                      </td>
                      <td className="px-6 py-4">
                        <SourceBadge source={summary.submissionSource} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 font-medium text-zinc-600">{formatDateTime(updatedAt)}</td>
                      <td className="px-6 py-4 font-medium text-zinc-600">{dealId ?? "N/A"}</td>
                      <td className="px-6 py-4 font-bold text-zinc-900">{assetCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-zinc-100 pt-6">
            <div className="flex items-center gap-8">
              {totalPages > 0 && (
                <span className="text-sm font-medium text-zinc-500">
                  Page <span className="font-bold text-zinc-900">{page}</span> of <span className="font-bold text-zinc-900">{totalPages}</span>
                </span>
              )}
              
              <div className="flex items-center gap-2 text-sm text-zinc-500">
                <span>Show</span>
                <div className="relative flex items-center">
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); handleFilterChange(); }}
                    className="appearance-none rounded-lg border border-zinc-200 bg-white py-1.5 pl-3 pr-8 text-sm font-bold text-zinc-900 shadow-sm focus:border-[#3ec099] focus:outline-none focus:ring-2 focus:ring-[#3ec099]/10 transition-all cursor-pointer"
                  >
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                    <option value={100}>100</option>
                  </select>
                  <svg className="pointer-events-none absolute right-2.5 h-4 w-4 text-zinc-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </div>
                <span>per page</span>
              </div>
            </div>

            {totalPages > 1 && (
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
            )}
          </div>
        </div>
      )}
    </div>
  );
}
