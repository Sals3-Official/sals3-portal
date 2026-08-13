/**
 * USD to PHP rate on money-changer logic.
 *
 * ## This no longer prices anything customer-facing
 *
 * It used to be the live `sals3-ecommerce` storefront pricing contract: the
 * feed multiplied a CJ USD cost by this rate and a flat markup percent on
 * every buyer request. As of 2026-08-13 the storefront serves published
 * `product_offers`, whose price is resolved once at publish time by
 * `modules/pricing/resolver.ts` and frozen onto the row with its policy
 * layers and resolver version. A buyer request performs no FX at all, and
 * `modules/catalog/storefront/no-supplier-calls.test.ts` forbids this module
 * from re-entering that path.
 *
 * What still uses it: `src/lib/products/catalog-fx.ts`, for Portal's own
 * seller-facing reference conversions. That is a display estimate, not an
 * approved commercial rate — and it is deliberately NOT
 * `modules/pricing/reference-fx.ts`, which is the platform-owned rate a
 * commercial price may be built from.
 *
 * A quoted mid-market rate (what Google, Morningstar, or a central bank
 * publishes) is not a rate anyone can actually transact at. Paying CJ in
 * dollars costs more than mid, because the card or wallet doing the
 * conversion takes its own spread. So the rate pricing uses is the fetched
 * mid rate plus a small buffer, the same shape a money changer quotes, only
 * a narrower one.
 *
 * Sourced from the European Central Bank's daily reference rates, which
 * publish once per business day - deliberately, so shopper prices change at
 * most once a day rather than drifting all afternoon.
 *
 * This never throws and never blocks a page for long: a failed refresh falls
 * back to the last good rate, then to `CJ_USD_TO_PHP_RATE`. The fallback is
 * the floor of correctness, not a substitute for a live rate - a stale rate
 * quietly costs margin, so a failure to refresh is logged.
 */

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4_000;

/** Outside this band the answer is not a USD/PHP rate, whatever it claims. */
const MIN_PLAUSIBLE_RATE = 30;
const MAX_PLAUSIBLE_RATE = 120;

/** A genuine daily move is small; a large jump is far more likely bad data. */
const MAX_DRIFT_PERCENT = 10;

/**
 * Sized from what the payment rails actually charge above mid, not guessed:
 * a PH credit card runs about 1.85% (1% Visa/Mastercard assessment plus
 * ~0.85% issuer FX conversion), and PayPal is 3-4%. 2.5% covers the card case
 * with room for the rate moving between daily ECB publications, and is still
 * under the 2-3% a money changer quotes.
 *
 * Revisit once the real CJ payment route is confirmed. Topping the CJ wallet
 * up by wire transfer or Payoneer earns a 2-3% CJ bonus that offsets most of
 * this, and a thinner buffer would then be the correct answer.
 */
const DEFAULT_BUFFER_PERCENT = 2.5;

const FALLBACK_RATE = 58;

export type UsdToPhpRate = {
  /** Mid-market rate as published. */
  spot: number;
  /** What pricing uses: `spot` plus the buffer. */
  effective: number;
  bufferPercent: number;
  source: string;
  fetchedAt: Date;
  /** True when this is a fallback rather than a fresh published rate. */
  stale: boolean;
};

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
    // European Central Bank reference rates, once per business day.
    name: 'ecb-frankfurter',
    url: 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=PHP',
    read: (body) =>
      readNumber((body as { rates?: { PHP?: unknown } })?.rates?.PHP),
  },
  {
    name: 'open-er-api',
    url: 'https://open.er-api.com/v6/latest/USD',
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

export function getFxBufferPercent(): number {
  return readEnvNumber('CJ_FX_BUFFER_PERCENT', DEFAULT_BUFFER_PERCENT);
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
  // Last good rate first: a rate from this morning is far closer to the truth
  // than a hand-typed constant from whenever someone last edited the env.
  if (cached !== null) return { ...cached.rate, stale: true };

  const spot = readEnvNumber('CJ_USD_TO_PHP_RATE', FALLBACK_RATE);

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
  // Sequential and ordered on purpose: the first source is the authoritative
  // one, and the next only earns a call when the one before it fails.
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
    `[storefront-fx] no source returned a usable USD/PHP rate; pricing at ${fallback.spot} from ${fallback.source}`,
  );

  return fallback;
}

export async function resolveUsdToPhpRate(): Promise<UsdToPhpRate> {
  const bufferPercent = getFxBufferPercent();

  if (cached !== null && cached.expiresAt > Date.now()) {
    // Re-apply the buffer rather than returning the stored effective rate, so
    // changing the buffer takes effect without waiting out the cache.
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
export function clearUsdToPhpRateCache(): void {
  cached = null;
  inFlight = null;
}
