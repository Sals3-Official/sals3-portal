// @vitest-environment node
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
