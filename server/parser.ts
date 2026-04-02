import type { _Object } from "@aws-sdk/client-s3";
import type { Asset } from "./types.js";
import { PREFIX } from "./s3.js";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"]);
const DOC_EXTS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt"]);

export function isRawImagesKey(key: string): boolean {
  return key
    .split("/")
    .some((segment) => segment.toLowerCase() === "raw_images");
}

function visibleAssetObjects(objects: _Object[]): _Object[] {
  return objects.filter((o) => o.Key && !o.Key.endsWith("/") && !isRawImagesKey(o.Key));
}

function extOf(key: string): string {
  const dot = key.lastIndexOf(".");
  return dot === -1 ? "" : key.slice(dot).toLowerCase();
}

function assetType(key: string): Asset["type"] {
  const ext = extOf(key);
  if (IMAGE_EXTS.has(ext)) return "image";
  if (DOC_EXTS.has(ext)) return "document";
  return "other";
}

function pickThumbnailKey(objects: _Object[]): string | undefined {
  const imageObjects = visibleAssetObjects(objects).filter(
    (o): o is _Object & { Key: string } => Boolean(o.Key && assetType(o.Key) === "image")
  );
  if (imageObjects.length === 0) return undefined;

  const bySmallestSize = (a: _Object, b: _Object) => (a.Size ?? Number.MAX_SAFE_INTEGER) - (b.Size ?? Number.MAX_SAFE_INTEGER);

  const thumbNamed = imageObjects
    .filter((o) => /(?:thumb|thumbnail|preview)/i.test(o.Key))
    .sort(bySmallestSize);
  if (thumbNamed[0]?.Key) return thumbNamed[0].Key;

  const exterior = imageObjects
    .filter((o) => o.Key.toLowerCase().includes("exterior"))
    .sort(bySmallestSize);
  if (exterior[0]?.Key) return exterior[0].Key;

  return imageObjects.sort(bySmallestSize)[0]?.Key;
}

/** Derive the submission ID from an S3 key under advance/ */
export function submissionIdFromKey(key: string): string {
  // advance/<id>/... → id is the first path segment after the prefix
  const rest = key.slice(PREFIX.length);
  const slash = rest.indexOf("/");
  return slash === -1 ? rest : rest.slice(0, slash);
}

/** Group a flat list of S3 objects by submission ID. */
export function groupBySubmission(objects: _Object[]): Map<string, _Object[]> {
  const map = new Map<string, _Object[]>();
  for (const obj of objects) {
    if (!obj.Key) continue;
    const id = submissionIdFromKey(obj.Key);
    if (!id) continue;
    const list = map.get(id) ?? [];
    list.push(obj);
    map.set(id, list);
  }
  return map;
}

export function buildAssetSummary(
  objects: _Object[]
): { assetCount: number; thumbnailKey?: string } {
  const visibleAssets = visibleAssetObjects(objects);
  return {
    assetCount: visibleAssets.length,
    thumbnailKey: pickThumbnailKey(visibleAssets),
  };
}

export function buildAssets(objects: _Object[]): Asset[] {
  const visibleAssets = visibleAssetObjects(objects);
  return visibleAssets.map((o) => ({
    key: o.Key!,
    type: assetType(o.Key!),
    size: o.Size,
    lastModified: o.LastModified?.toISOString(),
  }));
}
