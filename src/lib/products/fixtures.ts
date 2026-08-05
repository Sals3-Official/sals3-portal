import { REJECTION_REASON, SEED_TUPLES, type SeedTuple } from './fixture-seed';
import type { Product, ProductReview, ProductVariant } from './types';

/**
 * Development catalogue fixture.
 *
 * No catalogue service, database, or product photography exists yet (build
 * spec stage 3). These rows exist so the portal screens can be built and
 * reviewed. They never reach a crawler or an AI answer surface: the portal
 * sets `robots: noindex` and publishes no structured data.
 */

function skuBase(slug: string): string {
  return slug
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '-')
    .slice(0, 20);
}

function buildVariants(
  slug: string,
  optionName: string,
  optionValues: readonly string[],
  stock: readonly number[],
  priceMinor: number,
): ProductVariant[] {
  return optionValues.map((value, index) => ({
    id: `${slug}-v${index + 1}`,
    options: { [optionName]: value },
    sku: `${skuBase(slug)}-${index + 1}`,
    priceMinor,
    stock: stock[index] ?? 0,
  }));
}

function buildReviews(slug: string, show: boolean): ProductReview[] {
  if (!show) {
    return [];
  }

  return [
    {
      id: `${slug}-r1`,
      author: 'Maria S.',
      rating: 5,
      body: 'It works well and it arrived early. I am happy with it.',
      createdAt: '2026-07-26',
      reply: null,
      reported: false,
    },
    {
      id: `${slug}-r2`,
      author: 'Ken D.',
      rating: 3,
      body: 'The item is good but the box was damaged.',
      createdAt: '2026-07-30',
      reply: 'Thank you. We will pack the item better next time.',
      reported: false,
    },
  ];
}

function buildProduct(row: SeedTuple, index: number): Product {
  const [
    slug,
    name,
    category,
    brand,
    status,
    regularMinor,
    saleMinor,
    costMinor,
    stock,
    optionName,
    optionValues,
    tone,
    updatedAt,
    views,
    addToCart,
    unitsSold,
  ] = row;
  const priceMinor = saleMinor ?? regularMinor;

  return {
    id: slug,
    sellerId: 'seller-001',
    tone,
    name,
    description: `${name} from ${brand}. This text is fixture copy for portal development. Replace it with real seller copy when the catalogue service is ready.`,
    category,
    brand,
    media: [],
    variants: buildVariants(slug, optionName, optionValues, stock, priceMinor),
    pricing: {
      regularMinor,
      saleMinor,
      costMinor,
      discountStartsAt: saleMinor === null ? null : '2026-08-01',
      discountEndsAt: saleMinor === null ? null : '2026-08-31',
    },
    identifiers: {
      sku: skuBase(slug),
      upc: null,
      ean: null,
      barcode: `SALS3-${String(index + 1).padStart(5, '0')}`,
    },
    shipping: {
      weightGrams: 400 + index * 130,
      lengthMm: 220,
      widthMm: 160,
      heightMm: 90,
      shippingClass: 'standard',
      restrictedRegions: [],
    },
    visibility: {
      published: status === 'published',
      channels: ['web'],
      availableFrom: null,
      availableUntil: null,
    },
    seo: {
      pageTitle: name,
      metaDescription: `Buy ${name.toLowerCase()} on Sals3. Fixture description for portal development.`,
      slug,
    },
    status,
    rejectionReason: status === 'rejected' ? REJECTION_REASON : null,
    createdAt: '2026-07-15',
    updatedAt,
    createdBy: 'Development user',
    updatedBy: 'Development user',
    analytics: {
      views,
      addToCart,
      unitsSold,
      revenueMinor: unitsSold * priceMinor,
    },
    reviews: buildReviews(slug, status === 'published' && unitsSold > 0),
    auditTrail: [
      {
        id: `${slug}-a1`,
        actor: 'Development user',
        field: 'Product',
        from: '—',
        to: 'Created',
        at: '2026-07-15',
      },
      {
        id: `${slug}-a2`,
        actor: 'Development user',
        field: 'Status',
        from: 'draft',
        to: status,
        at: updatedAt,
      },
    ],
  };
}

export default function buildFixtureCatalogue(): Product[] {
  return SEED_TUPLES.map(buildProduct);
}
