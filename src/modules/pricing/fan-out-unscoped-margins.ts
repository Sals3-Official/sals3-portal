import { and, eq, inArray, isNull, like } from 'drizzle-orm';
import {
  pricingCategoryPolicies,
  sals3Categories,
  type RoundingRule,
} from '@/lib/db/schema/pricing-policy';
import { TAXONOMY_V1_CODE_PREFIX } from '@/lib/products/sals3-category-code';
import {
  appendAuditEvent,
  type Executor,
} from '@/modules/catalog/candidates/repository';
import { listPricingScopeDestinations } from './pricing-scope-destinations';

/**
 * One-time data migration: give every all-destinations margin its own copy in
 * each open destination, then retire the all-destinations rule.
 *
 * Owner decision 2026-08-25. The Market Rules screen is moving from a scope
 * *selector* (one destination at a time, plus an "All destinations" mode) to a
 * column *per destination*. That leaves the unscoped rule with nowhere to
 * render — and an unscoped rule is not decorative, it is the row that actually
 * prices everything today: production carries a 25% margin on every department
 * with `market_code IS NULL`. Removing the mode without moving the data would
 * have left those rows pricing live orders with no screen able to show or
 * change them.
 *
 * So the value is copied first and retired second, in one transaction. Every
 * destination keeps the exact rate it resolves to today, which is why this is a
 * migration and not a pricing change: **no published or future price moves
 * because of it.** What changes is only where the number is written down.
 *
 * ## Why `SUPERSEDED` rather than `DEACTIVATED`
 *
 * `DEACTIVATED` is what a person chooses when they want a rule to stop
 * applying. Nothing stopped applying here — the same rate still prices the same
 * categories, from six rows instead of one. `SUPERSEDED` is the status this
 * table already uses for "replaced by a newer row", and each copy carries
 * `supersedesId` back to the unscoped row it came from, so the trail from
 * today's six rows to yesterday's one is readable in the data rather than only
 * in this comment.
 *
 * ## What it deliberately leaves alone
 *
 * Supplier mirror categories (`CJ-<uuid>`). The bulk 25% import wrote a policy
 * onto every one of them, and those rows are provably inert — a mirror path is
 * the raw supplier string, so it can never be an ancestor of a real taxonomy
 * path and can never price anything (see `listCategoryMarginOverview`). Fanning
 * them out would multiply dead rows sixfold and hide the real count. They stay
 * untouched and unscoped, exactly as inert as before.
 *
 * Idempotent. A destination that already has its own ACTIVE rule for a category
 * is never overwritten — a deliberate choice outranks a copied default — and a
 * second run finds no unscoped rows left to copy.
 */

const MIGRATION_ACTOR = 'system:fan-out-unscoped-margins';

const MIGRATION_REASON =
  'Per-destination margins: copied from the all-destinations rule (owner decision 2026-08-25)';

/**
 * Inserted in chunks rather than one statement. The bulk 25% import means the
 * unscoped set can be far larger than the ~21 departments the screen shows, and
 * whatever it is gets multiplied by six — so a single `INSERT` is one long lock
 * on the table every save on the Market Rules screen also needs.
 */
const INSERT_CHUNK_SIZE = 500;

type UnscopedPolicyRow = {
  policyId: string;
  sellerAccountId: string;
  categoryId: string;
  categoryCode: string;
  targetMarginRate: string;
  roundingRule: RoundingRule;
};

export type FanOutUnscopedMarginsPlan = {
  /** Destination codes the copies will be written for. */
  destinations: string[];
  /** ACTIVE all-destinations rules on real taxonomy categories. */
  unscopedActive: number;
  /** Copies this run would write. */
  wouldCreate: number;
  /** (category, destination) pairs already carrying their own ACTIVE rule. */
  alreadyScoped: number;
};

export type FanOutUnscopedMarginsResult = FanOutUnscopedMarginsPlan & {
  created: number;
  retired: number;
};

/**
 * Every ACTIVE all-destinations rule on a real Sals3 taxonomy category.
 *
 * The `code LIKE 'CAT-GGL%'` arm is the same allow list the screen uses, and it
 * is what keeps supplier mirrors out — see the module comment.
 */
