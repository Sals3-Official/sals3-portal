import { describe, expect, it } from 'vitest';
import type {
  StorefrontDetailRow,
  StorefrontListRow,
} from '@/modules/catalog/storefront/read-model';
import {
  categoryLeafName,
  isPublicSlug,
  storefrontFeedQuerySchema,
  toStorefrontCategories,
  toStorefrontProduct,
  toStorefrontProductDetail,
  toStorefrontProductFeed,
} from './catalog-feed';

function row(overrides: Partial<StorefrontListRow> = {}): StorefrontListRow {
  return {
    id: '90a329b9-56aa-4f54-abb2-ad843602aa73',
    slug: 'waterproof-shell-jacket',
    title: 'Mens Short-Style Cold-Weather Waterproof Shell Jacket',
    priceMinor: 4299,
    priceCurrency: 'USD',
    availabilityState: 'UNKNOWN',
    categoryCode: 'CAT-APP-100412',
    categoryPath: "Apparel > Outerwear > Men's Jackets",
    primaryImageUrl: 'https://cf.cjdropshipping.com/quick/product/a.jpg',
    publishedAt: '2026-08-13T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * The exact key set `sals3-ecommerce`'s `StorefrontProductSchema` requires.
 * Locked in a test because that schema rejects the **entire page** on a
 * missing or empty legacy key — dropping one here would break the live
 * storefront harder than the 502 this rewrite replaces. Adding a key is safe
 * (Zod strips unknowns); removing one is not, and this list is what makes the
 * difference impossible to miss in review.
 */
const CONSUMER_REQUIRED_KEYS = [
  'id',
  'slug',
  'title',
  'priceMinor',
  'oldPriceMinor',
  'imageUrl',
  'imageAlt',
  'ratingLine',
  'shipLine',
  'category',
] as const;

describe('toStorefrontProduct', () => {
  it('emits every key the storefront consumer requires', () => {
    const product = toStorefrontProduct(row());

    CONSUMER_REQUIRED_KEYS.forEach((key) => {
      expect(product).toHaveProperty(key);
    });
    expect(product?.ratingLine).not.toBe('');
    expect(product?.shipLine).not.toBe('');
  });

  /**
   * ADR-003: no fabricated was/now pair. Equal values make every consumer card
   * render one honest price with no strikethrough and no percent-off badge.
   */
  it('publishes no comparison price', () => {
    const product = toStorefrontProduct(row());

    expect(product?.oldPriceMinor).toBe(product?.priceMinor);
  });

  it('carries the offer currency rather than assuming one', () => {
    expect(toStorefrontProduct(row())?.currency).toBe('USD');
    expect(toStorefrontProduct(row({ priceCurrency: 'AUD' }))?.currency).toBe(
      'AUD',
    );
  });

  it('uses the product title as image alt text', () => {
    const product = toStorefrontProduct(row());

    expect(product?.imageAlt).toBe(
      'Mens Short-Style Cold-Weather Waterproof Shell Jacket',
    );
  });

  it('passes a missing image through as null rather than a placeholder URL', () => {
    expect(toStorefrontProduct(row({ primaryImageUrl: null }))?.imageUrl).toBe(
      null,
    );
  });

  /**
   * Absent means absent. A defaulted `categoryName` would tell the consumer a
   * category exists when the product has none, and the consumer cannot tell
   * the two apart once a value is present.
   */
  it('omits categoryName rather than defaulting it', () => {
    const product = toStorefrontProduct(
      row({ categoryCode: null, categoryPath: null }),
    );
    const serialised = JSON.parse(JSON.stringify(product));

    expect('categoryName' in serialised).toBe(false);
    expect(product?.category).toBe('uncategorised');
  });

  it('drops a row whose slug or category cannot satisfy the consumer regex', () => {
    expect(toStorefrontProduct(row({ slug: 'Not A Slug' }))).toBe(null);
    expect(toStorefrontProduct(row({ categoryCode: 'CAT_APP_1' }))).toBe(null);
  });
});

describe('toStorefrontProductDetail', () => {
  function detail(overrides: Partial<StorefrontDetailRow> = {}) {
    return {
      ...row(),
      images: [{ url: 'https://cf.cjdropshipping.com/quick/product/a.jpg' }],
      ...overrides,
    };
  }

  it('carries the card fields plus the detail fields', () => {
    const product = toStorefrontProductDetail(detail());

    expect(product).toMatchObject({
      slug: 'waterproof-shell-jacket',
      currency: 'USD',
      publishedAt: '2026-08-13T00:00:00.000Z',
      categoryPath: "Apparel > Outerwear > Men's Jackets",
    });
    expect(product?.images).toEqual([
      {
        url: 'https://cf.cjdropshipping.com/quick/product/a.jpg',
        alt: 'Mens Short-Style Cold-Weather Waterproof Shell Jacket',
      },
    ]);
  });

  /**
   * The whole rollout rests on this: an absent key means "nobody wrote one",
   * and a defaulted key would make that indistinguishable from "written and
   * empty". A `JSON` round-trip is the check that matters, because that is what
   * the consumer actually receives.
   */
  it.each(['description', 'variants', 'specs', 'categoryPath'])(
    'omits %s from the wire when there is nothing to report',
    (key) => {
      const serialised = JSON.parse(
        JSON.stringify(
          toStorefrontProductDetail(detail({ categoryPath: null })),
        ),
      );

      expect(key in serialised).toBe(false);
    },
  );

  it('reports description blocks when the frozen revision has them', () => {
    const product = toStorefrontProductDetail(
      detail({
        description: {
          blocks: [{ type: 'paragraph', text: 'A warm winter jacket.' }],
        },
      }),
    );

    expect(product?.description?.blocks).toEqual([
      { type: 'paragraph', text: 'A warm winter jacket.' },
    ]);
  });

  it('omits a variant’s options when it has no axes', () => {
    const product = toStorefrontProductDetail(
      detail({
        variants: [
          {
            id: 'variant-1',
            sku: 'SALS3-1',
            priceMinor: 4299,
            currency: 'USD',
            availability: 'AVAILABLE',
            options: [],
          },
        ],
      }),
    );
    const serialised = JSON.parse(JSON.stringify(product));

    expect('options' in serialised.variants[0]).toBe(false);
  });

  function labelledVariant(label?: string) {
    return {
      id: 'variant-1',
      sku: 'SALS3-1',
      priceMinor: 4299,
      currency: 'USD' as const,
      availability: 'AVAILABLE' as const,
      options: [],
      ...(label === undefined ? {} : { label }),
    };
  }

  it("carries the supplier's variant label verbatim", () => {
    const product = toStorefrontProductDetail(
      detail({ variants: [labelledVariant('Black-1XL')] }),
    );

    // Verbatim, and never split into axes: guessing which token is a colour and
    // which a size turns a wrong guess into a customer-facing attribute.
    expect(product?.variants?.[0]?.label).toBe('Black-1XL');
  });

  it('omits the label when the supplier reported none', () => {
    const serialised = JSON.parse(
      JSON.stringify(
        toStorefrontProductDetail(detail({ variants: [labelledVariant()] })),
      ),
    );

    expect('label' in serialised.variants[0]).toBe(false);
  });

  it('truncates an overlong label rather than failing the product', () => {
    const product = toStorefrontProductDetail(
      detail({ variants: [labelledVariant('L'.repeat(200))] }),
    );

    // Same lesson as `title`: one overlong supplier string must cost that string,
    // not the whole product page. This file is the truncation authority, so the
    // wire can never carry more than the consumer's `truncatedText(60)` accepts.
    expect(product?.variants?.[0]?.label).toHaveLength(60);
  });

  it('reports variant options in the order the read model returned them', () => {
    const product = toStorefrontProductDetail(
      detail({
        variants: [
          {
            id: 'variant-1',
            sku: 'SALS3-1',
            priceMinor: 4299,
            currency: 'USD',
            availability: 'UNAVAILABLE',
            options: [
              { name: 'Colour', value: 'Black' },
              { name: 'Size', value: 'XL' },
            ],
          },
        ],
      }),
    );

    expect(product?.variants?.[0].options).toEqual([
      { name: 'Colour', value: 'Black' },
      { name: 'Size', value: 'XL' },
    ]);
  });

  it('drops a detail row whose slug cannot satisfy the consumer regex', () => {
    expect(toStorefrontProductDetail(detail({ slug: 'Not A Slug' }))).toBe(
      null,
    );
  });
});

describe('toStorefrontProductFeed', () => {
  /**
   * The defect this replaces: the CJ-backed feed reported CJ's own page count
   * while serving `limit`-sized pages, so the consumer's pagination offered
   * pages that did not exist.
   */
  it('computes totalPages from the served page size', () => {
    const feed = toStorefrontProductFeed(
      { rows: [row()], total: 31 },
      { section: 'for-you', page: 2, limit: 14 },
    );

    expect(feed.totalPages).toBe(3);
    expect(feed.page).toBe(2);
    expect(feed.limit).toBe(14);
  });

  it('reports at least one page when the catalogue is empty', () => {
    const feed = toStorefrontProductFeed(
      { rows: [], total: 0 },
      { section: 'for-you', page: 1, limit: 14 },
    );

    expect(feed).toEqual({
      products: [],
      total: 0,
      page: 1,
      limit: 14,
      totalPages: 1,
    });
  });

  it('drops an unmappable row without failing the page', () => {
    const feed = toStorefrontProductFeed(
      { rows: [row({ slug: 'Not A Slug' }), row()], total: 2 },
      { section: 'for-you', page: 1, limit: 14 },
    );

    expect(feed.products).toHaveLength(1);
  });
});

describe('toStorefrontCategories', () => {
  it('names the leaf and derives a short display code', () => {
    expect(
      toStorefrontCategories([
        { code: 'CAT-HOM-100123', path: 'Home & Garden > Kitchen > Cookware' },
      ]),
    ).toEqual([{ id: 'cat-hom-100123', code: 'CO', name: 'Cookware' }]);
  });

  it('de-duplicates and skips codes the consumer regex would reject', () => {
    const categories = toStorefrontCategories([
      { code: 'CAT-HOM-100123', path: 'Home > Cookware' },
      { code: 'CAT-HOM-100123', path: 'Home > Cookware' },
      { code: 'CAT_HOM_1', path: 'Home > Bad Code' },
    ]);

    expect(categories).toHaveLength(1);
  });
});

describe('categoryLeafName', () => {
  it('returns the last non-empty segment', () => {
    expect(categoryLeafName('Apparel > Outerwear > Jackets')).toBe('Jackets');
    expect(categoryLeafName('Apparel')).toBe('Apparel');
  });
});

describe('isPublicSlug', () => {
  it.each([
    ['waterproof-shell-jacket', true],
    ['a1', true],
    ['Not-A-Slug', false],
    ['double--hyphen', false],
    ['-leading', false],
    ['trailing-', false],
    ['', false],
    ['../../etc/passwd', false],
    ['a'.repeat(121), false],
  ])('%j -> %s', (value, expected) => {
    expect(isPublicSlug(value)).toBe(expected);
  });
});

describe('storefrontFeedQuerySchema', () => {
  it('falls back to safe defaults instead of rejecting bad input', () => {
    expect(
      storefrontFeedQuerySchema.parse({
        section: 'nope',
        page: 'x',
        limit: '900',
      }),
    ).toEqual({ section: 'for-you', page: 1, limit: 14 });
  });
});
