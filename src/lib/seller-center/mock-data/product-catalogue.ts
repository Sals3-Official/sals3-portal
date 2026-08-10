import type {
  CatalogueProductFixture,
  CatalogueVariantFixture,
} from '@/lib/seller-center/product-catalogue/types';
import type { MoneyValue } from '@/lib/seller-center/product-editor/types';

/**
 * Fictional catalogue-list fixtures for the Product Catalogue design
 * preview. See `product-catalogue/types.ts` for why every field here -
 * units sold, wishlist, views, rating, content score, A/B test tag, QC/
 * Violation status, soft delete - is invented rather than read from a
 * database: none of those concepts exist anywhere else in this repo.
 *
 * `editorFixtureKey` links each fictional row to one of the 8 *real*
 * fixtures already built for the Product Editor
 * (`product-editor/mock-data.ts`'s `PRODUCT_EDITOR_FIXTURE_KEYS`), so
 * "Edit" opens the same screen this repo already has rather than a second,
 * parallel one.
 */

const CURRENCY = 'USD';

function usd(amountMinor: number): MoneyValue {
  return { amountMinor, currency: CURRENCY };
}

function variant(
  seed: Omit<CatalogueVariantFixture, 'price' | 'compareAtPrice'> & {
    priceMinor: number;
    compareAtPriceMinor?: number;
  },
): CatalogueVariantFixture {
  return {
    id: seed.id,
    specsLabel: seed.specsLabel,
    sellerSku: seed.sellerSku,
    hasImage: seed.hasImage,
    stock: seed.stock,
    active: seed.active,
    price: usd(seed.priceMinor),
    compareAtPrice:
      seed.compareAtPriceMinor === undefined
        ? null
        : usd(seed.compareAtPriceMinor),
  };
}

const CARGO_SHORTS_VARIANTS: CatalogueVariantFixture[] = [
  variant({
    id: 'cs-green-s',
    specsLabel: 'Color: Green, Size: Small 27-31',
    sellerSku: '15560634326-1784664853912-0',
    hasImage: true,
    priceMinor: 599,
    compareAtPriceMinor: 1198,
    stock: 15,
    active: true,
  }),
  variant({
    id: 'cs-green-m',
    specsLabel: 'Color: Green, Size: Medium 31-35',
    sellerSku: '15560634326-1784664853915-1',
    hasImage: true,
    priceMinor: 599,
    compareAtPriceMinor: 1198,
    stock: 15,
    active: true,
  }),
  variant({
    id: 'cs-green-l',
    specsLabel: 'Color: Green, Size: Large 35-39',
    sellerSku: '15560634326-1784664853915-2',
    hasImage: true,
    priceMinor: 599,
    compareAtPriceMinor: 1198,
    stock: 15,
    active: true,
  }),
];

const DAYPACK_VARIANTS: CatalogueVariantFixture[] = [
  variant({
    id: 'dp-slate-20',
    specsLabel: 'Color: Slate, Capacity: 20L',
    sellerSku: 'S3-AUR-DP-SLT20',
    hasImage: true,
    priceMinor: 2490,
    stock: 412,
    active: true,
  }),
  variant({
    id: 'dp-clay-20',
    specsLabel: 'Color: Clay, Capacity: 20L',
    sellerSku: 'S3-AUR-DP-CLAY20',
    hasImage: true,
    priceMinor: 2490,
    stock: 0,
    active: false,
  }),
];

function noVariants(): CatalogueVariantFixture[] {
  return [];
}

const BASE_FIELDS = {
  hasImage: true,
  wishlistCount30d: 0,
  pageViews30d: 0,
  ratingAverage: null as number | null,
  ratingCount: 0,
  abTestTag: null as string | null,
};

