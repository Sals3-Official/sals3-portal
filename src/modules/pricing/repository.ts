import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
} from 'drizzle-orm';
import type { Executor } from '@/modules/catalog/candidates/repository';
import {
  pricingCategoryPolicies,
  pricingFxAdjustmentPolicies,
  pricingProductOverrides,
  pricingStoreDefaults,
  pricingVariantOverrides,
  sals3Categories,
  type PricingCategoryPolicyRow,
  type PricingFxAdjustmentPolicyRow,
  type PricingProductOverrideRow,
  type PricingStoreDefaultRow,
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

export const CATEGORY_PATH_SEPARATOR = ' > ';

export type NearestCategoryPolicy = {
  policy: PricingCategoryPolicyRow;
  /** The category the policy is actually attached to — the product's own category or its nearest priced ancestor. */
  sourceCategory: Sals3CategoryRow;
};

/**
 * The product category's own policy, or the nearest ancestor's (ADR-015
 * §3's least-to-most-specific chain, 2026-08-19 amendment): Taxonomy v1
 * stores a row for every node, so "Apparel & Accessories > Clothing >
 * Shirts & Tops" checks itself, then "… > Clothing", then the department.
 * One query for the whole chain — every ancestor path is derivable from
 * the leaf's own `path` string, so no recursive CTE is needed — then the
 * deepest priced node wins client-side (at most 5 rows).
 */
export async function findNearestActiveCategoryPolicy(
  executor: Executor,
  sellerAccountId: string,
  category: Sals3CategoryRow,
): Promise<NearestCategoryPolicy | null> {
  const segments = category.path.split(CATEGORY_PATH_SEPARATOR);
  const chainPaths = segments.map((_, index) =>
    segments.slice(0, index + 1).join(CATEGORY_PATH_SEPARATOR),
  );

  const rows = await executor
    .select({
      category: sals3Categories,
      policy: pricingCategoryPolicies,
    })
    .from(sals3Categories)
    .innerJoin(
      pricingCategoryPolicies,
      and(
        eq(pricingCategoryPolicies.categoryId, sals3Categories.id),
        eq(pricingCategoryPolicies.sellerAccountId, sellerAccountId),
        eq(pricingCategoryPolicies.status, 'ACTIVE'),
      ),
    )
    .where(inArray(sals3Categories.path, chainPaths));

  if (rows.length === 0) return null;

  const deepest = rows.reduce((best, row) =>
    row.category.path.length > best.category.path.length ? row : best,
  );

  return { policy: deepest.policy, sourceCategory: deepest.category };
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
 * The taxonomy down to L2 only — department and group — LEFT JOINed to this
 * seller's active policy (or `null`).
 *
 * **Why L2 and not every row** (owner decision, 2026-08-19): the deepest
 * levels are effectively per-item ("Bicycle Jerseys", "Bicycle Tights"),
 * and per-product pricing belongs in the Product Catalogue, not in a
 * commercial-rules screen. Shipping all 5,602 rows also put 5,382 rows on
 * screen that nobody was ever going to tune by hand. 21 departments + 192
 * groups = 213 rows, a 96% cut, and it holds as the taxonomy grows.
 *
 * Depth is NOT a resolution limit — `findNearestActiveCategoryPolicy` still
 * walks the full path chain, so a product five levels deep inherits from its
 * group or its department exactly as before. This narrows what a person is
 * asked to configure, never what the resolver can read.
 *
 * The `OR policy IS NOT NULL` arm is deliberate: a deeper policy that
 * already exists (the retired L1>L2 bulk fan-out wrote per-leaf rows) stays
 * visible and editable. Hiding a rate that is actively pricing products
 * would be the silent-configuration failure this codebase keeps hitting.
 *
 * LEFT JOIN — not the INNER JOIN `listActiveCategoryPolicies` uses — is what
 * makes a group with zero active policies still knowable: the query is
 * driven FROM `sals3Categories`, not from the policy table. One query, no
 * N+1 — the settings page's whole initial render comes from this fetch.
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
    // Depth <= 2, plus anything already carrying a policy — see the doc
    // comment. `l3 IS NULL` is the depth test: `path` is denormalized but
    // `l1`/`l2`/`l3` are the real level columns.
    .where(
      or(isNull(sals3Categories.l3), isNotNull(pricingCategoryPolicies.id)),
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
 * Supersedes `previous` and inserts the next version — the override analogue
 * of `reviseCategoryPolicy`. An edit must stay distinguishable from a delete
 * plus an unrelated new record, so this keeps the `version`/`supersedesId`
 * chain the schema's doc comment promises instead of resetting to version 1.
 *
 * Takes the previous row rather than an id: the caller has already read it to
 * decide this is an edit at all, and reading it again here would be a second
 * chance for the two to disagree about which row is being superseded.
 *
 * Caller must run this inside a transaction — the supersede and the insert are
 * only ever correct together.
 */
export async function reviseProductOverride(
  executor: Executor,
  previous: PricingProductOverrideRow,
  input: {
    targetMarginRate: string;
    reason: string;
    actorId: string;
  },
): Promise<PricingProductOverrideRow> {
  await executor
    .update(pricingProductOverrides)
    .set({ status: 'SUPERSEDED', updatedAt: new Date() })
    .where(eq(pricingProductOverrides.id, previous.id));

  const [row] = await executor
    .insert(pricingProductOverrides)
    .values({
      supplierCandidateId: previous.supplierCandidateId,
      targetMarginRate: input.targetMarginRate,
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

/**
 * Variant analogue of `reviseProductOverride`. `additionalJustification` is
 * re-supplied rather than carried over from `previous`: it explains *this*
 * edit's materially different cost or risk, and silently inheriting the old
 * one would let a revision keep a justification nobody re-affirmed.
 */
export async function reviseVariantOverride(
  executor: Executor,
  previous: PricingVariantOverrideRow,
  input: {
    targetMarginRate: string;
    reason: string;
    additionalJustification: string;
    actorId: string;
  },
): Promise<PricingVariantOverrideRow> {
  await executor
    .update(pricingVariantOverrides)
    .set({ status: 'SUPERSEDED', updatedAt: new Date() })
    .where(eq(pricingVariantOverrides.id, previous.id));

  const [row] = await executor
    .insert(pricingVariantOverrides)
    .values({
      supplierCandidateId: previous.supplierCandidateId,
      supplierVariantId: previous.supplierVariantId,
      targetMarginRate: input.targetMarginRate,
      reason: input.reason,
      additionalJustification: input.additionalJustification,
      actorId: input.actorId,
      version: previous.version + 1,
      supersedesId: previous.id,
      status: 'ACTIVE',
    })
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

// --- Store default (ADR-015 §3 base layer) -------------------------------

export async function findActiveStoreDefault(
  executor: Executor,
  sellerAccountId: string,
): Promise<PricingStoreDefaultRow | null> {
  const rows = await executor
    .select()
    .from(pricingStoreDefaults)
    .where(
      and(
        eq(pricingStoreDefaults.sellerAccountId, sellerAccountId),
        eq(pricingStoreDefaults.status, 'ACTIVE'),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function createStoreDefault(
  executor: Executor,
  input: {
    sellerAccountId: string;
    targetMarginRate: string;
    minContributionMinor: bigint;
    minContributionCurrency: string;
    roundingRule: SchemaRoundingRule;
    reason: string;
    actorId: string;
  },
): Promise<PricingStoreDefaultRow> {
  const [row] = await executor
    .insert(pricingStoreDefaults)
    .values({ ...input, version: 1, supersedesId: null, status: 'ACTIVE' })
    .returning();

  return row;
}

/** Supersedes `previous` and inserts the new active version. Caller must run this inside a transaction. */
export async function reviseStoreDefault(
  executor: Executor,
  previous: PricingStoreDefaultRow,
  input: {
    targetMarginRate: string;
    minContributionMinor: bigint;
    minContributionCurrency: string;
    roundingRule: SchemaRoundingRule;
    reason: string;
    actorId: string;
  },
): Promise<PricingStoreDefaultRow> {
  await executor
    .update(pricingStoreDefaults)
    .set({ status: 'SUPERSEDED', updatedAt: new Date() })
    .where(eq(pricingStoreDefaults.id, previous.id));

  const [row] = await executor
    .insert(pricingStoreDefaults)
    .values({
      sellerAccountId: previous.sellerAccountId,
      targetMarginRate: input.targetMarginRate,
      minContributionMinor: input.minContributionMinor,
      minContributionCurrency: input.minContributionCurrency,
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

/** Scoped by `sellerAccountId` — see `deactivateCategoryPolicy`'s comment. */
export async function deactivateStoreDefault(
  executor: Executor,
  policyId: string,
  sellerAccountId: string,
): Promise<PricingStoreDefaultRow | null> {
  const [row] = await executor
    .update(pricingStoreDefaults)
    .set({ status: 'DEACTIVATED', updatedAt: new Date() })
    .where(
      and(
        eq(pricingStoreDefaults.id, policyId),
        eq(pricingStoreDefaults.sellerAccountId, sellerAccountId),
      ),
    )
    .returning();

  return row ?? null;
}
