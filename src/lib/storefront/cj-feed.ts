import type { CjQuery } from '@/lib/cj/schemas';
import { fetchCjProducts, type CjProductPage } from '@/services/cj/products';

const STOREFRONT_CJ_CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  expiresAt: number;
  page?: CjProductPage;
  inFlight?: Promise<CjProductPage>;
};

const cache = new Map<string, CacheEntry>();

function cacheKey(query: CjQuery): string {
  return `${query.cjPage}:${query.cjSearch}:${query.cjPid}`;
}

export async function getStorefrontCjProducts(
  query: CjQuery,
): Promise<CjProductPage> {
  const key = cacheKey(query);
  const now = Date.now();
  const cached = cache.get(key);

  if (cached?.page !== undefined && cached.expiresAt > now) {
    return cached.page;
  }

  if (cached?.inFlight !== undefined) {
    return cached.inFlight;
  }

  const inFlight = fetchCjProducts(query)
    .then((page) => {
      cache.set(key, {
        expiresAt: Date.now() + STOREFRONT_CJ_CACHE_TTL_MS,
        page,
      });

      return page;
    })
    .catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });

  cache.set(key, {
    expiresAt: now + STOREFRONT_CJ_CACHE_TTL_MS,
    inFlight,
  });

  return inFlight;
}

export function clearStorefrontCjProductsCache() {
  cache.clear();
}
