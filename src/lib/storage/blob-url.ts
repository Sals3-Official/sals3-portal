import { z } from 'zod';

/**
 * Vercel Blob's public read host, seller-upload analogue of
 * `src/lib/cj/image-hosts.ts`.
 *
 * A store's own subdomain is not fixed in code — Vercel assigns it per Blob
 * store — so this matches the host **suffix** every public Blob URL shares,
 * the same wildcard shape `next.config.ts`'s `remotePatterns` uses.
 */
export const VERCEL_BLOB_HOST_SUFFIX = '.public.blob.vercel-storage.com';

/**
 * Accepts an image address only from Vercel Blob's public host. Anything
 * else becomes `null`, the same defence-in-depth `cjImageUrl` applies to
 * supplier imagery: this table is written exclusively by
 * `upload-seller-media.ts`'s own `put()` call, so a non-Blob value here would
 * mean something else wrote the row, not a value this check expects to
 * legitimately reject in normal operation.
 */
export const vercelBlobImageUrl = z
  .string()
  .nullish()
  .transform((value) => {
    if (typeof value !== 'string' || value.trim() === '') return null;

    try {
      const url = new URL(value);

      return url.protocol === 'https:' &&
        url.hostname.endsWith(VERCEL_BLOB_HOST_SUFFIX)
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  });
