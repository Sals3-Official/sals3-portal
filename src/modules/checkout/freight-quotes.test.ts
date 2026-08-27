// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import {
  CheckoutFreightQuoteError,
  quoteCheckoutFreight,
} from './freight-quotes';

vi.mock('server-only', () => ({}));

type OfferRow = {
  slug: string;
  title: string;
  productId: string;
  variantId: string;
  priceMinor: bigint;
  connectionId: string;
  externalProductId: string;
  externalVariantId: string;
  externalSku: string;
  sals3Sku: string;
  weightGrams: number;
  lengthMillimeters: number;
  widthMillimeters: number;
  heightMillimeters: number;
  marketCode: string;
};

function offerRow(overrides: Partial<OfferRow> = {}): OfferRow {
  return {
    slug: 'jacket',
    title: 'Jacket',
    productId: 'product-1',
    variantId: 'variant-1',
    priceMinor: BigInt(1206),
    connectionId: 'connection-1',
    externalProductId: 'cj-product-1',
    externalVariantId: 'cj-variant-1',
    externalSku: 'CJ-SKU-1',
    sals3Sku: 'SALS3-SKU-1',
    weightGrams: 250,
    lengthMillimeters: 100,
    widthMillimeters: 80,
    heightMillimeters: 20,
    marketCode: 'AU',
    ...overrides,
  };
}

function executorReturningSequence(rowSets: OfferRow[][]) {
  type QueryChain = {
    from: () => QueryChain;
    innerJoin: () => QueryChain;
    where: () => QueryChain;
    limit: () => Promise<OfferRow[]>;
  };
  let selectCount = 0;
  const chain: QueryChain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(
      async () => rowSets[Math.min(selectCount - 1, rowSets.length - 1)] ?? [],
    ),
  };
  const executor = {
    select: vi.fn(() => {
      selectCount += 1;

      return chain;
    }),
  };

  return { executor, chain };
}

function cjProductDetail() {
  return {
    code: 200,
    message: 'success',
    pointsInfo: { total: 50000, usedToday: 0, remaining: 50000 },
    data: {
      pid: 'cj-product-1',
      productNameEn: 'Jacket',
      productName: 'Jacket',
      productSku: 'CJ-JACKET',
      productImage: null,
      productImageSet: [],
      productWeight: '250',
      productType: '',
      categoryId: '',
      categoryName: '',
      entryCode: '',
      description: '',
      sellPrice: '10',
      suggestSellPrice: '20',
      listedNum: 1,
      status: '3',
      createrTime: '',
      materialNameEnSet: [],
      packingNameEnSet: [],
      productProEnSet: ['COMMON'],
      productKeyEnSet: [],
      variants: [
        {
          vid: 'cj-variant-1',
          pid: 'cj-product-1',
          variantNameEn: 'Default',
          variantSku: 'CJ-SKU-1',
          variantImage: null,
          variantKey: 'Default',
          variantWeight: 250,
          variantLength: 100,
          variantWidth: 80,
          variantHeight: 20,
          variantVolume: 160,
          variantSellPrice: 10,
          inventoryNum: null,
        },
      ],
      isTestProduct: false,
    },
  };
}

function cjInventory() {
  return {
    code: 200,
    message: 'success',
    pointsInfo: { total: 50000, usedToday: 0, remaining: 50000 },
    data: {
      inventories: [],
      variantInventories: [
        {
          vid: 'cj-variant-1',
          inventory: [
            {
              countryCode: 'CN',
              totalInventory: 100,
              cjInventory: 100,
              factoryInventory: 0,
              verifiedWarehouse: 1,
            },
          ],
        },
      ],
    },
  };
}

function successFreightResponse(destination: 'AU' | 'PH') {
  return {
    code: 200,
    result: true,
    data: [
      {
        arrivalTime: destination === 'AU' ? '8-15' : '12-20',
        optionId: `option-${destination.toLowerCase()}`,
        channelId: `channel-${destination.toLowerCase()}`,
        totalPostageFee: destination === 'AU' ? 12.34 : 4.09,
        option: {
          enName: `CJPacket ${destination}`,
          id: `option-${destination.toLowerCase()}`,
        },
        channel: {
          enName: `CJPacket ${destination} Channel`,
          id: `channel-${destination.toLowerCase()}`,
        },
        ruleTips: null,
        allRuleTips: null,
        recommendLogisticsTypeList: null,
      },
    ],
  };
}

