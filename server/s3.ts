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

/** Fetch an S3 object and parse it as JSON. Returns null on failure. */
export async function getJsonObject<T = unknown>(key: string): Promise<T | null> {
  try {
    const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
    const res = await getS3().send(cmd);
    const body = await res.Body?.transformToString("utf-8");
    if (!body) return null;
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
}

/** Generate a short-lived presigned GET URL. */
export async function presignUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(getS3(), cmd, { expiresIn: expiresInSeconds });
}
