import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { StorefrontDetailRow } from '@/modules/catalog/storefront/read-model';
import { toStorefrontProductDetail } from './catalog-feed';

/**
 * The producer half of the cross-repository drift guard.
 *
 * `test/fixtures/storefront-product-detail.json` is committed **identically** in
 * this repository and in `sals3-ecommerce`, which parses it with its own Zod
 * schema. This test asserts that this repository's serializer actually produces
 * it. So a contract change that lands on only one side fails a test in whichever
 * repository moved — which matters more here than in most contracts, because
 * every field added on 2026-08-13 is optional, so real drift would otherwise
 * show up as a silently missing section on a product page rather than as an
 * error.
 *
 * Keep the two files byte-identical. If this test fails, the question is which
 * side is right, not which file to edit.
 */

const FIXTURE_PATH = 'test/fixtures/storefront-product-detail.json';

/**
 * The read-model row that must serialize to the fixture. Written out in full
 * rather than derived from it, so a change to the mapper cannot be "fixed" by
 * editing one file and calling it agreement.
 */
const ROW: StorefrontDetailRow = {
  id: '90a329b9-56aa-4f54-abb2-ad843602aa73',
  slug: 'mens-short-style-cold-weather-waterproof-shell-jacket',
  title: 'Mens Short-Style Cold-Weather Waterproof Shell Jacket',
  priceMinor: 4299,
  priceCurrency: 'USD',
  availabilityState: 'AVAILABLE',
  categoryCode: 'CAT-APP-100412',
  categoryPath: "Apparel > Outerwear > Men's Jackets",
  primaryImageUrl: 'https://cf.cjdropshipping.com/quick/product/a.jpg',
  publishedAt: '2026-08-13T01:02:03.000Z',
  images: [
    { url: 'https://cf.cjdropshipping.com/quick/product/a.jpg' },
    { url: 'https://oss-cf.cjdropshipping.com/quick/product/b.jpg' },
  ],
  description: {
    blocks: [
      { type: 'heading', level: 2, text: 'Built for cold mornings' },
      {
        type: 'paragraph',
        text: 'A short-cut shell jacket with a fleece lining.',
      },
      {
        type: 'bulletList',
        items: ['Water-resistant outer shell', 'Fleece-lined body'],
      },
      {
        type: 'keyValueList',
        entries: [
          { label: 'Material', value: 'Polyester shell, fleece lining' },
          { label: 'Care', value: 'Machine wash cold' },
        ],
      },
      {
        type: 'image',
        url: 'https://pub-5bd4708f2c2e4597ab8bd6234faae447.r2.dev/description-media/90a329b9-56aa-4f54-abb2-ad843602aa73/size-chart.webp',
        alt: 'Size chart for the shell jacket',
        caption: 'Measurements taken flat, in centimetres',
      },
    ],
  },
  variants: [
    {
      id: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0',
      sku: 'SALS3-JKT-BLK-XL',
      priceMinor: 4299,
      currency: 'USD',
      availability: 'AVAILABLE',
      options: [
        { name: 'Colour', value: 'Black' },
        { name: 'Size', value: 'XL' },
      ],
      label: 'Black-XL',
      // Present on one variant and absent on the other, so the fixture pins
      // both halves of an optional field: a consumer that assumes it is always
      // there fails against Navy.
      imageUrl: 'https://media.example.com/seller-media/p/black.webp',
    },
    {
      id: '1a2b3c4d-5e6f-7089-9807-f6e5d4c3b2a1',
      sku: 'SALS3-JKT-NVY-XL',
      priceMinor: 4499,
      currency: 'USD',
      availability: 'UNKNOWN',
      options: [
        { name: 'Colour', value: 'Navy' },
        { name: 'Size', value: 'XL' },
      ],
      label: 'Navy-XL',
    },
  ],
  specs: {
    sku: 'SALS3-JKT-BLK-XL',
    weightGrams: 880,
    lengthMillimeters: 300,
    widthMillimeters: 250,
    heightMillimeters: 80,
    gtins: ['09501101530003'],
    mpn: 'CJYD2718032',
    brand: 'Sals3 Basics',
    condition: 'NEW',
  },
  specification: [
    { label: 'Material', value: 'Polyester shell, fleece lining' },
    { label: 'Season', value: 'Autumn, Winter' },
    { label: 'Country of Origin', value: 'China' },
  ],
  metaDescription:
    'A short-cut waterproof shell jacket with a fleece lining, in black and navy.',
};

describe('the committed contract fixture', () => {
  it('is exactly what the serializer produces for the documented row', () => {
    const fixture = JSON.parse(
      readFileSync(join(process.cwd(), FIXTURE_PATH), 'utf8'),
    );
    const product = toStorefrontProductDetail(ROW);

    // Through `JSON.parse(JSON.stringify(...))` on purpose: what the consumer
    // receives is the serialized form, so an `undefined` that never reaches the
    // wire must not count as a difference either way.
    expect(JSON.parse(JSON.stringify({ product }))).toEqual(fixture);
  });
});
