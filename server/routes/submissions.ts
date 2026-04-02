import { Router } from "express";
import { listAllObjects, presignUrl, getObjectStream, PREFIX } from "../s3.js";
import { groupBySubmission, buildSummary, buildDetail } from "../parser.js";
import type { SubmissionSummary } from "../types.js";

export const submissionsRouter = Router();

// Cache raw object list and parsed summaries to avoid hammering S3
let objectCache: { ts: number; data: Awaited<ReturnType<typeof listAllObjects>> } | null = null;
let summaryCache: { objectTs: number; data: SubmissionSummary[] } | null = null;
const CACHE_TTL_MS = 5 * 60_000; // 5 minutes

async function getCachedObjects() {
  const now = Date.now();
  if (objectCache && now - objectCache.ts < CACHE_TTL_MS) return objectCache.data;
  const data = await listAllObjects(PREFIX);
  objectCache = { ts: now, data };
  return data;
}

async function getCachedSummaries(): Promise<SubmissionSummary[]> {
  const objects = await getCachedObjects();
  // Reuse summaries if built from the same object fetch
  if (summaryCache && summaryCache.objectTs === objectCache!.ts) return summaryCache.data;

  const groups = groupBySubmission(objects);
  const entries = [...groups.entries()];
  const BATCH = 20;
  const summaries: SubmissionSummary[] = [];
  for (let i = 0; i < entries.length; i += BATCH) {
    const batch = entries.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(([id, objs]) => buildSummary(id, objs)));
    summaries.push(...results);
  }
  summaryCache = { objectTs: objectCache!.ts, data: summaries };
  return summaries;
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
    const results = await Promise.all(
      items.map(async ({ id, key }) => {
        if (!key || !key.startsWith(`${PREFIX}${id}/`)) return { key, url: null };
        const url = await presignUrl(key);
        return { key, url };
      })
    );
    res.json(results);
  } catch (err) {
    console.error("[submissions] presign-batch error:", err);
    res.status(500).json({ error: "Failed to generate URLs", detail: String(err) });
  }
});

/**
 * GET /api/submissions
 * Query params: query, stage, from, to, page (1-indexed), pageSize
 */
submissionsRouter.get("/", async (req, res) => {
  try {
    const summaries = await getCachedSummaries();

    let filtered = summaries.slice(); // work on a copy

    const { query, stage, from, to } = req.query as Record<string, string>;

    if (query) {
      const q = query.toLowerCase();
      filtered = filtered.filter(
        (s) => s.id.toLowerCase().includes(q) || s.vin?.toLowerCase().includes(q)
      );
    }
    if (stage && stage !== "all") {
      filtered = filtered.filter((s) => s.stage === stage);
    }
    if (from) {
      const fromTs = new Date(from).getTime();
      filtered = filtered.filter((s) => new Date(s.updatedAt).getTime() >= fromTs);
    }
    if (to) {
      const toTs = new Date(to).getTime();
      filtered = filtered.filter((s) => new Date(s.updatedAt).getTime() <= toTs);
    }

    // Sort newest first
    filtered.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

    // Pagination
    const pageSize = Math.min(parseInt((req.query.pageSize as string) ?? "50", 10), 200);
    const page = Math.max(parseInt((req.query.page as string) ?? "1", 10), 1);
    const total = filtered.length;
    const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

    res.json({ total, page, pageSize, data: paged });
  } catch (err) {
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
    const objects = await getCachedObjects();
    const groups = groupBySubmission(objects);
    const objs = groups.get(id);
    if (!objs) {
      res.status(404).json({ error: "Submission not found" });
      return;
    }
    const detail = await buildDetail(id, objs);
    res.json(detail);
  } catch (err) {
    console.error("[submissions] detail error:", err);
    res.status(500).json({ error: "Failed to load submission", detail: String(err) });
  }
});

/**
 * GET /api/submissions/:id/download?key=<s3key>
 * Proxies the S3 object to the browser with Content-Disposition: attachment.
 */
submissionsRouter.get("/:id/download", async (req, res) => {
  try {
    const key = req.query.key as string;
    if (!key) { res.status(400).json({ error: "key param required" }); return; }
    const { id } = req.params;
    if (!key.startsWith(`${PREFIX}${id}/`)) {
      res.status(403).json({ error: "Key does not belong to this submission" });
      return;
    }
    const { body, contentType, contentLength } = await getObjectStream(key);
    if (!body) { res.status(404).json({ error: "Object not found" }); return; }

    const filename = key.split("/").pop() ?? "download";
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    if (contentType) res.setHeader("Content-Type", contentType);
    if (contentLength) res.setHeader("Content-Length", String(contentLength));

    // Pipe the S3 readable stream to the response
    const webStream = body.transformToWebStream() as ReadableStream<Uint8Array>;
    const reader = webStream.getReader();
    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
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
    // Validate key belongs to this submission
    const { id } = req.params;
    if (!key.startsWith(`${PREFIX}${id}/`)) {
      res.status(403).json({ error: "Key does not belong to this submission" });
      return;
    }
    const url = await presignUrl(key);
    res.json({ url });
  } catch (err) {
    console.error("[submissions] presign error:", err);
    res.status(500).json({ error: "Failed to generate asset URL", detail: String(err) });
  }
});
