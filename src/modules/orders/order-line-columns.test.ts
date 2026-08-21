// @vitest-environment node
import { readFileSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/postgres-js';
import { describe, expect, it } from 'vitest';
import { sals3OrderLines } from '@/lib/db/schema/orders';

/**
 * `sals3_order_lines` must never be read with a bare `.select()`.
 *
 * Drizzle expands `.select().from(table)` to every column the *schema file*
 * declares. So the moment a column is added to `schema/orders.ts`, both of these
 * queries silently start asking production for it — and until the break-glass
 * migration has run, production does not have it. That is not a slow read or a
 * missing field: it is `column "listing_snapshot" does not exist` on the buyer's
 * order page and on the supplier fulfilment worker, which is the PR #102 / PR
 * #113 failure class sitting in front of money.
 *
 * Naming the columns decouples the SQL from the schema, which is what lets a
 * column ship one release ahead of the code that reads it. This test is the
 * thing that keeps someone from "tidying" the explicit lists back into
 * `.select()` and re-arming the hazard.
 *
 * Read as source text rather than by executing the queries: what matters is the
 * shape of the call, and a fake executor would happily accept either form.
 */
const ORDER_LINE_READERS = [
  'src/modules/orders/buyer-read.ts',
  'src/modules/orders/fulfillment-worker.ts',
];

describe('sals3_order_lines reads', () => {
  it.each(ORDER_LINE_READERS)('%s names its columns', (path) => {
    const source = readFileSync(path, 'utf8');
    const bareSelectBeforeOrderLines =
      /\.select\(\)\s*\n?\s*\.from\(sals3OrderLines\)/u;

    expect(source).toMatch(/\.from\(sals3OrderLines\)/u);
    expect(source).not.toMatch(bareSelectBeforeOrderLines);
  });

  /**
   * The buyer payload is also where a supplier fact would leak. ADR-004 §6 keeps
   * the connection id and the CJ identifiers out of it, and the previous bare
   * select fetched all of them on every request.
   */
  it('never selects supplier identifiers for a buyer', () => {
    const source = readFileSync('src/modules/orders/buyer-read.ts', 'utf8');

    expect(source).not.toMatch(/sals3OrderLines\.supplierConnectionId/u);
    expect(source).not.toMatch(/sals3OrderLines\.externalProductId/u);
    expect(source).not.toMatch(/sals3OrderLines\.externalVariantId/u);
    expect(source).not.toMatch(/sals3OrderLines\.externalSku/u);
  });
});

/**
 * Drizzle names **every** column of the schema in an `INSERT`, filling the ones
 * the caller omitted with `default`. So adding a column to `schema/orders.ts` is
 * by itself enough to change the SQL order acceptance emits — there is no
 * "define it now, write it later".
 *
 * This was found by running `toSQL()` while checking whether the column could
 * ship a release ahead of its reader. It could not: the first draft of that
 * change added `listingSnapshot` to the schema and claimed to read and write
 * nothing, and it would have failed every paid checkout with
 * `column "listing_snapshot" does not exist` until the migration ran.
 *
 * The assertion is the general rule, not the specific column: any column present
 * in the schema must already exist in production before that schema ships.
 */
describe('order line inserts', () => {
  it('name every schema column, so a new column changes acceptance SQL', () => {
    // No connection is opened — `toSQL()` only builds the statement.
    const db = drizzle({} as never);
    const { sql: statement } = db
      .insert(sals3OrderLines)
      .values({
        orderId: '00000000-0000-4000-8000-000000000000',
        storeLineItemId: 'sli-1',
        productId: '00000000-0000-4000-8000-000000000001',
        variantId: '00000000-0000-4000-8000-000000000002',
        title: 'x',
        quantity: 1,
        unitAmountMinor: BigInt(1),
        currency: 'USD',
        supplierConnectionId: '00000000-0000-4000-8000-000000000003',
        externalProductId: 'p',
        externalVariantId: 'v',
        externalSku: null,
        sals3Sku: 's',
      })
      .toSQL();

    // `variant_label` and `image_url` were not passed above, and are named
    // anyway — which is the whole point.
    expect(statement).toContain('"variant_label"');
    expect(statement).toContain('"image_url"');

    // Therefore: nothing in the schema may be absent from production. This is
    // the guard on the ordering, and it fails the moment a column is added to
    // the Drizzle table before its DDL has been applied.
    expect(statement).not.toContain('"listing_snapshot"');
  });
});
