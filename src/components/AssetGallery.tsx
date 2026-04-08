import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Asset } from "../types/submission";
import { batchPresignUrls } from "../api/client";
import { ui } from "./ui";

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

function downloadAsset(submissionId: string, key: string) {
  const qs = new URLSearchParams({ key });
  const url = `/api/submissions/${encodeURIComponent(submissionId)}/download?${qs}`;
  const a = document.createElement("a");
  a.href = url;
  a.download = key.split("/").pop() ?? "download";
  a.click();
}

function DownloadIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className}>
      <path d="M10 3a.75.75 0 01.75.75v7.69l2.22-2.22a.75.75 0 111.06 1.06l-3.5 3.5a.75.75 0 01-1.06 0l-3.5-3.5a.75.75 0 111.06-1.06l2.22 2.22V3.75A.75.75 0 0110 3z" />
      <path d="M3 15.75a.75.75 0 01.75-.75h12.5a.75.75 0 010 1.5H3.75a.75.75 0 01-.75-.75z" />
    </svg>
  );
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
    <svg viewBox="0 0 64 72" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-12 h-12">
      <rect x="4" y="2" width="46" height="58" rx="5" fill="#0f172a" stroke="#334155" strokeWidth="2" />
      <path d="M34 2v14a4 4 0 004 4h14" stroke="#334155" strokeWidth="2" strokeLinecap="round" />
      <rect x="10" y="40" width="44" height="24" rx="4" fill="#1e293b" />
      <text x="32" y="57" textAnchor="middle" fill="white" fontSize="11" fontWeight="700" fontFamily="system-ui, sans-serif">PDF</text>
    </svg>
  );
}

function ImageThumb({
  asset,
  submissionId,
  url,
  onClick,
}: {
  asset: Asset;
  submissionId: string;
  url?: string;
  onClick: (url: string, name: string) => void;
}) {
  const name = fileName(asset.key);

  return (
    <div
      className="group relative aspect-square cursor-pointer overflow-hidden rounded-lg border border-zinc-700 bg-zinc-900/70 shadow-md transition hover:border-zinc-500 hover:shadow-lg"
      onClick={() => url && onClick(url, name)}
    >
      {!url && (
        <div className="absolute inset-0 flex items-center justify-center text-zinc-500 text-sm">
          Loading…
        </div>
      )}
      {url && (
        <>
          <img
            src={url}
            alt={name}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
          <button
            className="absolute bottom-2 right-2 flex items-center justify-center rounded-lg bg-black/70 p-2 text-white opacity-0 transition group-hover:opacity-100 hover:bg-black/90"
            title={`Download ${name}`}
            onClick={(e) => {
              e.stopPropagation();
              downloadAsset(submissionId, asset.key);
            }}
          >
            <DownloadIcon className="w-4 h-4" />
          </button>
        </>
      )}
    </div>
  );
}

function PdfThumb({
  asset,
  url,
  onClick,
}: {
  asset: Asset;
  url?: string;
  onClick: (url: string, name: string) => void;
}) {
  const name = fileName(asset.key);

  return (
    <button
      className="flex w-full cursor-pointer flex-col items-center gap-3 rounded-lg border border-zinc-700 bg-zinc-900/70 p-4 text-left shadow-md transition hover:border-zinc-500 hover:bg-zinc-900 disabled:cursor-wait disabled:opacity-60"
      onClick={() => url && onClick(url, name)}
      disabled={!url}
      title={name}
    >
      <div className="flex items-center justify-center w-full py-2">
        {!url ? (
          <div className="w-12 h-12 rounded bg-zinc-700 animate-pulse" />
        ) : (
          <PdfIcon />
        )}
      </div>
      <span className="text-sm text-zinc-200 font-semibold truncate w-full text-center">{name}</span>
      {asset.size != null && (
        <span className="text-xs text-zinc-500">{formatSize(asset.size)}</span>
      )}
    </button>
  );
}

function AssetItem({
  asset,
  url,
}: {
  asset: Asset;
  url?: string;
}) {
  const icon = asset.type === "document" ? "📄" : "📎";

  return (
    <div className="flex items-center gap-4 rounded-lg border border-zinc-700 bg-zinc-900/70 px-4 py-3 shadow-md transition hover:border-zinc-500 hover:bg-zinc-900">
      <span className="text-2xl leading-none">{icon}</span>
      <div className="flex-1 min-w-0">
        <p className="text-base font-semibold truncate text-zinc-100">{fileName(asset.key)}</p>
        {asset.size != null && (
          <p className="text-sm text-zinc-500">{formatSize(asset.size)}</p>
        )}
      </div>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 text-sm font-semibold text-zinc-300 transition hover:text-zinc-100 hover:underline"
        >
          Open ↗
        </a>
      ) : (
        <span className="shrink-0 text-sm text-zinc-500">Loading…</span>
      )}
    </div>
  );
}

