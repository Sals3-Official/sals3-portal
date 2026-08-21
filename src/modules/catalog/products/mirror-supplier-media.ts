import 'server-only';

import { createHash } from 'node:crypto';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { and, eq, isNotNull, isNull, ne } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import { cjImageUrl } from '@/lib/cj/primitives';
import { productMediaSources } from '@/lib/db/schema';
import { getR2Client, readR2Config } from '@/lib/storage/r2-client';
import { r2PublicImageUrl, r2PublicUrlForKey } from '@/lib/storage/r2-url';
import {
  MAX_UPLOAD_BYTES,
  OUTPUT_CONTENT_TYPE,
  prepareUploadedImage,
} from './image-upload-pipeline';

/**
 * Taking a durable Sals3 copy of a supplier's photo.
 *
 * ## The promise this keeps
 *
 * ADR-007's `Media locking`: *"If a supplier later replaces or removes a file at
 * the same URL, the order, receipt, return, dispute, and support surfaces
 * continue showing the original accepted media."* Nothing kept that promise. A
 * `SUPPLIER_ORIGINAL` row holds a CJ CDN address, and the per-order listing
 * snapshot freezes the **address**, not the bytes — so a file CJ swaps out
 * changes what a two-year-old order shows, silently, in the one case nobody
 * looks at until a dispute.
 *
 * This fetches the bytes once, re-encodes them through the same pipeline every
 * seller upload goes through, stores them in Cloudflare R2, and records where.
 * `source_url` is never touched: it is provenance, and the answer to "where did
 * this come from" is not the answer to "what can we still show".
 *
 * ## What it will not fetch
 *
 * Only an address that `cjImageUrl` accepts — the same host allow-list the
 * projection and the storefront use. A stored URL is still an address this
 * server is about to open, so it is validated at the moment of use rather than
 * trusted because it is in our own database (rule 32: no user-influenced value
 * decides what the server fetches). Anything else is reported as
 * `HOST_NOT_ALLOWED` and left alone.
 *
 * ## Cost
 *
 * **No CJ API call and no points** (ADR-017): this reads CJ's CDN, not its API.
 * It is still bandwidth and storage, so it is bounded per run, runs
 * sequentially, and is never reachable from a render — publication schedules it
 * after the response, and the backfill route is manual.
 */

/** One run's ceiling, matching `media-projection`'s own per-product cap. */
export const MAX_MIRRORED_PER_PRODUCT = 12;

/** A CDN that does not answer must not hold a publish worker open. */
const FETCH_TIMEOUT_MS = 10_000;

export type MirrorFailureReason =
  | 'HOST_NOT_ALLOWED'
  | 'FETCH_FAILED'
  | 'TOO_LARGE'
  | 'NOT_AN_IMAGE'
  | 'STORAGE_FAILED';

export type MirrorSupplierMediaResult = {
  /** Rows that now carry a durable copy because of this run. */
  mirrored: number;
  /** Rows that already had one, or that this run reused a copy for. */
  skipped: number;
  failures: { mediaId: string; reason: MirrorFailureReason }[];
};

type Fetcher = typeof fetch;

/**
 * Rows worth mirroring: this product's supplier originals that a buyer may
 * actually be shown, and that have no durable copy yet.
 *
 * `reviewState = 'APPROVED'` and a known rights basis are the same conditions
 * the storefront's own media predicate applies — mirroring an asset nobody may
 * display would spend storage to protect nothing.
 */
async function pendingRows(db: Database, productId: string) {
  return db
    .select({
      id: productMediaSources.id,
      sourceUrl: productMediaSources.sourceUrl,
    })
    .from(productMediaSources)
    .where(
      and(
        eq(productMediaSources.productId, productId),
        eq(productMediaSources.sourceType, 'SUPPLIER_ORIGINAL'),
        eq(productMediaSources.reviewState, 'APPROVED'),
        ne(productMediaSources.rightsBasis, 'UNKNOWN'),
        isNotNull(productMediaSources.sourceUrl),
        isNull(productMediaSources.storedUrl),
      ),
    )
    .limit(MAX_MIRRORED_PER_PRODUCT);
}

async function fetchImageBytes(
  url: string,
  fetcher: Fetcher,
): Promise<
  | { ok: true; bytes: ArrayBuffer }
  | { ok: false; reason: 'FETCH_FAILED' | 'TOO_LARGE' }
> {
  try {
    const response = await fetcher(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      // No credentials, no cookies: this is a public CDN read.
      redirect: 'follow',
    });

    if (!response.ok) return { ok: false, reason: 'FETCH_FAILED' };

    // Checked before reading the body where the CDN declares it, and again
    // against the real length below — a header is a claim, not a measurement.
    const declared = Number(response.headers.get('content-length') ?? '0');

    if (declared > MAX_UPLOAD_BYTES) return { ok: false, reason: 'TOO_LARGE' };

    const bytes = await response.arrayBuffer();

    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      return { ok: false, reason: 'TOO_LARGE' };
    }

    return { ok: true, bytes };
  } catch {
    return { ok: false, reason: 'FETCH_FAILED' };
  }
}

