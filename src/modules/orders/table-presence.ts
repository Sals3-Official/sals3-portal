import { sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';

/**
 * Whether the order tables this database needs actually exist.
 *
 * `sals3_orders` and `sals3_order_lines` arrive through a `workflow_dispatch`
 * break-glass migration rather than through the deploy, so there is a real
 * window — and, on a selectively-migrated local database, a permanent state —
 * where a screen reading them exists and its tables do not.
 *
 * This is deliberately a separate question from `isDatabaseUnavailable`. That
 * helper treats only connection-class faults as unavailability and rethrows
 * `42P01 undefined_table`, which is correct: a portal-wide guard that swallowed
 * a missing relation would hide genuine schema drift everywhere. So a missing
 * table has to be asked about explicitly, and its copy has to name the gap as a
 * migration gap rather than dress it up as an outage. That is the whole lesson
 * of the PR #102 incident.
 */
export type ExistingOrderTables = {
  orders: boolean;
  orderLines: boolean;
};

export async function readExistingOrderTables(
  db: DbExecutor,
): Promise<ExistingOrderTables> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('sals3_orders', 'sals3_order_lines')`,
    ),
  )) as unknown as { table_name?: unknown }[];

  const present = new Set(
    rows
      .map((row) => row.table_name)
      .filter((name): name is string => typeof name === 'string'),
  );

  return {
    orders: present.has('sals3_orders'),
    orderLines: present.has('sals3_order_lines'),
  };
}

/** Both tables, which is what every sales read needs before it can run. */
export async function orderTablesExist(db: DbExecutor): Promise<boolean> {
  const tables = await readExistingOrderTables(db);

  return tables.orders && tables.orderLines;
}
