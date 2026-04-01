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

function ImageThumb({
  asset,
  submissionId,
  onClick,
}: {
  asset: Asset;
  submissionId: string;
  onClick: (url: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["asset-url", submissionId, asset.key],
    queryFn: () => getAssetUrl(submissionId, asset.key),
    staleTime: 50 * 60 * 1000,
  });

  return (
    <div
      className="relative aspect-square bg-gray-100 rounded border border-gray-200 overflow-hidden cursor-pointer hover:border-gray-400 transition"
      onClick={() => data?.url && onClick(data.url)}
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
      <div className="absolute bottom-0 left-0 right-0 bg-black/40 px-1.5 py-0.5 truncate text-white text-xs">
        {fileName(asset.key)}
      </div>
    </div>
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
    <div className="flex items-center gap-3 py-2 px-3 bg-white rounded border border-gray-200 hover:border-gray-300 transition">
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
          className="text-xs text-blue-600 hover:underline shrink-0"
        >
          Open ↗
        </a>
      ) : (
        <button
          onClick={() => setFetch(true)}
          disabled={isLoading}
          className="text-xs text-blue-600 hover:underline shrink-0 disabled:opacity-40"
        >
          {isLoading ? "Loading…" : "Get link"}
        </button>
      )}
    </div>
  );
}

function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <img
        src={url}
        alt="Preview"
        className="max-w-[90vw] max-h-[90vh] object-contain rounded shadow-xl"
        onClick={(e) => e.stopPropagation()}
      />
      <button
        className="absolute top-4 right-4 text-white text-3xl leading-none hover:opacity-70"
        onClick={onClose}
      >
        ✕
      </button>
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
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  const images = assets.filter((a) => a.type === "image");
  const docs = assets.filter((a) => a.type === "document");
  const others = assets.filter((a) => a.type === "other");

  return (
    <div className="flex flex-col gap-6">
      {lightboxUrl && (
        <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />
      )}

      {images.length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-gray-400 mb-2">Images</h4>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
            {images.map((a) => (
              <ImageThumb
                key={a.key}
                asset={a}
                submissionId={submissionId}
                onClick={setLightboxUrl}
              />
            ))}
          </div>
        </div>
      )}

      {docs.length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-gray-400 mb-2">Documents</h4>
          <div className="flex flex-col gap-1">
            {docs.map((a) => (
              <AssetItem key={a.key} asset={a} submissionId={submissionId} />
            ))}
          </div>
        </div>
      )}

      {others.length > 0 && (
        <div>
          <h4 className="text-xs uppercase tracking-wider text-gray-400 mb-2">Other files</h4>
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
