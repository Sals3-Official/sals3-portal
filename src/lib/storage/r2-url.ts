import { z } from 'zod';

/**
 * Cloudflare R2's public read URL, seller-upload analogue of
 * `src/lib/cj/image-hosts.ts` — R2 replacement for the retired
 * `vercelBlobImageUrl` (owner decision 2026-08-17).
 *
 * Unlike Vercel Blob, R2 has no fixed host suffix every store shares: the
 * public read address is whatever the owner configured as
 * `CLOUDFLARE_R2_PUBLIC_BASE_URL` — an `r2.dev` subdomain or a custom domain
 * bound to the bucket. So this checks membership under that **configured**
 * base URL rather than a hard-coded suffix. It must be the public read
 * base, never the private S3-compatible `CLOUDFLARE_R2_ENDPOINT` used for
 * writes/deletes — see `r2-client.ts`.
 *
 * `null` whenever the base URL is unset or misconfigured, which refuses
 * every address rather than accepting one nobody can vouch for.
 */
function readPublicBase(): URL | null {
  const raw = process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL;

  if (raw === undefined || raw.trim() === '') return null;

  try {
    const base = new URL(raw);

    return base.protocol === 'https:' ? base : null;
  } catch {
    return null;
  }
}

/**
 * Accepts an image address only under the configured R2 public base URL.
 * Anything else becomes `null`, the same defence-in-depth `cjImageUrl`
 * applies to supplier imagery: this table is written exclusively by
 * `upload-seller-media.ts`'s own `PutObjectCommand` call, so a non-R2 value
 * here would mean something else wrote the row, not a value this check
 * expects to legitimately reject in normal operation.
 */
export const r2PublicImageUrl = z
  .string()
  .nullish()
  .transform((value) => {
    if (typeof value !== 'string' || value.trim() === '') return null;

    const base = readPublicBase();

    if (base === null) return null;

    try {
      const url = new URL(value);
      const baseDir = base.pathname.endsWith('/')
        ? base.pathname
        : `${base.pathname}/`;

      return url.protocol === 'https:' &&
        url.host === base.host &&
        url.pathname.startsWith(baseDir)
        ? url.toString()
        : null;
    } catch {
      return null;
    }
  });

/** Builds the public URL for an object key under the configured base. */
export function r2PublicUrlForKey(publicBaseUrl: string, key: string): string {
  const base = publicBaseUrl.endsWith('/')
    ? publicBaseUrl
    : `${publicBaseUrl}/`;

  return `${base}${key}`;
}
