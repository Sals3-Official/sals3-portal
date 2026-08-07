import { z } from 'zod';
import type { CjProduct } from '@/lib/cj/normalize';
import { resolveUsdToPhpRate } from './fx';

export const storefrontSectionSchema = z.enum(['for-you', 'deals']);

export const storefrontFeedQuerySchema = z.object({
  section: storefrontSectionSchema.catch('for-you').default('for-you'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
  limit: z.coerce.number().int().min(1).max(30).catch(14).default(14),
});

export type StorefrontFeedQuery = z.infer<typeof storefrontFeedQuerySchema>;

export type StorefrontProduct = {
  id: string;
  slug: string;
  title: string;
  priceMinor: number;
  oldPriceMinor: number;
  imageUrl: string | null;
  imageAlt: string;
  ratingLine: string;
  shipLine: string;
  category: string;
};

export type StorefrontProductFeed = {
  products: StorefrontProduct[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type StorefrontCategory = {
  id: string;
  code: string;
  name: string;
};

type PricingConfig = {
  usdToPhpRate: number;
  markupPercent: number;
};

const DEFAULT_USD_TO_PHP_RATE = 58;
const DEFAULT_MARKUP_PERCENT = 30;

function positiveEnvNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getStorefrontPricingConfig(): PricingConfig {
  return {
    usdToPhpRate: positiveEnvNumber(
      'CJ_USD_TO_PHP_RATE',
      DEFAULT_USD_TO_PHP_RATE,
    ),
    markupPercent: positiveEnvNumber(
      'CJ_PRICE_MARKUP_PERCENT',
      DEFAULT_MARKUP_PERCENT,
    ),
  };
}

/**
 * The pricing config a request should actually use: a published USD/PHP rate
 * plus the buffer, rather than the hand-typed `CJ_USD_TO_PHP_RATE`, which is
 * now only the fallback. Resolve this once per request at the route boundary
 * and pass it down, so the mapping functions below stay pure and synchronous.
 */
export async function resolveStorefrontPricingConfig(): Promise<PricingConfig> {
  const rate = await resolveUsdToPhpRate();

  return {
    usdToPhpRate: rate.effective,
    markupPercent: positiveEnvNumber(
      'CJ_PRICE_MARKUP_PERCENT',
      DEFAULT_MARKUP_PERCENT,
    ),
  };
}

function slugify(value: string, fallback: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug === '' ? fallback : slug;
}

function categoryCode(name: string): string {
  const words = (name.match(/[A-Za-z0-9]+/g) ?? []).filter(
    (word) => word.length > 1,
  );
  const raw =
    words.length > 1
      ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`
      : (words[0] ?? name).slice(0, 2);

  return raw.toUpperCase();
}

function priceMinor(
  priceCentsUsd: number | null,
  config = getStorefrontPricingConfig(),
): number | null {
  if (priceCentsUsd === null || priceCentsUsd <= 0) {
    return null;
  }

  return Math.round(
    priceCentsUsd * config.usdToPhpRate * (1 + config.markupPercent / 100),
  );
}

function shipLine(product: CjProduct): string {
  return product.shipsFrom.length === 0
    ? 'CJdropshipping'
    : `Ships from ${product.shipsFrom.join(', ')}`;
}

/**
 * Sals3 publishes no comparison ("was") price.
 *
 * `oldPriceMinor` deliberately equals `priceMinor`: every `sals3-ecommerce`
 * card renders the strikethrough and the percent-off badge only when the old
 * price is strictly greater, so an equal value shows one honest price and no
 * discount claim. The field stays in the contract because the consumer's
 * schema requires it, and so a genuine value can fill it once real price
 * history exists.
 *
 * Never derive this from the current price. A was/now pair produced by marking
 * the live price up is not evidence that anything ever sold for the higher
 * number, and ADR-003 prohibits it.
 */
export function toStorefrontProduct(
  product: CjProduct,
  config = getStorefrontPricingConfig(),
): StorefrontProduct | null {
  const currentPrice = priceMinor(product.priceCentsUsd, config);

  if (currentPrice === null) {
    return null;
  }

  return {
    id: product.id,
    slug: slugify(product.id || product.sku, 'cj-product'),
    title: product.name,
    priceMinor: currentPrice,
    oldPriceMinor: currentPrice,
    imageUrl: product.imageUrl,
    imageAlt: product.name,
    ratingLine: 'Supplier item',
    shipLine: shipLine(product),
    category: slugify(product.category, 'cj-supplier'),
  };
}

export function toStorefrontProductFeed(
  products: readonly CjProduct[],
  query: StorefrontFeedQuery,
  supplierTotal: number,
  supplierTotalPages = Math.max(1, Math.ceil(supplierTotal / query.limit)),
  config = getStorefrontPricingConfig(),
): StorefrontProductFeed {
  const source =
    query.section === 'deals'
      ? [...products].sort((first, second) => {
          const firstCount = first.listedCount ?? -1;
          const secondCount = second.listedCount ?? -1;

          return secondCount - firstCount;
        })
      : products;
  const mapped = source
    .map((product) => toStorefrontProduct(product, config))
    .filter((product): product is StorefrontProduct => product !== null);

  return {
    products: mapped.slice(0, query.limit),
    total: supplierTotal,
    page: query.page,
    limit: query.limit,
    totalPages: supplierTotalPages,
  };
}

export function listStorefrontCategories(
  products: readonly CjProduct[],
): StorefrontCategory[] {
  const bySlug = new Map<string, StorefrontCategory>();

  products.forEach((product) => {
    const name = product.category === '—' ? 'CJdropshipping' : product.category;
    const id = slugify(name, 'cj-supplier');

    if (!bySlug.has(id)) {
      bySlug.set(id, { id, code: categoryCode(name), name });
    }
  });

  return [...bySlug.values()];
}
