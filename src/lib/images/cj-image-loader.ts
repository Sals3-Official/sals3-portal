'use client';

import CJ_IMAGE_HOSTS from '@/lib/cj/image-hosts';

/**
 * The `next/image` loader for the whole portal (`next.config.ts`
 * `images.loaderFile`).
 *
 * Why a custom loader exists at all: the default loader routes every image
 * through Vercel's `/_next/image` optimizer, and that optimizer is metered.
 * When the account's Image Optimization allowance ran out, *every* request to
 * it began answering `402 OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED` - verified
 * against production on 2026-08-13, including `?url=/favicon.ico`, so the
 * failure was the optimizer itself and not any one upstream host. Every
 * thumbnail on Product Sourcing and every brand mark in the sidebar and auth
 * screens rendered as a broken image.
 *
 * Rather than pay for the optimizer or ship unresized originals, this loader
 * hands the resizing to CJ's own CDN, which already does it for free.
 * `cf.cjdropshipping.com` honours Alibaba-OSS `x-oss-process` instructions;
 * measured against a real product image on 2026-08-13:
 *
 * | request                                     | bytes   |
 * | ------------------------------------------- | ------- |
 * | original                                    | 314,871 |
 * | `image/resize,w_80/format,webp/quality,q_75`|   1,380 |
 *
 * That is the 40px table thumbnail at 2x, 228x smaller than what a pass-through
 * would have shipped, and in WebP.
 *
 * Note what this does NOT do: it never proxies, and it never invents a host. A
 * non-CJ address - a local `/public` path, anything else - is returned
 * untouched, so the browser fetches exactly what the component asked for. The
 * loader therefore cannot be turned into an open image proxy, and it is not the
 * security boundary for remote imagery either: `cjImageUrl` in
 * `src/lib/cj/primitives.ts` rejects any address off `CJ_IMAGE_HOSTS` at intake,
 * before it is ever stored, and `next.config.ts` `remotePatterns` still carries
 * the same list.
 */

/** Instruction pipeline CJ's CDN understands. Unsupported params are ignored by the CDN, which then serves the original. */
const OSS_PROCESS_PARAM = 'x-oss-process';

/** Matches the default `images.qualities` entry Next uses when a component sets no `quality`. */
const DEFAULT_QUALITY = 75;

type ImageLoaderArgs = {
  src: string;
  width: number;
  quality?: number;
};

/**
 * True only for an absolute `https:` address on an allow-listed CJ host.
 *
 * Relative sources (`/brand/sals3-mark.png`) throw in `new URL` without a base
 * and are meant to fail this check, so the caller returns them unchanged.
 */
function cjImageAddress(src: string): URL | null {
  let url: URL;

  try {
    url = new URL(src);
  } catch {
    return null;
  }

  return url.protocol === 'https:' && CJ_IMAGE_HOSTS.includes(url.hostname)
    ? url
    : null;
}

export default function cjImageLoader({
  src,
  width,
  quality,
}: ImageLoaderArgs): string {
  const url = cjImageAddress(src);

  if (url === null) return src;

  // `set`, not string concatenation: a stored address may already carry a query
  // string, and a second `x-oss-process` would make the CDN reject the request.
  url.searchParams.set(
    OSS_PROCESS_PARAM,
    `image/resize,w_${width}/format,webp/quality,q_${quality ?? DEFAULT_QUALITY}`,
  );

  return url.toString();
}
