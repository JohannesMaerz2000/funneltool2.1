import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Asset } from "../types/submission";
import { getAssetUrl } from "../api/client";

function fileName(key: string) {
  return key.split("/").pop() ?? key;
}

function formatSize(bytes?: number) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function isPdf(key: string) {
  return key.toLowerCase().endsWith(".pdf");
}

function normalizeCategoryLabel(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function inferAssetCategory(asset: Asset): string {
  const filename = fileName(asset.key);
  const dot = filename.lastIndexOf(".");
  const stem = (dot === -1 ? filename : filename.slice(0, dot)).trim();
  if (!stem) return "Uncategorized";

  const parts = stem
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "Uncategorized";

  // Common pattern: "<index>_<category>_<random-id>.<ext>"
  let start = 0;
  let removedLeadingIndex = false;
  if (/^\d+$/.test(parts[0])) {
    start = 1;
    removedLeadingIndex = true;
  }

  let end = parts.length;
  let removedVolatileSuffix = false;

  while (end > start) {
    const last = parts[end - 1];
    if (!last) break;
    const lower = last.toLowerCase();
    const isTimestamp = /^\d{10,}$/.test(last);
    const isAlphaNumUploadId =
      /[a-z]/i.test(last) &&
      /\d/.test(last) &&
      last.length >= 6 &&
      !["m1", "m15", "m1.5"].includes(lower);
    const isLongHexLike = /^[a-f0-9]{8,}$/i.test(last);

    if (isTimestamp || isAlphaNumUploadId || isLongHexLike) {
      end -= 1;
      removedVolatileSuffix = true;
      continue;
    }
    break;
  }

  // Collapse repeated shots like "Exterior 0 1774..." and keep only category name.
  if (end > start + 1) {
    const maybeIndex = parts[end - 1];
    const idx = Number(maybeIndex);
    const isSmallNumericIndex = /^\d+$/.test(maybeIndex) && Number.isFinite(idx) && idx >= 0 && idx <= 20;
    if (isSmallNumericIndex && (removedVolatileSuffix || removedLeadingIndex)) {
      end -= 1;
    }
  }

  const core = parts.slice(start, end).join("_");
  if (!core) return "Uncategorized";
  return normalizeCategoryLabel(core);
}

type CategoryStat = {
  category: string;
  images: number;
  documents: number;
  others: number;
  total: number;
};

function buildCategoryStats(assets: Asset[]): CategoryStat[] {
  const byCategory = new Map<string, CategoryStat>();

  for (const asset of assets) {
    const category = inferAssetCategory(asset);
    const current = byCategory.get(category) ?? {
      category,
      images: 0,
      documents: 0,
      others: 0,
      total: 0,
    };

    if (asset.type === "image") current.images += 1;
    else if (asset.type === "document") current.documents += 1;
    else current.others += 1;
    current.total += 1;
    byCategory.set(category, current);
  }

  return [...byCategory.values()].sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));
}

function PdfIcon() {
  return (
    <svg viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-10 h-10">
      <rect x="4" y="2" width="46" height="58" rx="5" fill="#f1f5f9" stroke="#cbd5e1" strokeWidth="2" />
      <path d="M34 2v14a4 4 0 004 4h14" stroke="#cbd5e1" strokeWidth="2" strokeLinecap="round" />
      <rect x="10" y="40" width="44" height="24" rx="4" fill="#ef4444" />
      <text x="32" y="57" textAnchor="middle" fill="white" fontSize="11" fontWeight="700" fontFamily="system-ui, sans-serif">PDF</text>
    </svg>
  );
}

function ImageThumb({
  asset,
  submissionId,
  onClick,
}: {
  asset: Asset;
  submissionId: string;
  onClick: (url: string, name: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["asset-url", submissionId, asset.key],
    queryFn: () => getAssetUrl(submissionId, asset.key),
    staleTime: 50 * 60 * 1000,
  });

  return (
    <div
      className="relative aspect-square cursor-pointer overflow-hidden rounded-xl border border-gray-200 bg-gray-100 shadow-sm transition hover:border-emerald-300 hover:shadow"
      onClick={() => data?.url && onClick(data.url, fileName(asset.key))}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-xs">
          Loading…
        </div>
      )}
      {data?.url && (
        <img
          src={data.url}
          alt={fileName(asset.key)}
          className="w-full h-full object-cover"
        />
      )}
    </div>
  );
}

function PdfThumb({
  asset,
  submissionId,
  onClick,
}: {
  asset: Asset;
  submissionId: string;
  onClick: (url: string, name: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["asset-url", submissionId, asset.key],
    queryFn: () => getAssetUrl(submissionId, asset.key),
    staleTime: 50 * 60 * 1000,
  });

  const name = fileName(asset.key);

  return (
    <button
      className="flex flex-col items-center gap-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm transition hover:border-emerald-300 hover:shadow cursor-pointer disabled:cursor-wait disabled:opacity-60 text-left w-full"
      onClick={() => data?.url && onClick(data.url, name)}
      disabled={isLoading || !data?.url}
      title={name}
    >
      <div className="flex items-center justify-center w-full py-2">
        {isLoading ? (
          <div className="w-10 h-10 rounded bg-gray-100 animate-pulse" />
        ) : (
          <PdfIcon />
        )}
      </div>
      <span className="text-xs text-gray-600 font-medium truncate w-full text-center">{name}</span>
      {asset.size != null && (
        <span className="text-[10px] text-gray-400">{formatSize(asset.size)}</span>
      )}
    </button>
  );
}

