import { resolve } from 'path';
import { createHash } from 'crypto';
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
 * it. That matters more here than in most contracts, because every field added
 * on 2026-08-13 is optional, so real drift shows up as a silently missing
 * section on a product page rather than as an error.
 *
 * ## What this pair does *not* do, corrected 2026-08-31
 *
 * This note used to claim that "a contract change that lands on only one side
 * fails a test in whichever repository moved". **It does not, and it did not.**
 * This test compares this repository's copy against this repository's serializer;
 * the sibling compares its copy against its own schema. Both pass while the two
 * copies describe *different documents*, and for eight days they did — the
 * sibling's carried the paragraph `runs` field and this one did not, so the pair
 * was asserting agreement that was not there.
 *
 * The two are byte-identical again, and `FIXTURE_SHA256` below makes each copy
 * tamper-evident. That is genuinely weaker than the old claim: nothing here can
 * read the sibling repository, so **a fixture change is a two-repository change
 * and both hashes move in the same pair of commits.** The hash turns a silent
 * divergence into a failing test on the side that moved and a literal a reviewer
 * can compare in seconds.
 *
 * If this test fails, the question is which side is right, not which file to edit.
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
        /*
          The emphasis a seller applied, as marks rather than markup. It belongs
          in this row because `sals3-ecommerce`'s own contract test asserts the
          fixture carries it — "a fixture that carried it while the schema
          dropped it would read as shipped when nothing reached the page" — and
          for eight days this row did not, so the two committed copies described
          different documents while each repo's test only ever compared its own.
        */
        runs: [
          { text: 'A short-cut shell jacket' },
          { text: ' with a fleece lining.', marks: ['strong' as const] },
        ],
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
      /*
        A size chart, which is the content this block type exists for. The last
        row leaves one cell blank on purpose: blank is the one thing a table
        cell may be that no other text position in this document may, and a
        guard that only ever carried filled cells would go green while a
        consumer's `.min(1)` quietly dropped the whole chart.
      */
      {
        type: 'table',
        caption: 'Body measurements in centimetres. Allow 1–2 cm variance.',
        headers: ['Size', 'Waist', 'Hips', 'Length'],
        rows: [
          ['M', '65', '100', '103'],
          ['L', '69', '104', '104'],
          ['XL', '73', '108', ''],
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

/**
 * The fingerprint of the committed fixture, asserted **identically in
 * `sals3-ecommerce`**.
 *
 * ## Why a hash, and what it does and does not catch
 *
 * The two copies are documented as committed identically and drifted anyway: this
 * one gained the paragraph `runs` field and the other did not, for eight days,
 * because each repository's test only ever compared its own copy against its own
 * side of the contract. Neither could see the other.
 *
 * A hash cannot fix that on its own — nothing here can read the sibling
 * repository. What it does is make each copy **tamper-evident**: editing the
 * fixture without updating this literal fails immediately, and the literal is
 * then visibly different from the sibling's, which is a two-second check in
 * review instead of a diff nobody runs.
 *
 * So changing the fixture is a **two-repository change, and both hashes move in
 * the same pair of commits**. If you are reading this because the assertion
 * failed and you only meant to edit one side, that is the answer.
 */
const FIXTURE_SHA256 =
  '0851988670867f807ec93b3fafd28fd3483ea9136d6b69c002f64f11db0443b4';

describe('the committed fixture is the same bytes in both repositories', () => {
  it('has the fingerprint sals3-ecommerce asserts too', () => {
    const bytes = readFileSync(resolve(process.cwd(), FIXTURE_PATH));

    expect(createHash('sha256').update(bytes).digest('hex')).toBe(
      FIXTURE_SHA256,
    );
  });
});
