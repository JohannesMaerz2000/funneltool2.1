import { Router } from "express";
import { listAllObjects, presignUrl, PREFIX } from "../s3.js";
import { groupBySubmission, buildSummary, buildDetail } from "../parser.js";
import type { SubmissionSummary } from "../types.js";

export const submissionsRouter = Router();

// Cache raw object list for a short period to avoid hammering S3
let objectCache: { ts: number; data: Awaited<ReturnType<typeof listAllObjects>> } | null = null;
const CACHE_TTL_MS = 30_000;

async function getCachedObjects() {
  const now = Date.now();
  if (objectCache && now - objectCache.ts < CACHE_TTL_MS) return objectCache.data;
  const data = await listAllObjects(PREFIX);
  objectCache = { ts: now, data };
  return data;
}

/**
 * GET /api/submissions
 * Query params: query, stage, from, to, page (1-indexed), pageSize
 */
submissionsRouter.get("/", async (req, res) => {
  try {
    const objects = await getCachedObjects();
    const groups = groupBySubmission(objects);

    // Build summaries in parallel (batched to avoid excessive S3 calls)
    const entries = [...groups.entries()];
    const BATCH = 20;
    const summaries: SubmissionSummary[] = [];
    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(([id, objs]) => buildSummary(id, objs)));
      summaries.push(...results);
    }

    // Filtering
    let filtered = summaries;

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
