import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const mocks = vi.hoisted(() => ({
  CheckoutFreightQuoteError: class CheckoutFreightQuoteError extends Error {},
  quoteCheckoutFreight: vi.fn(),
}));

vi.mock('@/modules/checkout/freight-quotes', () => ({
  checkoutFreightQuoteRequestSchema: {
    safeParse(value: unknown) {
      const candidate = value as {
        cart?: { items?: unknown[] };
        address?: { email?: unknown };
      };

      return (candidate.cart?.items?.length ?? 0) > 0 &&
        candidate.address?.email
        ? { success: true as const, data: candidate }
        : { success: false as const };
    },
  },
  CheckoutFreightQuoteError: mocks.CheckoutFreightQuoteError,
  quoteCheckoutFreight: mocks.quoteCheckoutFreight,
}));

const { POST } = await import('./route');

const validBody = {
  cart: {
    items: [{ productId: 'jacket', variantId: 'variant-1', quantity: 1 }],
  },
  address: {
    email: 'buyer@example.com',
    fullName: 'Buyer Example',
    phone: '09171234567',
    addressLine1: '123 Main Street',
    addressLine2: '',
    city: 'Manila',
    region: 'Metro Manila',
    postalCode: '1000',
    country: 'PH',
  },
};

function request(token?: string, body: unknown = validBody) {
  return new Request(
    'https://portal.test/api/storefront/checkout/freight-quotes',
    {
      method: 'POST',
      headers:
        token === undefined
          ? { 'content-type': 'application/json' }
          : {
              authorization: `Bearer ${token}`,
              'content-type': 'application/json',
            },
      body: JSON.stringify(body),
    },
  );
}

describe('storefront checkout freight quotes API', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    mocks.quoteCheckoutFreight.mockReset();
  });

  it('rejects requests without the storefront token', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await POST(request());

    expect(response.status).toBe(401);
    expect(mocks.quoteCheckoutFreight).not.toHaveBeenCalled();
  });

  it('rejects malformed quote input safely', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');

    const response = await POST(request('secret', { cart: { items: [] } }));
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: 'Check your cart and address, then try again.',
    });
    expect(mocks.quoteCheckoutFreight).not.toHaveBeenCalled();
  });

  it('returns normalized quote data', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.quoteCheckoutFreight.mockResolvedValue({
      quotes: [
        {
          quoteId: 'quote-1',
          packageId: 'pkg_1',
          shippingTier: 'Standard',
          cjLogisticName: 'CJPacket Postal',
          optionId: 'option-1',
          channelId: 'channel-1',
          arrivalTime: '12-20',
          amountMinor: 409,
          currency: 'USD',
          originCountry: 'CN',
          destinationCountry: 'PH',
          ruleTips: [],
          expiresAt: '2026-08-17T14:15:00.000Z',
        },
      ],
      packages: [{ packageId: 'pkg_1', originCountry: 'CN', itemCount: 1 }],
      quotedAt: '2026-08-17T14:00:00.000Z',
    });

    const response = await POST(request('secret'));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.quotes[0]).toMatchObject({
      cjLogisticName: 'CJPacket Postal',
      optionId: 'option-1',
      amountMinor: 409,
    });
    expect(mocks.quoteCheckoutFreight).toHaveBeenCalledWith(validBody);
  });

  it('returns buyer-safe unavailable messages', async () => {
    vi.stubEnv('SALS3_STOREFRONT_API_TOKEN', 'secret');
    mocks.quoteCheckoutFreight.mockRejectedValue(
      new mocks.CheckoutFreightQuoteError('CJ returned no delivery methods.'),
    );

    const response = await POST(request('secret'));
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload).toEqual({ error: 'CJ returned no delivery methods.' });
  });
});
