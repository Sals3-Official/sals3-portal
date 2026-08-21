// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { StorefrontDetailRow } from '@/modules/catalog/storefront/read-model';
import {
  LISTING_SNAPSHOT_VERSION,
  listingSnapshotOf,
  listingSnapshotSchema,
} from './listing-snapshot';

const VARIANT_ID = '33333333-3333-4333-8333-333333333333';

function detail(
  overrides: Partial<StorefrontDetailRow> = {},
): StorefrontDetailRow {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    slug: 'mens-casual-retro-corduroy-jacket',
    title: "Men's Casual Retro Corduroy Jacket Coat",
    priceMinor: 725,
    priceCurrency: 'USD',
    availabilityState: 'AVAILABLE',
    categoryCode: 'CAT-GGL-1',
    categoryPath: 'Apparel & Accessories > Clothing > Outerwear',
    primaryImageUrl: 'https://media.example-r2.dev/a.webp',
    publishedAt: '2026-08-18T00:00:00.000Z',
    images: [
      { url: 'https://media.example-r2.dev/a.webp' },
      { url: 'https://media.example-r2.dev/b.webp' },
    ],
    variants: [
      {
        id: VARIANT_ID,
        sku: 'S3V-2268B366F7',
        priceMinor: 725,
        currency: 'USD',
        availability: 'AVAILABLE',
        options: [
          { name: 'Colour', value: 'Army Green' },
          { name: 'Size', value: 'L' },
        ],
        label: 'army green-L',
      },
    ],
    description: {
      blocks: [{ type: 'paragraph', text: 'A corduroy jacket.' }],
    },
    specification: [{ label: 'Material', value: '100% Cotton' }],
    specs: { brand: 'Generic', condition: 'NEW', weightGrams: 700 },
    ...overrides,
  };
}

describe('listingSnapshotOf', () => {
  it('captures a document the read schema accepts', () => {
    const snapshot = listingSnapshotOf(detail(), VARIANT_ID);

    expect(listingSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(snapshot?.version).toBe(LISTING_SNAPSHOT_VERSION);
  });

  /**
   * The whole point. `variant_label` freezes the supplier's own token
   * (`army green-L`); the buyer chose `Colour: Army Green` and `Size: L`, in the
   * order and the words the seller set — and those are exactly what a rename or a
   * reorder changes.
   */
  it('freezes the buyer-facing option axes, not the supplier token', () => {
    const snapshot = listingSnapshotOf(detail(), VARIANT_ID);

    expect(snapshot?.options).toEqual([
      { name: 'Colour', value: 'Army Green' },
      { name: 'Size', value: 'L' },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('army green-L');
  });

  it('freezes the gallery, the description, the specifications and the category', () => {
    const snapshot = listingSnapshotOf(detail(), VARIANT_ID);

    expect(snapshot?.imageUrls).toHaveLength(2);
    expect(snapshot?.description?.blocks).toHaveLength(1);
    expect(snapshot?.specification).toEqual([
      { label: 'Material', value: '100% Cotton' },
    ]);
    expect(snapshot?.categoryPath).toContain('Outerwear');
    expect(snapshot?.specs?.brand).toBe('Generic');
  });

  /**
   * A later seller edit produces a different snapshot for a *new* order and
   * cannot reach an old one — the old one is bytes on a row nobody rewrites.
   */
  it('records the state at capture time, so a later edit is a different document', () => {
    const before = listingSnapshotOf(detail(), VARIANT_ID);
    const after = listingSnapshotOf(
      detail({
        title: 'Completely Different Product',
        images: [{ url: 'https://media.example-r2.dev/z.webp' }],
        variants: [
          {
            id: VARIANT_ID,
            sku: 'S3V-2268B366F7',
            priceMinor: 725,
            currency: 'USD',
            availability: 'AVAILABLE',
            options: [{ name: 'Colour', value: 'Olive' }],
          },
        ],
      }),
      VARIANT_ID,
    );

    expect(before?.title).toBe("Men's Casual Retro Corduroy Jacket Coat");
    expect(after?.title).toBe('Completely Different Product');
    expect(before?.options).not.toEqual(after?.options);
    expect(before?.imageUrls).not.toEqual(after?.imageUrls);
  });

  it('stores empty options for a product with no axes rather than omitting them', () => {
    const snapshot = listingSnapshotOf(detail({ variants: [] }), VARIANT_ID);

    expect(snapshot?.options).toEqual([]);
    expect(listingSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  it('captures nothing for a product that is no longer published', () => {
    expect(listingSnapshotOf(null, VARIANT_ID)).toBeNull();
  });

  it('reads null rather than undefined for absent sections', () => {
    const snapshot = listingSnapshotOf(
      detail({
        description: undefined,
        specification: undefined,
        specs: undefined,
      }),
      VARIANT_ID,
    );

    expect(snapshot?.description).toBeNull();
    expect(snapshot?.specification).toBeNull();
    expect(snapshot?.specs).toBeNull();
    expect(listingSnapshotSchema.safeParse(snapshot).success).toBe(true);
  });

  /** Supplier identifiers have no business in a record a buyer reads. */
  it('carries no supplier identity', () => {
    const serialised = JSON.stringify(listingSnapshotOf(detail(), VARIANT_ID));

    expect(serialised).not.toMatch(/connection/iu);
    expect(serialised).not.toMatch(/external/iu);
    expect(serialised).not.toMatch(/\bcj\b/iu);
  });
});

describe('listingSnapshotSchema', () => {
  it('refuses a document with no version', () => {
    const { version, ...rest } = listingSnapshotOf(
      detail(),
      VARIANT_ID,
    ) as Record<string, unknown>;

    expect(version).toBeDefined();
    expect(listingSnapshotSchema.safeParse(rest).success).toBe(false);
  });

  it('refuses a description block the document format does not allow', () => {
    expect(
      listingSnapshotSchema.safeParse({
        ...listingSnapshotOf(detail(), VARIANT_ID),
        description: { blocks: [{ type: 'html', text: '<script>' }] },
      }).success,
    ).toBe(false);
  });
});
