// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import {
  CheckoutFreightQuoteError,
  checkoutFreightAddressSchema,
  checkoutFreightQuoteRequestSchema,
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
    priceMinor: BigInt(1000),
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

type QuoteCountry = 'AU' | 'PH' | 'FJ';

const FREIGHT_FIXTURES: Record<
  QuoteCountry,
  {
    arrivalTime: string;
    totalPostageFee: number;
    phone: string;
    addressLine1: string;
    city: string;
    region: string;
    postalCode: string;
  }
> = {
  AU: {
    arrivalTime: '8-15',
    totalPostageFee: 12.34,
    phone: '+61 412 345 678',
    addressLine1: '1 Martin Place',
    city: 'Sydney',
    region: 'NSW',
    postalCode: '2000',
  },
  PH: {
    arrivalTime: '12-20',
    totalPostageFee: 4.09,
    phone: '09171234567',
    addressLine1: '123 Main Street',
    city: 'Manila',
    region: 'Metro Manila',
    postalCode: '1000',
  },
  FJ: {
    arrivalTime: '12-20',
    totalPostageFee: 16.01,
    phone: '+6793212345',
    addressLine1: '14 Queens Road',
    city: 'Nadi',
    region: 'Western Division',
    postalCode: '',
  },
};

function successFreightResponse(destination: QuoteCountry) {
  const fixture = FREIGHT_FIXTURES[destination];

  return {
    code: 200,
    result: true,
    data: [
      {
        arrivalTime: fixture.arrivalTime,
        optionId: `option-${destination.toLowerCase()}`,
        channelId: `channel-${destination.toLowerCase()}`,
        totalPostageFee: fixture.totalPostageFee,
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
  country: QuoteCountry,
  rowSets: OfferRow[][],
  freightResponse: unknown = successFreightResponse(country),
  supportsFreeStandardShipping = false,
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
  const fixture = FREIGHT_FIXTURES[country];
  const result = await quoteCheckoutFreight(
    {
      cart: { items: [{ productId: 'jacket', quantity: 1 }] },
      address: {
        email: 'buyer@example.com',
        fullName: 'Buyer Example',
        phone: fixture.phone,
        addressLine1: fixture.addressLine1,
        addressLine2: '',
        city: fixture.city,
        region: fixture.region,
        postalCode: fixture.postalCode,
        country,
      },
      ...(supportsFreeStandardShipping
        ? { capabilities: { freeStandardShipping: true as const } }
        : {}),
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
  beforeEach(() => {
    vi.stubEnv('SALS3_FREE_STANDARD_SHIPPING_PH_USD', '12');
    vi.stubEnv('SALS3_FREE_STANDARD_SHIPPING_AU_USD', '25');
    vi.stubEnv('SALS3_FREE_STANDARD_SHIPPING_FJ_USD', '55');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts Fiji freight quote requests without a postal code', () => {
    const parsed = checkoutFreightQuoteRequestSchema.safeParse({
      cart: { items: [{ productId: 'jacket', quantity: 1 }] },
      address: {
        email: 'buyer@example.com',
        fullName: 'Buyer Example',
        phone: '+6793212345',
        addressLine1: '14 Queens Road',
        addressLine2: '',
        city: 'Nadi',
        region: 'Western Division',
        postalCode: '',
        country: 'FJ',
      },
    });

    expect(parsed.success).toBe(true);
  });

  it('keeps postal codes required for Australia and the Philippines', () => {
    ['AU', 'PH'].forEach((country) => {
      const parsed = checkoutFreightQuoteRequestSchema.safeParse({
        cart: { items: [{ productId: 'jacket', quantity: 1 }] },
        address: {
          email: 'buyer@example.com',
          fullName: 'Buyer Example',
          phone: '',
          addressLine1: '1 Main Street',
          addressLine2: '',
          city: 'Sydney',
          region: 'NSW',
          postalCode: '',
          country,
        },
      });

      expect(parsed.success).toBe(false);
      expect(parsed.error?.issues).toContainEqual(
        expect.objectContaining({
          path: ['address', 'postalCode'],
          message: 'Enter a postal code.',
        }),
      );
    });
  });

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

  it('quotes a Fiji address through the same CJ freightCalculateTip path', async () => {
    const { result, freightBodies } = await quoteForCountry('FJ', [
      [],
      [offerRow({ marketCode: 'AU' })],
    ]);

    expect(result.quotes[0]).toMatchObject({
      destinationCountry: 'FJ',
      cjLogisticName: 'CJPacket FJ',
      amountMinor: 1601,
    });
    expect(freightBodies[0]).toMatchObject({
      reqDTOS: [
        expect.objectContaining({
          destAreaCode: 'FJ',
          zip: '',
          city: 'Nadi',
          province: 'Western Division',
        }),
      ],
    });
  });

  it.each([
    ['PH', 1200, 409],
    ['AU', 2500, 1234],
    ['FJ', 5500, 1601],
  ] as const)(
    'makes only Standard free when a %s cart reaches its threshold',
    async (country, thresholdAmountMinor, regularAmountMinor) => {
      const { result } = await quoteForCountry(
        country,
        [
          [
            offerRow({
              marketCode: country,
              priceMinor: BigInt(thresholdAmountMinor),
            }),
          ],
        ],
        undefined,
        true,
      );

      expect(result.freeShipping).toEqual({
        thresholdAmountMinor,
        subtotalAmountMinor: thresholdAmountMinor,
        amountRemainingMinor: 0,
        eligible: true,
        currency: 'USD',
      });
      expect(result.quotes[0]).toMatchObject({
        shippingTier: 'Standard',
        amountMinor: 0,
        regularAmountMinor,
      });
    },
  );

  it('caps the contribution on a heavy Fiji basket instead of giving Standard away in full', async () => {
    // A 2kg Fiji parcel really can cost $98.32 (measured on CJ's own
    // calculator) -- with no ceiling, that entire amount was previously
    // absorbed the instant the order qualified. With no explicit
    // SALS3_FREE_STANDARD_SHIPPING_CEILING_FJ_USD configured, the ceiling
    // defaults to the $55 threshold itself, so the buyer should still owe
    // the $43.32 remainder.
    const heavyFijiFreight = {
      code: 200,
      result: true,
      data: [
        {
          arrivalTime: '20-60',
          optionId: 'option-fj-heavy',
          channelId: 'channel-fj-heavy',
          totalPostageFee: 98.32,
          option: { enName: 'CJPacket FJ Liquid Line', id: 'option-fj-heavy' },
          channel: { enName: 'CJPacket FJ Channel', id: 'channel-fj-heavy' },
          ruleTips: null,
          allRuleTips: null,
          recommendLogisticsTypeList: null,
        },
      ],
    };
    const { result } = await quoteForCountry(
      'FJ',
      [[offerRow({ marketCode: 'FJ', priceMinor: BigInt(5500) })]],
      heavyFijiFreight,
      true,
    );

    expect(result.freeShipping).toMatchObject({
      thresholdAmountMinor: 5500,
      eligible: true,
    });
    expect(result.quotes[0]).toMatchObject({
      shippingTier: 'Standard',
      regularAmountMinor: 9832,
      // Sals3 contributes at most the $55 ceiling; the buyer owes the rest.
      amountMinor: 9832 - 5500,
    });
  });

  it('keeps faster tiers paid after Standard becomes free', async () => {
    const { result } = await quoteForCountry(
      'PH',
      [[offerRow({ marketCode: 'PH', priceMinor: BigInt(1200) })]],
      {
        code: 200,
        result: true,
        data: [
          {
            arrivalTime: '12-20',
            optionId: 'standard-option',
            channelId: 'standard-channel',
            totalPostageFee: 4.09,
            ruleTips: [],
            allRuleTips: [],
            recommendLogisticsTypeList: [],
          },
          {
            arrivalTime: '3-7',
            optionId: 'expedited-option',
            channelId: 'expedited-channel',
            totalPostageFee: 10,
            ruleTips: [],
            allRuleTips: [],
            recommendLogisticsTypeList: [],
          },
        ],
      },
      true,
    );

    expect(result.quotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shippingTier: 'Standard',
          amountMinor: 0,
          regularAmountMinor: 409,
        }),
        expect.objectContaining({
          shippingTier: 'Expedited',
          amountMinor: 1000,
          regularAmountMinor: 1000,
        }),
      ]),
    );
  });

  it('keeps Standard paid for a storefront that has not opted into zero freight', async () => {
    const { result } = await quoteForCountry('PH', [
      [offerRow({ marketCode: 'PH', priceMinor: BigInt(1200) })],
    ]);

    expect(result.freeShipping).toBeUndefined();
    expect(result.quotes[0]).toMatchObject({
      shippingTier: 'Standard',
      amountMinor: 409,
      regularAmountMinor: 409,
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

/**
 * The country enum moved from a literal in this file to an import
 * (`checkout-destinations.ts`) on 2026-08-30, so that the storefront preview,
 * the free-shipping thresholds and this schema stop each keeping their own copy
 * of the same three codes.
 *
 * Nothing asserted what that enum admits, which made the move unguarded: if the
 * import ever resolved to the *pricing* list — six measured destinations, the
 * obvious wrong thing to point it at — checkout would accept an NZ, US or CA
 * address that CJ cannot be asked to quote, and the failure would surface at the
 * supplier call instead of at validation. These pin both sides.
 */
describe('checkoutFreightAddressSchema country enum', () => {
  const address = {
    email: 'buyer@example.com',
    fullName: 'A Buyer',
    phone: '0400000000',
    addressLine1: '1 Test Street',
    city: 'Sydney',
    region: 'New South Wales',
    postalCode: '2000',
  };

  it.each(['AU', 'PH', 'FJ'])(
    'admits %s, which freight can quote',
    (country) => {
      expect(
        checkoutFreightAddressSchema.safeParse({ ...address, country }).success,
      ).toBe(true);
    },
  );

  /**
   * Priceable but not checkout-capable. A margin may be set for each of these
   * (owner decision 2026-08-25), and that is deliberately not the same
   * permission as being able to complete an order.
   */
  it.each(['NZ', 'US', 'CA'])(
    'refuses %s, which is priceable but has no freight quote',
    (country) => {
      expect(
        checkoutFreightAddressSchema.safeParse({ ...address, country }).success,
      ).toBe(false);
    },
  );

  it.each(['au', 'AUS', '', 'ZZ'])('refuses the malformed %s', (country) => {
    expect(
      checkoutFreightAddressSchema.safeParse({ ...address, country }).success,
    ).toBe(false);
  });
});
