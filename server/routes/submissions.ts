import { Router, type Response } from "express";
import { Readable } from "node:stream";
import archiver from "archiver";
import type { _Object } from "@aws-sdk/client-s3";
import { listAllObjects, presignUrl, getObjectStream, PREFIX } from "../s3.js";
import { buildAssets, buildAssetSummary, groupBySubmission, isRawImagesKey } from "../parser.js";
import {
  fetchSubmissionDetail,
  fetchSubmissionList,
  SellerApiError,
  type SellerSubmissionListItem,
} from "../sellerApi.js";
import type { SubmissionDetail, SubmissionSummary } from "../types.js";

export const submissionsRouter = Router();

type S3ObjectList = Awaited<ReturnType<typeof listAllObjects>>;

// Cache raw object list and grouped map to avoid hammering S3.
let objectCache: { ts: number; data: S3ObjectList } | null = null;
let groupCache: { objectTs: number; data: ReturnType<typeof groupBySubmission> } | null = null;
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

async function getCachedObjects() {
  const now = Date.now();
  if (objectCache && now - objectCache.ts < CACHE_TTL_MS) return objectCache.data;
  const data = await listAllObjects(PREFIX);
  objectCache = { ts: now, data };
  groupCache = null; // invalidate derived cache
  return data;
}

function getCachedGroups(objects: S3ObjectList) {
  if (groupCache && groupCache.objectTs === objectCache!.ts) return groupCache.data;
  const data = groupBySubmission(objects);
  groupCache = { objectTs: objectCache!.ts, data };
  return data;
}

function buildCaseInsensitiveGroups(
  groups: ReturnType<typeof groupBySubmission>
): Map<string, _Object[]> {
  const map = new Map<string, _Object[]>();
  for (const [key, objects] of groups.entries()) {
    map.set(key.toLowerCase(), objects);
  }
  return map;
}

function resolveSubmissionObjects(
  groups: ReturnType<typeof groupBySubmission>,
  caseInsensitiveGroups: Map<string, _Object[]>,
  candidates: Array<string | null | undefined>
): _Object[] {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const exact = groups.get(trimmed);
    if (exact) return exact;
    const insensitive = caseInsensitiveGroups.get(trimmed.toLowerCase());
    if (insensitive) return insensitive;
  }
  return [];
}

