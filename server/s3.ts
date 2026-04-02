import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  type _Object,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const BUCKET = process.env.S3_BUCKET ?? "seller-funnel-development";
export const PREFIX = "advance/";

// Lazy singleton – created on first use so .env.aws is already loaded by then.
let _s3: S3Client | null = null;

function getS3(): S3Client {
  if (!_s3) {
    const region =
      process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "eu-central-1";
    _s3 = new S3Client({
      region,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        ...(process.env.AWS_SESSION_TOKEN
          ? { sessionToken: process.env.AWS_SESSION_TOKEN }
          : {}),
      },
    });
  }
  return _s3;
}

/** List all objects under a prefix (handles S3 pagination). */
export async function listAllObjects(prefix: string): Promise<_Object[]> {
  const objects: _Object[] = [];
  let continuationToken: string | undefined;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
    });
    const res = await getS3().send(cmd);
    objects.push(...(res.Contents ?? []));
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return objects;
}

/** List immediate "subdirectories" under a prefix using the delimiter. */
export async function listCommonPrefixes(prefix: string): Promise<string[]> {
  const prefixes: string[] = [];
  let continuationToken: string | undefined;

  do {
    const cmd = new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      Delimiter: "/",
      ContinuationToken: continuationToken,
    });
    const res = await getS3().send(cmd);
    for (const cp of res.CommonPrefixes ?? []) {
      if (cp.Prefix) prefixes.push(cp.Prefix);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return prefixes;
}

// In-memory cache for parsed JSON payloads (keyed by S3 key).
// These rarely change and are fetched repeatedly during summary building.
const jsonCache = new Map<string, { ts: number; data: unknown }>();
const JSON_CACHE_TTL_MS = 10 * 60_000; // 10 minutes

/** Fetch an S3 object and parse it as JSON. Returns null on failure. */
export async function getJsonObject<T = unknown>(key: string): Promise<T | null> {
  const now = Date.now();
  const cached = jsonCache.get(key);
  if (cached && now - cached.ts < JSON_CACHE_TTL_MS) return cached.data as T;

  try {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const res = await getS3().send(cmd);
    const body = await res.Body?.transformToString("utf-8");
    if (!body) return null;
    const parsed = JSON.parse(body) as T;
    jsonCache.set(key, { ts: now, data: parsed });
    return parsed;
  } catch {
    return null;
  }
}

/** Fetch an S3 object as a readable stream with metadata. */
export async function getObjectStream(key: string) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  const res = await getS3().send(cmd);
  return {
    body: res.Body,
    contentType: res.ContentType,
    contentLength: res.ContentLength,
  };
}

/** Generate a short-lived presigned GET URL. */
export async function presignUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(getS3(), cmd, { expiresIn: expiresInSeconds });
}