async function quoteForCountry(
  country: 'AU' | 'PH',
  rowSets: OfferRow[][],
  freightResponse: unknown = successFreightResponse(country),
) {
  const freightBodies: unknown[] = [];
  const fetcher = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();

      if (url.includes('/product/query')) {
        return Response.json(cjProductDetail());
      }

      if (url.includes('/product/stock/getInventoryByPid')) {
        return Response.json(cjInventory());
      }

      freightBodies.push(
        typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
      );

      return Response.json(freightResponse);
    },
  );
  const { executor } = executorReturningSequence(rowSets);
  const result = await quoteCheckoutFreight(
    {
      cart: { items: [{ productId: 'jacket', quantity: 1 }] },
      address: {
        email: 'buyer@example.com',
        fullName: 'Buyer Example',
        phone: country === 'AU' ? '+61 412 345 678' : '09171234567',
        addressLine1: country === 'AU' ? '1 Martin Place' : '123 Main Street',
        addressLine2: '',
        city: country === 'AU' ? 'Sydney' : 'Manila',
        region: country === 'AU' ? 'NSW' : 'Metro Manila',
        postalCode: country === 'AU' ? '2000' : '1000',
        country,
      },
    },
    {
      executor: executor as never,
      fetcherForConnection: () => fetcher as unknown as typeof fetch,
      tokenManager: {
        getAccessToken: vi.fn(async () => 'cj-token'),
      } as unknown as CjTokenManager,
    },
  );

  return { result, freightBodies, fetcher, executor };
}

describe('quoteCheckoutFreight', () => {
  it('quotes an Australia address through the legacy provider-reference fallback', async () => {
    const { result, freightBodies } = await quoteForCountry('AU', [
      [],
      [offerRow({ marketCode: 'PH' })],
    ]);

    expect(result.quotes[0]).toMatchObject({
      destinationCountry: 'AU',
      originCountry: 'CN',
      cjLogisticName: 'CJPacket AU',
      amountMinor: 1234,
    });
    expect(freightBodies[0]).toMatchObject({
      reqDTOS: [
        expect.objectContaining({
          srcAreaCode: 'CN',
          destAreaCode: 'AU',
          zip: '2000',
        }),
      ],
    });
  });

  it('quotes a Philippines address through the same CJ freightCalculateTip path', async () => {
    const { result, freightBodies } = await quoteForCountry('PH', [
      [],
      [offerRow({ marketCode: 'AU' })],
    ]);

    expect(result.quotes[0]).toMatchObject({
      destinationCountry: 'PH',
      cjLogisticName: 'CJPacket PH',
      amountMinor: 409,
    });
    expect(freightBodies[0]).toMatchObject({
      reqDTOS: [
        expect.objectContaining({
          destAreaCode: 'PH',
          zip: '1000',
        }),
      ],
    });
  });

  it('prefers the active offer binding path over the legacy fallback', async () => {
    const { executor } = await quoteForCountry('AU', [
      [offerRow({ connectionId: 'active-binding-connection' })],
    ]);

    expect(executor.select).toHaveBeenCalledTimes(1);
  });

  it('rejects before CJ calls when no connected CJ-backed line can be resolved', async () => {
    const { executor } = executorReturningSequence([[], []]);
    const fetcher = vi.fn();

    await expect(
      quoteCheckoutFreight(
        {
          cart: { items: [{ productId: 'jacket', quantity: 1 }] },
          address: {
            email: 'buyer@example.com',
            fullName: 'Buyer Example',
            phone: '',
            addressLine1: '1 Martin Place',
            addressLine2: '',
            city: 'Sydney',
            region: 'NSW',
            postalCode: '2000',
            country: 'AU',
          },
        },
        {
          executor: executor as never,
          fetcherForConnection: () => fetcher as unknown as typeof fetch,
          tokenManager: {
            getAccessToken: vi.fn(async () => 'cj-token'),
          } as unknown as CjTokenManager,
        },
      ),
    ).rejects.toThrow(CheckoutFreightQuoteError);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('turns CJ no-route rows into a buyer-safe quote error', async () => {
    await expect(
      quoteForCountry('AU', [[offerRow()]], {
        code: 200,
        result: true,
        data: [
          {
            optionId: '',
            channelId: '',
            error: 'no route',
            errorEn: 'No route',
            ruleTips: null,
            allRuleTips: null,
          },
        ],
      }),
    ).rejects.toThrow('No delivery method is available');
  });
});
