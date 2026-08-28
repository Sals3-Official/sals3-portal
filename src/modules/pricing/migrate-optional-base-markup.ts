import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * One-time DDL making `pricing_store_defaults.target_margin_rate` nullable, so
 * a store default can exist purely to carry the operating-expense floor.
 *
 * ## Why the column stops being required
 *
 * The row does two unrelated jobs. `target_margin_rate` is the markup used for
 * a product whose category has **no** rule of its own — a fallback, reached
 * only through `nearestCategoryPolicy === null` in `resolveProductPricing`.
 * `min_contribution_rate` / `min_contribution_minor` are the floor, read for
 * **every** product regardless of which layer priced it.
 *
 * Owner decision 2026-08-28: every category carries its own markup, so the
 * fallback half never fires — but the floor half is wanted, and the floor has
 * no home except this row. `NOT NULL` therefore forced a seller to invent a
 * base markup they did not want in order to state a floor they did, and the two
 * numbers sat side by side on one dialog looking like alternatives. Making the
 * column nullable is what lets the screen stop asking.
 *
 * **Null means "no store-default fallback", not zero.** A zero base markup is a
 * rule that prices at cost; an absent one is the absence of a rule, and a
 * product whose category has no markup then has no price at all
 * (`PRICING_POLICY_REQUIRED`) rather than a silently free one. That distinction
 * is the entire reason this is a `DROP NOT NULL` and not a `DEFAULT 0`.
 *
 * ## Why this runs before the deployment, not with it
 *
 * The opposite ordering hazard from `migrate-opex-floor.ts`, and worth stating
 * because it is easy to assume the rule is always "DDL first, or everything
 * breaks". Dropping a `NOT NULL` only widens what the column accepts, so code
 * that still always writes a value keeps working unchanged — this DDL is safe
 * both early and late. What is *not* safe is the reverse order for the code: a
 * deployment that stops writing `target_margin_rate` before the constraint is
 * gone would fail every store-default insert. So this ships and runs first for
 * the same practical reason as the others, just with a gentler failure mode if
 * it does not.
 *
 * ## Why there is no accompanying range check
 *
 * `min_contribution_rate` carries `pricing_store_defaults_floor_rate_range`, and
 * the symmetry is tempting. It is left alone deliberately: `ADD CONSTRAINT`
 * validates existing rows, so a single legacy row holding a 0 would abort the
 * transaction and take the `DROP NOT NULL` down with it — losing the half that
 * matters over the half that does not. `isValidMarginRate` already refuses those
 * values on every write path. A range check here would be a separate, separately
 * reversible change.
 *
 * ## No backfill, and nothing to undo
 *
 * Existing rows keep the value they have. Re-adding the constraint later is a
 * plain `SET NOT NULL`, which succeeds as long as no row has since been written
 * without one — so the rollback story is "stop writing nulls, then re-add", not
 * a data repair.
 */

export const OPTIONAL_BASE_MARKUP_DDL_STATEMENTS = [
  'ALTER TABLE "pricing_store_defaults" ALTER COLUMN "target_margin_rate" DROP NOT NULL',
] as const;

/**
 * The real hazard is the lock, not the change. `ALTER TABLE` takes an
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
 * Read-only. Whether the column actually still refuses nulls, asked of the
 * database rather than inferred from a migration ledger — the ledger records
 * intent, this records reality, and the 2026-08-18 incident is what happens
 * when the two disagree.
 */
export async function baseMarkupIsRequired(db: Database): Promise<boolean> {
  const rows = (await db.execute(
    sql.raw(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'pricing_store_defaults'
         AND column_name = 'target_margin_rate'
         AND is_nullable = 'NO'`,
    ),
  )) as unknown as unknown[];

  return rows.length > 0;
}

export type RunOptionalBaseMarkupDdlResult = { statementsRun: number };

export async function runOptionalBaseMarkupDdl(
  db: Database,
): Promise<RunOptionalBaseMarkupDdlResult> {
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`));

    // eslint-disable-next-line no-restricted-syntax -- a fixed, ordered list in one transaction; the order is the point.
    for (const statement of OPTIONAL_BASE_MARKUP_DDL_STATEMENTS) {
      // eslint-disable-next-line no-await-in-loop
      await tx.execute(sql.raw(statement));
    }
  });

  return { statementsRun: OPTIONAL_BASE_MARKUP_DDL_STATEMENTS.length };
}

export type MigrateOptionalBaseMarkupResult = {
  ok: true;
  wasRequiredBefore: boolean;
  statementsRun: number;
  isRequiredAfter: boolean;
};

/**
 * Idempotent: `DROP NOT NULL` on an already-nullable column is a no-op.
 *
 * Reports the state before and after rather than only "done", so a run that
 * achieved nothing cannot read as success.
 */
export async function migrateOptionalBaseMarkup(
  db: Database,
): Promise<MigrateOptionalBaseMarkupResult> {
  const wasRequiredBefore = await baseMarkupIsRequired(db);

  const { statementsRun } = await runOptionalBaseMarkupDdl(db);

  const isRequiredAfter = await baseMarkupIsRequired(db);

  return {
    ok: true,
    wasRequiredBefore,
    statementsRun,
    isRequiredAfter,
  };
}
