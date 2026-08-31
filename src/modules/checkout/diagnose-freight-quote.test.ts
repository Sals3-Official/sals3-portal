// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import { diagnoseFreightQuote } from './diagnose-freight-quote';

vi.mock('server-only', () => ({}));

/**
 * The real DB executor only ever needs to answer one query chain -
 * `loadQuoteLines`'s own binding/fallback lookup - so this stubs exactly that
 * shape rather than mocking the whole module.
 */
function executorReturning(rows: unknown[]) {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(rows),
  };

  return { select: () => chain } as never;
}

function fakeTokenManager(token: string | Error): CjTokenManager {
  return {
    getAccessToken: vi.fn(async () => {
      if (token instanceof Error) throw token;

      return token;
    }),
  } as unknown as CjTokenManager;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

/**
 * A fetcher keyed on which CJ endpoint is being asked, not on call order, and
 * building a fresh `Response` per call rather than replaying one instance.
 *
 * `quoteCheckoutFreight` redoes the same product and inventory reads this
 * module already made directly, then makes a third call to
 * `/logistic/freightCalculateTip` — so a fetcher that only remembers a fixed
 * sequence of responses runs out after this module's own two calls and
 * answers the real function's identical requests with nothing. A single
 * shared `Response` object fails a second way: its body can only be read
 * once, and the second `.json()` — whichever caller it belongs to — throws.
 */
function routedFetcher(routes: {
  product?: [number, unknown];
  inventory?: [number, unknown];
  freight?: [number, unknown];
}) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url.includes('/product/query') && routes.product) {
      return jsonResponse(...routes.product);
    }

    if (url.includes('/product/stock/getInventoryByPid') && routes.inventory) {
      return jsonResponse(...routes.inventory);
    }

    if (url.includes('/logistic/freightCalculateTip') && routes.freight) {
      return jsonResponse(...routes.freight);
    }

    throw new Error(`unexpected CJ call: ${url}`);
  });
}

const FREIGHT_QUOTE_BODY = {
  code: 200,
  data: [
    {
      optionId: 'opt-1',
      channelId: 'chan-1',
      // A real "min-max days" window — `classifyShippingTiers` reads this to
      // decide Standard/Express/Expedited, not the option or channel id.
      arrivalTime: '12-50',
      option: { enName: 'CJPacket' },
      totalPostageFee: 500,
      error: '',
      errorEn: '',
    },
  ],
};

const LINE_ROW = {
  slug: 'harem-pants',
  title: 'Harem Pants',
  productId: 'product-1',
  variantId: 'variant-1',
  priceMinor: BigInt(1620),
  connectionId: 'connection-1',
  externalProductId: '2408221121551616400',
  externalVariantId: '2408221121551618300',
  externalSku: 'CJXX211766813MN',
  sals3Sku: 'S3V-B264B6697641',
  weightGrams: 420,
  lengthMillimeters: 300,
  widthMillimeters: 200,
  heightMillimeters: 30,
  marketCode: 'AU',
};

