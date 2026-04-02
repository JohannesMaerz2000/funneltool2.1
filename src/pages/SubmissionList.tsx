import { useMemo, useState, useDeferredValue } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { batchPresignUrls, listSubmissions } from "../api/client";
import type { Stage } from "../types/submission";
import StageBadge from "../components/StageBadge";

const PAGE_SIZE = 10;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
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

export default function SubmissionList() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [page, setPage] = useState(1);

  // Reset to page 1 whenever filters change
  const params = { query: deferredQuery, page, pageSize: PAGE_SIZE };

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["submissions", params],
    queryFn: () => listSubmissions(params),
    staleTime: 2 * 60_000, // avoid re-fetching on every mount/focus
    placeholderData: keepPreviousData, // keep old data visible while fetching next page
  });

  // Fetch all thumbnail presigned URLs in a single batch request
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

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  function handleFilter() {
    setPage(1);
  }

  return (
    <div>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Submissions</h1>
        </div>
        {data && (
          <span className="rounded-full border border-emerald-200 bg-white px-3 py-1 text-sm font-medium text-gray-600 shadow-sm">
            {data.total} total
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <input
          type="search"
          placeholder="Search by ID or VIN…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); handleFilter(); }}
          className="w-64 rounded-xl border border-gray-300 px-3 py-2 text-sm transition focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
        />
        {query && (
          <button
            onClick={() => { setQuery(""); setPage(1); }}
            className="text-sm font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
          >
            Clear
          </button>
        )}
      </div>

      {/* States */}
      {isLoading && (
        <div className="flex items-center gap-2 py-10 text-gray-500">
          <span className="animate-spin text-lg">⟳</span> Loading submissions…
        </div>
      )}

      {isError && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <strong>Error loading submissions:</strong>{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </div>
      )}

      {/* Table */}
      {data && data.data.length === 0 && !isLoading && (
        <p className="py-10 text-center text-gray-500">No submissions match your filters.</p>
      )}

      {data && data.data.length > 0 && (
        <div className="relative">
          {isFetching && !isLoading && (
            <div className="absolute right-0 top-0 py-1 text-xs text-gray-400">refreshing…</div>
          )}
          <div className="overflow-x-auto rounded-2xl border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full text-sm">
              <thead className="border-b border-gray-200 bg-emerald-50/60">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Thumbnail</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">ID</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Stage</th>
                  <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Last updated</th>
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
                    <td className="px-4 py-2">
                      <StageBadge stage={s.stage as Stage} />
                    </td>
                    <td className="px-4 py-2 text-gray-600 whitespace-nowrap">
                      {formatDate(s.updatedAt)}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{s.assetCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-3 text-sm">
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
