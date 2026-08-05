import { z } from 'zod';
import type { CjProduct } from '@/lib/cj/normalize';

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
const DEAL_COMPARE_UPLIFT_PERCENT = 15;

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

function comparePriceMinor(
  price: number,
  section: StorefrontFeedQuery['section'],
) {
  if (section !== 'deals') {
    return price;
  }

  return Math.round(price * (1 + DEAL_COMPARE_UPLIFT_PERCENT / 100));
}

function shipLine(product: CjProduct): string {
  return product.shipsFrom.length === 0
    ? 'CJdropshipping'
    : `Ships from ${product.shipsFrom.join(', ')}`;
}

export function toStorefrontProduct(
  product: CjProduct,
  section: StorefrontFeedQuery['section'],
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
    oldPriceMinor: comparePriceMinor(currentPrice, section),
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
    .map((product) => toStorefrontProduct(product, query.section))
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
