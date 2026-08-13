import { and, desc, eq, ilike, or } from 'drizzle-orm';
import type { Executor } from '@/modules/catalog/candidates/repository';
import {
  pricingCategoryPolicies,
  pricingFxAdjustmentPolicies,
  pricingProductOverrides,
  pricingVariantOverrides,
  sals3Categories,
  type PricingCategoryPolicyRow,
  type PricingFxAdjustmentPolicyRow,
  type PricingProductOverrideRow,
  type PricingVariantOverrideRow,
  type RoundingRule as SchemaRoundingRule,
  type Sals3CategoryRow,
} from '@/lib/db/schema';

/**
 * Data access for category-first margin and the seller's funding buffer.
 *
 * Every "revise" function supersedes the previous row and inserts a new one
 * in the SAME transaction the caller opened — this module never opens its
 * own transaction, matching `candidates/repository.ts`'s convention of
 * accepting an `Executor` so the caller controls atomicity.
 */

const CATEGORY_SEARCH_LIMIT = 50;

export async function findCategoryByCode(
  executor: Executor,
  code: string,
): Promise<Sals3CategoryRow | null> {
  const rows = await executor
    .select()
    .from(sals3Categories)
    .where(eq(sals3Categories.code, code))
    .limit(1);

  return rows[0] ?? null;
}

