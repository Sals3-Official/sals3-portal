import 'server-only';

/**
 * Approximate USD-to-local rates, for showing a seller roughly what a price
 * looks like where it is sold.
 *
 * ## This is display, not pricing
 *
 * `modules/pricing/reference-fx.ts` refuses every non-identity pair, and that
 * stays true: no reference-FX provider is approved for what the Portal
 * *charges*. Nothing here reaches the resolver, is stored on an offer, or
 * decides what anybody pays. Every figure it produces is rendered beside the
 * USD one and labelled approximate, which is the same treatment the storefront
 * already gives buyers.
 *
 * If that framing ever slips — if one of these numbers starts being treated as
 * the price — the fix is to delete this module, not to approve it after the
 * fact.
 *
 * ## Two sources, and why both are needed
 *
 * The ECB feed is the better reference and covers AUD, PHP, NZD and CAD. It
 * does **not** publish FJD, checked 2026-08-30. `open.er-api.com` does, so it
 * is the fallback rather than a redundancy — Fiji has no price here without it.
 *
 * Same pair, same order, as `lib/storefront/fx.ts`, which has been fetching
 * USD/PHP this way in production.
 *
 * ## Failing to nothing
 *
 * An unavailable rate returns no entry, and the caller renders USD alone. A
 * guessed rate would be indistinguishable from a real one by the time it
 * reached a seller deciding what to charge — the exact failure the hard-coded
 * FX buffer caused before it was removed.
 */

/** One hour. These are a sanity check on a shelf price, not a trading rate. */
const CACHE_TTL_MS = 60 * 60 * 1000;

/** An optional extra must never be what makes a page slow. */
const FETCH_TIMEOUT_MS = 4_000;

type Rates = Readonly<Record<string, number>>;

let cached: { rates: Rates; expiresAt: number } | null = null;
let inFlight: Promise<Rates> | null = null;

/** Test-only reset. */
export function clearDisplayFxCacheForTests(): void {
  cached = null;
  inFlight = null;
}

function readRates(body: unknown, wanted: string[]): Rates {
  const raw = (body as { rates?: Record<string, unknown> })?.rates;

  if (raw === undefined || raw === null) return {};

  const out: Record<string, number> = {};

  wanted.forEach((code) => {
    const value = raw[code];

    /*
      A rate must be a positive finite number. Anything else — a null for a
      currency the feed does not carry, a string, a zero — is dropped rather
      than coerced, so the currency simply has no approximation rather than a
      wrong one.
    */
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      out[code] = value;
    }
  });

  return out;
}

async function fetchJson(url: string): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
    });

    return response.ok ? await response.json() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function refresh(wanted: string[]): Promise<Rates> {
  const ecb = await fetchJson(
    `https://api.frankfurter.dev/v1/latest?base=USD&symbols=${wanted.join(',')}`,
  );
  const fromEcb = ecb === null ? {} : readRates(ecb, wanted);

  const missing = wanted.filter((code) => fromEcb[code] === undefined);

  /*
    The fallback is asked only for what the ECB did not answer — today that is
    FJD alone. Fetching everything from both and preferring one would put a
    second network call on every request to no effect.
  */
  const fallback =
    missing.length === 0
      ? {}
      : readRates(
          (await fetchJson('https://open.er-api.com/v6/latest/USD')) ?? {},
          missing,
        );

  const rates = { ...fallback, ...fromEcb };

  // Cached even when partial: a missing currency is a currency with no
  // approximation, and re-asking on every render would not conjure one.
  cached = { rates, expiresAt: Date.now() + CACHE_TTL_MS };

  return rates;
}

/**
 * Rates for the currencies asked for, keyed by code. A currency no source
 * answered for is simply absent.
 */
export default async function displayFxRates(wanted: string[]): Promise<Rates> {
  if (wanted.length === 0) return {};

  if (cached !== null && cached.expiresAt > Date.now()) return cached.rates;

  inFlight ??= refresh(wanted).finally(() => {
    inFlight = null;
  });

  return inFlight;
}