async function readUnscopedPolicies(
  executor: Executor,
): Promise<UnscopedPolicyRow[]> {
  const rows = await executor
    .select({
      policyId: pricingCategoryPolicies.id,
      sellerAccountId: pricingCategoryPolicies.sellerAccountId,
      categoryId: pricingCategoryPolicies.categoryId,
      categoryCode: sals3Categories.code,
      targetMarginRate: pricingCategoryPolicies.targetMarginRate,
      roundingRule: pricingCategoryPolicies.roundingRule,
    })
    .from(pricingCategoryPolicies)
    .innerJoin(
      sals3Categories,
      eq(sals3Categories.id, pricingCategoryPolicies.categoryId),
    )
    .where(
      and(
        eq(pricingCategoryPolicies.status, 'ACTIVE'),
        isNull(pricingCategoryPolicies.marketCode),
        like(sals3Categories.code, `${TAXONOMY_V1_CODE_PREFIX}%`),
      ),
    );

  return rows.map((row) => ({
    policyId: row.policyId,
    sellerAccountId: row.sellerAccountId,
    categoryId: row.categoryId,
    categoryCode: row.categoryCode,
    targetMarginRate: row.targetMarginRate as string,
    roundingRule: row.roundingRule as RoundingRule,
  }));
}

function scopeKey(
  sellerAccountId: string,
  categoryId: string,
  marketCode: string,
): string {
  return `${sellerAccountId}|${categoryId}|${marketCode}`;
}

/**
 * The (seller, category, destination) triples that already have their own rule.
 *
 * Read for exactly the categories being migrated rather than the whole table:
 * this is the set the copy must not tread on, and scoping the read to it keeps
 * unrelated policies out of memory.
 */
async function readExistingScopedKeys(
  executor: Executor,
  categoryIds: string[],
): Promise<Set<string>> {
  if (categoryIds.length === 0) return new Set();

  const rows = await executor
    .select({
      sellerAccountId: pricingCategoryPolicies.sellerAccountId,
      categoryId: pricingCategoryPolicies.categoryId,
      marketCode: pricingCategoryPolicies.marketCode,
    })
    .from(pricingCategoryPolicies)
    .where(
      and(
        eq(pricingCategoryPolicies.status, 'ACTIVE'),
        inArray(pricingCategoryPolicies.categoryId, categoryIds),
      ),
    );

  const keys = new Set<string>();

  rows.forEach((row) => {
    if (row.marketCode === null) return;
    keys.add(scopeKey(row.sellerAccountId, row.categoryId, row.marketCode));
  });

  return keys;
}

function planFrom(
  unscoped: UnscopedPolicyRow[],
  existingScoped: Set<string>,
  destinations: string[],
): FanOutUnscopedMarginsPlan {
  let wouldCreate = 0;
  let alreadyScoped = 0;

  unscoped.forEach((policy) => {
    destinations.forEach((marketCode) => {
      if (
        existingScoped.has(
          scopeKey(policy.sellerAccountId, policy.categoryId, marketCode),
        )
      ) {
        alreadyScoped += 1;
      } else {
        wouldCreate += 1;
      }
    });
  });

  return {
    destinations,
    unscopedActive: unscoped.length,
    wouldCreate,
    alreadyScoped,
  };
}

/**
 * Read-only. Reports exactly what a run would do, so the size of the write is
 * known before it happens rather than inferred from a green response.
 *
 * The count matters: the bulk import may have written a policy to far more
 * categories than the ~21 departments the screen lists, and this multiplies it
 * by six.
 */
export async function planFanOutUnscopedMargins(
  executor: Executor,
): Promise<FanOutUnscopedMarginsPlan> {
  const destinations = listPricingScopeDestinations().map(
    (destination) => destination.code,
  );
  const unscoped = await readUnscopedPolicies(executor);
  const existingScoped = await readExistingScopedKeys(executor, [
    ...new Set(unscoped.map((policy) => policy.categoryId)),
  ]);

  return planFrom(unscoped, existingScoped, destinations);
}

type TransactionalExecutor = Executor & {
  transaction: <T>(fn: (tx: Executor) => Promise<T>) => Promise<T>;
};

