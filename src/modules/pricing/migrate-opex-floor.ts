import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * One-time DDL adding the percentage form of the operating-expense floor to
 * `pricing_store_defaults`, and the constraint that keeps the two forms from
 * both being set at once.
 *
 * Owner decision 2026-08-26: a margin must never fall below what it costs to
 * operate, and that minimum is expressible **either** as a percentage **or** as
 * a fixed amount — never both on the same rule. The amount half already exists
 * (`min_contribution_minor`, applied by `applyContributionFloor`); this adds the
 * percentage half and makes "exactly one, or neither" a property of the
 * database rather than a habit of the form.
 *
 * **This must run before the deployment that names the column.** Drizzle names
 * every column of a table in its `INSERT`, so a deployment carrying
 * `minContributionRate` before the database has it would break every store
 * default write, not just the new field. Nothing in the change that adds this
 * DDL names the column — same ordering as `migrate-per-market-scope.ts`, and the
 * same reason.
 *
 * ## Why the exclusivity lives in a CHECK
 *
 * The form can enforce it, and will. So can Zod. Neither is reached by a CSV
 * import, a future admin tool, or a hand-written repair statement — and the
 * failure is silent: two floors on one row, with nothing in the schema saying
 * which one the resolver should have honoured. A constraint refuses the row
 * instead, at the only layer every writer passes through.
 *
 * ## Why a rate rather than reusing the margin column
 *
 * `target_margin_rate` is the margin this rule *aims* for. The floor is the
 * margin it must never fall *below*. They are different numbers with different
 * jobs — a seller may aim for 25% while refusing to ever go under 18% — and
 * collapsing them would make the floor unexpressible.
 *
 * ## What this deliberately does not do
 *
 * It does not write a `drizzle.__drizzle_migrations` row, the way
 * `migrate-per-market-scope.ts` does for `0029`. That module could pin a hash
 * because its migration file already existed; the file for this column is
 * generated from the schema change, which by the ordering above cannot ship
 * until after this has run. The ledger row therefore belongs to the feature
 * change, not to this one — and is named here so its absence reads as a
 * decision rather than an oversight.
 */

export const OPEX_FLOOR_DDL_STATEMENTS = [
  // Nullable, and null means "no percentage floor" — not zero. A zero floor and
  // an absent floor are the same in effect but not in intent, and the
  // difference is what the screen has to show back to the seller.
  'ALTER TABLE "pricing_store_defaults" ADD COLUMN IF NOT EXISTS "min_contribution_rate" numeric(8, 6)',

  // Exactly one form, or neither. `min_contribution_minor` defaults to 0 and is
  // NOT NULL, so "no amount floor" is `= 0` rather than NULL — the check is
  // written against that reality, not against a tidier one.
  'ALTER TABLE "pricing_store_defaults" DROP CONSTRAINT IF EXISTS "pricing_store_defaults_floor_exclusive"',
  `ALTER TABLE "pricing_store_defaults" ADD CONSTRAINT "pricing_store_defaults_floor_exclusive"
     CHECK (NOT ("min_contribution_rate" IS NOT NULL AND "min_contribution_minor" > 0))`,

  // The same open interval `isValidMarginRate` enforces in application code. A
  // floor of 0 prices nothing and a floor of 1 divides by zero; both are typos,
  // and a typo should be refused rather than stored as a rule that can never
  // fire or can only ever fail.
  'ALTER TABLE "pricing_store_defaults" DROP CONSTRAINT IF EXISTS "pricing_store_defaults_floor_rate_range"',
  `ALTER TABLE "pricing_store_defaults" ADD CONSTRAINT "pricing_store_defaults_floor_rate_range"
     CHECK ("min_contribution_rate" IS NULL OR ("min_contribution_rate" > 0 AND "min_contribution_rate" < 1))`,
] as const;

/**
 * The real hazard is the lock, not the column. `ALTER TABLE` takes an
 * `ACCESS EXCLUSIVE` lock; if a long query holds the table, the ALTER queues and
 * every pricing read and policy write queues behind it. Failing fast is the
 * rollback story for a DDL that otherwise has none: the statement aborts, the
 * transaction rolls back, nothing changed, and the run can be retried when it is
 * quieter.
 *
 * `SET LOCAL` rather than a session `SET`: this runs on a pooled serverless
 * connection, and a session-level timeout would leak onto whatever unrelated
 * query reuses that connection next.
 */
export const DDL_LOCK_TIMEOUT = '5s';

/**
 * Read-only. Whether the column is actually present, asked of the database
 * rather than inferred from a migration ledger — the ledger records intent, this
 * records reality, and the 2026-08-18 incident is what happens when the two
 * disagree.
 */
export async function hasOpexFloorColumn(db: Database): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'pricing_store_defaults'
         AND column_name = 'min_contribution_rate'`,
    ),
  )) as unknown as unknown[];

  return rows.length > 0;
}

/**
 * Read-only, and reported separately from the column on purpose.
 *
 * A missing column breaks every write immediately and loudly. A missing
 * constraint breaks nothing until a row carries both floors, and by then the
 * resolver has already had two answers and silently used one. A single flag
 * would have called that success.
 */
export async function hasOpexFloorConstraints(db: Database): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT conname FROM pg_constraint
       WHERE conname IN (
         'pricing_store_defaults_floor_exclusive',
         'pricing_store_defaults_floor_rate_range'
       )`,
    ),
  )) as unknown as unknown[];

  return rows.length === 2;
}

export type RunOpexFloorDdlResult = { statementsRun: number };

export async function runOpexFloorDdl(
  db: Database,
): Promise<RunOpexFloorDdlResult> {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`));

    // eslint-disable-next-line no-restricted-syntax -- a fixed, ordered list in one transaction; the order is the point.
    for (const statement of OPEX_FLOOR_DDL_STATEMENTS) {
      // eslint-disable-next-line no-await-in-loop
      await tx.execute(sql.raw(statement));
    }
  });

  return { statementsRun: OPEX_FLOOR_DDL_STATEMENTS.length };
}

export type MigrateOpexFloorResult = {
  ok: true;
  columnExistedBefore: boolean;
  constraintsExistedBefore: boolean;
  statementsRun: number;
  columnExistsAfter: boolean;
  constraintsExistAfter: boolean;
};

/**
 * Idempotent: every statement is `IF NOT EXISTS`, or a `DROP … IF EXISTS`
 * followed by an `ADD` — `ADD CONSTRAINT` has no `IF NOT EXISTS` of its own, so
 * dropping first is what makes a second run safe rather than an error.
 *
 * Reports the state before and after rather than only "done", so a run that
 * achieved nothing cannot read as success.
 */
export async function migrateOpexFloor(
  db: Database,
): Promise<MigrateOpexFloorResult> {
  const [columnExistedBefore, constraintsExistedBefore] = await Promise.all([
    hasOpexFloorColumn(db),
    hasOpexFloorConstraints(db),
  ]);

  const { statementsRun } = await runOpexFloorDdl(db);

  const [columnExistsAfter, constraintsExistAfter] = await Promise.all([
    hasOpexFloorColumn(db),
    hasOpexFloorConstraints(db),
  ]);

  return {
    ok: true,
    columnExistedBefore,
    constraintsExistedBefore,
    statementsRun,
    columnExistsAfter,
    constraintsExistAfter,
  };
}
