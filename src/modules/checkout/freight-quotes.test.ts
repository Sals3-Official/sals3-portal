// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import { quoteCheckoutFreight } from './freight-quotes';

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

function executorReturning(rows: OfferRow[]) {
  type QueryChain = {
    from: () => QueryChain;
    innerJoin: () => QueryChain;
    where: () => QueryChain;
    limit: () => Promise<OfferRow[]>;
  };
  const chain: QueryChain = {
    from: vi.fn(() => chain),
    innerJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(async () => rows),
  };

  return { select: vi.fn(() => chain) };
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

describe('quoteCheckoutFreight', () => {
  it('quotes an Australia address even when the published storefront offer is from another market', async () => {
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

        return Response.json({
          code: 200,
          result: true,
          data: [
            {
              arrivalTime: '8-15',
              optionId: 'option-au',
              channelId: 'channel-au',
              totalPostageFee: 12.34,
              option: { enName: 'CJPacket AU', id: 'option-au' },
              channel: { enName: 'CJPacket AU Channel', id: 'channel-au' },
              ruleTips: [],
              allRuleTips: [],
            },
          ],
        });
      },
    );
    const result = await quoteCheckoutFreight(
      {
        cart: { items: [{ productId: 'jacket', quantity: 1 }] },
        address: {
          email: 'buyer@example.com',
          fullName: 'Buyer Example',
          phone: '+61 412 345 678',
          addressLine1: '1 Martin Place',
          addressLine2: '',
          city: 'Sydney',
          region: 'NSW',
          postalCode: '2000',
          country: 'AU',
        },
      },
      {
        executor: executorReturning([
          {
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
            marketCode: 'PH',
          },
        ]) as never,
        fetcherForConnection: () => fetcher as unknown as typeof fetch,
        tokenManager: {
          getAccessToken: vi.fn(async () => 'cj-token'),
        } as unknown as CjTokenManager,
      },
    );

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
});