/**
 * Copy, then retire — in one transaction, in that order.
 *
 * The order is the whole safety argument. If the retire ran first and the copy
 * failed, every category would lose the only rule pricing it. A transaction
 * makes that unobservable, but writing it in the safe order means the code is
 * still correct if someone later runs the halves separately.
 */
export async function fanOutUnscopedMargins(
  db: TransactionalExecutor,
): Promise<FanOutUnscopedMarginsResult> {
  const destinations = listPricingScopeDestinations().map(
    (destination) => destination.code,
  );

  return db.transaction(async (tx) => {
    const unscoped = await readUnscopedPolicies(tx);
    const existingScoped = await readExistingScopedKeys(tx, [
      ...new Set(unscoped.map((policy) => policy.categoryId)),
    ]);
    const plan = planFrom(unscoped, existingScoped, destinations);

    if (unscoped.length === 0) {
      return { ...plan, created: 0, retired: 0 };
    }

    const pending = unscoped.flatMap((policy) =>
      destinations
        .filter(
          (marketCode) =>
            !existingScoped.has(
              scopeKey(policy.sellerAccountId, policy.categoryId, marketCode),
            ),
        )
        .map((marketCode) => ({
          source: policy,
          values: {
            sellerAccountId: policy.sellerAccountId,
            categoryId: policy.categoryId,
            marketCode,
            targetMarginRate: policy.targetMarginRate,
            roundingRule: policy.roundingRule,
            status: 'ACTIVE' as const,
            version: 1,
            // Back to the all-destinations row this rate came from, so the
            // trail lives in the data and not only in a comment.
            supersedesId: policy.policyId,
            reason: MIGRATION_REASON,
            actorId: MIGRATION_ACTOR,
          },
        })),
    );

    let created = 0;

    /* eslint-disable no-await-in-loop -- chunks are deliberately sequential; see INSERT_CHUNK_SIZE. */
    for (let start = 0; start < pending.length; start += INSERT_CHUNK_SIZE) {
      const chunk = pending.slice(start, start + INSERT_CHUNK_SIZE);
      const written = await tx
        .insert(pricingCategoryPolicies)
        .values(chunk.map((entry) => entry.values))
        .returning({ id: pricingCategoryPolicies.id });

      created += written.length;

      for (let index = 0; index < written.length; index += 1) {
        const entry = chunk[index];
        const row = written[index];

        if (entry !== undefined && row !== undefined) {
          await appendAuditEvent(tx, {
            actorId: MIGRATION_ACTOR,
            action: 'category_pricing_policy.created',
            entityType: 'PricingCategoryPolicy',
            entityId: row.id,
            payload: {
              sellerAccountId: entry.source.sellerAccountId,
              categoryCode: entry.source.categoryCode,
              targetMarginRate: entry.source.targetMarginRate,
              roundingRule: entry.source.roundingRule,
              marketCode: entry.values.marketCode,
              reason: MIGRATION_REASON,
              supersedesId: entry.source.policyId,
              source: 'per-destination-migration',
            },
          });
        }
      }
    }

    const retiredRows = await tx
      .update(pricingCategoryPolicies)
      .set({ status: 'SUPERSEDED', updatedAt: new Date() })
      .where(
        inArray(
          pricingCategoryPolicies.id,
          unscoped.map((policy) => policy.policyId),
        ),
      )
      .returning({ id: pricingCategoryPolicies.id });

    for (let index = 0; index < unscoped.length; index += 1) {
      const policy = unscoped[index] as UnscopedPolicyRow;

      await appendAuditEvent(tx, {
        actorId: MIGRATION_ACTOR,
        action: 'category_pricing_policy.superseded',
        entityType: 'PricingCategoryPolicy',
        entityId: policy.policyId,
        payload: {
          sellerAccountId: policy.sellerAccountId,
          categoryCode: policy.categoryCode,
          reason: MIGRATION_REASON,
          replacedBy: destinations,
          source: 'per-destination-migration',
        },
      });
    }
    /* eslint-enable no-await-in-loop */

    return { ...plan, created, retired: retiredRows.length };
  });
}
