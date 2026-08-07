import type { z } from 'zod';
import type { cjProductSchema } from './schemas';

/**
 * Turns a validated CJ product into the flat shape the table renders.
 *
 * The normalising happens here, once, so no component has to know that CJ sends
 * prices as strings, names as a JSON-encoded array, or weights as a range.
 */

export type CjProduct = {
  id: string;
  name: string;
  sku: string;
  imageUrl: string | null;
  category: string;
  /** Supplier price in US cents. CJ quotes in USD. */
  priceCentsUsd: number | null;
  weight: string;
  productType: string;
  supplier: string;
  freeShipping: boolean;
  shipsFrom: string[];
  listedCount: number | null;
  createdAt: string | null;
};

type RawCjProduct = z.infer<typeof cjProductSchema>;

/**
 * CJ sends `productName` as a JSON-encoded array of Chinese names, for example
 * `["名字一","名字二"]`. The English name is the one to show; this is only the
 * fallback when it is missing.
 */
function firstLocalName(productName: string): string {
  if (productName === '') {
    return '';
  }

  try {
    const parsed: unknown = JSON.parse(productName);

    if (Array.isArray(parsed)) {
      const first = parsed.find(
        (item) => typeof item === 'string' && item !== '',
      );

      return typeof first === 'string' ? first : '';
    }
  } catch {
    // Not JSON. Fall through and use the raw string.
  }

  return productName;
}

/** USD major units to cents. Returns null when the price is unusable. */
export function usdToCents(price: string): number | null {
  const parsed = Number.parseFloat(price);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.round(parsed * 100);
}

/**
 * Formats US cents. The portal shows the supplier price in its own currency and
 * never converts it: no approved exchange-rate source exists yet, and a guessed
 * rate on a price a buyer could act on would be a fabricated number.
 */
export function formatUsdCents(cents: number | null): string {
  if (cents === null) {
    return '—';
  }

  return `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Epoch milliseconds to a plain ISO date, or null when absent or invalid. */
export function toIsoDate(epochMs: number | null): string | null {
  if (epochMs === null || epochMs <= 0) {
    return null;
  }

  const date = new Date(epochMs);

  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

/** CJ weights arrive as a single value or a range. Kept as text with a unit. */
export function formatWeight(weight: string): string {
  return weight === '' ? '—' : `${weight} g`;
}

/**
 * Best-effort public CJdropshipping product page URL, built from `pid` alone
 * - CJ's `/product/list` response carries no URL field at all, so this is
 * inferred from CJ's publicly known page-URL shape, not returned by the API
 * and not independently verified against a live page (CJ's own site sits
 * behind a bot-check that blocked confirming one). Treat this as "probably
 * right", not "guaranteed" - if a link 404s, that is this function being
 * wrong, not the product being gone.
 */
export function cjProductPageUrl(pid: string): string {
  return `https://cjdropshipping.com/product/-p-${encodeURIComponent(pid)}.html`;
}

export function normalizeCjProduct(raw: RawCjProduct): CjProduct {
  const name =
    raw.productNameEn !== ''
      ? raw.productNameEn
      : firstLocalName(raw.productName);

  return {
    id: raw.pid,
    name: name === '' ? 'Unnamed product' : name,
    sku: raw.productSku === '' ? '—' : raw.productSku,
    imageUrl: raw.productImage,
    category: raw.categoryName === '' ? '—' : raw.categoryName,
    priceCentsUsd: usdToCents(raw.sellPrice),
    weight: formatWeight(raw.productWeight),
    productType: raw.productType === '' ? '—' : raw.productType,
    supplier: raw.supplierName === '' ? '—' : raw.supplierName,
    freeShipping: raw.isFreeShipping,
    shipsFrom: raw.shippingCountryCodes,
    listedCount: raw.listedNum,
    createdAt: toIsoDate(raw.createTime),
  };
}
