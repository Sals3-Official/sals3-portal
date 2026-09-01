import { afterEach, describe, expect, it, vi } from 'vitest';

const { GET } = await import('./route');

function request(token?: string) {
  return new Request('https://portal.test/api/storefront/free-shipping', {
    headers:
      token === undefined ? undefined : { authorization: `Bearer ${token}` },
  });
}

describe('storefront free-shipping thresholds API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects requests without the storefront token', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await GET(request());

    expect(response.status).toBe(401);
  });

  it('serves the configured threshold for every checkout destination', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    vi.stubEnv('SALS3_FREE_STANDARD_SHIPPING_AU_USD', '25');
    vi.stubEnv('SALS3_FREE_STANDARD_SHIPPING_PH_USD', '12');
    vi.stubEnv('SALS3_FREE_STANDARD_SHIPPING_FJ_USD', '55');

    const response = await GET(request('secret'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      thresholds: { AU: 2500, PH: 1200, FJ: 5500 },
      currency: 'USD',
    });
  });

  it('drops a country whose threshold is unset rather than failing the request', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    vi.stubEnv('SALS3_FREE_STANDARD_SHIPPING_AU_USD', '25');
    vi.stubEnv('SALS3_FREE_STANDARD_SHIPPING_PH_USD', undefined);
    vi.stubEnv('SALS3_FREE_STANDARD_SHIPPING_FJ_USD', '55');

    const response = await GET(request('secret'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      thresholds: { AU: 2500, FJ: 5500 },
      currency: 'USD',
    });
  });
});
