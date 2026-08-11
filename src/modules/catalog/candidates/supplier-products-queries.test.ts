// @vitest-environment node
//
// This module imports `@/lib/db/client`, which throws when `window` is
// defined (a load-bearing guard against bundling the DB client into client
// code), so it needs the plain Node environment rather than jsdom.
import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  MIN_SEARCH_LENGTH,
  normalizeSearchTerm,
  supplierProductsSearchCondition,
} from './supplier-products-queries';

/**
 * The All Supplier Products read model must answer every browse, search,
 * filter, and page action from PostgreSQL. `PgDialect.sqlToQuery` is the
 * real renderer Drizzle uses before handing a query to `postgres.js` and
 * needs no live connection, so it can prove the generated SQL text and its
 * bind parameters without a database.
 */
const dialect = new PgDialect();

function render(sql: SQL | undefined): { sql: string; params: unknown[] } {
  if (sql === undefined) {
    throw new Error('Expected a defined SQL condition, got undefined.');
  }

  return dialect.sqlToQuery(sql);
}

describe('normalizeSearchTerm', () => {
  it('treats fewer than two meaningful characters as no search at all', () => {
    expect(MIN_SEARCH_LENGTH).toBe(2);
    expect(normalizeSearchTerm('a')).toBe('');
    expect(normalizeSearchTerm(' a ')).toBe('');
    expect(normalizeSearchTerm('   ')).toBe('');
    expect(normalizeSearchTerm(undefined)).toBe('');
    expect(normalizeSearchTerm(null)).toBe('');
  });

  it('whitespace-normalizes a term before it is committed', () => {
    expect(normalizeSearchTerm('  ceramic   mug  ')).toBe('ceramic mug');
  });

  it('accepts exactly two meaningful characters', () => {
    expect(normalizeSearchTerm('mu')).toBe('mu');
  });
});

describe('supplierProductsSearchCondition', () => {
  it('produces no condition below the minimum, leaving the scoped set intact', () => {
    expect(supplierProductsSearchCondition('a')).toBeUndefined();
    expect(supplierProductsSearchCondition('')).toBeUndefined();
  });

  it('always sends the term as a bind parameter, never concatenated SQL', () => {
    const { sql, params } = render(
      supplierProductsSearchCondition(
        "mug'; drop table supplier_candidates;--",
      ),
    );

    expect(sql).not.toContain('drop table');
    expect(params).toContain("%mug'; drop table supplier\\_candidates;--%");
  });

  it('escapes LIKE wildcards so a typed % or _ means the literal character', () => {
    const { params } = render(supplierProductsSearchCondition('50%_off'));

    expect(params).toEqual(['%50\\%\\_off%', '%50\\%\\_off%', '%50\\%\\_off%']);
  });

  it('searches the CJ product id, the persisted name, and the persisted SKU', () => {
    const { sql } = render(supplierProductsSearchCondition('mug'));

    expect(sql).toContain('external_product_id');
    expect(sql).toContain(`"feed_snapshot"->>'name'`);
    expect(sql).toContain(`"feed_snapshot"->>'sku'`);
    // Case-insensitive, so a seller does not have to match capitalisation.
    expect(sql.toLowerCase()).toContain('ilike');
  });
});
