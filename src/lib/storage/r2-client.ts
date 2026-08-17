import 'server-only';

import { S3Client } from '@aws-sdk/client-s3';

/**
 * Cloudflare R2 access for seller-uploaded product photos (owner decision
 * 2026-08-17, superseding the earlier Vercel Blob backend — the upload
 * feature needs durable object storage, and R2 is the approved target).
 *
 * R2 is S3-compatible, so the official AWS SDK v3 S3 client talks to it
 * directly once pointed at the account's R2 endpoint with `region: 'auto'`
 * (Cloudflare's own documented value — R2 has no regions).
 *
 * Five env vars, none of them literal in code:
 * - `CLOUDFLARE_R2_ENDPOINT` — the S3-compatible endpoint for writes/deletes.
 * - `CLOUDFLARE_R2_ACCESS_KEY_ID` / `CLOUDFLARE_R2_SECRET_ACCESS_KEY` — an R2
 *   API token scoped to this bucket only (least privilege).
 * - `CLOUDFLARE_R2_BUCKET` — the bucket seller uploads write into.
 * - `CLOUDFLARE_R2_PUBLIC_BASE_URL` — the public read URL or custom domain
 *   PDP/editor images render from. Never the private S3 endpoint — see
 *   `r2-url.ts`.
 *
 * All five are required together. Uploading is refused with an honest
 * `STORAGE_NOT_CONFIGURED` reason (`upload-seller-media.ts`) whenever any is
 * missing, the same posture `BLOB_READ_WRITE_TOKEN` had.
 */

export type R2Config = {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl: string;
};

export function readR2Config(): R2Config | null {
  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  const accessKeyId = process.env.CLOUDFLARE_R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY;
  const bucket = process.env.CLOUDFLARE_R2_BUCKET;
  const publicBaseUrl = process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL;

  if (
    endpoint === undefined ||
    endpoint.trim() === '' ||
    accessKeyId === undefined ||
    accessKeyId.trim() === '' ||
    secretAccessKey === undefined ||
    secretAccessKey.trim() === '' ||
    bucket === undefined ||
    bucket.trim() === '' ||
    publicBaseUrl === undefined ||
    publicBaseUrl.trim() === ''
  ) {
    return null;
  }

  return { endpoint, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

let cachedClient: S3Client | null = null;

/**
 * One client for the life of the process — same reasoning `getDb()` gives
 * its pooled Postgres connection. Env vars do not change at runtime, so a
 * first-call-wins singleton is enough; no per-call config diffing.
 */
export function getR2Client(config: R2Config): S3Client {
  if (cachedClient !== null) return cachedClient;

  cachedClient = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return cachedClient;
}
