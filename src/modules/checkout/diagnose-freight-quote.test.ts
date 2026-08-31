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
  it('reports which supplier binding it resolved and both raw CJ bodies', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { code: 200, data: {} }))
      .mockResolvedValueOnce(
        jsonResponse(200, { code: 200, data: { variantInventories: [] } }),
      );

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

    await expect(result).resolves.toMatchObject({
      ok: true,
      line: {
        connectionId: 'connection-1',
        externalProductId: '2408221121551616400',
        externalVariantId: '2408221121551618300',
      },
      cjProductQuery: { status: 200, body: { code: 200, data: {} } },
      cjInventoryQuery: { status: 200 },
    });
  });

  /**
   * The exact case this tool was built for: a business-level CJ refusal that
   * `getCjJson` would collapse into an opaque 503. Here the buyer-safe
   * collapse does not apply, so the raw body — including whatever `code` and
   * message CJ actually sent — is what a real diagnosis needs to see.
   */
  it('surfaces a non-200 CJ body instead of collapsing it', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, { code: 1600001, message: 'product not exist' }),
      )
      .mockResolvedValueOnce(jsonResponse(200, { code: 200, data: {} }));

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
