import { resolveUsdToPhpRate, type UsdToPhpRate } from '@/lib/storefront/fx';
import readStorefrontFxBuffer from '@/lib/storefront/fx-buffer-cache';
import type { CatalogFxRates } from '@/lib/products/catalog-types';

/**
 * AUD-to-PHP rate for the redesign preview, on the same money-changer logic
 * as the real `src/lib/storefront/fx.ts` (ECB reference rate + a buffer,
 * fails safe to a last-known-good rate then a configured fallback).
 *
 * This is a DELIBERATELY SEPARATE, isolated module - it does not modify
 * `fx.ts`. `fx.ts` prices real customer-facing storefront orders; adding a
 * second currency to that shared file is a real production/financial change
 * that deserves its own review, not something to fold in while closing a
 * design-preview gap. If AliExpress (or any AUD-quoting supplier) becomes a
 * real integration, generalize `fx.ts` itself the same way this file does,
 * so both currencies share one reviewed cache/fallback implementation
 * instead of two.
 *
 * Takes the same buffer the caller resolved for USD - the buffer is about what
 * payment rails charge to convert to PHP, which does not depend on which
 * currency is being converted from.
 */

const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4_000;

/** AUD/PHP has historically sat well under USD/PHP; outside this band the answer is not real. */
const MIN_PLAUSIBLE_RATE = 15;
const MAX_PLAUSIBLE_RATE = 60;
const MAX_DRIFT_PERCENT = 10;
const FALLBACK_RATE = 38;

type RateSource = {
  name: string;
  url: string;
  read: (body: unknown) => number | null;
};

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;
}

const SOURCES: RateSource[] = [
  {
    name: 'ecb-frankfurter',
    url: 'https://api.frankfurter.dev/v1/latest?base=AUD&symbols=PHP',
    read: (body) =>
      readNumber((body as { rates?: { PHP?: unknown } })?.rates?.PHP),
  },
  {
    name: 'open-er-api',
    url: 'https://open.er-api.com/v6/latest/AUD',
    read: (body) =>
      readNumber((body as { rates?: { PHP?: unknown } })?.rates?.PHP),
  },
];

let cached: { rate: UsdToPhpRate; expiresAt: number } | null = null;
let inFlight: Promise<UsdToPhpRate> | null = null;

function readEnvNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function applyBuffer(spot: number, bufferPercent: number): number {
  return spot * (1 + bufferPercent / 100);
}

function isPlausible(spot: number): boolean {
  if (spot < MIN_PLAUSIBLE_RATE || spot > MAX_PLAUSIBLE_RATE) return false;

  const previous = cached?.rate.spot;

  if (previous === undefined) return true;

  const driftPercent = Math.abs((spot - previous) / previous) * 100;

  return driftPercent <= MAX_DRIFT_PERCENT;
}