function parseOptionalString(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseBoundedInt(
  input: unknown,
  defaults: { fallback: number; min: number; max: number }
): number {
  if (typeof input !== "string") return defaults.fallback;
  const parsed = Number.parseInt(input, 10);
  if (!Number.isFinite(parsed)) return defaults.fallback;
  return Math.min(defaults.max, Math.max(defaults.min, parsed));
}

function normalizeIsoDate(value?: string): string | undefined {
  if (!value) return undefined;
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return undefined;
  return new Date(ts).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function asNullableString(value: unknown): string | null {
  return asString(value) ?? null;
}

function normalizeSummary(
  item: SellerSubmissionListItem,
  enrichment?: { assetCount: number; thumbnailKey?: string }
): SubmissionSummary {
  return {
    id: item.id,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
    vin: item.vin ?? undefined,
    sessionId: item.session_id ?? undefined,
    formIntake: item.form_intake ?? undefined,
    formId: item.form_id ?? undefined,
    pipedriveDealId: item.pipedrive_deal_id ?? null,
    pipedriveSyncStatus: item.pipedrive_sync_status ?? null,
    submissionSource: item.submission_source ?? null,
    registrationCountry: item.registration_country ?? null,
    assetCount: enrichment?.assetCount ?? 0,
    thumbnailKey: enrichment?.thumbnailKey,
  };
}

async function getAssetEnrichment(
  submissions: Array<{ id: string; vin?: string | null }>
): Promise<Map<string, { assetCount: number; thumbnailKey?: string }>> {
  const map = new Map<string, { assetCount: number; thumbnailKey?: string }>();
  if (submissions.length === 0) return map;

  const objects = await getCachedObjects();
  const groups = getCachedGroups(objects);
  const caseInsensitiveGroups = buildCaseInsensitiveGroups(groups);

  for (const submission of submissions) {
    const matched = resolveSubmissionObjects(groups, caseInsensitiveGroups, [
      submission.id,
      submission.vin ?? undefined,
    ]);
    map.set(submission.id, buildAssetSummary(matched));
  }

  return map;
}

function handleSellerApiError(res: Response, err: unknown) {
  if (!(err instanceof SellerApiError)) return false;
  if (err.status === 404) {
    res.status(404).json({ error: "Not found" });
    return true;
  }
  const status = err.status >= 400 && err.status < 600 ? err.status : 502;
  res.status(status).json({ error: err.message, detail: err.body ?? null });
  return true;
}

/**
 * POST /api/submissions/presign-batch
 * Body: [{ id, key }] — returns [{ key, url }]
 */
submissionsRouter.post("/presign-batch", async (req, res) => {
  try {
    const items = req.body as Array<{ id: string; key: string }>;
    if (!Array.isArray(items) || items.length > 200) {
      res.status(400).json({ error: "Expected array of up to 200 items" });
      return;
    }
    // Process in batches of 20 to avoid overwhelming the S3 presigner.
    const CONCURRENCY = 20;
    const results: Array<{ key: string; url: string | null }> = [];
    for (let i = 0; i < items.length; i += CONCURRENCY) {
      const batch = items.slice(i, i + CONCURRENCY);
      const batchResults = await Promise.all(
        batch.map(async ({ id, key }) => {
          void id;
          if (!key || !key.startsWith(PREFIX) || isRawImagesKey(key)) {
            return { key, url: null };
          }
          const url = await presignUrl(key);
          return { key, url };
        })
      );
      results.push(...batchResults);
    }
    res.json(results);
  } catch (err) {
    console.error("[submissions] presign-batch error:", err);
    res.status(500).json({ error: "Failed to generate URLs", detail: String(err) });
  }
});

/**
 * GET /api/submissions
 * Query params: page, pageSize, vin, from, to (ISO date strings)
 */
submissionsRouter.get("/", async (req, res) => {
  try {
    const vin = parseOptionalString(req.query.vin) ?? parseOptionalString(req.query.query);
    const fromRaw = parseOptionalString(req.query.from);
    const toRaw = parseOptionalString(req.query.to);
    const from = normalizeIsoDate(fromRaw);
    const to = normalizeIsoDate(toRaw);

    if (fromRaw && !from) {
      res.status(400).json({ error: "Invalid from date (expected ISO date string)" });
      return;
    }
    if (toRaw && !to) {
      res.status(400).json({ error: "Invalid to date (expected ISO date string)" });
      return;
    }

    const page = parseBoundedInt(req.query.page, { fallback: 1, min: 1, max: 10_000 });
    const pageSize = parseBoundedInt(req.query.pageSize, { fallback: 20, min: 1, max: 100 });

    const upstream = await fetchSubmissionList({ page, pageSize, vin, from, to });
    const enrichmentById = await getAssetEnrichment(
      upstream.items.map((item) => ({ id: item.id, vin: item.vin }))
    );
    const data = upstream.items.map((item) => normalizeSummary(item, enrichmentById.get(item.id)));

    res.json({
      total: upstream.total,
      page: upstream.page,
      pageSize: upstream.pageSize,
      data,
    });
  } catch (err) {
    if (handleSellerApiError(res, err)) return;
    console.error("[submissions] list error:", err);
    res.status(500).json({ error: "Failed to list submissions", detail: String(err) });
  }
});

/**
 * GET /api/submissions/:id
 */
submissionsRouter.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const upstream = await fetchSubmissionDetail(id);
    if (!isRecord(upstream.submission)) {
      res.status(502).json({ error: "Invalid submission payload from seller API" });
      return;
    }

    const submission = upstream.submission;
    const objects = await getCachedObjects();
    const groups = getCachedGroups(objects);
    const caseInsensitiveGroups = buildCaseInsensitiveGroups(groups);
    const vin = asString(submission.vin);
    const submissionObjects = resolveSubmissionObjects(groups, caseInsensitiveGroups, [id, vin]);
    const assetSummary = buildAssetSummary(submissionObjects);
    const assets = buildAssets(submissionObjects);

    const detail: SubmissionDetail = {
      id: asString(submission.id) ?? id,
      createdAt: asString(submission.created_at) ?? new Date(0).toISOString(),
      updatedAt: asString(submission.updated_at) ?? new Date(0).toISOString(),
      vin,
      sessionId: asString(submission.session_id),
      formIntake: asString(submission.form_intake),
      formId: asString(submission.form_id),
      pipedriveDealId: asNullableString(submission.pipedrive_deal_id),
      pipedriveSyncStatus: asNullableString(submission.pipedrive_sync_status),
      submissionSource: asNullableString(submission.submission_source),
      registrationCountry: asNullableString(submission.registration_country),
      lastSyncedAt: asNullableString(submission.last_synced_at),
      identifierInformationId: asNullableString(submission.identifier_information_id),
      idempotencyKey: asNullableString(submission.idempotency_key),
      submission,
      submissionData: isRecord(submission.submission_data) ? submission.submission_data : null,
      datInformation: isRecord(upstream.dat_information) ? upstream.dat_information : null,
      vinHistory: isRecord(upstream.vin_history) ? upstream.vin_history : null,
      imageProcessingJobs: Array.isArray(upstream.image_processing_jobs)
        ? upstream.image_processing_jobs.filter(isRecord)
        : [],
      assetCount: assetSummary.assetCount,
      thumbnailKey: assetSummary.thumbnailKey,
      assets,
    };

    res.json(detail);
  } catch (err) {
    if (handleSellerApiError(res, err)) return;
    console.error("[submissions] detail error:", err);
    res.status(500).json({ error: "Failed to load submission", detail: String(err) });
  }
});

