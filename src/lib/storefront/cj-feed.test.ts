import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CjProductPage } from './supplier-source';
import {
  clearStorefrontCjProductsCache,
  getStorefrontCjProducts,
} from './cj-feed';

const mocks = vi.hoisted(() => ({
  fetchStorefrontCjProducts: vi.fn(),
}));

vi.mock('./supplier-source', () => ({
  fetchStorefrontCjProducts: mocks.fetchStorefrontCjProducts,
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
    mocks.fetchStorefrontCjProducts.mockReset();
  });

  it('dedupes concurrent storefront requests for the same CJ page', async () => {
    mocks.fetchStorefrontCjProducts.mockResolvedValue(cjPage());

    const [first, second, third] = await Promise.all([
      getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: '' }),
      getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: '' }),
      getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: '' }),
    ]);

    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(mocks.fetchStorefrontCjProducts).toHaveBeenCalledTimes(1);
  });

  it('keeps separate cache entries for separate CJ pages', async () => {
    mocks.fetchStorefrontCjProducts
      .mockResolvedValueOnce(cjPage(1))
      .mockResolvedValueOnce(cjPage(2));

    await getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: '' });
    await getStorefrontCjProducts({ cjPage: 2, cjSearch: '', cjPid: '' });

    expect(mocks.fetchStorefrontCjProducts).toHaveBeenCalledTimes(2);
  });

  it('keeps a separate cache entry for a product-id lookup', async () => {
    mocks.fetchStorefrontCjProducts
      .mockResolvedValueOnce(cjPage(1))
      .mockResolvedValueOnce(cjPage(1));

    await getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: '' });
    await getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: 'abc' });

    expect(mocks.fetchStorefrontCjProducts).toHaveBeenCalledTimes(2);
  });

  it('clears failed in-flight requests so a later call can retry', async () => {
    mocks.fetchStorefrontCjProducts
      .mockRejectedValueOnce(new Error('rate-limited'))
      .mockResolvedValueOnce(cjPage());

    await expect(
      getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: '' }),
    ).rejects.toThrow('rate-limited');
    await expect(
      getStorefrontCjProducts({ cjPage: 1, cjSearch: '', cjPid: '' }),
    ).resolves.toEqual(cjPage());

    expect(mocks.fetchStorefrontCjProducts).toHaveBeenCalledTimes(2);
  });
});
