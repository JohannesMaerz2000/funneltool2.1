import type { _Object } from "@aws-sdk/client-s3";
import type { SubmissionSummary, SubmissionDetail, Asset } from "./types.js";
import { getJsonObject, PREFIX } from "./s3.js";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic", ".heif"]);
const DOC_EXTS = new Set([".pdf", ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt"]);

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
  const imageKeys = objects
    .map((o) => o.Key)
    .filter((key): key is string => Boolean(key && !key.endsWith("/") && assetType(key) === "image"));

  const firstExterior = imageKeys.find((key) => key.toLowerCase().includes("exterior"));
  return firstExterior ?? imageKeys[0];
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

/** Heuristic: pick the most likely form-payload JSON from a submission's objects. */
function pickPayloadKey(objects: _Object[]): string | null {
  const jsonFiles = objects
    .filter((o) => o.Key && extOf(o.Key) === ".json")
    .sort((a, b) => (b.Size ?? 0) - (a.Size ?? 0)); // largest JSON first

  return jsonFiles[0]?.Key ?? null;
}

/** Extract VIN from a parsed payload using common field name patterns. */
function extractVin(data: Record<string, unknown>): string | undefined {
  // Try flat fields first
  const candidates = ["vin", "VIN", "vehicleIdentificationNumber", "vehicle_vin"];
  for (const key of candidates) {
    if (typeof data[key] === "string" && (data[key] as string).length > 0) {
      return data[key] as string;
    }
  }
  // Try one level deep (vehicle.vin, car.vin, etc.)
  for (const val of Object.values(data)) {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = val as Record<string, unknown>;
      for (const key of candidates) {
        if (typeof nested[key] === "string") return nested[key] as string;
      }
    }
  }
  return undefined;
}

/** Detect submission stage from keys and payload data. */
function detectStage(
  objects: _Object[],
  payload: Record<string, unknown> | null
): SubmissionSummary["stage"] {
  const keys = objects.map((o) => o.Key ?? "").join(" ");

  if (payload) {
    const stageField =
      (payload["stage"] as string) ??
      (payload["step"] as string) ??
      (payload["submissionStage"] as string);
    if (typeof stageField === "string") {
      const s = stageField.toLowerCase();
      if (s.includes("1.5") || s.includes("m1.5")) return "M1.5";
      if (s.includes("m1") || s === "1") return "M1";
    }
  }

  if (keys.includes("m1.5") || keys.includes("M1_5") || keys.includes("stage_1_5")) return "M1.5";
  if (keys.includes("m1") || keys.includes("M1")) return "M1";
  return "unknown";
}

/** Build a SubmissionSummary from grouped objects. */
export async function buildSummary(
  id: string,
  objects: _Object[]
): Promise<SubmissionSummary> {
  const latestObj = objects
    .filter((o) => o.LastModified)
    .sort((a, b) => (b.LastModified!.getTime() - a.LastModified!.getTime()))[0];

  const payloadKey = pickPayloadKey(objects);
  const payload = payloadKey ? await getJsonObject<Record<string, unknown>>(payloadKey) : null;

  return {
    id,
    vin: payload ? extractVin(payload) : undefined,
    stage: detectStage(objects, payload),
    updatedAt: latestObj?.LastModified?.toISOString() ?? new Date(0).toISOString(),
    assetCount: objects.filter((o) => o.Key && !o.Key.endsWith("/")).length,
    thumbnailKey: pickThumbnailKey(objects),
  };
}

/** Build a full SubmissionDetail including assets (without presigned URLs – add on demand). */
export async function buildDetail(
  id: string,
  objects: _Object[]
): Promise<SubmissionDetail> {
  const summary = await buildSummary(id, objects);

  const payloadKey = pickPayloadKey(objects);
  const formData = payloadKey
    ? await getJsonObject<Record<string, unknown>>(payloadKey)
    : undefined;

  // Extract structured sections from formData if present
  const vehicle = formData?.vehicle as Record<string, unknown> | undefined;
  const seller = formData?.seller as Record<string, unknown> | undefined;

  const assets: Asset[] = objects
    .filter((o) => o.Key && !o.Key.endsWith("/"))
    .map((o) => ({
      key: o.Key!,
      type: assetType(o.Key!),
      size: o.Size,
      lastModified: o.LastModified?.toISOString(),
    }));

  return {
    ...summary,
    vehicle,
    seller,
    formData: formData ?? undefined,
    assets,
  };
}