/**
 * GET /api/submissions/:id/download-all
 * Streams a zip archive of all image assets for a submission.
 */
submissionsRouter.get("/:id/download-all", async (req, res) => {
  try {
    const { id } = req.params;
    const objects = await getCachedObjects();
    const groups = getCachedGroups(objects);
    const caseInsensitiveGroups = buildCaseInsensitiveGroups(groups);
    let objs = resolveSubmissionObjects(groups, caseInsensitiveGroups, [id]);
    if (objs.length === 0) {
      const upstream = await fetchSubmissionDetail(id);
      const vin = isRecord(upstream.submission) ? asString(upstream.submission.vin) : undefined;
      objs = resolveSubmissionObjects(groups, caseInsensitiveGroups, [vin]);
    }
    if (objs.length === 0) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }

    const imageExts = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".svg"]);
    const imageKeys = objs
      .filter((o) => {
        const key = o.Key ?? "";
        if (!key || key.endsWith("/") || isRawImagesKey(key)) return false;
        const ext = key.slice(key.lastIndexOf(".")).toLowerCase();
        return imageExts.has(ext);
      })
      .map((o) => o.Key!);

    if (imageKeys.length === 0) {
      res.status(404).json({ error: "No images found" });
      return;
    }

    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${id}_images.zip"`);

    const archive = archiver("zip", { store: true });
    archive.pipe(res);

    for (const key of imageKeys) {
      const { body } = await getObjectStream(key);
      if (!body) continue;
      const filename = key.split("/").pop() ?? key;
      const nodeStream = Readable.fromWeb(
        body.transformToWebStream() as import("stream/web").ReadableStream
      );
      archive.append(nodeStream, { name: filename });
    }

    await archive.finalize();
  } catch (err) {
    console.error("[submissions] download-all error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Download failed", detail: String(err) });
  }
});

/**
 * GET /api/submissions/:id/download?key=<s3key>
 * Proxies the S3 object to the browser with Content-Disposition: attachment.
 */
submissionsRouter.get("/:id/download", async (req, res) => {
  try {
    const key = req.query.key as string;
    if (!key) {
      res.status(400).json({ error: "key param required" });
      return;
    }
    if (!key.startsWith(PREFIX)) {
      res.status(403).json({ error: "Key must be inside allowed S3 prefix" });
      return;
    }
    if (isRawImagesKey(key)) {
      res.status(403).json({ error: "raw_images assets are excluded" });
      return;
    }
    const { body, contentType, contentLength } = await getObjectStream(key);
    if (!body) {
      res.status(404).json({ error: "Object not found" });
      return;
    }

    const filename = key.split("/").pop() ?? "download";
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    if (contentType) res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", String(contentLength));

    // Pipe the S3 readable stream to the response.
    const webStream = body.transformToWebStream() as ReadableStream<Uint8Array>;
    const reader = webStream.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          return;
        }
        if (!res.write(value)) {
          await new Promise<void>((resolve) => res.once("drain", resolve));
        }
      }
    };
    await pump();
  } catch (err) {
    console.error("[submissions] download error:", err);
    if (!res.headersSent) res.status(500).json({ error: "Download failed", detail: String(err) });
  }
});

/**
 * GET /api/submissions/:id/asset-url?key=<s3key>
 * Returns a short-lived presigned URL for an asset.
 */
submissionsRouter.get("/:id/asset-url", async (req, res) => {
  try {
    const key = req.query.key as string;
    if (!key) {
      res.status(400).json({ error: "key param required" });
      return;
    }
    // Validate key belongs to configured S3 prefix.
    if (!key.startsWith(PREFIX)) {
      res.status(403).json({ error: "Key must be inside allowed S3 prefix" });
      return;
    }
    if (isRawImagesKey(key)) {
      res.status(403).json({ error: "raw_images assets are excluded" });
      return;
    }
    const url = await presignUrl(key);
    res.json({ url });
  } catch (err) {
    console.error("[submissions] presign error:", err);
    res.status(500).json({ error: "Failed to generate asset URL", detail: String(err) });
  }
});
