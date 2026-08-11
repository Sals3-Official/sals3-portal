import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import {
  offerSupplierBindings,
  productMediaSources,
  productOffers,
  productOptionValues,
  productOptions,
  productRevisions,
  productVariantOptionValues,
  productVariants,
  products,
  providerProductReferences,
  providerVariantReferences,
} from './product-catalog';

/**
 * The canonical catalog's invariants are database constraints, not
 * application conventions — every one of these would otherwise be a
 * read-then-write race two concurrent Server Actions could both pass.
 *
 * Asserted without a database, the same way `pricing-policy.test.ts` and
 * `supplier-connections.test.ts` already do. The `where` assertions matter as
 * much as the `unique` ones: a partial index silently widened to
 * unconditional rejects legitimate rows, and one silently narrowed stops
 * enforcing the rule it exists for.
 */

type Table = Parameters<typeof getTableConfig>[0];

function indexNamed(table: Table, name: string) {
  return getTableConfig(table).indexes.find(
    (index) => index.config.name === name,
  );
}

function columnNamesOf(table: Table, name: string): string[] {
  return (indexNamed(table, name)?.config.columns ?? []).map((column) =>
    'name' in column && typeof column.name === 'string'
      ? column.name
      : String(column),
  );
}

function checkNames(table: Table): string[] {
  return getTableConfig(table).checks.map((entry) => entry.name);
}

describe('products constraints', () => {
  it('makes a public slug unique only among published products', () => {
    const index = indexNamed(products, 'products_public_slug_key');

    expect(index?.config.unique).toBe(true);
    expect(columnNamesOf(products, 'products_public_slug_key')).toEqual([
      'slug',
    ]);
    // Unconditional here would collide two drafts that share a working title.
    expect(index?.config.where).toBeDefined();
  });

  it('cannot represent a published product without a revision or a slug', () => {
    expect(checkNames(products)).toEqual(
      expect.arrayContaining([
        'products_published_requires_revision',
        'products_published_requires_slug',
      ]),
    );
  });

  it('cannot represent a declared brand with no brand name', () => {
    expect(checkNames(products)).toContain(
      'products_declared_brand_requires_name',
    );
  });

  it('keeps category id and mapping confidence consistent', () => {
    expect(checkNames(products)).toContain(
      'products_category_mapping_consistent',
    );
  });
});

describe('product_revisions constraints', () => {
  it('numbers revisions uniquely per product', () => {
    const index = indexNamed(
      productRevisions,
      'product_revisions_product_number_key',
    );

    expect(index?.config.unique).toBe(true);
    expect(
      columnNamesOf(productRevisions, 'product_revisions_product_number_key'),
    ).toEqual(['product_id', 'revision_number']);
  });

  it('allows at most one open draft per product, so a fork cannot double', () => {
    const index = indexNamed(
      productRevisions,
      'product_revisions_open_draft_key',
    );

    expect(index?.config.unique).toBe(true);
    expect(
      columnNamesOf(productRevisions, 'product_revisions_open_draft_key'),
    ).toEqual(['product_id']);
    expect(index?.config.where).toBeDefined();
  });

  it('cannot represent a settled revision without its frozen snapshot', () => {
    // This is what makes revision immutability real: an APPROVED row with a
    // null snapshot would leave nothing for a later edit to be compared to.
    expect(checkNames(productRevisions)).toContain(
      'product_revisions_frozen_when_settled',
    );
  });

  it('cannot represent an approved revision with no recorded approval mode', () => {
    expect(checkNames(productRevisions)).toContain(
      'product_revisions_approved_records_mode',
    );
  });
});

describe('option and variant constraints', () => {
  it('keeps normalized option names and positions unique per product', () => {
    expect(
      indexNamed(productOptions, 'product_options_product_normalized_name_key')
        ?.config.unique,
    ).toBe(true);
    expect(
      indexNamed(productOptions, 'product_options_product_position_key')?.config
        .unique,
    ).toBe(true);
  });

  it('keeps normalized option values and positions unique per option', () => {
    expect(
      indexNamed(
        productOptionValues,
        'product_option_values_option_normalized_key',
      )?.config.unique,
    ).toBe(true);
    expect(
      indexNamed(
        productOptionValues,
        'product_option_values_option_position_key',
      )?.config.unique,
    ).toBe(true);
  });

  it('forbids one variant carrying the same option twice', () => {
    const index = indexNamed(
      productVariantOptionValues,
      'product_variant_option_values_variant_option_key',
    );

    expect(index?.config.unique).toBe(true);
    expect(
      columnNamesOf(
        productVariantOptionValues,
        'product_variant_option_values_variant_option_key',
      ),
    ).toEqual(['variant_id', 'option_id']);
  });

  it('forbids two active variants sharing one option combination', () => {
    const index = indexNamed(
      productVariants,
      'product_variants_active_combination_key',
    );

    expect(index?.config.unique).toBe(true);
    expect(
      columnNamesOf(productVariants, 'product_variants_active_combination_key'),
    ).toEqual(['product_id', 'option_combination_key']);
    expect(index?.config.where).toBeDefined();
  });

  it('forbids an ACTIVE variant with no resolved option combination', () => {
    // Without this check the partial index above is bypassable: SQL unique
    // indexes ignore NULLs, so unlimited ACTIVE variants could carry a null
    // combination key. It is also what stops a supplier-sourced variant from
    // being stored as ACTIVE before anyone maps its options.
    expect(checkNames(productVariants)).toContain(
      'product_variants_active_requires_combination',
    );
  });

  it('keeps the Sals3 SKU globally unique', () => {
    const index = indexNamed(productVariants, 'product_variants_sals3_sku_key');

    expect(index?.config.unique).toBe(true);
    expect(index?.config.where).toBeUndefined();
  });

  it('bounds GTINs to the Merchant API maximum and rejects negative dimensions', () => {
    expect(checkNames(productVariants)).toEqual(
      expect.arrayContaining([
        'product_variants_gtin_cardinality',
        'product_variants_dimensions_non_negative',
      ]),
    );
  });
});

