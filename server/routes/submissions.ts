import { Router, raw, type Response } from "express";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";
import archiver from "archiver";
import type { _Object } from "@aws-sdk/client-s3";
import { listAllObjects, presignUrl, presignUploadUrl, getObjectStream, putObject, deleteObject, PREFIX } from "../s3.js";
import { buildAssets, buildAssetSummary, groupBySubmission, isRawImagesKey } from "../parser.js";
import {
  fetchSubmissionDetail,
  fetchSubmissionList,
  SellerApiError,
  type SellerSubmissionListItem,
  type SellerSubmissionListResponse,
} from "../sellerApi.js";
import type { CaseSummary, SubmissionDetail, SubmissionSummary } from "../types.js";

export const submissionsRouter = Router();

type S3ObjectList = Awaited<ReturnType<typeof listAllObjects>>;

// Cache raw object list and grouped map to avoid hammering S3.
let objectCache: { ts: number; data: S3ObjectList } | null = null;
let groupCache: { objectTs: number; data: ReturnType<typeof groupBySubmission> } | null = null;
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

function invalidateS3Caches() {
  objectCache = null;
  groupCache = null;
}

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

function sanitizePathSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function getFileExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  if (idx === -1 || idx === fileName.length - 1) return "";
  return fileName.slice(idx + 1).toLowerCase();
}

function normalizeCategory(category: string): string {
  return category
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

type UploadTarget = "photos" | "papers";

function isUploadTarget(value: string | undefined): value is UploadTarget {
  return value === "photos" || value === "papers";
}

function folderForTarget(target: UploadTarget): string {
  return target === "papers" ? "01_Fahrzeugpapiere" : "02_Fahrzeugfotos";
}

function inferExtension(fileName: string, contentType: string): string {
  const fromName = getFileExtension(fileName);
  if (fromName) return fromName;
  const lowerType = contentType.toLowerCase();
  if (lowerType === "image/jpeg") return "jpg";
  if (lowerType === "image/png") return "png";
  if (lowerType === "image/webp") return "webp";
  if (lowerType === "application/pdf") return "pdf";
  return "bin";
}

function nextUploadIndex(objects: _Object[]): number {
  let maxIdx = -1;
  for (const obj of objects) {
    const key = obj.Key;
    if (!key) continue;
    const base = key.split("/").pop() ?? "";
    const match = base.match(/^(\d+)_/);
    if (!match) continue;
    const idx = Number.parseInt(match[1], 10);
    if (Number.isFinite(idx) && idx > maxIdx) maxIdx = idx;
  }
  return maxIdx + 1;
}

function buildUploadKey(input: {
  vin?: string;
  category: string;
  fileName: string;
  contentType: string;
  target: UploadTarget;
  nextIndex: number;
}): string {
  const vin = sanitizePathSegment(input.vin?.toUpperCase() ?? "unknown-vin") || "unknown-vin";
  const vinSuffix = vin.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 4) || "vinx";
  const category = normalizeCategory(input.category) || (input.target === "papers" ? "registration_document" : "exterior");
  const ext = inferExtension(input.fileName, input.contentType);
  const hash = randomUUID().replace(/-/g, "").slice(0, 8);
  const folder = folderForTarget(input.target);
  const filePart = `${input.nextIndex}_${category}_${hash}${vinSuffix}.${ext}`;
  return `${PREFIX}${vin}/${folder}/${filePart}`;
}

function isSupportedImageContentType(contentType: string): boolean {
  return /^image\/[a-z0-9.+-]+$/i.test(contentType);
}

function isSupportedPaperContentType(contentType: string): boolean {
  return isSupportedImageContentType(contentType) || contentType.toLowerCase() === "application/pdf";
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

type IntakeFilter = "initial" | "advance";
type ViewFilter = "initial" | "partial" | "advance";

function normalizeIntakeFilter(value?: string): IntakeFilter | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "initial" || normalized === "advance") return normalized;
  return undefined;
}

function getAdvanceSyncState(status?: string | null): "partial" | "completed" {
  return status?.trim().toLowerCase() === "completed" ? "completed" : "partial";
}

function parseViewFilters(value?: string): ViewFilter[] | null {
  if (!value) return null;
  const values = value
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);
  if (values.length === 0) return null;
  const unique = Array.from(new Set(values));
  const valid = unique.every((v) => v === "initial" || v === "partial" || v === "advance");
  if (!valid) return null;
  return unique as ViewFilter[];
}

