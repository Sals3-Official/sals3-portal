import { and, desc, eq, ilike, or } from 'drizzle-orm';
import type { Executor } from '@/modules/catalog/candidates/repository';
import {
  pricingCategoryPolicies,
  pricingFxAdjustmentPolicies,
  pricingProductOverrides,
  pricingVariantOverrides,
  sals3Categories,
  type FundingRail as SchemaFundingRail,
  type PricingCategoryPolicyRow,
  type PricingFxAdjustmentPolicyRow,
  type PricingProductOverrideRow,
  type PricingVariantOverrideRow,
  type RoundingRule as SchemaRoundingRule,
  type Sals3CategoryRow,
} from '@/lib/db/schema';

/**
 * Data access for category-first margin and FX-adjustment policy.
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

export async function deactivateCategoryPolicy(
  executor: Executor,
  policyId: string,
): Promise<void> {
  await executor
    .update(pricingCategoryPolicies)
    .set({ status: 'DEACTIVATED', updatedAt: new Date() })
    .where(eq(pricingCategoryPolicies.id, policyId));
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

export async function removeProductOverride(
  executor: Executor,
  overrideId: string,
): Promise<void> {
  await executor
    .update(pricingProductOverrides)
    .set({ status: 'REMOVED', updatedAt: new Date() })
    .where(eq(pricingProductOverrides.id, overrideId));
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

export async function removeVariantOverride(
  executor: Executor,
  overrideId: string,
): Promise<void> {
  await executor
    .update(pricingVariantOverrides)
    .set({ status: 'REMOVED', updatedAt: new Date() })
    .where(eq(pricingVariantOverrides.id, overrideId));
}

// --- FX adjustment policy -------------------------------------------------

export async function findActiveFxAdjustmentPolicy(
  executor: Executor,
  sellerAccountId: string,
  sourceCurrency: string,
  targetCurrency: string,
  fundingRail: SchemaFundingRail,
): Promise<PricingFxAdjustmentPolicyRow | null> {
  const rows = await executor
    .select()
    .from(pricingFxAdjustmentPolicies)
    .where(
      and(
        eq(pricingFxAdjustmentPolicies.sellerAccountId, sellerAccountId),
        eq(pricingFxAdjustmentPolicies.sourceCurrency, sourceCurrency),
        eq(pricingFxAdjustmentPolicies.targetCurrency, targetCurrency),
        eq(pricingFxAdjustmentPolicies.fundingRail, fundingRail),
        eq(pricingFxAdjustmentPolicies.status, 'ACTIVE'),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function listActiveFxAdjustmentPolicies(
  executor: Executor,
  sellerAccountId: string,
): Promise<PricingFxAdjustmentPolicyRow[]> {
  return executor
    .select()
    .from(pricingFxAdjustmentPolicies)
    .where(
      and(
        eq(pricingFxAdjustmentPolicies.sellerAccountId, sellerAccountId),
        eq(pricingFxAdjustmentPolicies.status, 'ACTIVE'),
      ),
    );
}

export async function createFxAdjustmentPolicy(
  executor: Executor,
  input: {
    sellerAccountId: string;
    sourceCurrency: string;
    targetCurrency: string;
    fundingRail: SchemaFundingRail;
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

export async function reviseFxAdjustmentPolicy(
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
      sourceCurrency: previous.sourceCurrency,
      targetCurrency: previous.targetCurrency,
      fundingRail: previous.fundingRail,
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

export async function deactivateFxAdjustmentPolicy(
  executor: Executor,
  policyId: string,
): Promise<void> {
  await executor
    .update(pricingFxAdjustmentPolicies)
    .set({ status: 'DEACTIVATED', updatedAt: new Date() })
    .where(eq(pricingFxAdjustmentPolicies.id, policyId));
}
