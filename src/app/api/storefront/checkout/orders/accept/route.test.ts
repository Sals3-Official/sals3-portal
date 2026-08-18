// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

vi.mock('server-only', () => ({}));

vi.mock('@/modules/checkout/orders', () => ({
  CheckoutOrderError: class CheckoutOrderError extends Error {
    readonly status = 422;
  },
  acceptCheckoutOrderSchema: {
    safeParse: vi.fn(),
  },
  acceptCheckoutOrder: vi.fn(),
}));

const orders = await import('@/modules/checkout/orders');

function request(body: unknown, token = 'secret') {
  return new Request(
    'https://portal.test/api/storefront/checkout/orders/accept',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
  );
}

describe('storefront checkout order accept route', () => {
  beforeEach(() => {
    process.env.SALS3_STOREFRONT_API_TOKEN = 'secret';
    vi.mocked(orders.acceptCheckoutOrderSchema.safeParse).mockReset();
    vi.mocked(orders.acceptCheckoutOrder).mockReset();
  });

  it('rejects missing storefront bearer token', async () => {
    const response = await POST(
      new Request('https://portal.test/api/storefront/checkout/orders/accept', {
        method: 'POST',
        body: '{}',
      }),
    );

    expect(response.status).toBe(401);
    expect(orders.acceptCheckoutOrder).not.toHaveBeenCalled();
  });

  it('accepts verified Stripe payment data idempotently through the order service', async () => {
    const body = {
      checkoutIntentId: '11111111-1111-4111-8111-111111111111',
      stripeEventId: 'evt_123',
      stripeCheckoutSessionId: 'cs_test_123',
      amountTotalMinor: 2409,
      currency: 'USD',
    };

    vi.mocked(orders.acceptCheckoutOrderSchema.safeParse).mockReturnValue({
      success: true,
      data: body,
    } as never);
    vi.mocked(orders.acceptCheckoutOrder).mockResolvedValue({
      orderId: '22222222-2222-4222-8222-222222222222',
      orderNumber: 'S3-20260818-ABC123',
    });

    const response = await POST(request(body));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      orderId: '22222222-2222-4222-8222-222222222222',
      orderNumber: 'S3-20260818-ABC123',
    });
    expect(orders.acceptCheckoutOrder).toHaveBeenCalledWith(body);
  });
});
