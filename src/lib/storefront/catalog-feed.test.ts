import { describe, expect, it } from 'vitest';
import type {
  StorefrontDetailRow,
  StorefrontListRow,
} from '@/modules/catalog/storefront/read-model';
import {
  categoryLeafName,
  categoryTopName,
  isPublicSlug,
  storefrontFeedQuerySchema,
  toStorefrontCategories,
  toStorefrontDepartments,
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
  /**
   * The shared contract fixture's `categoryPath` is `Apparel > Outerwear > Men's
   * Jackets`, which is not a seeded taxonomy path — `Apparel` is not one of the 21
   * departments — so every level of it is correctly name-only. These pin the
   * addressable side, which that fixture cannot show.
   */
  describe('categoryTrail', () => {
    it('carries an address per level for a real taxonomy path', () => {
      const payload = toStorefrontProductDetail(
        detail({
          categoryPath:
            'Office Supplies > General Office Supplies > Paper Products > Notebooks & Notepads',
        }),
      );

      expect(payload?.categoryTrail).toEqual([
        // L1 keeps its bare department slug: already live, already linked.
        { name: 'Office Supplies', slug: 'office-supplies' },
        {
          name: 'General Office Supplies',
          slug: 'general-office-supplies-932',
        },
        { name: 'Paper Products', slug: 'paper-products-956' },
        { name: 'Notebooks & Notepads', slug: 'notebooks-notepads-961' },
      ]);
      // The display string stays: a consumer with no interest in links reads it,
      // and dropping it would break one that already does.
      expect(payload?.categoryPath).toContain('Notebooks & Notepads');
    });

    it('omits the trail with the path, so the two cannot disagree', () => {
      const payload = toStorefrontProductDetail(detail({ categoryPath: null }));

      expect(payload?.categoryPath).toBe(undefined);
      expect(payload?.categoryTrail).toBe(undefined);
    });
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
  it('names the main (L1) category, not the published leaf', () => {
    expect(
      toStorefrontCategories([
        { code: 'CAT-HOM-100123', path: 'Home & Garden > Kitchen > Cookware' },
      ]),
    ).toEqual([{ id: 'home-garden', code: 'HG', name: 'Home & Garden' }]);
  });

  it('rolls every leaf of one main category up into a single tile', () => {
    const categories = toStorefrontCategories([
      {
        code: 'CAT-GGL-2271',
        path: 'Apparel & Accessories > Clothing > Dresses',
      },
      {
        code: 'CAT-GGL-5598',
        path: 'Apparel & Accessories > Clothing > Outerwear > Coats & Jackets',
      },
      {
        code: 'CAT-GGL-212',
        path: 'Apparel & Accessories > Clothing > Shirts & Tops',
      },
      {
        code: 'CAT-GGL-6000',
        path: 'Toys & Games > Toys > Scale Model Accessories',
      },
    ]);

    expect(categories).toEqual([
      { id: 'apparel-accessories', code: 'AA', name: 'Apparel & Accessories' },
      { id: 'toys-games', code: 'TG', name: 'Toys & Games' },
    ]);
  });

  it('never emits a taxonomy code as the public id', () => {
    const [category] = toStorefrontCategories([
      {
        code: 'CAT-GGL-5079',
        path: 'Animals & Pet Supplies > Pet Supplies > Fish Supplies > Aquarium Lighting',
      },
    ]);

    expect(category?.id).toBe('animals-pet-supplies');
    expect(category?.id).not.toMatch(/cat-/);
  });

  it('treats a single-segment path as its own main category', () => {
    expect(
      toStorefrontCategories([{ code: 'CAT-X-1', path: 'Software' }]),
    ).toEqual([{ id: 'software', code: 'SO', name: 'Software' }]);
  });

  it('skips a name that cannot reduce to a slug the consumer accepts', () => {
    const categories = toStorefrontCategories([
      { code: 'CAT-CJK-1', path: '\u5bb6\u5c45 > \u53a8\u623f' },
      { code: 'CAT-GGL-1', path: 'Furniture > Chairs' },
    ]);

    expect(categories).toEqual([
      { id: 'furniture', code: 'FU', name: 'Furniture' },
    ]);
  });
});

describe('toStorefrontDepartments', () => {
  it('emits every department, including ones with no published product', () => {
    expect(
      toStorefrontDepartments([
        { l1: 'Animals & Pet Supplies' },
        { l1: 'Food, Beverages & Tobacco' },
        { l1: 'Software' },
      ]),
    ).toEqual([
      {
        id: 'animals-pet-supplies',
        code: 'AP',
        name: 'Animals & Pet Supplies',
      },
      {
        id: 'food-beverages-tobacco',
        code: 'FB',
        name: 'Food, Beverages & Tobacco',
      },
      { id: 'software', code: 'SO', name: 'Software' },
    ]);
  });

  it('de-duplicates and drops a name that cannot become a public slug', () => {
    expect(
      toStorefrontDepartments([
        { l1: 'Furniture' },
        { l1: ' Furniture ' },
        { l1: '\u5bb6\u5c45' },
      ]),
    ).toEqual([{ id: 'furniture', code: 'FU', name: 'Furniture' }]);
  });

  it('takes the department out of a mirrored row that stored a whole path', () => {
    expect(
      toStorefrontDepartments([
        { l1: "Women's Clothing / Tops & Sets / Sweaters" },
        { l1: "Men's Clothing > Outerwear & Jackets > Men's Jackets" },
      ]),
    ).toEqual([
      { id: 'women-s-clothing', code: 'WC', name: "Women's Clothing" },
      { id: 'men-s-clothing', code: 'MC', name: "Men's Clothing" },
    ]);
  });
});

describe('categoryTopName', () => {
  it('returns the first non-empty segment', () => {
    expect(categoryTopName('Apparel & Accessories > Clothing > Dresses')).toBe(
      'Apparel & Accessories',
    );
    expect(categoryTopName('Furniture')).toBe('Furniture');
  });

  it('also splits the slash-separated paths CJ mirror rows carry', () => {
    expect(
      categoryTopName('Sports & Outdoors / Sportswear / Accessories'),
    ).toBe('Sports & Outdoors');
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

describe('units sold on the card', () => {
  it('omits the key entirely until something has sold', () => {
    const [product] = toStorefrontProductFeed(
      { rows: [row()], total: 1 },
      { section: 'for-you', page: 1, limit: 20 },
    ).products;

    // Absent, not zero. A card cannot render "0 sold" from a key that is not
    // there, and on a young catalogue a wall of zeroes reads as "nobody buys
    // here" - a verdict the absence of sales does not support.
    expect(product).not.toHaveProperty('soldUnits');
  });

  it('carries the count once there is one', () => {
    const [product] = toStorefrontProductFeed(
      { rows: [row({ soldUnits: 142 })], total: 1 },
      { section: 'for-you', page: 1, limit: 20 },
    ).products;

    expect(product?.soldUnits).toBe(142);
  });

  it('treats a zero as nothing to say rather than passing it through', () => {
    const [product] = toStorefrontProductFeed(
      { rows: [row({ soldUnits: 0 })], total: 1 },
      { section: 'for-you', page: 1, limit: 20 },
    ).products;

    expect(product).not.toHaveProperty('soldUnits');
  });
});