function AssetItem({
  asset,
  submissionId,
}: {
  asset: Asset;
  submissionId: string;
}) {
  const [fetch, setFetch] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ["asset-url", submissionId, asset.key],
    queryFn: () => getAssetUrl(submissionId, asset.key),
    enabled: fetch,
    staleTime: 50 * 60 * 1000,
  });

  const icon = asset.type === "document" ? "📄" : "📎";

  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm transition hover:border-emerald-300 hover:shadow">
      <span className="text-lg leading-none">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{fileName(asset.key)}</p>
        {asset.size != null && (
          <p className="text-xs text-gray-400">{formatSize(asset.size)}</p>
        )}
      </div>
      {data?.url ? (
        <a
          href={data.url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline"
        >
          Open ↗
        </a>
      ) : (
        <button
          onClick={() => setFetch(true)}
          disabled={isLoading}
          className="shrink-0 text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:underline disabled:opacity-40"
        >
          {isLoading ? "Loading…" : "Get link"}
        </button>
      )}
    </div>
  );
}

function PdfPopout({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex flex-col w-full max-w-5xl h-[90vh] rounded-2xl overflow-hidden shadow-2xl bg-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50 shrink-0">
          <PdfIcon />
          <span className="flex-1 text-sm font-medium text-gray-800 truncate">{name}</span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-gray-400 hover:text-gray-700 transition shrink-0"
            title="Open in new tab"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
              <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
              <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clipRule="evenodd" />
            </svg>
          </a>
          <button
            className="text-gray-400 hover:text-gray-700 transition shrink-0"
            onClick={onClose}
            aria-label="Close"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* PDF iframe */}
        <iframe
          src={url}
          title={name}
          className="flex-1 w-full border-0"
        />
      </div>
    </div>
  );
}

function Lightbox({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <img
        src={url}
        alt={name}
        className="max-w-[90vw] max-h-[90vh] object-contain rounded shadow-xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        className="absolute top-4 right-4 text-white text-3xl leading-none hover:opacity-70"
        onClick={onClose}
      >
        ✕
      </button>
      <p className="absolute bottom-4 left-0 right-0 text-center text-sm text-white/80">
        {name}
      </p>
    </div>
  );
}

export default function AssetGallery({
  assets,
  submissionId,
}: {
  assets: Asset[];
  submissionId: string;
}) {
  const [lightbox, setLightbox] = useState<{ url: string; name: string } | null>(null);
  const [pdfPopout, setPdfPopout] = useState<{ url: string; name: string } | null>(null);
  const categoryStats = buildCategoryStats(assets);

  const images = assets.filter((a) => a.type === "image");
  const pdfs = assets.filter((a) => isPdf(a.key));
  const docs = assets.filter((a) => a.type === "document" && !isPdf(a.key));
  const others = assets.filter((a) => a.type === "other");

  return (
    <div className="flex flex-col gap-6">
      {lightbox && (
        <Lightbox url={lightbox.url} name={lightbox.name} onClose={() => setLightbox(null)} />
      )}
      {pdfPopout && (
        <PdfPopout url={pdfPopout.url} name={pdfPopout.name} onClose={() => setPdfPopout(null)} />
      )}

      {categoryStats.length > 0 && (
        <div>
          <div className="flex flex-wrap gap-2">
            {categoryStats.map((row) => (
              <span
                key={row.category}
                className="inline-flex items-center rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 shadow-sm"
              >
                {row.category}: {row.total}
              </span>
            ))}
          </div>
        </div>
      )}

      {images.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs uppercase tracking-[0.14em] text-gray-500">Images</h4>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
            {images.map((a) => (
              <ImageThumb
                key={a.key}
                asset={a}
                submissionId={submissionId}
                onClick={(url, name) => setLightbox({ url, name })}
              />
            ))}
          </div>
        </div>
      )}

      {pdfs.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs uppercase tracking-[0.14em] text-gray-500">PDFs</h4>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {pdfs.map((a) => (
              <PdfThumb
                key={a.key}
                asset={a}
                submissionId={submissionId}
                onClick={(url, name) => setPdfPopout({ url, name })}
              />
            ))}
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs uppercase tracking-[0.14em] text-gray-500">Documents</h4>
          <div className="flex flex-col gap-1">
            {docs.map((a) => (
              <AssetItem key={a.key} asset={a} submissionId={submissionId} />
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs uppercase tracking-[0.14em] text-gray-500">Other files</h4>
          <div className="flex flex-col gap-1">
            {others.map((a) => (
              <AssetItem key={a.key} asset={a} submissionId={submissionId} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
