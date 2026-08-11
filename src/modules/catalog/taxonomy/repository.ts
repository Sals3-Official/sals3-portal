import { and, asc, eq, sql } from 'drizzle-orm';

import type { Executor } from '@/modules/catalog/candidates/repository';
import {
  categoryRemapReviewFindings,
  products,
  providerCategoryMappings,
  sals3Categories,
  sals3CategoryPresets,
  type CategoryMappingConfidence,
  type CategoryRemapReviewFindingRow,
  type ProductRow,
  type ProviderCategoryMappingMethod,
  type ProviderCategoryMappingRow,
  type Sals3CategoryPresetRow,
  type Sals3CategoryRow,
} from '@/lib/db/schema';

/**
 * Data access for category mapping and taxonomy presets.
 *
 * Reads are local database reads only: no CJ call, no supplier adapter, no
 * workbook parsing, no network. Every lookup is served by an index declared
 * on the table (`provider_category_mappings_active_key`,
 * `sals3_category_presets_category_version_key`,
 * `category_remap_review_findings_open_idx`). There is no unbounded scan and
 * no per-row lookup inside a loop.
 *
 * Like `modules/pricing/repository.ts` and `modules/market-config/
 * repository.ts`, nothing here opens a transaction. The caller passes an
 * `Executor` so a supersede, an activation, its findings, and its audit rows
 * all land in one.
 */

// --- Taxonomy reference ----------------------------------------------------

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

export async function findPresetByCategoryCode(
  executor: Executor,
  code: string,
  taxonomyVersion: string,
): Promise<Sals3CategoryPresetRow | null> {
  const rows = await executor
    .select({ preset: sals3CategoryPresets })
    .from(sals3CategoryPresets)
    .innerJoin(
      sals3Categories,
      eq(sals3Categories.id, sals3CategoryPresets.categoryId),
    )
    .where(
      and(
        eq(sals3Categories.code, code),
        eq(sals3CategoryPresets.taxonomyVersion, taxonomyVersion),
      ),
    )
    .limit(1);

  return rows[0]?.preset ?? null;
}

// --- Mapping lookups -------------------------------------------------------

export type ActiveMappingWithCategory = {
  mapping: ProviderCategoryMappingRow;
  /** `null` for an `AMBIGUOUS`/`UNMAPPED` mapping, which by check constraint names no category. */
  category: Sals3CategoryRow | null;
};

/**
 * The one read the resolver makes. A single statement with a `LEFT JOIN`, so
 * a mapped decision never costs a second round trip per candidate — the
 * N+1 shape this would otherwise take when rendering a page of candidates.
 */
export async function findActiveMapping(
  executor: Executor,
  provider: ProviderCategoryMappingRow['provider'],
  externalCategoryId: string,
): Promise<ActiveMappingWithCategory | null> {
  const rows = await executor
    .select({ mapping: providerCategoryMappings, category: sals3Categories })
    .from(providerCategoryMappings)
    .leftJoin(
      sals3Categories,
      eq(sals3Categories.id, providerCategoryMappings.sals3CategoryId),
    )
    .where(
      and(
        eq(providerCategoryMappings.provider, provider),
        eq(providerCategoryMappings.externalCategoryId, externalCategoryId),
        eq(providerCategoryMappings.status, 'ACTIVE'),
      ),
    )
    .limit(1);

  const row = rows[0];

  return row === undefined
    ? null
    : { mapping: row.mapping, category: row.category };
}

export async function findMappingById(
  executor: Executor,
  mappingId: string,
): Promise<ProviderCategoryMappingRow | null> {
  const rows = await executor
    .select()
    .from(providerCategoryMappings)
    .where(eq(providerCategoryMappings.id, mappingId))
    .limit(1);

  return rows[0] ?? null;
}

/** Highest version ever issued for an identity, across every status. `0` when none exists. */
export async function findHighestMappingVersion(
  executor: Executor,
  provider: ProviderCategoryMappingRow['provider'],
  externalCategoryId: string,
): Promise<number> {
  const rows = await executor
    .select({
      highest: sql<number>`coalesce(max(${providerCategoryMappings.mappingVersion}), 0)`,
    })
    .from(providerCategoryMappings)
    .where(
      and(
        eq(providerCategoryMappings.provider, provider),
        eq(providerCategoryMappings.externalCategoryId, externalCategoryId),
      ),
    );

  return Number(rows[0]?.highest ?? 0);
}

