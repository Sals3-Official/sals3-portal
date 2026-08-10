import type { CatalogueFilters } from '@/components/products/catalogue/CatalogueFilterBar';
import {
  deriveProductAvailability,
  worstAttentionSeverity,
  worstEvidenceFreshness,
} from './derive';
import type {
  Availability,
  CatalogueProductFixture,
  ListingStatus,
} from './types';

/**
 * Pure filter/sort/count logic, kept out of the client component so it can
 * be unit-tested directly rather than only through rendered DOM assertions
 * - the same split `product-editor/derive.ts` uses.
 */

export function countByStatus(
  products: CatalogueProductFixture[],
): Record<ListingStatus | 'ALL', number> {
  const counts = {
    ALL: products.length,
    DRAFT: 0,
    LIVE: 0,
    LIVE_NEEDS_ATTENTION: 0,
    AUTO_PAUSED: 0,
    ARCHIVED: 0,
  } as Record<ListingStatus | 'ALL', number>;

  products.forEach((product) => {
    counts[product.status] += 1;
  });

  return counts;
}

function productAvailability(product: CatalogueProductFixture): Availability {
  return deriveProductAvailability(product.variants, product.availability);
}

function matchesSearch(
  product: CatalogueProductFixture,
  field: CatalogueFilters['searchField'],
  term: string,
): boolean {
  const needle = term.trim().toLowerCase();

  if (needle === '') return true;

  if (field === 'NAME') return product.name.toLowerCase().includes(needle);

  if (field === 'SALS3_PRODUCT_ID') {
    return (
      product.sals3ProductId.toLowerCase().includes(needle) ||
      product.variants.some((variant) =>
        variant.sals3VariantId.toLowerCase().includes(needle),
      )
    );
  }

  if (field === 'SELLER_SKU') {
    return product.variants.some((variant) =>
      variant.sellerSku.toLowerCase().includes(needle),
    );
  }

  return (
    product.cjProductId.toLowerCase().includes(needle) ||
    product.variants.some((variant) =>
      variant.cjVariantId.toLowerCase().includes(needle),
    )
  );
}

export function filterAndSortProducts(
  products: CatalogueProductFixture[],
  activeTab: ListingStatus | 'ALL',
  filters: CatalogueFilters,
): CatalogueProductFixture[] {
  const filtered = products.filter((product) => {
    if (activeTab !== 'ALL' && product.status !== activeTab) return false;
    if (!matchesSearch(product, filters.searchField, filters.searchTerm)) {
      return false;
    }
    if (
      filters.category !== null &&
      product.categoryPath !== filters.category
    ) {
      return false;
    }
    if (
      filters.supplierProviderCode !== null &&
      product.supplierProviderCode !== filters.supplierProviderCode
    ) {
      return false;
    }
    if (
      filters.mediaStatus !== null &&
      product.mediaStatus !== filters.mediaStatus
    ) {
      return false;
    }

    const availability = productAvailability(product);

    if (
      filters.availability !== null &&
      availability !== filters.availability
    ) {
      return false;
    }
    if (filters.outOfStockOnly && availability !== 'OUT_OF_STOCK') return false;
    if (filters.needsAttentionOnly && product.attentionReasons.length === 0) {
      return false;
    }
    if (
      filters.evidenceFreshness !== null &&
      worstEvidenceFreshness(product.variants, product.evidenceFreshness) !==
        filters.evidenceFreshness
    ) {
      return false;
    }

    return true;
  });

  const sorted = [...filtered];
  const severityRank: Record<string, number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };

  switch (filters.sort) {
    case 'PRICE_ASC':
      sorted.sort(
        (a, b) => a.sellingPrice.amountMinor - b.sellingPrice.amountMinor,
      );
      break;
    case 'PRICE_DESC':
      sorted.sort(
        (a, b) => b.sellingPrice.amountMinor - a.sellingPrice.amountMinor,
      );
      break;
    case 'ATTENTION_SEVERITY_DESC':
      sorted.sort((a, b) => {
        const aSeverity = worstAttentionSeverity(a.attentionReasons);
        const bSeverity = worstAttentionSeverity(b.attentionReasons);
        const aRank = aSeverity === null ? 99 : severityRank[aSeverity];
        const bRank = bSeverity === null ? 99 : severityRank[bSeverity];

        return aRank - bRank;
      });
      break;
    case 'CREATED_DESC':
    default:
      sorted.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
  }

  return sorted;
}

export function uniqueCategories(
  products: CatalogueProductFixture[],
): string[] {
  return [...new Set(products.map((product) => product.categoryPath))].sort();
}

export function uniqueSupplierProviders(
  products: CatalogueProductFixture[],
): Array<{ code: string; name: string }> {
  const byCode = new Map<string, string>();

  products.forEach((product) => {
    byCode.set(product.supplierProviderCode, product.supplierProviderName);
  });

  return [...byCode.entries()]
    .map(([code, name]) => ({ code, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function countOutOfStock(products: CatalogueProductFixture[]): number {
  return products.filter(
    (product) => productAvailability(product) === 'OUT_OF_STOCK',
  ).length;
}

export function countNeedsAttention(
  products: CatalogueProductFixture[],
): number {
  return products.filter((product) => product.attentionReasons.length > 0)
    .length;
}