function PdfPopout({ url, name, onClose }: { url: string; name: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm"
      onClick={onClose}
    >
        <div
        className={`${ui.card} flex h-[90vh] w-full max-w-5xl flex-col shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-5 py-4">
          <PdfIcon />
          <span className="flex-1 text-base font-semibold text-zinc-100 truncate">{name}</span>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-zinc-400 hover:text-zinc-200 transition shrink-0"
            title="Open in new tab"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z" clipRule="evenodd" />
              <path fillRule="evenodd" d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z" clipRule="evenodd" />
            </svg>
          </a>
          <button
            className="text-zinc-400 hover:text-zinc-200 transition shrink-0"
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
        decoding="async"
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

  // Memoize all derived lists in a single pass
  const { images, pdfs, docs, others, categoryStats } = useMemo(() => {
    const imgs: Asset[] = [];
    const pdfList: Asset[] = [];
    const docList: Asset[] = [];
    const otherList: Asset[] = [];
    for (const a of assets) {
      if (a.type === "image") imgs.push(a);
      else if (isPdf(a.key)) pdfList.push(a);
      else if (a.type === "document") docList.push(a);
      else otherList.push(a);
    }
    return {
      images: imgs,
      pdfs: pdfList,
      docs: docList,
      others: otherList,
      categoryStats: buildCategoryStats(assets),
    };
  }, [assets]);

  // Stable query key based on asset keys, not array reference
  const batchItems = useMemo(
    () => assets.map((a) => ({ id: submissionId, key: a.key })),
    [assets, submissionId]
  );

  // Single batch request for ALL asset presigned URLs
  const { data: batchResults } = useQuery({
    queryKey: ["asset-urls-batch", submissionId, batchItems.map((i) => i.key)],
    queryFn: () => batchPresignUrls(batchItems),
    enabled: batchItems.length > 0,
    staleTime: 50 * 60 * 1000,
  });

  // Build a lookup map: S3 key → presigned URL
  const urlMap = useMemo(() => {
    const map = new Map<string, string>();
    if (batchResults) {
      for (const { key, url } of batchResults) {
        if (url) map.set(key, url);
      }
    }
    return map;
  }, [batchResults]);

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
          <div className="flex flex-wrap gap-3">
            {categoryStats.map((row) => (
              <span
                key={row.category}
                className="inline-flex items-center rounded-lg border border-zinc-700 bg-zinc-900/80 px-4 py-2 text-sm font-semibold text-zinc-200 shadow-md"
              >
                {row.category}: <span className="ml-2 font-bold text-zinc-300">{row.total}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {images.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold uppercase tracking-wider text-zinc-300">Images</h4>
            <a
              href={`/api/submissions/${encodeURIComponent(submissionId)}/download-all`}
              download
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/80 px-4 py-2 text-sm font-semibold text-zinc-300 shadow-md transition hover:border-zinc-500 hover:text-zinc-100 hover:bg-zinc-900"
            >
              <DownloadIcon className="w-4 h-4" />
              Download All (.zip)
            </a>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-3">
            {images.map((a) => (
              <ImageThumb
                key={a.key}
                asset={a}
                submissionId={submissionId}
                url={urlMap.get(a.key)}
                onClick={(url, name) => setLightbox({ url, name })}
              />
            ))}
          </div>
        </div>
      )}

      {pdfs.length > 0 && (
        <div>
          <h4 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-300">PDFs</h4>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
            {pdfs.map((a) => (
              <PdfThumb
                key={a.key}
                asset={a}
                url={urlMap.get(a.key)}
                onClick={(url, name) => setPdfPopout({ url, name })}
              />
            ))}
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div>
          <h4 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-300">Documents</h4>
          <div className="flex flex-col gap-2">
            {docs.map((a) => (
              <AssetItem key={a.key} asset={a} url={urlMap.get(a.key)} />
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div>
          <h4 className="mb-4 text-sm font-bold uppercase tracking-wider text-zinc-300">Other files</h4>
          <div className="flex flex-col gap-2">
            {others.map((a) => (
              <AssetItem key={a.key} asset={a} url={urlMap.get(a.key)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