export async function findMappingByVersion(
  executor: Executor,
  provider: ProviderCategoryMappingRow['provider'],
  externalCategoryId: string,
  mappingVersion: number,
): Promise<ProviderCategoryMappingRow | null> {
  const rows = await executor
    .select()
    .from(providerCategoryMappings)
    .where(
      and(
        eq(providerCategoryMappings.provider, provider),
        eq(providerCategoryMappings.externalCategoryId, externalCategoryId),
        eq(providerCategoryMappings.mappingVersion, mappingVersion),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Full version history for one supplier category, oldest first. Superseded rows stay readable forever. */
export async function listMappingHistory(
  executor: Executor,
  provider: ProviderCategoryMappingRow['provider'],
  externalCategoryId: string,
): Promise<ProviderCategoryMappingRow[]> {
  return executor
    .select()
    .from(providerCategoryMappings)
    .where(
      and(
        eq(providerCategoryMappings.provider, provider),
        eq(providerCategoryMappings.externalCategoryId, externalCategoryId),
      ),
    )
    .orderBy(asc(providerCategoryMappings.mappingVersion));
}

// --- Mapping writes --------------------------------------------------------

/**
 * Inserts a proposal at an exact version. Returns `null` when that version
 * already exists, which is what makes a retried proposal idempotent instead
 * of forking the history into two rows claiming the same version.
 */
export async function insertMappingProposal(
  executor: Executor,
  input: {
    provider: ProviderCategoryMappingRow['provider'];
    externalCategoryId: string;
    observedCategoryPath: string | null;
    sals3CategoryId: string | null;
    taxonomyVersion: string;
    mappingVersion: number;
    supersedesId: string | null;
    method: ProviderCategoryMappingMethod;
    confidence: CategoryMappingConfidence;
    reason: string;
    evidenceReference: string | null;
    actorId: string;
  },
): Promise<ProviderCategoryMappingRow | null> {
  const rows = await executor
    .insert(providerCategoryMappings)
    .values({
      ...input,
      reviewStatus: 'PENDING_REVIEW',
      status: 'PROPOSED',
    })
    .onConflictDoNothing({
      target: [
        providerCategoryMappings.provider,
        providerCategoryMappings.externalCategoryId,
        providerCategoryMappings.mappingVersion,
      ],
    })
    .returning();

  return rows[0] ?? null;
}

/**
 * Compare-and-set on the exact row state the caller read. A stale tab, a
 * replayed request, or a concurrent reviewer matches zero rows and gets
 * `null` rather than overwriting a transition it never saw.
 */
export async function reviewMapping(
  executor: Executor,
  input: {
    mappingId: string;
    expectedStatus: ProviderCategoryMappingRow['status'];
    expectedMappingVersion: number;
    nextReviewStatus: ProviderCategoryMappingRow['reviewStatus'];
    nextStatus: ProviderCategoryMappingRow['status'];
    reason: string;
    reviewedBy: string;
  },
): Promise<ProviderCategoryMappingRow | null> {
  const now = new Date();

  const rows = await executor
    .update(providerCategoryMappings)
    .set({
      reviewStatus: input.nextReviewStatus,
      status: input.nextStatus,
      reason: input.reason,
      reviewedBy: input.reviewedBy,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(providerCategoryMappings.id, input.mappingId),
        eq(providerCategoryMappings.status, input.expectedStatus),
        eq(
          providerCategoryMappings.mappingVersion,
          input.expectedMappingVersion,
        ),
      ),
    )
    .returning();

  return rows[0] ?? null;
}

/**
 * Retires the currently active row for an identity. Also a compare-and-set:
 * it names the version it believes is active, so two concurrent activations
 * cannot both think they superseded the same predecessor.
 */
export async function supersedeActiveMapping(
  executor: Executor,
  input: {
    provider: ProviderCategoryMappingRow['provider'];
    externalCategoryId: string;
    expectedMappingVersion: number;
  },
): Promise<ProviderCategoryMappingRow | null> {
  const rows = await executor
    .update(providerCategoryMappings)
    .set({ status: 'SUPERSEDED', updatedAt: new Date() })
    .where(
      and(
        eq(providerCategoryMappings.provider, input.provider),
        eq(
          providerCategoryMappings.externalCategoryId,
          input.externalCategoryId,
        ),
        eq(providerCategoryMappings.status, 'ACTIVE'),
        eq(
          providerCategoryMappings.mappingVersion,
          input.expectedMappingVersion,
        ),
      ),
    )
    .returning();

  return rows[0] ?? null;
}

// --- Remap review findings -------------------------------------------------

/**
 * Records that one active mapping was superseded and its effect needs review.
 *
 * `onConflictDoNothing` on the summary partial unique index makes a replayed
 * correction a no-op instead of a duplicate queue of work, so `null` here
 * means "already raised", not "failed".
 *
 * This only ever inserts into its own table. It does not update a candidate,
 * an evaluation, a supplier snapshot, or any audit row — a remap marks
 * history for review, it never rewrites it.
 *
 * `affectedCandidatesEnumerated` is `false` because this branch has no
 * persisted provider category id on `supplier_candidates` to enumerate by;
 * see the table's doc comment. The per-candidate insert that will set it
 * `true` belongs to the follow-up that lands that column, and writing a
 * guessed list from a category *name* instead would be the exact mistake this
 * module exists to prevent.
 */
export async function insertRemapReviewSummary(
  executor: Executor,
  row: {
    provider: ProviderCategoryMappingRow['provider'];
    externalCategoryId: string;
    previousMappingId: string;
    previousMappingVersion: number;
    newMappingId: string | null;
    newMappingVersion: number | null;
    reason: string;
    actorId: string;
  },
): Promise<CategoryRemapReviewFindingRow | null> {
  const rows = await executor
    .insert(categoryRemapReviewFindings)
    .values({
      ...row,
      supplierCandidateId: null,
      affectedCandidatesEnumerated: false,
      status: 'OPEN',
    })
    .onConflictDoNothing({
      target: categoryRemapReviewFindings.previousMappingId,
      where: sql`${categoryRemapReviewFindings.supplierCandidateId} is null`,
    })
    .returning();

  return rows[0] ?? null;
}

export async function listOpenRemapReviewFindings(
  executor: Executor,
  input: {
    provider: ProviderCategoryMappingRow['provider'];
    externalCategoryId: string;
    limit: number;
  },
): Promise<CategoryRemapReviewFindingRow[]> {
  return executor
    .select()
    .from(categoryRemapReviewFindings)
    .where(
      and(
        eq(categoryRemapReviewFindings.provider, input.provider),
        eq(
          categoryRemapReviewFindings.externalCategoryId,
          input.externalCategoryId,
        ),
        eq(categoryRemapReviewFindings.status, 'OPEN'),
      ),
    )
    .orderBy(asc(categoryRemapReviewFindings.createdAt))
    .limit(input.limit);
}

// --- Product category assignment -------------------------------------------

/**
 * Stamps a resolved category and its provenance onto a product.
 *
 * Scoped to the steward and gated on the exact `version` the caller read, so
 * a stale editor or a double submit matches zero rows and gets `null` rather
 * than overwriting an assignment it never saw. `null` is one answer for "not
 * yours, not there, or moved on" — a caller cannot probe for another tenant's
 * product.
 */
export async function assignProductCategory(
  executor: Executor,
  input: {
    productId: string;
    stewardSellerAccountId: string;
    expectedVersion: number;
    categoryId: string;
    categoryMappingConfidence: CategoryMappingConfidence;
    categoryMappingId: string;
    categoryMappingVersion: number;
    actorId: string;
  },
): Promise<ProductRow | null> {
  const rows = await executor
    .update(products)
    .set({
      categoryId: input.categoryId,
      categoryMappingConfidence: input.categoryMappingConfidence,
      categoryMappingId: input.categoryMappingId,
      categoryMappingVersion: input.categoryMappingVersion,
      version: input.expectedVersion + 1,
      updatedAt: new Date(),
      updatedBy: input.actorId,
    })
    .where(
      and(
        eq(products.id, input.productId),
        eq(products.stewardSellerAccountId, input.stewardSellerAccountId),
        eq(products.version, input.expectedVersion),
      ),
    )
    .returning();

  return rows[0] ?? null;
}

/**
 * Returns a product to `UNMAPPED` with no category and no provenance.
 *
 * Used when the resolver reports review — including for a product that was
 * mapped under a rule since superseded. Clearing is the safe direction: a
 * product with no category cannot be priced (the pricing resolver refuses
 * `UNMAPPED`) or published on a category basis, whereas one still carrying a
 * withdrawn category would keep looking decided.
 */
export async function clearProductCategory(
  executor: Executor,
  input: {
    productId: string;
    stewardSellerAccountId: string;
    expectedVersion: number;
    actorId: string;
  },
): Promise<ProductRow | null> {
  const rows = await executor
    .update(products)
    .set({
      categoryId: null,
      categoryMappingConfidence: 'UNMAPPED',
      categoryMappingId: null,
      categoryMappingVersion: null,
      version: input.expectedVersion + 1,
      updatedAt: new Date(),
      updatedBy: input.actorId,
    })
    .where(
      and(
        eq(products.id, input.productId),
        eq(products.stewardSellerAccountId, input.stewardSellerAccountId),
        eq(products.version, input.expectedVersion),
      ),
    )
    .returning();

  return rows[0] ?? null;
}
