// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

vi.mock('server-only', () => ({}));

vi.mock('@/modules/checkout/orders', () => ({
  CheckoutOrderError: class CheckoutOrderError extends Error {
    readonly status = 422;
  },
  createCheckoutIntentSchema: {
    safeParse: vi.fn(),
  },
  createCheckoutIntent: vi.fn(),
}));

const orders = await import('@/modules/checkout/orders');

function request(body: unknown, token = 'secret') {
  return new Request('https://portal.test/api/storefront/checkout/intents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

describe('storefront checkout intent route', () => {
  beforeEach(() => {
    process.env.SALS3_STOREFRONT_API_TOKEN = 'secret';
    vi.mocked(orders.createCheckoutIntentSchema.safeParse).mockReset();
    vi.mocked(orders.createCheckoutIntent).mockReset();
  });

  it('rejects missing storefront bearer token', async () => {
    const response = await POST(
      new Request('https://portal.test/api/storefront/checkout/intents', {
        method: 'POST',
        body: '{}',
      }),
    );

    expect(response.status).toBe(401);
    expect(orders.createCheckoutIntent).not.toHaveBeenCalled();
  });

  it('creates an immutable checkout intent after schema validation', async () => {
    const body = { cart: { items: [] } };

    vi.mocked(orders.createCheckoutIntentSchema.safeParse).mockReturnValue({
      success: true,
      data: body,
    } as never);
    vi.mocked(orders.createCheckoutIntent).mockResolvedValue({
      checkoutIntentId: '11111111-1111-4111-8111-111111111111',
      shippingQuotedAt: '2026-08-17T14:00:00.000Z',
    });

    const response = await POST(request(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      checkoutIntentId: '11111111-1111-4111-8111-111111111111',
      shippingQuotedAt: '2026-08-17T14:00:00.000Z',
    });
    expect(orders.createCheckoutIntent).toHaveBeenCalledWith(body);
  });
});
