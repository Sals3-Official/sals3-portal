import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  SUPPLIER_CONNECTIONS_PROVIDER_EXTERNAL_HASH_KEY,
  SUPPLIER_CONNECTIONS_SELLER_PROVIDER_KEY,
  supplierConnections,
} from './supplier-connections';

/**
 * "One seller account, one supplier configuration" and "one provider
 * account, one live connection" are database constraints, not conventions.
 * This asserts they are still declared as such, without needing a database.
 *
 * The `where === undefined` assertion is the point of the file: a partial
 * index (say, excluding DISCONNECTED rows) is the obvious-looking way to
 * make reconnect more forgiving, and it would silently unpick the rule.
 */
function indexNamed(name: string) {
  return getTableConfig(supplierConnections).indexes.find(
    (index) => index.config.name === name,
  );
}

function columnNamesOf(name: string): string[] {
  return (indexNamed(name)?.config.columns ?? []).map((column) =>
    'name' in column && typeof column.name === 'string'
      ? column.name
      : String(column),
  );
}

describe('supplier_connections constraints', () => {
  it('holds one connection per seller per provider', () => {
    const index = indexNamed(SUPPLIER_CONNECTIONS_SELLER_PROVIDER_KEY);

    expect(index).toBeDefined();
    expect(index?.config.unique).toBe(true);
    expect(columnNamesOf(SUPPLIER_CONNECTIONS_SELLER_PROVIDER_KEY)).toEqual([
      'seller_account_id',
      'provider_id',
    ]);
  });

  it('holds one live connection per provider account', () => {
    const index = indexNamed(SUPPLIER_CONNECTIONS_PROVIDER_EXTERNAL_HASH_KEY);

    expect(index).toBeDefined();
    expect(index?.config.unique).toBe(true);
    expect(
      columnNamesOf(SUPPLIER_CONNECTIONS_PROVIDER_EXTERNAL_HASH_KEY),
    ).toEqual(['provider_id', 'external_account_lookup_hash']);
  });

  it('keeps the provider-account index unconditional', () => {
    expect(
      indexNamed(SUPPLIER_CONNECTIONS_PROVIDER_EXTERNAL_HASH_KEY)?.config.where,
    ).toBeUndefined();
  });
});