export async function findCategoryById(
  executor: Executor,
  categoryId: string,
): Promise<Sals3CategoryRow | null> {
  const rows = await executor
    .select()
    .from(sals3Categories)
    .where(eq(sals3Categories.id, categoryId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Case-insensitive substring match on the stable code or the display path.
 * Capped so a broad query (or an empty one) never returns all 1,345 rows to
 * a client in one response.
 */
export async function searchCategories(
  executor: Executor,
  query: string,
): Promise<Sals3CategoryRow[]> {
  const trimmed = query.trim();

  if (trimmed === '') {
    return executor.select().from(sals3Categories).limit(CATEGORY_SEARCH_LIMIT);
  }

  const pattern = `%${trimmed}%`;

  return executor
    .select()
    .from(sals3Categories)
    .where(
      or(
        ilike(sals3Categories.path, pattern),
        ilike(sals3Categories.code, pattern),
      ),
    )
    .limit(CATEGORY_SEARCH_LIMIT);
}

// --- Category policy ---------------------------------------------------

export async function findActiveCategoryPolicy(
  executor: Executor,
  sellerAccountId: string,
  categoryId: string,
): Promise<PricingCategoryPolicyRow | null> {
  const rows = await executor
    .select()
    .from(pricingCategoryPolicies)
    .where(
      and(
        eq(pricingCategoryPolicies.sellerAccountId, sellerAccountId),
        eq(pricingCategoryPolicies.categoryId, categoryId),
        eq(pricingCategoryPolicies.status, 'ACTIVE'),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export type CategoryPolicyWithCategory = PricingCategoryPolicyRow & {
  categoryCode: string;
  categoryPath: string;
};

export async function listActiveCategoryPolicies(
  executor: Executor,
  sellerAccountId: string,
): Promise<CategoryPolicyWithCategory[]> {
  const rows = await executor
    .select({
      policy: pricingCategoryPolicies,
      categoryCode: sals3Categories.code,
      categoryPath: sals3Categories.path,
    })
    .from(pricingCategoryPolicies)
    .innerJoin(
      sals3Categories,
      eq(sals3Categories.id, pricingCategoryPolicies.categoryId),
    )
    .where(
      and(
        eq(pricingCategoryPolicies.sellerAccountId, sellerAccountId),
        eq(pricingCategoryPolicies.status, 'ACTIVE'),
      ),
    );

  return rows.map((row) => ({
    ...row.policy,
    categoryCode: row.categoryCode,
    categoryPath: row.categoryPath,
  }));
}

export type CategoryMarginLeafRow = {
  categoryId: string;
  code: string;
  path: string;
  l1: string | null;
  l2: string | null;
  l3: string | null;
  policy: {
    id: string;
    targetMarginRate: string;
    roundingRule: SchemaRoundingRule;
    version: number;
    updatedAt: Date;
  } | null;
};

/**
 * Every leaf in the taxonomy, LEFT JOINed to this seller's active policy
 * (or `null`). LEFT JOIN — not the INNER JOIN `listActiveCategoryPolicies`
 * uses — is what makes an L2 group with zero active policies still
 * knowable: the query is driven FROM `sals3Categories`, not from the
 * policy table. One query, no N+1 — the settings page's whole initial
 * render comes from this single fetch.
 */
export async function listCategoryMarginOverview(
  executor: Executor,
  sellerAccountId: string,
): Promise<CategoryMarginLeafRow[]> {
  const rows = await executor
    .select({
      categoryId: sals3Categories.id,
      code: sals3Categories.code,
      path: sals3Categories.path,
      l1: sals3Categories.l1,
      l2: sals3Categories.l2,
      l3: sals3Categories.l3,
      policyId: pricingCategoryPolicies.id,
      targetMarginRate: pricingCategoryPolicies.targetMarginRate,
      roundingRule: pricingCategoryPolicies.roundingRule,
      version: pricingCategoryPolicies.version,
      updatedAt: pricingCategoryPolicies.updatedAt,
    })
    .from(sals3Categories)
    .leftJoin(
      pricingCategoryPolicies,
      and(
        eq(pricingCategoryPolicies.categoryId, sals3Categories.id),
        eq(pricingCategoryPolicies.sellerAccountId, sellerAccountId),
        eq(pricingCategoryPolicies.status, 'ACTIVE'),
      ),
    )
    .orderBy(
      sals3Categories.l1,
      sals3Categories.l2,
      sals3Categories.l3,
      sals3Categories.path,
    );

  return rows.map((row) => ({
    categoryId: row.categoryId,
    code: row.code,
    path: row.path,
    l1: row.l1,
    l2: row.l2,
    l3: row.l3,
    policy:
      row.policyId === null
        ? null
        : {
            id: row.policyId,
            targetMarginRate: row.targetMarginRate as string,
            roundingRule: row.roundingRule as SchemaRoundingRule,
            version: row.version as number,
            updatedAt: row.updatedAt as Date,
          },
  }));
}

/**
 * Authoritative "every leaf under this L2 today" lookup, used ONLY at
 * write time by the bulk margin action. Recomputed from `(l1, l2)` on
 * every write — never trust a client-supplied leaf-id list, which would
 * open a staleness/tamper gap.
 */
export async function findLeafCategoriesByL1L2(
  executor: Executor,
  l1: string,
  l2: string,
): Promise<Sals3CategoryRow[]> {
  return executor
    .select()
    .from(sals3Categories)
    .where(and(eq(sals3Categories.l1, l1), eq(sals3Categories.l2, l2)));
}

export type CategoryMarginGroup = {
  l1: string;
  l2: string;
  /** Stable client-side key and lookup key: `${l1}::${l2}`. */
  groupKey: string;
  leaves: CategoryMarginLeafRow[];
};

/**
 * Pure grouping — no I/O. Kept out of SQL deliberately: "uniform / mixed /
 * unset" per group needs to compare actual rate+rounding values across a
 * group's leaves, including treating "no policy" as a distinct third
 * state — a plain reduce over an already-small (1,345-row) array reads far
 * more clearly than the equivalent SQL aggregate. Buckets a null `l1`/`l2`
 * under `'(Uncategorized)'` rather than dropping the row; every live row
 * today is fully populated, but this defends against the schema's
 * nullability anyway.
 */
export function groupCategoryMarginRowsByL2(
  rows: CategoryMarginLeafRow[],
): CategoryMarginGroup[] {
  const byKey = new Map<string, CategoryMarginGroup>();

  rows.forEach((row) => {
    const l1 = row.l1 ?? '(Uncategorized)';
    const l2 = row.l2 ?? '(Uncategorized)';
    const groupKey = `${l1}::${l2}`;

    let group = byKey.get(groupKey);
    if (group === undefined) {
      group = { l1, l2, groupKey, leaves: [] };
      byKey.set(groupKey, group);
    }
    group.leaves.push(row);
  });

  return [...byKey.values()];
}

export async function createCategoryPolicy(
  executor: Executor,
  input: {
    sellerAccountId: string;
    categoryId: string;
    targetMarginRate: string;
    roundingRule: SchemaRoundingRule;
    reason: string;
    actorId: string;
  },
): Promise<PricingCategoryPolicyRow> {
  const [row] = await executor
    .insert(pricingCategoryPolicies)
    .values({ ...input, version: 1, supersedesId: null, status: 'ACTIVE' })
    .returning();

  return row;
}

/** Supersedes `previous` and inserts the new active version. Caller must run this inside a transaction. */
export async function reviseCategoryPolicy(
  executor: Executor,
  previous: PricingCategoryPolicyRow,
  input: {
    targetMarginRate: string;
    roundingRule: SchemaRoundingRule;
    reason: string;
    actorId: string;
  },
): Promise<PricingCategoryPolicyRow> {
  await executor
    .update(pricingCategoryPolicies)
    .set({ status: 'SUPERSEDED', updatedAt: new Date() })
    .where(eq(pricingCategoryPolicies.id, previous.id));

  const [row] = await executor
    .insert(pricingCategoryPolicies)
    .values({
      sellerAccountId: previous.sellerAccountId,
      categoryId: previous.categoryId,
      targetMarginRate: input.targetMarginRate,
      roundingRule: input.roundingRule,
      reason: input.reason,
      actorId: input.actorId,
      version: previous.version + 1,
      supersedesId: previous.id,
      status: 'ACTIVE',
    })
    .returning();

  return row;
}

/**
 * Scoped by `sellerAccountId` — a policy id that belongs to another tenant
 * matches zero rows and returns `null`, the same "not yours, not there"
 * answer as a genuinely missing id. Never trust a caller-claimed seller id
 * against the caller's own session as a substitute for this database-level
 * check.
 */
export async function deactivateCategoryPolicy(
  executor: Executor,
  policyId: string,
  sellerAccountId: string,
): Promise<PricingCategoryPolicyRow | null> {
  const [row] = await executor
    .update(pricingCategoryPolicies)
    .set({ status: 'DEACTIVATED', updatedAt: new Date() })
    .where(
      and(
        eq(pricingCategoryPolicies.id, policyId),
        eq(pricingCategoryPolicies.sellerAccountId, sellerAccountId),
      ),
    )
    .returning();

  return row ?? null;
}

// --- Product override ---------------------------------------------------

export async function findActiveProductOverride(
  executor: Executor,
  supplierCandidateId: string,
): Promise<PricingProductOverrideRow | null> {
  const rows = await executor
    .select()
    .from(pricingProductOverrides)
    .where(
      and(
        eq(pricingProductOverrides.supplierCandidateId, supplierCandidateId),
        eq(pricingProductOverrides.status, 'ACTIVE'),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Every override ever recorded for one candidate, newest first - not just the
 * `ACTIVE` one `findActiveProductOverride` returns.
 *
 * The read-only candidate detail drawer shows supersession history, so a
 * reviewer can see that a margin was revised and why. Pricing-override *audit*
 * events are keyed by the override id (`entityType: 'PricingProductOverride'`),
 * not the candidate, so these rows are the only per-candidate record of that
 * history.
 *
 * Caller must already have proven the candidate belongs to the reading seller:
 * this table has no tenant column.
 */
export async function listProductOverridesForCandidate(
  executor: Executor,
  supplierCandidateId: string,
): Promise<PricingProductOverrideRow[]> {
  return executor
    .select()
    .from(pricingProductOverrides)
    .where(eq(pricingProductOverrides.supplierCandidateId, supplierCandidateId))
    .orderBy(desc(pricingProductOverrides.createdAt));
}

export async function createProductOverride(
  executor: Executor,
  input: {
    supplierCandidateId: string;
    targetMarginRate: string;
    reason: string;
    actorId: string;
  },
): Promise<PricingProductOverrideRow> {
  const [row] = await executor
    .insert(pricingProductOverrides)
    .values({ ...input, version: 1, supersedesId: null, status: 'ACTIVE' })
    .returning();

  return row;
}

/**
 * Scoped by `supplierCandidateId` — the caller must already have verified
 * (via `candidateBelongsToSeller`) that this candidate belongs to it. An
 * `overrideId` that does not actually belong to that candidate matches
 * zero rows rather than removing a different candidate's override.
 */
export async function removeProductOverride(
  executor: Executor,
  overrideId: string,
  supplierCandidateId: string,
): Promise<PricingProductOverrideRow | null> {
  const [row] = await executor
    .update(pricingProductOverrides)
    .set({ status: 'REMOVED', updatedAt: new Date() })
    .where(
      and(
        eq(pricingProductOverrides.id, overrideId),
        eq(pricingProductOverrides.supplierCandidateId, supplierCandidateId),
      ),
    )
    .returning();

  return row ?? null;
}

// --- Variant override ---------------------------------------------------

export async function findActiveVariantOverride(
  executor: Executor,
  supplierCandidateId: string,
  supplierVariantId: string,
): Promise<PricingVariantOverrideRow | null> {
  const rows = await executor
    .select()
    .from(pricingVariantOverrides)
    .where(
      and(
        eq(pricingVariantOverrides.supplierCandidateId, supplierCandidateId),
        eq(pricingVariantOverrides.supplierVariantId, supplierVariantId),
        eq(pricingVariantOverrides.status, 'ACTIVE'),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Every variant override ever recorded for one candidate. See `listProductOverridesForCandidate` for the scoping contract. */
export async function listVariantOverridesForCandidate(
  executor: Executor,
  supplierCandidateId: string,
): Promise<PricingVariantOverrideRow[]> {
  return executor
    .select()
    .from(pricingVariantOverrides)
    .where(eq(pricingVariantOverrides.supplierCandidateId, supplierCandidateId))
    .orderBy(desc(pricingVariantOverrides.createdAt));
}

export async function createVariantOverride(
  executor: Executor,
  input: {
    supplierCandidateId: string;
    supplierVariantId: string;
    targetMarginRate: string;
    reason: string;
    additionalJustification: string;
    actorId: string;
  },
): Promise<PricingVariantOverrideRow> {
  const [row] = await executor
    .insert(pricingVariantOverrides)
    .values({ ...input, version: 1, supersedesId: null, status: 'ACTIVE' })
    .returning();

  return row;
}

/** Scoped by `supplierCandidateId` — see `removeProductOverride`'s comment. */
export async function removeVariantOverride(
  executor: Executor,
  overrideId: string,
  supplierCandidateId: string,
): Promise<PricingVariantOverrideRow | null> {
  const [row] = await executor
    .update(pricingVariantOverrides)
    .set({ status: 'REMOVED', updatedAt: new Date() })
    .where(
      and(
        eq(pricingVariantOverrides.id, overrideId),
        eq(pricingVariantOverrides.supplierCandidateId, supplierCandidateId),
      ),
    )
    .returning();

  return row ?? null;
}

// --- Funding buffer policy -------------------------------------------------

/** At most one ACTIVE funding buffer per seller — no currency/rail dimension. */
export async function findActiveFundingBufferPolicy(
  executor: Executor,
  sellerAccountId: string,
): Promise<PricingFxAdjustmentPolicyRow | null> {
  const rows = await executor
    .select()
    .from(pricingFxAdjustmentPolicies)
    .where(
      and(
        eq(pricingFxAdjustmentPolicies.sellerAccountId, sellerAccountId),
        eq(pricingFxAdjustmentPolicies.status, 'ACTIVE'),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function createFundingBufferPolicy(
  executor: Executor,
  input: {
    sellerAccountId: string;
    adjustmentRate: string;
    reason: string;
    actorId: string;
    effectiveTo?: Date | null;
  },
): Promise<PricingFxAdjustmentPolicyRow> {
  const [row] = await executor
    .insert(pricingFxAdjustmentPolicies)
    .values({
      ...input,
      version: 1,
      supersedesId: null,
      status: 'ACTIVE',
      effectiveFrom: new Date(),
      effectiveTo: input.effectiveTo ?? null,
    })
    .returning();

  return row;
}

export async function reviseFundingBufferPolicy(
  executor: Executor,
  previous: PricingFxAdjustmentPolicyRow,
  input: {
    adjustmentRate: string;
    reason: string;
    actorId: string;
    effectiveTo?: Date | null;
  },
): Promise<PricingFxAdjustmentPolicyRow> {
  await executor
    .update(pricingFxAdjustmentPolicies)
    .set({ status: 'SUPERSEDED', updatedAt: new Date() })
    .where(eq(pricingFxAdjustmentPolicies.id, previous.id));

  const [row] = await executor
    .insert(pricingFxAdjustmentPolicies)
    .values({
      sellerAccountId: previous.sellerAccountId,
      adjustmentRate: input.adjustmentRate,
      reason: input.reason,
      actorId: input.actorId,
      version: previous.version + 1,
      supersedesId: previous.id,
      status: 'ACTIVE',
      effectiveFrom: new Date(),
      effectiveTo: input.effectiveTo ?? null,
    })
    .returning();

  return row;
}

/** Scoped by `sellerAccountId` — see `deactivateCategoryPolicy`'s comment. */
export async function deactivateFundingBufferPolicy(
  executor: Executor,
  policyId: string,
  sellerAccountId: string,
): Promise<PricingFxAdjustmentPolicyRow | null> {
  const [row] = await executor
    .update(pricingFxAdjustmentPolicies)
    .set({ status: 'DEACTIVATED', updatedAt: new Date() })
    .where(
      and(
        eq(pricingFxAdjustmentPolicies.id, policyId),
        eq(pricingFxAdjustmentPolicies.sellerAccountId, sellerAccountId),
      ),
    )
    .returning();

  return row ?? null;
}