describe('provider reference constraints', () => {
  it('holds one provider product reference per (provider, external product id)', () => {
    const index = indexNamed(
      providerProductReferences,
      'provider_product_references_provider_external_key',
    );

    expect(index?.config.unique).toBe(true);
    expect(
      columnNamesOf(
        providerProductReferences,
        'provider_product_references_provider_external_key',
      ),
    ).toEqual(['supplier_provider_id', 'external_product_id']);
    // Unconditional: two different CJ pids must never converge onto one
    // canonical product, and one pid must never fork into two.
    expect(index?.config.where).toBeUndefined();
  });

  it('holds one provider variant reference per (product reference, external variant id)', () => {
    const index = indexNamed(
      providerVariantReferences,
      'provider_variant_references_reference_external_key',
    );

    expect(index?.config.unique).toBe(true);
    expect(
      columnNamesOf(
        providerVariantReferences,
        'provider_variant_references_reference_external_key',
      ),
    ).toEqual(['provider_product_reference_id', 'external_variant_id']);
  });

  it('binds each Sals3 variant to at most one provider variant', () => {
    expect(
      indexNamed(
        providerVariantReferences,
        'provider_variant_references_variant_key',
      )?.config.unique,
    ).toBe(true);
  });
});

describe('offer constraints', () => {
  it('holds the exact seller/variant/market/fulfillment tuple unique', () => {
    const index = indexNamed(
      productOffers,
      'product_offers_seller_variant_market_mode_key',
    );

    expect(index?.config.unique).toBe(true);
    expect(
      columnNamesOf(
        productOffers,
        'product_offers_seller_variant_market_mode_key',
      ),
    ).toEqual([
      'seller_account_id',
      'variant_id',
      'market_code',
      'fulfillment_mode',
    ]);
  });

  it('cannot represent a published offer with no price', () => {
    expect(checkNames(productOffers)).toContain(
      'product_offers_published_requires_price',
    );
  });

  it('cannot represent a compare-at price without price-history evidence', () => {
    // The durable version of the fabricated `oldPriceMinor` defect this
    // repository already had to remove from the storefront feed once.
    expect(checkNames(productOffers)).toContain(
      'product_offers_compare_at_requires_evidence',
    );
  });

  it('forces every pricing state to explain itself', () => {
    expect(checkNames(productOffers)).toContain(
      'product_offers_pricing_state_explained',
    );
  });

  it('pairs a price amount with its currency and forbids a negative amount', () => {
    expect(checkNames(productOffers)).toEqual(
      expect.arrayContaining([
        'product_offers_price_paired',
        'product_offers_price_non_negative',
      ]),
    );
  });
});

describe('offer supplier binding constraints', () => {
  it('allows at most one ACTIVE binding per offer', () => {
    const index = indexNamed(
      offerSupplierBindings,
      'offer_supplier_bindings_active_key',
    );

    expect(index?.config.unique).toBe(true);
    expect(
      columnNamesOf(
        offerSupplierBindings,
        'offer_supplier_bindings_active_key',
      ),
    ).toEqual(['offer_id']);
    // Partial, so a retired binding stays as history beside the active one.
    expect(index?.config.where).toBeDefined();
  });

  it('deduplicates a replayed binding on its exact triple', () => {
    const index = indexNamed(
      offerSupplierBindings,
      'offer_supplier_bindings_offer_connection_variant_key',
    );

    expect(index?.config.unique).toBe(true);
    expect(
      columnNamesOf(
        offerSupplierBindings,
        'offer_supplier_bindings_offer_connection_variant_key',
      ),
    ).toEqual([
      'offer_id',
      'supplier_connection_id',
      'provider_variant_reference_id',
    ]);
    // Unconditional: the ACTIVE-only index above would happily allow a stack
    // of duplicate UNVERIFIED rows from a replayed request.
    expect(index?.config.where).toBeUndefined();
  });
});

describe('media provenance constraints', () => {
  it('deduplicates observed media by checksum, only when one exists', () => {
    const index = indexNamed(
      productMediaSources,
      'product_media_sources_product_checksum_key',
    );

    expect(index?.config.unique).toBe(true);
    expect(index?.config.where).toBeDefined();
  });

  it('cannot represent an approved asset with an unknown rights basis', () => {
    expect(checkNames(productMediaSources)).toContain(
      'product_media_sources_approved_requires_rights',
    );
  });
});