async function fetchSpot(source: RateSource): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(source.url, {
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!response.ok) return null;

    return source.read(await response.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function fallbackRate(bufferPercent: number): UsdToPhpRate {
  if (cached !== null) return { ...cached.rate, stale: true };

  const spot = readEnvNumber('CJ_AUD_TO_PHP_RATE', FALLBACK_RATE);

  return {
    spot,
    effective: applyBuffer(spot, bufferPercent),
    bufferPercent,
    source: 'configured-fallback',
    fetchedAt: new Date(),
    stale: true,
  };
}

async function refresh(bufferPercent: number): Promise<UsdToPhpRate> {
  for (let index = 0; index < SOURCES.length; index += 1) {
    const source = SOURCES[index];

    if (source !== undefined) {
      // eslint-disable-next-line no-await-in-loop
      const spot = await fetchSpot(source);

      if (spot !== null && isPlausible(spot)) {
        const rate: UsdToPhpRate = {
          spot,
          effective: applyBuffer(spot, bufferPercent),
          bufferPercent,
          source: source.name,
          fetchedAt: new Date(),
          stale: false,
        };

        cached = { rate, expiresAt: Date.now() + CACHE_TTL_MS };

        return rate;
      }
    }
  }

  const fallback = fallbackRate(bufferPercent);

  // eslint-disable-next-line no-console
  console.error(
    `[design-preview-fx] no source returned a usable AUD/PHP rate; pricing at ${fallback.spot} from ${fallback.source}`,
  );

  return fallback;
}

export async function resolveAudToPhpRate(
  bufferPercent: number,
): Promise<UsdToPhpRate> {
  if (cached !== null && cached.expiresAt > Date.now()) {
    return {
      ...cached.rate,
      bufferPercent,
      effective: applyBuffer(cached.rate.spot, bufferPercent),
    };
  }

  inFlight ??= refresh(bufferPercent).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

/** Test-only reset. */
export function clearAudToPhpRateCache(): void {
  cached = null;
  inFlight = null;
}

type MidRate = { rate: number; fetchedAt: Date; stale: boolean };

const MIN_PLAUSIBLE_USD_AUD = 1.1;
const MAX_PLAUSIBLE_USD_AUD = 2.5;

let cachedUsdAud: { value: MidRate; expiresAt: number } | null = null;
let inFlightUsdAud: Promise<MidRate | null> | null = null;

/**
 * Plain mid-market USD/AUD, for "what is this price roughly in AUD" reference
 * display only - never a transaction estimate, so it carries no buffer.
 * Returns `null` (not a guessed fallback) when no source answers: this is
 * optional context, not something a page needs to keep working.
 */
async function refreshUsdToAudMidRate(): Promise<MidRate | null> {
  const response = await (async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      try {
        const result = await fetch(
          'https://api.frankfurter.dev/v1/latest?base=USD&symbols=AUD',
          { signal: controller.signal, cache: 'no-store' },
        );

        return result.ok ? await result.json() : null;
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  })();

  const rate = readNumber(
    (response as { rates?: { AUD?: unknown } })?.rates?.AUD,
  );

  if (
    rate === null ||
    rate < MIN_PLAUSIBLE_USD_AUD ||
    rate > MAX_PLAUSIBLE_USD_AUD
  ) {
    return cachedUsdAud === null
      ? null
      : { ...cachedUsdAud.value, stale: true };
  }

  const value: MidRate = { rate, fetchedAt: new Date(), stale: false };

  cachedUsdAud = { value, expiresAt: Date.now() + CACHE_TTL_MS };

  return value;
}

export async function resolveUsdToAudMidRate(): Promise<MidRate | null> {
  if (cachedUsdAud !== null && cachedUsdAud.expiresAt > Date.now()) {
    return cachedUsdAud.value;
  }

  inFlightUsdAud ??= refreshUsdToAudMidRate().finally(() => {
    inFlightUsdAud = null;
  });

  return inFlightUsdAud;
}

/**
 * Resolves every supplier currency this catalog knows how to estimate in
 * PHP, once per request. USD goes through the real, production
 * `resolveUsdToPhpRate()` - the exact rate the storefront prices with. AUD
 * goes through this file's isolated preview-only resolver. Any other
 * supplier currency (e.g. a future provider quoting in a currency neither of
 * these covers) is simply absent from the returned map, which is what makes
 * `estimatePhpMinor()` return `null` for it instead of guessing.
 */
export async function resolveCatalogFxRates(): Promise<CatalogFxRates> {
  /*
    No configured buffer, no estimates — an empty map rather than a new `null`
    return, because absence is already this type's way of saying "cannot
    estimate this currency" and `estimatePhpMinor` already answers `null` to it.
    Reusing that keeps the four components downstream untouched, and an estimate
    built on an unconfigured cushion is one the viewer cannot tell from a
    configured one.
  */
  const buffer = await readStorefrontFxBuffer();

  if (buffer.outcome !== 'RESOLVED') return {};

  const { bufferPercent } = buffer.buffer;

  const [usd, aud] = await Promise.all([
    resolveUsdToPhpRate(bufferPercent),
    resolveAudToPhpRate(bufferPercent),
  ]);

  return {
    USD: {
      effectiveRate: usd.effective,
      fetchedAt: usd.fetchedAt.toISOString(),
      stale: usd.stale,
    },
    AUD: {
      effectiveRate: aud.effective,
      fetchedAt: aud.fetchedAt.toISOString(),
      stale: aud.stale,
    },
  };
}