const CATALOGUE_FIXTURES: CatalogueProductFixture[] = [
  {
    ...BASE_FIELDS,
    id: 'prod-cargo-shorts',
    externalProductId: '15560634326',
    name: 'Men Cargo Shorts 6 Pockets (Blue Camou)',
    status: 'ACTIVE',
    categoryPath: 'Men / Bottoms / Shorts',
    createdAt: '2026-08-03T02:27:00.000Z',
    unitsSold30d: 214,
    wishlistCount30d: 38,
    pageViews30d: 1236,
    ratingAverage: 4.7,
    ratingCount: 52,
    contentScore: 'TOP',
    price: usd(599),
    compareAtPrice: null,
    totalStock: 45,
    active: true,
    editorFixtureKey: 'pass',
    variants: CARGO_SHORTS_VARIANTS,
  },
  {
    ...BASE_FIELDS,
    id: 'prod-daypack',
    externalProductId: 'CJPD2291845007',
    name: 'Aurelis 20L Packable Daypack',
    status: 'ACTIVE',
    categoryPath: 'Bags & Travel / Backpacks / Daypacks',
    createdAt: '2026-08-01T09:00:00.000Z',
    unitsSold30d: 96,
    wishlistCount30d: 21,
    pageViews30d: 804,
    ratingAverage: 4.2,
    ratingCount: 19,
    contentScore: 'GOOD',
    abTestTag: 'Cover image test B',
    price: usd(2490),
    compareAtPrice: null,
    totalStock: 412,
    active: true,
    editorFixtureKey: 'attention',
    variants: DAYPACK_VARIANTS,
  },
  {
    ...BASE_FIELDS,
    id: 'prod-tote-bag',
    externalProductId: '17309210153073',
    name: 'Canvas Tote Bag with Inner Pocket',
    status: 'ACTIVE',
    categoryPath: 'Bags & Travel / Totes',
    createdAt: '2026-07-28T14:10:00.000Z',
    unitsSold30d: 0,
    ratingAverage: null,
    contentScore: 'NEEDS_IMPROVEMENT',
    price: usd(449),
    compareAtPrice: usd(699),
    totalStock: 132,
    active: true,
    editorFixtureKey: 'price-spike',
    variants: noVariants(),
  },
  {
    ...BASE_FIELDS,
    id: 'prod-water-bottle',
    externalProductId: '17309882010001',
    name: 'Insulated Steel Water Bottle 750ml',
    status: 'INACTIVE',
    categoryPath: 'Sports & Outdoors / Drinkware',
    createdAt: '2026-07-15T11:40:00.000Z',
    unitsSold30d: 12,
    ratingAverage: 3.9,
    ratingCount: 7,
    contentScore: 'GOOD',
    price: usd(799),
    compareAtPrice: null,
    totalStock: 0,
    active: false,
    editorFixtureKey: 'mixed-stock',
    variants: noVariants(),
  },
  {
    ...BASE_FIELDS,
    id: 'prod-desk-lamp',
    externalProductId: '17309882010088',
    name: 'Foldable LED Desk Lamp',
    status: 'INACTIVE',
    categoryPath: 'Home & Living / Lighting',
    createdAt: '2026-07-10T08:20:00.000Z',
    unitsSold30d: 3,
    ratingAverage: null,
    contentScore: 'NEEDS_IMPROVEMENT',
    price: usd(1299),
    compareAtPrice: null,
    totalStock: 18,
    active: false,
    editorFixtureKey: 'stale-evidence',
    variants: noVariants(),
  },
  {
    ...BASE_FIELDS,
    id: 'prod-draft-hoodie',
    externalProductId: '17309882010200',
    name: 'Quilted Zip-Up Hoodie (draft)',
    status: 'DRAFT',
    categoryPath: 'Men / Outerwear',
    createdAt: '2026-08-09T05:00:00.000Z',
    unitsSold30d: 0,
    ratingAverage: null,
    contentScore: 'NEEDS_IMPROVEMENT',
    price: usd(1590),
    compareAtPrice: null,
    totalStock: 0,
    active: false,
    editorFixtureKey: 'pass',
    variants: noVariants(),
  },
  {
    ...BASE_FIELDS,
    id: 'prod-draft-cap',
    externalProductId: '17309882010211',
    name: 'Corduroy Six-Panel Cap (draft)',
    status: 'DRAFT',
    categoryPath: 'Accessories / Hats',
    createdAt: '2026-08-09T05:20:00.000Z',
    unitsSold30d: 0,
    ratingAverage: null,
    contentScore: 'NEEDS_IMPROVEMENT',
    price: usd(499),
    compareAtPrice: null,
    totalStock: 0,
    active: false,
    editorFixtureKey: 'pass',
    variants: noVariants(),
  },
  {
    ...BASE_FIELDS,
    id: 'prod-pending-sandals',
    externalProductId: '17309882010333',
    name: 'Slip-On Sport Sandals',
    status: 'PENDING_QC',
    categoryPath: 'Men / Footwear / Sandals',
    createdAt: '2026-08-08T16:45:00.000Z',
    unitsSold30d: 0,
    ratingAverage: null,
    contentScore: 'GOOD',
    price: usd(699),
    compareAtPrice: null,
    totalStock: 60,
    active: false,
    editorFixtureKey: 'market-route',
    variants: noVariants(),
  },
  {
    ...BASE_FIELDS,
    id: 'prod-pending-tumbler',
    externalProductId: '17309882010344',
    name: 'Frosted Acrylic Tumbler 500ml',
    status: 'PENDING_QC',
    categoryPath: 'Home & Living / Drinkware',
    createdAt: '2026-08-08T17:05:00.000Z',
    unitsSold30d: 0,
    ratingAverage: null,
    contentScore: 'GOOD',
    price: usd(349),
    compareAtPrice: null,
    totalStock: 84,
    active: false,
    editorFixtureKey: 'market-route',
    variants: noVariants(),
  },
  {
    ...BASE_FIELDS,
    id: 'prod-violation-shirt',
    externalProductId: '17309882010500',
    name: 'Graphic Print Tee ("N-Tech" logo)',
    status: 'VIOLATION',
    categoryPath: 'Men / Tops',
    createdAt: '2026-07-30T12:00:00.000Z',
    unitsSold30d: 4,
    wishlistCount30d: 2,
    pageViews30d: 40,
    ratingAverage: null,
    contentScore: 'NEEDS_IMPROVEMENT',
    price: usd(549),
    compareAtPrice: null,
    totalStock: 25,
    active: false,
    editorFixtureKey: 'blocked',
    variants: noVariants(),
  },
  {
    ...BASE_FIELDS,
    id: 'prod-violation-charger',
    externalProductId: '17309882010511',
    name: 'Fast-Charge USB-C Adapter',
    status: 'VIOLATION',
    categoryPath: 'Electronics / Chargers',
    createdAt: '2026-07-29T09:30:00.000Z',
    unitsSold30d: 1,
    ratingAverage: null,
    contentScore: 'NEEDS_IMPROVEMENT',
    price: usd(899),
    compareAtPrice: null,
    totalStock: 10,
    active: false,
    editorFixtureKey: 'blocked',
    variants: noVariants(),
  },
  {
    ...BASE_FIELDS,
    id: 'prod-deleted-scarf',
    externalProductId: '17309882010600',
    name: 'Knit Infinity Scarf (removed)',
    status: 'DELETED',
    categoryPath: 'Accessories / Scarves',
    createdAt: '2026-06-20T10:00:00.000Z',
    unitsSold30d: 0,
    ratingAverage: 4.0,
    ratingCount: 3,
    contentScore: 'GOOD',
    price: usd(399),
    compareAtPrice: null,
    totalStock: 0,
    active: false,
    editorFixtureKey: 'delisted',
    variants: noVariants(),
  },
];

/** Every fixture's id, for tests that need to assert on a known row. */
export const CATALOGUE_FIXTURE_IDS = CATALOGUE_FIXTURES.map(
  (product) => product.id,
);

export function listCatalogueFixtures(): CatalogueProductFixture[] {
  return CATALOGUE_FIXTURES;
}
