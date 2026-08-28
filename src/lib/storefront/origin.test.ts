// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import storefrontOrigin from './origin';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('storefrontOrigin', () => {
  /**
   * The reason this default exists. Requiring configuration meant the Orders
   * screens silently rendered no product link until somebody edited the Vercel
   * project, and the fallback for a missing link is a missing link - nothing
   * announces it.
   */
  it('answers the storefront without any configuration', () => {
    vi.stubEnv('SALS3_STOREFRONT_BASE_URL', '');

    expect(storefrontOrigin()).toBe('https://sals3-ecommerce.vercel.app');
  });

  it('lets a deployment override it for the day the storefront moves', () => {
    vi.stubEnv('SALS3_STOREFRONT_BASE_URL', 'https://sals3.com');

    expect(storefrontOrigin()).toBe('https://sals3.com');
  });

  it('strips trailing slashes so a path is never doubled', () => {
    vi.stubEnv('SALS3_STOREFRONT_BASE_URL', 'https://sals3.com///');

    expect(storefrontOrigin()).toBe('https://sals3.com');
  });

  it('ignores whitespace, which a pasted value carries more often than not', () => {
    vi.stubEnv('SALS3_STOREFRONT_BASE_URL', '  https://sals3.com  ');

    expect(storefrontOrigin()).toBe('https://sals3.com');
  });
});
