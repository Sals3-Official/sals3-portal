import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  or,
} from 'drizzle-orm';
import { TAXONOMY_V1_CODE_PREFIX } from '@/lib/products/sals3-category-code';
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

/**
 * Resolve many category codes in one statement — the bulk-import path needs
 * every code in an uploaded file, and one query per row would turn a 213-row
 * spreadsheet into 213 round trips inside a transaction.
 */
export async function findCategoriesByCodes(
  executor: Executor,
  codes: string[],
): Promise<Sals3CategoryRow[]> {
  if (codes.length === 0) return [];

  return executor
    .select()
    .from(sals3Categories)
    .where(inArray(sals3Categories.code, codes));
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

/**
 * The policy for **exactly** one category and one scope, with no fallback.
 *
 * This is the compare-and-set read behind every save, so the scope has to be
 * exact: resolving here would let a save that believes it is revising an
 * all-destinations rule actually supersede a destination-scoped one, or the
 * reverse. `findNearestActiveCategoryPolicy` is the resolving read; these two
 * answer different questions and must not be swapped.
 */
export async function findActiveCategoryPolicy(
  executor: Executor,
  sellerAccountId: string,
  categoryId: string,
  marketCode: string | null,
): Promise<PricingCategoryPolicyRow | null> {
  const rows = await executor
    .select()
    .from(pricingCategoryPolicies)
    .where(
      and(
        eq(pricingCategoryPolicies.sellerAccountId, sellerAccountId),
        eq(pricingCategoryPolicies.categoryId, categoryId),
        eq(pricingCategoryPolicies.status, 'ACTIVE'),
        marketCode === null
          ? isNull(pricingCategoryPolicies.marketCode)
          : eq(pricingCategoryPolicies.marketCode, marketCode),
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
/**
 * Which of two candidate rows wins, in one place.
 *
 * **Depth beats market** — owner decision, 2026-08-25, confirmed explicitly.
 * A deeper category carrying only an all-destinations rule outranks a shallower
 * one carrying a rule for this exact destination. The alternative was tried on
 * paper and rejected: if market outranked depth, setting a single country rate
 * on a department would silently override every product-level decision beneath
 * it, and nothing in the UI would show that it had.
 *
 * Market is the tie-break **within** one depth, where an exactly-scoped rule
 * beats the unscoped one. That pair can only exist because the two partial
 * unique indexes deliberately allow it: one ACTIVE row per `(seller, category)`
 * with a null scope, and one per `(seller, category, market_code)` without.
 *
 * Returns true when `row` should replace `best`.
 */
function outranks(
  row: { category: Sals3CategoryRow; policy: PricingCategoryPolicyRow },
  best: { category: Sals3CategoryRow; policy: PricingCategoryPolicyRow },
): boolean {
  if (row.category.path.length !== best.category.path.length) {
    return row.category.path.length > best.category.path.length;
  }

  // Same category: the destination-specific rule is the more specific answer.
  return row.policy.marketCode !== null && best.policy.marketCode === null;
}

/**
 * The nearest active policy for one category **in one destination**.
 *
 * `marketCode` is required and deliberately not defaulted. ADR-015's
 * `Amendment — 2026-08-25`: a caller that cannot say which destination it is
 * pricing for must refuse rather than silently resolve the all-destinations
 * rule, for the same reason `minContributionCurrency` is explicit — an inferred
 * commercial input is one nobody can audit later.
 *
 * The query widens to `market_code = $market OR market_code IS NULL`; it does
 * **not** narrow to the market alone. Dropping the unscoped rows would make a
 * seller who has configured nothing per-destination lose every margin they
 * have, which is the opposite of what "null means all destinations" promises.
 */
export async function findNearestActiveCategoryPolicy(
  executor: Executor,
  sellerAccountId: string,
  category: Sals3CategoryRow,
  marketCode: string,
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
        or(
          eq(pricingCategoryPolicies.marketCode, marketCode),
          isNull(pricingCategoryPolicies.marketCode),
        ),
      ),
    )
    .where(inArray(sals3Categories.path, chainPaths));

  if (rows.length === 0) return null;

  const deepest = rows.reduce((best, row) =>
    outranks(row, best) ? row : best,
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

export type CategoryMarginPolicySummary = {
  id: string;
  targetMarginRate: string;
  roundingRule: SchemaRoundingRule;
  version: number;
  updatedAt: Date;
  /** The scope this row was read for. `null` is the all-destinations rule. */
  marketCode: string | null;
};

export type CategoryMarginLeafRow = {
  categoryId: string;
  code: string;
  path: string;
  l1: string | null;
  l2: string | null;
  l3: string | null;
  policy: CategoryMarginPolicySummary | null;
};

/**
 * The same taxonomy row, carrying every destination's rule at once.
 *
 * Keyed by destination code rather than held as a list because every consumer
 * asks the same question — "what does this category do in AU?" — and a list
 * makes each of them write the same find.
 */
export type CategoryMarginMarketRow = {
  categoryId: string;
  code: string;
  path: string;
  l1: string | null;
  l2: string | null;
  l3: string | null;
  policies: Record<string, CategoryMarginPolicySummary>;
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
/**
 * How many categories sit under each node, counted across the WHOLE
 * taxonomy — not just the rows `listCategoryMarginOverview` returns.
 *
 * This exists because deriving the count from those rows is wrong the
 * moment they are depth-capped, and it shipped wrong: "Home & Garden —
 * 1,034 categories" rendered as "21", and the editor told a seller a
 * department margin covered 21 categories when it covered 1,034. A number
 * that understates the blast radius of a pricing change by 50x is worse
 * than no number.
 *
 * Reads one column. The 5,602 short strings stay on the server — only the
 * 213 aggregated counts reach the browser — so this is cheaper than it
 * looks and needs no recursive CTE.
 */
export async function countDescendantsByPath(
  executor: Executor,
): Promise<Map<string, number>> {
  const rows = await executor
    .select({ path: sals3Categories.path })
    .from(sals3Categories);

  const counts = new Map<string, number>();

  rows.forEach((row) => {
    const segments = row.path.split(CATEGORY_PATH_SEPARATOR);

    // Every strict ancestor of this row gains one descendant.
    for (let depth = 1; depth < segments.length; depth += 1) {
      const ancestorPath = segments
        .slice(0, depth)
        .join(CATEGORY_PATH_SEPARATOR);
      counts.set(ancestorPath, (counts.get(ancestorPath) ?? 0) + 1);
    }
  });

  return counts;
}

/**
 * `marketCode` selects **exactly one scope**, with no fallback — this is an
 * editing view, not a resolution.
 *
 * The screen must show the rules the seller's next save will replace. Showing
 * a rate inherited from all-destinations while the Save button writes a
 * destination-scoped row is the same class of bug `findStoreDefaultForScope`
 * exists to prevent, one table over.
 *
 * `null` asks for the all-destinations rules, which is what the screen shows
 * before a destination is chosen.
 */
export async function listCategoryMarginOverview(
  executor: Executor,
  sellerAccountId: string,
  marketCode: string | null,
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
      policyMarketCode: pricingCategoryPolicies.marketCode,
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
        marketCode === null
          ? isNull(pricingCategoryPolicies.marketCode)
          : eq(pricingCategoryPolicies.marketCode, marketCode),
      ),
    )
    /**
     * Depth <= 2, plus anything already carrying a policy — see the doc
     * comment. `l3 IS NULL` is the depth test: `path` is denormalized but
     * `l1`/`l2`/`l3` are the real level columns.
     *
     * **And never a `CJ-` mirror as a fresh row.** `cj-mirror.ts` inserts
     * `{ code: 'CJ-<uuid>', path, l1: path }`, leaving `l2`/`l3` null — so
     * every supplier mirror passed the depth test and appeared on this screen
     * beside the real departments, wearing the supplier's own raw path
     * (`Men's Clothing / Outerwear & Jackets / Man Ho…`). The category picker
     * already filters these (`v1-reference.ts`); this screen never got the
     * same rule.
     *
     * It is not cosmetic. `publishProduct` **refuses** a `CJ-<uuid>` category
     * (owner decision 2026-08-20), so a product filed under one can never
     * reach a live listing — which makes a margin set against it a number
     * that is guaranteed never to price anything. Offering `Set` on that row
     * invites a seller to configure nothing and believe they configured
     * something.
     *
     * A mirror that **already** carries a policy still shows, deliberately:
     * hiding it would strand a real, versioned row where nobody could
     * deactivate it. So the rule is "never offered fresh", not "never shown".
     *
     * Written as an **allow list** on the v1 prefix rather than a block list on
     * `CJ-`: the rule this screen wants is "a real Sals3 category", which is
     * `isSals3TaxonomyCode`'s rule, and a block list would silently admit
     * whatever the third code convention turns out to be.
     */
    .where(
      and(
        or(isNull(sals3Categories.l3), isNotNull(pricingCategoryPolicies.id)),
        // Unconditional, unlike the depth escape hatch above it.
        //
        // This shipped with an `OR policy IS NOT NULL` arm on the reasoning
        // that a mirror already carrying a policy should stay visible so it
        // could be deactivated rather than stranded. In production **every**
        // mirror carries one — the owner's bulk 25% import wrote a policy to
        // every row — so the arm fired on all of them and the screen looked
        // unchanged. The escape hatch was written for a rare case that is in
        // fact the normal one.
        //
        // Hiding them strands nothing, because a mirror policy is provably
        // inert: `findNearestActiveCategoryPolicy` matches on
        // `sals3_categories.path` against the chain derived from the product's
        // own path, and a mirror's path is the supplier's raw string
        // (`Men's Clothing / Outerwear & Jackets / …`, separated by `/`, not
        // ` > `). It can never be an ancestor of a real taxonomy path, so it
        // can never price anything. What is left behind is a dead row, not a
        // live rule.
        like(sals3Categories.code, `${TAXONOMY_V1_CODE_PREFIX}%`),
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
            marketCode: (row.policyMarketCode as string | null) ?? null,
          },
  }));
}

/**
 * The same overview, read once for every destination instead of once per
 * destination.
 *
 * The screen shows a column per destination now, so the alternative was six
 * calls to `listCategoryMarginOverview` — six passes over 5,595 taxonomy rows
 * to answer one question. This joins without a scope filter and groups the
 * result, so the taxonomy is scanned once and each category arrives carrying
 * whichever destination rules it has.
 *
 * The join fans out — one row per (category, destination) rule, and a category
 * with no rule at all still arrives once with a null policy. Grouping by
 * `categoryId` is what turns that back into one row per category.
 *
 * All-destinations rules (`market_code IS NULL`) are read and reported under
 * the `ALL_MARKETS_KEY` rather than dropped. They are retired by
 * `fanOutUnscopedMargins`, but a reader that silently ignored one would show
 * "Not set" for a category a live rule is still pricing — the exact failure the
 * migration exists to prevent, reintroduced one layer up.
 */
export const ALL_MARKETS_KEY = '__all__';

export async function listCategoryMarginOverviewByMarket(
  executor: Executor,
  sellerAccountId: string,
): Promise<CategoryMarginMarketRow[]> {
  const rows = await executor
    .select({
      categoryId: sals3Categories.id,
      code: sals3Categories.code,
      path: sals3Categories.path,
      l1: sals3Categories.l1,
      l2: sals3Categories.l2,
      l3: sals3Categories.l3,
      policyId: pricingCategoryPolicies.id,
      policyMarketCode: pricingCategoryPolicies.marketCode,
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
    // Same two rules as the single-scope read above, and for the same reasons:
    // depth <= 2 unless a policy already exists, and real Sals3 categories only
    // so a supplier mirror is never offered a margin it can never apply.
    .where(
      and(
        or(isNull(sals3Categories.l3), isNotNull(pricingCategoryPolicies.id)),
        like(sals3Categories.code, `${TAXONOMY_V1_CODE_PREFIX}%`),
      ),
    )
    .orderBy(
      sals3Categories.l1,
      sals3Categories.l2,
      sals3Categories.l3,
      sals3Categories.path,
    );

  const byCategory = new Map<string, CategoryMarginMarketRow>();

  rows.forEach((row) => {
    let entry = byCategory.get(row.categoryId);

    if (entry === undefined) {
      entry = {
        categoryId: row.categoryId,
        code: row.code,
        path: row.path,
        l1: row.l1,
        l2: row.l2,
        l3: row.l3,
        policies: {},
      };
      byCategory.set(row.categoryId, entry);
    }

    if (row.policyId === null) return;

    const marketCode = (row.policyMarketCode as string | null) ?? null;

    entry.policies[marketCode ?? ALL_MARKETS_KEY] = {
      id: row.policyId,
      targetMarginRate: row.targetMarginRate as string,
      roundingRule: row.roundingRule as SchemaRoundingRule,
      version: row.version as number,
      updatedAt: row.updatedAt as Date,
      marketCode,
    };
  });

  return [...byCategory.values()];
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
    /** `null` writes the all-destinations rule. */
    marketCode: string | null;
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
      // Carried from the row being superseded, never re-supplied by the caller:
      // a revision changes a rate, not which destination the rule is for.
      marketCode: previous.marketCode,
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

/**
 * The seller's active store default for one destination.
 *
 * The floor lives on this row, and the owner's justification for
 * per-destination pricing was operational expense — which is exactly what
 * `min_contribution_minor` carries. So the scope applies here too, or the rule
 * would only have moved by half.
 *
 * There is no depth here, so market is the only key: an exactly-scoped default
 * beats the unscoped one, and `.limit(1)` is gone because both can exist. Taking
 * the first row of two would have made the answer depend on Postgres's physical
 * ordering — a silent, unreproducible pick between two real configurations.
 */
/**
 * The store default for **exactly** one scope, with no fallback.
 *
 * Deliberately separate from `findActiveStoreDefault`, which resolves — walks
 * the scoped rule then the unscoped one — because a screen and a resolver want
 * opposite things from the same table.
 *
 * The resolver wants "whatever applies to this destination". An editor wants
 * "the row this scope owns, or nothing". Handing the editor the resolver's
 * answer is how a screen ends up **displaying the unscoped rule and writing a
 * scoped one**, or displaying a rule inherited from all-destinations and
 * offering a Deactivate that silently creates a new row instead.
 *
 * `null` asks for the unscoped rule, which is what the Market Rules screen
 * edits until it grows a destination selector.
 */
export async function findStoreDefaultForScope(
  executor: Executor,
  sellerAccountId: string,
  marketCode: string | null,
): Promise<PricingStoreDefaultRow | null> {
  const rows = await executor
    .select()
    .from(pricingStoreDefaults)
    .where(
      and(
        eq(pricingStoreDefaults.sellerAccountId, sellerAccountId),
        eq(pricingStoreDefaults.status, 'ACTIVE'),
        marketCode === null
          ? isNull(pricingStoreDefaults.marketCode)
          : eq(pricingStoreDefaults.marketCode, marketCode),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function findActiveStoreDefault(
  executor: Executor,
  sellerAccountId: string,
  marketCode: string,
): Promise<PricingStoreDefaultRow | null> {
  const rows = await executor
    .select()
    .from(pricingStoreDefaults)
    .where(
      and(
        eq(pricingStoreDefaults.sellerAccountId, sellerAccountId),
        eq(pricingStoreDefaults.status, 'ACTIVE'),
        or(
          eq(pricingStoreDefaults.marketCode, marketCode),
          isNull(pricingStoreDefaults.marketCode),
        ),
      ),
    );

  return rows.find((row) => row.marketCode !== null) ?? rows[0] ?? null;
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
    /**
     * Required, not optional with a null default.
     *
     * Optional here would compile at every call site and silently write the
     * all-destinations rule while a screen said otherwise — which is exactly
     * what happened before this was tightened: `saveStoreDefaultAction` read
     * the scoped row and then created an unscoped one. Making it required is
     * what turns that into a compile error.
     */
    marketCode: string | null;
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
