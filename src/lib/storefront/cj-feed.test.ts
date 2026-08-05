import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CjProductPage } from '@/services/cj/products';
import {
  clearStorefrontCjProductsCache,
  getStorefrontCjProducts,
} from './cj-feed';

const mocks = vi.hoisted(() => ({
  fetchCjProducts: vi.fn(),
}));

vi.mock('@/services/cj/products', () => ({
  fetchCjProducts: mocks.fetchCjProducts,
}));

function cjPage(page = 1): CjProductPage {
  return {
    products: [],
    page,
    pageSize: 20,
    total: 0,
    totalPages: 1,
  };
}

describe('storefront CJ supplier feed cache', () => {
  afterEach(() => {
    clearStorefrontCjProductsCache();
    mocks.fetchCjProducts.mockReset();
  });

  it('dedupes concurrent storefront requests for the same CJ page', async () => {
    mocks.fetchCjProducts.mockResolvedValue(cjPage());

    const [first, second, third] = await Promise.all([
      getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: '' }),
      getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: '' }),
      getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: '' }),
    ]);

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(mocks.fetchCjProducts).toHaveBeenCalledTimes(1);
  });

  it('keeps separate cache entries for separate CJ pages', async () => {
    mocks.fetchCjProducts
      .mockResolvedValueOnce(cjPage(1))
      .mockResolvedValueOnce(cjPage(2));

    await getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: '' });
    await getStorefrontCjProducts({ cjPage: 2, cjSearch: '', cjPid: '' });

    expect(mocks.fetchCjProducts).toHaveBeenCalledTimes(2);
  });

  it('keeps a separate cache entry for a product-id lookup', async () => {
    mocks.fetchCjProducts
      .mockResolvedValueOnce(cjPage(1))
      .mockResolvedValueOnce(cjPage(1));

    await getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: '' });
    await getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: 'abc' });

    expect(mocks.fetchCjProducts).toHaveBeenCalledTimes(2);
  });

  it('clears failed in-flight requests so a later call can retry', async () => {
    mocks.fetchCjProducts
      .mockRejectedValueOnce(new Error('rate-limited'))
      .mockResolvedValueOnce(cjPage());

    await expect(
      getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: '' }),
    ).rejects.toThrow('rate-limited');
    await expect(
      getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: '' }),
    ).resolves.toEqual(cjPage());

    expect(mocks.fetchCjProducts).toHaveBeenCalledTimes(2);
  });
});