function caseMatchesView(c: CaseSummary, view: ViewFilter): boolean {
  if (view === "initial") return !!c.m1;
  if (!c.m15) return false;
  const sync = getAdvanceSyncState(c.m15.pipedriveSyncStatus);
  return view === "partial" ? sync === "partial" : sync === "completed";
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

function groupIntoCases(submissions: SubmissionSummary[]): CaseSummary[] {
  const grouped = new Map<string, SubmissionSummary[]>();

  submissions.forEach((submission) => {
    const key = submission.vin?.toUpperCase().trim() || `NO_VIN:${submission.id}`;
    const list = grouped.get(key) ?? [];
    list.push(submission);
    grouped.set(key, list);
  });

  const cases: CaseSummary[] = [];

  grouped.forEach((items, caseKey) => {
    const sorted = [...items].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    const m1 = sorted.find((item) => item.formIntake?.toLowerCase() === "initial");
    const m15 = sorted.find((item) => item.formIntake?.toLowerCase() === "advance");
    const primary = m15 ?? m1 ?? sorted[0];

    const updatedAt = [m1?.updatedAt, m15?.updatedAt, primary.updatedAt]
      .filter((value): value is string => !!value)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0];

    cases.push({
      caseKey,
      vin: primary.vin,
      m1,
      m15,
      openId: (m15 ?? m1 ?? primary).id,
      updatedAt,
      pipedriveSyncStatus: m15?.pipedriveSyncStatus ?? m1?.pipedriveSyncStatus ?? primary.pipedriveSyncStatus,
      pipedriveDealId: m15?.pipedriveDealId ?? m1?.pipedriveDealId ?? primary.pipedriveDealId,
      assetCount: Math.max(m15?.assetCount ?? 0, m1?.assetCount ?? 0, primary.assetCount ?? 0),
      thumbnailKey: m15?.thumbnailKey ?? m1?.thumbnailKey ?? primary.thumbnailKey,
    });
  });

  return cases.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
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
 * POST /api/submissions/:id/upload-url
 * Body: { fileName: string, contentType: string, category?: string }
 * Returns: { key, uploadUrl }
 */
submissionsRouter.post("/:id/upload-url", async (req, res) => {
  try {
    const { id } = req.params;
    const fileName = parseOptionalString(req.body?.fileName);
    const contentType = parseOptionalString(req.body?.contentType);
    const category = parseOptionalString(req.body?.category) ?? "exterior";

    if (!fileName || !contentType) {
      res.status(400).json({ error: "fileName and contentType are required" });
      return;
    }
    if (!isSupportedImageContentType(contentType)) {
      res.status(400).json({ error: "Only image uploads are supported" });
      return;
    }

    const upstream = await fetchSubmissionDetail(id);
    const vin = isRecord(upstream.submission) ? asString(upstream.submission.vin) : undefined;
    const objects = await getCachedObjects();
    const groups = getCachedGroups(objects);
    const caseInsensitiveGroups = buildCaseInsensitiveGroups(groups);
    const existingObjects = resolveSubmissionObjects(groups, caseInsensitiveGroups, [id, vin]);
    const nextIndex = nextUploadIndex(existingObjects);
    const key = buildUploadKey({
      vin,
      category,
      fileName,
      contentType,
      target: "photos",
      nextIndex,
    });
    const uploadUrl = await presignUploadUrl(key, contentType);

    // Bust object/group cache so newly uploaded images appear on the next fetch.
    invalidateS3Caches();

    res.json({ key, uploadUrl });
  } catch (err) {
    if (handleSellerApiError(res, err)) return;
    console.error("[submissions] upload-url error:", err);
    res.status(500).json({ error: "Failed to generate upload URL", detail: String(err) });
  }
});

/**
 * POST /api/submissions/:id/upload-complete
 * Body: { key: string }
 */
submissionsRouter.post("/:id/upload-complete", async (req, res) => {
  try {
    const key = parseOptionalString(req.body?.key);
    if (!key || !key.startsWith(PREFIX) || isRawImagesKey(key)) {
      res.status(400).json({ error: "Invalid key" });
      return;
    }
    invalidateS3Caches();
    res.json({ ok: true });
  } catch (err) {
    console.error("[submissions] upload-complete error:", err);
    res.status(500).json({ error: "Failed to finalize upload", detail: String(err) });
  }
});

/**
 * POST /api/submissions/:id/upload-asset?fileName=<name>&category=<category>&target=photos|papers
 * Body: raw bytes
 */
submissionsRouter.post("/:id/upload-asset", raw({ type: () => true, limit: "30mb" }), async (req, res) => {
  try {
    const { id } = req.params;
    const fileName = parseOptionalString(req.query.fileName) ?? "upload.jpg";
    const category = parseOptionalString(req.query.category) ?? "exterior";
    const targetRaw = parseOptionalString(req.query.target) ?? "photos";
    const contentType = parseOptionalString(req.headers["content-type"]);
    const body = req.body;
    const target = isUploadTarget(targetRaw) ? targetRaw : "photos";

    if (!contentType) {
      res.status(400).json({ error: "Content-Type is required" });
      return;
    }
    const isSupportedType =
      target === "papers"
        ? isSupportedPaperContentType(contentType)
        : isSupportedImageContentType(contentType);
    if (!isSupportedType) {
      res.status(400).json({ error: target === "papers" ? "Papers must be image/* or application/pdf" : "Photos must be image/*" });
      return;
    }
    if (!(body instanceof Buffer) || body.length === 0) {
      res.status(400).json({ error: "Asset body is required" });
      return;
    }

    const upstream = await fetchSubmissionDetail(id);
    const vin = isRecord(upstream.submission) ? asString(upstream.submission.vin) : undefined;
    const objects = await getCachedObjects();
    const groups = getCachedGroups(objects);
    const caseInsensitiveGroups = buildCaseInsensitiveGroups(groups);
    const existingObjects = resolveSubmissionObjects(groups, caseInsensitiveGroups, [id, vin]);
    const nextIndex = nextUploadIndex(existingObjects);
    const key = buildUploadKey({ vin, category, fileName, contentType, target, nextIndex });

    await putObject(key, body, contentType);
    invalidateS3Caches();

    res.json({ key });
  } catch (err) {
    if (handleSellerApiError(res, err)) return;
    console.error("[submissions] upload-asset error:", err);
    res.status(500).json({ error: "Failed to upload asset", detail: String(err) });
  }
});

/**
 * DELETE /api/submissions/:id/asset?key=<s3key>
 */
submissionsRouter.delete("/:id/asset", async (req, res) => {
  try {
    const { id } = req.params;
    const key = parseOptionalString(req.query.key) ?? parseOptionalString(req.body?.key);
    if (!key || !key.startsWith(PREFIX) || isRawImagesKey(key)) {
      res.status(400).json({ error: "Invalid key" });
      return;
    }

    const upstream = await fetchSubmissionDetail(id);
    const vin = isRecord(upstream.submission) ? asString(upstream.submission.vin) : undefined;
    const objects = await getCachedObjects();
    const groups = getCachedGroups(objects);
    const caseInsensitiveGroups = buildCaseInsensitiveGroups(groups);
    const allowedObjects = resolveSubmissionObjects(groups, caseInsensitiveGroups, [id, vin]);
    const keyAllowed = allowedObjects.some((obj) => obj.Key === key);
    if (!keyAllowed) {
      res.status(403).json({ error: "Asset does not belong to this submission" });
      return;
    }

    await deleteObject(key);
    invalidateS3Caches();
    res.json({ ok: true });
  } catch (err) {
    if (handleSellerApiError(res, err)) return;
    console.error("[submissions] delete asset error:", err);
    res.status(500).json({ error: "Failed to delete asset", detail: String(err) });
  }
});

/**
 * GET /api/submissions
 * Query params: page, pageSize, vin, from, to (ISO date strings)
 */
submissionsRouter.get("/", async (req, res) => {
  try {
    const vin = parseOptionalString(req.query.vin) ?? parseOptionalString(req.query.query);
    const pipedriveDealId = parseOptionalString(req.query.pipedrive_deal_id);
    const intakeRaw = parseOptionalString(req.query.intake);
    const intake = normalizeIntakeFilter(intakeRaw);
    const viewsRaw = parseOptionalString(req.query.views);
    const views = parseViewFilters(viewsRaw) ?? ["initial", "partial", "advance"];
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
    if (intakeRaw && !intake) {
      res.status(400).json({ error: "Invalid intake (expected initial or advance)" });
      return;
    }
    if (viewsRaw && !parseViewFilters(viewsRaw)) {
      res.status(400).json({ error: "Invalid views (expected comma-separated initial, partial, advance)" });
      return;
    }

    const page = parseBoundedInt(req.query.page, { fallback: 1, min: 1, max: 10_000 });
    const pageSize = parseBoundedInt(req.query.pageSize, { fallback: 20, min: 1, max: 100 });

    // To properly group by VIN and paginate, we need all submissions
    // since the upstream API doesn't support grouping. We fetch pages of 100 (upstream limit)
    // until we have them all.
    const allItems: SellerSubmissionListItem[] = [];
    let currentPage = 1;
    let totalAvailable = 0;

    do {
      const upstream = await fetchSubmissionList({ page: currentPage, pageSize: 100, vin, from, to });
      allItems.push(...upstream.items);
      totalAvailable = upstream.total;
      if (allItems.length >= totalAvailable || currentPage >= 10) break; // limit to 1000 items total for safety
      currentPage++;
    } while (true);

    const enrichmentById = await getAssetEnrichment(
      allItems.map((item) => ({ id: item.id, vin: item.vin }))
    );
    const submissions = allItems.map((item) => normalizeSummary(item, enrichmentById.get(item.id)));
    
    let cases = groupIntoCases(submissions);

    // Legacy intake support (if still used by an older client)
    if (intake === "initial") cases = cases.filter((c) => !!c.m1);
    if (intake === "advance") cases = cases.filter((c) => !!c.m15);

    cases = cases.filter((c) => views.some((view) => caseMatchesView(c, view)));

    // Client-side filter by deal ID if provided
    if (pipedriveDealId) {
      cases = cases.filter((c: CaseSummary) => c.pipedriveDealId === pipedriveDealId);
    }

    const total = cases.length;
    const paginatedData = cases.slice((page - 1) * pageSize, page * pageSize);

    res.json({
      total,
      page,
      pageSize,
      data: paginatedData,
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