describe('diagnoseFreightQuote', () => {
  it('reports which supplier binding it resolved, both raw CJ bodies, and a successful full quote', async () => {
    const productDetail = {
      code: 200,
      data: {
        variants: [
          {
            vid: '2408221121551618300',
            variantSku: 'CJXX211766813MN',
            variantWeight: 420,
            variantLength: 300,
            variantWidth: 200,
            variantHeight: 30,
          },
        ],
        productProEnSet: ['Clothes'],
      },
    };
    const inventory = {
      code: 200,
      data: {
        variantInventories: [
          {
            vid: '2408221121551618300',
            inventory: [{ countryCode: 'CN', factoryInventory: 100 }],
          },
        ],
      },
    };
    const fetcher = routedFetcher({
      product: [200, productDetail],
      inventory: [200, inventory],
      freight: [200, FREIGHT_QUOTE_BODY],
    });

    const result = diagnoseFreightQuote(
      {
        productSlug: 'harem-pants',
        variantId: 'variant-1',
        destinationCountry: 'PH',
      },
      {
        executor: executorReturning([LINE_ROW]),
        tokenManager: fakeTokenManager('token-1'),
        fetcherForConnection: () => fetcher,
      },
    );

    const resolved = await result;

    expect(resolved).toMatchObject({
      ok: true,
      line: {
        connectionId: 'connection-1',
        externalProductId: '2408221121551616400',
        externalVariantId: '2408221121551618300',
      },
      cjProductQuery: { status: 200, body: productDetail },
      cjInventoryQuery: { status: 200, body: inventory },
      fullQuote: { ok: true },
    });
    // A successful quote already explains itself; no need for a fourth call.
    expect(resolved).not.toHaveProperty('cjFreightQuery');
  });

  /**
   * The exact shape the harem-pants investigation actually found: both raw CJ
   * reads clean, and the real failure only visible one call further in, at the
   * freight calculation `getCjJson` never lets a diagnosis see.
   */
  it('surfaces an unhandled failure in the freight calculation, not just the two reads', async () => {
    const productDetail = {
      code: 200,
      data: {
        variants: [
          {
            vid: '2408221121551618300',
            variantSku: 'CJXX211766813MN',
            variantWeight: 420,
            variantLength: 300,
            variantWidth: 200,
            variantHeight: 30,
          },
        ],
        productProEnSet: ['Clothes'],
      },
    };
    const inventory = {
      code: 200,
      data: {
        variantInventories: [
          {
            vid: '2408221121551618300',
            inventory: [{ countryCode: 'CN', factoryInventory: 100 }],
          },
        ],
      },
    };
    const fetcher = routedFetcher({
      product: [200, productDetail],
      inventory: [200, inventory],
      // A malformed freight response: `cjFreightResponseSchema` will not
      // parse this, so `quoteCheckoutFreight` throws `CjApiError` — the exact
      // class of failure a buyer only ever sees as "try again in a moment".
      freight: [200, { unexpected: 'shape' }],
    });

    const result = await diagnoseFreightQuote(
      {
        productSlug: 'harem-pants',
        variantId: 'variant-1',
        destinationCountry: 'PH',
      },
      {
        executor: executorReturning([LINE_ROW]),
        tokenManager: fakeTokenManager('token-1'),
        fetcherForConnection: () => fetcher,
      },
    );

    expect(result).toMatchObject({
      ok: true,
      cjProductQuery: { status: 200 },
      cjInventoryQuery: { status: 200 },
      fullQuote: { ok: false, error: { name: 'CjApiError' } },
      // The one thing getCjJson would have discarded: the real, malformed CJ
      // body behind the unnamed CjApiError above.
      cjFreightQuery: { status: 200, body: { unexpected: 'shape' } },
    });
  });

  /**
   * The exact case this tool was built for: a business-level CJ refusal that
   * `getCjJson` would collapse into an opaque 503. Here the buyer-safe
   * collapse does not apply, so the raw body — including whatever `code` and
   * message CJ actually sent — is what a real diagnosis needs to see.
   */
  it('surfaces a non-200 CJ body instead of collapsing it', async () => {
    const fetcher = routedFetcher({
      product: [200, { code: 1600001, message: 'product not exist' }],
      inventory: [200, { code: 200, data: {} }],
      freight: [200, { code: 200, data: {} }],
    });

    const result = diagnoseFreightQuote(
      { productSlug: 'harem-pants', destinationCountry: 'PH' },
      {
        executor: executorReturning([LINE_ROW]),
        tokenManager: fakeTokenManager('token-1'),
        fetcherForConnection: () => fetcher,
      },
    );

    await expect(result).resolves.toMatchObject({
      ok: true,
      cjProductQuery: {
        status: 200,
        body: { code: 1600001, message: 'product not exist' },
      },
      // The same bad body sinks the real function's own attempt too.
      fullQuote: { ok: false, error: { name: 'CjApiError' } },
    });
  });

  it('reports a token failure by connection, without ever calling CJ', async () => {
    const fetcher = vi.fn();

    const result = await diagnoseFreightQuote(
      { productSlug: 'harem-pants', destinationCountry: 'PH' },
      {
        executor: executorReturning([LINE_ROW]),
        tokenManager: fakeTokenManager(new Error('invalid_grant')),
        fetcherForConnection: () => fetcher,
      },
    );

    expect(result).toEqual({
      ok: false,
      step: 'cj-product-query',
      message: expect.stringContaining('invalid_grant'),
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports the buyer-facing refusal when no supplier binding resolves', async () => {
    const result = await diagnoseFreightQuote(
      { productSlug: 'unlisted-product', destinationCountry: 'PH' },
      { executor: executorReturning([]) },
    );

    expect(result).toEqual({
      ok: false,
      step: 'load-quote-line',
      message: 'A cart item is not available for delivery to this address.',
    });
  });
});
