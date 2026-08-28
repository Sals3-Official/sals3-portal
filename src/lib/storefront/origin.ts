/**
 * The origin of the public storefront this portal serves.
 *
 * ## Why a built-in default rather than required configuration
 *
 * It was an environment variable with no default, which meant the Orders
 * screens rendered no product link until somebody edited the Vercel project —
 * a step nobody would notice was missing, because the fallback is silent by
 * design (a missing link, not an error).
 *
 * The alternative considered and rejected was the break-glass shape this
 * repository uses for production changes: a config table, a migration, a
 * `CRON_SECRET` endpoint and a `workflow_dispatch`. That machinery exists so a
 * *database* can be changed without Vercel access or raw credentials. Reaching
 * for it here would have meant production DDL — the deliberately expensive path
 * the standing rule guards after the 2026-08-18 outage — to store one string
 * that changes about as often as the company's name.
 *
 * So the value lives in code, like `lib/cj/image-hosts.ts`, and the
 * environment variable stays as an override for the day the storefront moves.
 *
 * ## Why this host and not `sals3.com`
 *
 * Checked rather than assumed, on 2026-08-29. Both answer 200, and they are
 * different systems: `sals3.com` serves WordPress/WooCommerce — the site this
 * project replaces — while `sals3-ecommerce.vercel.app` serves the Next.js
 * storefront, with `/cart` answering 200 and `/p/<slug>` resolving a real
 * product. Pointing a seller's "view the listing" link at the apex domain
 * would send them to the old shop.
 *
 * When the storefront takes over `sals3.com`, set `SALS3_STOREFRONT_BASE_URL`
 * and this default stops being consulted. That is the whole reason the
 * override survives.
 */
const DEFAULT_STOREFRONT_ORIGIN = 'https://sals3-ecommerce.vercel.app';

/**
 * The configured storefront origin, without a trailing slash.
 *
 * Read per call rather than captured at module load: a value frozen at import
 * time is invisible to a test that stubs the environment, and to any runtime
 * that populates configuration after the first import.
 */
export default function storefrontOrigin(): string {
  const configured = process.env.SALS3_STOREFRONT_BASE_URL?.trim();

  const origin =
    configured === undefined || configured === ''
      ? DEFAULT_STOREFRONT_ORIGIN
      : configured;

  return origin.replace(/\/+$/, '');
}
