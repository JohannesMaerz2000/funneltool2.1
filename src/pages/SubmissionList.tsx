import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { listSubmissions } from "../api/client";
import type { Stage } from "../types/submission";
import StageBadge from "../components/StageBadge";

const PAGE_SIZE = 50;

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

export default function SubmissionList() {
  const [query, setQuery] = useState("");
  const [stage, setStage] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);

  // Reset to page 1 whenever filters change
  const params = { query, stage, from, to, page, pageSize: PAGE_SIZE };

  const { data, isLoading, isError, error, isFetching } = useQuery({
    queryKey: ["submissions", params],
    queryFn: () => listSubmissions(params),
  });

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  function handleFilter() {
    setPage(1);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Submissions</h1>
        {data && (
          <span className="text-sm text-gray-500">
            {data.total} total
          </span>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <input
          type="search"
          placeholder="Search by ID or VIN…"
          value={query}
          onChange={(e) => { setQuery(e.target.value); handleFilter(); }}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        <select
          value={stage}
          onChange={(e) => { setStage(e.target.value); handleFilter(); }}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        >
          <option value="all">All stages</option>
          <option value="M1">M1</option>
          <option value="M1.5">M1.5</option>
          <option value="unknown">Unknown</option>
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => { setFrom(e.target.value); handleFilter(); }}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          title="From date"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => { setTo(e.target.value); handleFilter(); }}
          className="border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          title="To date"
        />
        {(query || stage !== "all" || from || to) && (
          <button
            onClick={() => { setQuery(""); setStage("all"); setFrom(""); setTo(""); setPage(1); }}
            className="text-sm text-gray-500 hover:text-gray-800 underline"
          >
            Clear
          </button>
        )}
      </div>

      {/* States */}
      {isLoading && (
        <div className="flex items-center gap-2 text-gray-500 py-10">
          <span className="animate-spin text-lg">⟳</span> Loading submissions…
        </div>
      )}

      {isError && (
        <div className="rounded bg-red-50 border border-red-200 text-red-800 p-4 text-sm">
          <strong>Error loading submissions:</strong>{" "}
          {error instanceof Error ? error.message : "Unknown error"}
        </div>
      )}

      {/* Table */}
      {data && data.data.length === 0 && !isLoading && (
        <p className="text-gray-500 py-10 text-center">No submissions match your filters.</p>
      )}

      {data && data.data.length > 0 && (
        <div className="relative">
          {isFetching && !isLoading && (
            <div className="absolute top-0 right-0 text-xs text-gray-400 py-1">refreshing…</div>
          )}
          <div className="overflow-x-auto rounded border border-gray-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">ID</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Stage</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Last updated</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Assets</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.data.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50 transition">
                    <td className="px-4 py-2">
                      <Link
                        to={`/submissions/${encodeURIComponent(s.id)}`}
                        className="text-blue-600 hover:underline font-mono text-xs"
                      >
                        {s.id}
                      </Link>
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
                  className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-100 transition"
                >
                  ← Prev
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-100 transition"
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