/**
 * Mirrors one product's approved supplier photos into Sals3 storage.
 *
 * Idempotent in two ways: rows that already carry `stored_url` are not
 * selected, and a row whose re-encoded bytes match a copy this product already
 * holds points at that copy instead of writing a second identical object. The
 * second case is what keeps the `(product_id, checksum)` unique index from
 * turning a duplicate photo into a failure.
 *
 * Sequential on purpose. A product has at most a dozen images, and firing them
 * at CJ's CDN in parallel to save two seconds is not a trade worth making on a
 * shared resource.
 */
export default async function mirrorSupplierMediaForProduct(input: {
  productId: string;
  db?: Database;
  fetchImpl?: Fetcher;
}): Promise<MirrorSupplierMediaResult> {
  const db = input.db ?? getDb();
  const fetcher = input.fetchImpl ?? fetch;
  const r2Config = readR2Config();
  const rows = await pendingRows(db, input.productId);

  if (rows.length === 0) {
    return { mirrored: 0, skipped: 0, failures: [] };
  }

  if (r2Config === null) {
    return {
      mirrored: 0,
      skipped: 0,
      failures: rows.map((row) => ({
        mediaId: row.id,
        reason: 'STORAGE_FAILED' as const,
      })),
    };
  }

  const result: MirrorSupplierMediaResult = {
    mirrored: 0,
    skipped: 0,
    failures: [],
  };

  // eslint-disable-next-line no-restricted-syntax -- sequential by design: see the note above.
  for (const row of rows) {
    const allowed = cjImageUrl.safeParse(row.sourceUrl);

    if (!allowed.success || allowed.data === null) {
      result.failures.push({ mediaId: row.id, reason: 'HOST_NOT_ALLOWED' });

      // eslint-disable-next-line no-continue
      continue;
    }

    // eslint-disable-next-line no-await-in-loop
    const fetched = await fetchImageBytes(allowed.data, fetcher);

    if (!fetched.ok) {
      result.failures.push({ mediaId: row.id, reason: fetched.reason });

      // eslint-disable-next-line no-continue
      continue;
    }

    // The same magic-byte check, dimension ceiling and WebP re-encode every
    // seller upload passes. A supplier's file is not more trustworthy than a
    // seller's, and re-encoding also strips whatever metadata rode along.
    // eslint-disable-next-line no-await-in-loop
    const prepared = await prepareUploadedImage(fetched.bytes);

    if (!prepared.ok) {
      result.failures.push({ mediaId: row.id, reason: 'NOT_AN_IMAGE' });

      // eslint-disable-next-line no-continue
      continue;
    }

    const checksum = createHash('sha256').update(prepared.buffer).digest('hex');
    // eslint-disable-next-line no-await-in-loop
    const twin = await db
      .select({ storedUrl: productMediaSources.storedUrl })
      .from(productMediaSources)
      .where(
        and(
          eq(productMediaSources.productId, input.productId),
          eq(productMediaSources.checksum, checksum),
          isNotNull(productMediaSources.storedUrl),
        ),
      )
      .limit(1);
    const existingCopy = twin[0]?.storedUrl ?? null;

    let storedUrl = existingCopy;

    if (storedUrl === null) {
      // Keyed by content hash, never by the supplier's filename (rule 31), so
      // the same bytes observed twice occupy one object.
      const objectKey = `supplier-media/${input.productId}/${checksum}.webp`;

      try {
        // eslint-disable-next-line no-await-in-loop
        await getR2Client(r2Config).send(
          new PutObjectCommand({
            Bucket: r2Config.bucket,
            Key: objectKey,
            Body: prepared.buffer,
            ContentType: OUTPUT_CONTENT_TYPE,
          }),
        );
      } catch {
        result.failures.push({ mediaId: row.id, reason: 'STORAGE_FAILED' });

        // eslint-disable-next-line no-continue
        continue;
      }

      storedUrl = r2PublicImageUrl.parse(
        r2PublicUrlForKey(r2Config.publicBaseUrl, objectKey),
      );
    }

    if (storedUrl === null) {
      result.failures.push({ mediaId: row.id, reason: 'STORAGE_FAILED' });

      // eslint-disable-next-line no-continue
      continue;
    }

    // The observed facts the projection deliberately left null are honest now:
    // bytes have actually been read, so a checksum and dimensions mean
    // something. `source_url`, `rights_basis` and `review_state` are untouched.
    // eslint-disable-next-line no-await-in-loop
    await db
      .update(productMediaSources)
      .set({
        storedUrl,
        storedAt: new Date(),
        checksum: existingCopy === null ? checksum : null,
        contentType: OUTPUT_CONTENT_TYPE,
        byteSize: prepared.buffer.byteLength,
        widthPixels: prepared.width,
        heightPixels: prepared.height,
      })
      .where(eq(productMediaSources.id, row.id));

    if (existingCopy === null) {
      result.mirrored += 1;
    } else {
      // Pointed at bytes this product already had: protected, nothing stored.
      result.skipped += 1;
    }
  }

  return result;
}
