'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import getDb from '@/lib/db/client';
import { requirePermission } from '@/lib/auth/session';
import { PermissionError } from '@/lib/auth/permissions';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  candidateBelongsToSeller,
  appendAuditEvent,
  listAuditHistoryForSellerEntity,
  type AuditHistoryEntry,
} from '@/modules/catalog/candidates/repository';
import {
  createCategoryPolicy,
  createFundingBufferPolicy,
  createProductOverride,
  createVariantOverride,
  deactivateCategoryPolicy,
  deactivateFundingBufferPolicy,
  findActiveCategoryPolicy,
  findActiveFundingBufferPolicy,
  findActiveProductOverride,
  findActiveVariantOverride,
  findCategoryByCode,
  findCategoryById,
  findLeafCategoriesByL1L2,
  removeProductOverride,
  removeVariantOverride,
  reviseCategoryPolicy,
  reviseFundingBufferPolicy,
  searchCategories,
} from '@/modules/pricing/repository';
import {
  isValidFxAdjustmentRate,
  isValidMarginRate,
  parseScaledRate,
} from '@/modules/pricing/money-math';
import type { Sals3CategoryRow } from '@/lib/db/schema';

/**
 * Server actions for Settings → Market Rules → Category pricing / funding
 * buffer (ADR-015 Phase 1). Every action follows the same discipline as
 * `supplier-apps/actions.ts`: Zod-validate, authorize, rate-limit, do every
 * read/write inside one transaction scoped to `session.sellerId`, audit
 * inside that same transaction, then return a typed `reason` instead of
 * letting a thrown error reach the browser as Next's global error page.
 */

const RATE_LIMIT = { capacity: 20, refillIntervalMs: 60_000 };
const MIN_REASON_LENGTH = 10;

const marginRateSchema = z.string().refine((value) => {
  try {
    return isValidMarginRate(parseScaledRate(value));
  } catch {
    return false;
  }
}, 'Enter a margin rate strictly between 0 and 1, e.g. 0.30 for 30%.');

const fxAdjustmentRateSchema = z.string().refine((value) => {
  try {
    return isValidFxAdjustmentRate(parseScaledRate(value));
  } catch {
    return false;
  }
}, 'Enter an adjustment between -20% and +20%, e.g. 0.025 for +2.5%.');

const reasonSchema = z
  .string()
  .trim()
  .min(MIN_REASON_LENGTH, 'Explain why in at least 10 characters.')
  .max(500);

const roundingRuleSchema = z.enum(['NONE', 'NEAREST_0_99']);

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { data: T }))
  | {
      ok: false;
      reason:
        | 'invalid_input'
        | 'denied'
        | 'rate_limited'
        | 'not_found'
        | 'category_mapping_unresolved'
        | 'failed';
      fieldErrors?: Record<string, string>;
    };

async function authorize(
  permission: 'pricing_policy:read' | 'pricing_policy:manage',
  rateLimitKey: string,
): Promise<
  | { ok: true; sellerAccountId: string; actorId: string }
  | { ok: false; reason: 'denied' | 'rate_limited' }
> {
  let session;

  try {
    session = await requirePermission(permission);
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, reason: 'denied' };
    throw error;
  }

  const limit = checkRateLimit(
    `${rateLimitKey}:${session.sellerId}`,
    RATE_LIMIT,
  );
  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  return {
    ok: true,
    sellerAccountId: session.sellerId,
    actorId: session.userId,
  };
}

// --- Category search (read) ------------------------------------------------

export async function searchSals3CategoriesAction(
  query: string,
): Promise<ActionResult<Sals3CategoryRow[]>> {
  const auth = await authorize(
    'pricing_policy:read',
    'pricing:search-categories',
  );
  if (!auth.ok) return auth;

  try {
    const rows = await searchCategories(getDb(), query);
    return { ok: true, data: rows };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] category search failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

// --- Category pricing policy -----------------------------------------------

const saveCategoryPolicyInputSchema = z.object({
  categoryCode: z.string().trim().min(1).max(64),
  targetMarginRate: marginRateSchema,
  roundingRule: roundingRuleSchema,
  reason: reasonSchema,
});

export async function saveCategoryPolicyAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = saveCategoryPolicyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:save-category-policy',
  );
  if (!auth.ok) return auth;

  try {
    const category = await findCategoryByCode(
      getDb(),
      parsed.data.categoryCode,
    );
    if (category === null) return { ok: false, reason: 'not_found' };

    await getDb().transaction(async (tx) => {
      const existing = await findActiveCategoryPolicy(
        tx,
        auth.sellerAccountId,
        category.id,
      );

      const row =
        existing === null
          ? await createCategoryPolicy(tx, {
              sellerAccountId: auth.sellerAccountId,
              categoryId: category.id,
              targetMarginRate: parsed.data.targetMarginRate,
              roundingRule: parsed.data.roundingRule,
              reason: parsed.data.reason,
              actorId: auth.actorId,
            })
          : await reviseCategoryPolicy(tx, existing, {
              targetMarginRate: parsed.data.targetMarginRate,
              roundingRule: parsed.data.roundingRule,
              reason: parsed.data.reason,
              actorId: auth.actorId,
            });

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action:
          existing === null
            ? 'category_pricing_policy.created'
            : 'category_pricing_policy.revised',
        entityType: 'PricingCategoryPolicy',
        entityId: row.id,
        payload: {
          sellerAccountId: auth.sellerAccountId,
          categoryCode: category.code,
          targetMarginRate: parsed.data.targetMarginRate,
          roundingRule: parsed.data.roundingRule,
          reason: parsed.data.reason,
          version: row.version,
          supersedesId: row.supersedesId,
        },
      });
    });

    revalidatePath('/market-rules');
    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] save category policy failed', {
      sellerAccountId: auth.sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

const saveCategoryGroupMarginInputSchema = z.object({
  l1: z.string().trim().min(1).max(128),
  l2: z.string().trim().min(1).max(128),
  targetMarginRate: marginRateSchema,
  roundingRule: roundingRuleSchema,
  reason: reasonSchema,
});

/**
 * Bulk-sets margin for every leaf category currently under one L1>L2
 * group, in one transaction — the setup-UI equivalent of calling
 * `saveCategoryPolicyAction` once per leaf. Storage stays exactly as it is
 * for a single-category save: one policy row per `(sellerAccountId,
 * categoryId)`, unconditionally created-or-revised. The leaf set is always
 * recomputed from `(l1, l2)` here, never taken from the caller, so a
 * client cannot bulk-write categories it never actually looked up.
 *
 * Overwrite is unconditional and by design: every current leaf under the
 * group — including ones a seller individually customized before this
 * click — gets the new rate and rounding. The UI's own confirmation step
 * is what makes that safe, not a server-side "skip if different" rule.
 */
export async function saveCategoryGroupMarginAction(
  input: unknown,
): Promise<ActionResult<{ updatedCount: number }>> {
  const parsed = saveCategoryGroupMarginInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:save-category-group-margin',
  );
  if (!auth.ok) return auth;

  try {
    const leaves = await findLeafCategoriesByL1L2(
      getDb(),
      parsed.data.l1,
      parsed.data.l2,
    );
    if (leaves.length === 0) return { ok: false, reason: 'not_found' };

    // Ties every audit row this one click produces back to one bulk
    // operation, without inventing a new entityType/table for it.
    const bulkOperationId = crypto.randomUUID();

    await getDb().transaction(async (tx) => {
      /* eslint-disable no-await-in-loop */
      // eslint-disable-next-line no-restricted-syntax -- sequential: every leaf's write shares this one transaction's connection, and the audit trail is easiest to reason about in creation order.
      for (const leaf of leaves) {
        const existing = await findActiveCategoryPolicy(
          tx,
          auth.sellerAccountId,
          leaf.id,
        );

        const row =
          existing === null
            ? await createCategoryPolicy(tx, {
                sellerAccountId: auth.sellerAccountId,
                categoryId: leaf.id,
                targetMarginRate: parsed.data.targetMarginRate,
                roundingRule: parsed.data.roundingRule,
                reason: parsed.data.reason,
                actorId: auth.actorId,
              })
            : await reviseCategoryPolicy(tx, existing, {
                targetMarginRate: parsed.data.targetMarginRate,
                roundingRule: parsed.data.roundingRule,
                reason: parsed.data.reason,
                actorId: auth.actorId,
              });

        await appendAuditEvent(tx, {
          actorId: auth.actorId,
          action:
            existing === null
              ? 'category_pricing_policy.created'
              : 'category_pricing_policy.revised',
          entityType: 'PricingCategoryPolicy',
          entityId: row.id,
          payload: {
            sellerAccountId: auth.sellerAccountId,
            categoryCode: leaf.code,
            targetMarginRate: parsed.data.targetMarginRate,
            roundingRule: parsed.data.roundingRule,
            reason: parsed.data.reason,
            version: row.version,
            supersedesId: row.supersedesId,
            bulkOperationId,
            bulkL1: parsed.data.l1,
            bulkL2: parsed.data.l2,
            bulkLeafCount: leaves.length,
          },
        });
      }
      /* eslint-enable no-await-in-loop */
    });

    revalidatePath('/market-rules');
    return { ok: true, data: { updatedCount: leaves.length } };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] save category group margin failed', {
      sellerAccountId: auth.sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

const deactivateCategoryPolicyInputSchema = z.object({
  policyId: z.string().uuid(),
  sellerAccountId: z.string().uuid(),
});

export async function deactivateCategoryPolicyAction(
  policyId: string,
  sellerAccountIdOfPolicy: string,
): Promise<ActionResult> {
  const parsed = deactivateCategoryPolicyInputSchema.safeParse({
    policyId,
    sellerAccountId: sellerAccountIdOfPolicy,
  });
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:deactivate-category-policy',
  );
  if (!auth.ok) return auth;

  // Cheap early exit for the obvious case, but the real IDOR guard is the
  // sellerAccountId filter inside `deactivateCategoryPolicy`'s own WHERE
  // clause below — a caller-claimed seller id checked only against the
  // caller's own session proves nothing about who the policyId actually
  // belongs to.
  if (parsed.data.sellerAccountId !== auth.sellerAccountId) {
    return { ok: false, reason: 'denied' };
  }

  try {
    let notFound = false;

    await getDb().transaction(async (tx) => {
      const deactivated = await deactivateCategoryPolicy(
        tx,
        parsed.data.policyId,
        auth.sellerAccountId,
      );

      if (deactivated === null) {
        notFound = true;
        return;
      }

      const category = await findCategoryById(tx, deactivated.categoryId);

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action: 'category_pricing_policy.deactivated',
        entityType: 'PricingCategoryPolicy',
        entityId: parsed.data.policyId,
        payload: {
          sellerAccountId: auth.sellerAccountId,
          categoryCode: category?.code ?? null,
        },
      });
    });

    if (notFound) return { ok: false, reason: 'not_found' };

    revalidatePath('/market-rules');
    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] deactivate category policy failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

// --- Funding buffer policy ---------------------------------------------------

const saveFundingBufferPolicyInputSchema = z.object({
  adjustmentRate: fxAdjustmentRateSchema,
  reason: reasonSchema,
  effectiveTo: z.string().datetime().optional(),
});

export async function saveFundingBufferPolicyAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = saveFundingBufferPolicyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:save-funding-buffer-policy',
  );
  if (!auth.ok) return auth;

  try {
    await getDb().transaction(async (tx) => {
      const existing = await findActiveFundingBufferPolicy(
        tx,
        auth.sellerAccountId,
      );

      const effectiveTo =
        parsed.data.effectiveTo === undefined
          ? null
          : new Date(parsed.data.effectiveTo);

      const row =
        existing === null
          ? await createFundingBufferPolicy(tx, {
              sellerAccountId: auth.sellerAccountId,
              adjustmentRate: parsed.data.adjustmentRate,
              reason: parsed.data.reason,
              actorId: auth.actorId,
              effectiveTo,
            })
          : await reviseFundingBufferPolicy(tx, existing, {
              adjustmentRate: parsed.data.adjustmentRate,
              reason: parsed.data.reason,
              actorId: auth.actorId,
              effectiveTo,
            });

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action:
          existing === null
            ? 'funding_buffer_policy.created'
            : 'funding_buffer_policy.revised',
        entityType: 'PricingFxAdjustmentPolicy',
        entityId: row.id,
        payload: {
          sellerAccountId: auth.sellerAccountId,
          adjustmentRate: parsed.data.adjustmentRate,
          reason: parsed.data.reason,
          version: row.version,
        },
      });
    });

    revalidatePath('/market-rules');
    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] save funding buffer policy failed', {
      sellerAccountId: auth.sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

export async function deactivateFundingBufferPolicyAction(
  policyId: string,
  sellerAccountIdOfPolicy: string,
): Promise<ActionResult> {
  const parsed = z
    .object({ policyId: z.string().uuid(), sellerAccountId: z.string().uuid() })
    .safeParse({ policyId, sellerAccountId: sellerAccountIdOfPolicy });
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:deactivate-funding-buffer-policy',
  );
  if (!auth.ok) return auth;

  // Cheap early exit for the obvious case; the real IDOR guard is the
  // sellerAccountId filter inside `deactivateFundingBufferPolicy`'s own
  // WHERE clause below — see `deactivateCategoryPolicyAction`'s comment.
  if (parsed.data.sellerAccountId !== auth.sellerAccountId) {
    return { ok: false, reason: 'denied' };
  }

  try {
    let notFound = false;

    await getDb().transaction(async (tx) => {
      const deactivated = await deactivateFundingBufferPolicy(
        tx,
        parsed.data.policyId,
        auth.sellerAccountId,
      );

      if (deactivated === null) {
        notFound = true;
        return;
      }

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action: 'funding_buffer_policy.deactivated',
        entityType: 'PricingFxAdjustmentPolicy',
        entityId: parsed.data.policyId,
        payload: { sellerAccountId: auth.sellerAccountId },
      });
    });

    if (notFound) return { ok: false, reason: 'not_found' };

    revalidatePath('/market-rules');
    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] deactivate funding buffer policy failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

// --- Product / variant overrides --------------------------------------------

const saveProductOverrideInputSchema = z.object({
  supplierCandidateId: z.string().uuid(),
  targetMarginRate: marginRateSchema,
  reason: reasonSchema,
});

export async function saveProductOverrideAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = saveProductOverrideInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:save-product-override',
  );
  if (!auth.ok) return auth;

  try {
    const owns = await candidateBelongsToSeller(
      getDb(),
      parsed.data.supplierCandidateId,
      auth.sellerAccountId,
    );
    if (!owns) return { ok: false, reason: 'not_found' };

    await getDb().transaction(async (tx) => {
      const existing = await findActiveProductOverride(
        tx,
        parsed.data.supplierCandidateId,
      );
      if (existing !== null) {
        await removeProductOverride(
          tx,
          existing.id,
          parsed.data.supplierCandidateId,
        );
      }

      const row = await createProductOverride(tx, {
        supplierCandidateId: parsed.data.supplierCandidateId,
        targetMarginRate: parsed.data.targetMarginRate,
        reason: parsed.data.reason,
        actorId: auth.actorId,
      });

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action: 'product_pricing_override.created',
        entityType: 'PricingProductOverride',
        entityId: row.id,
        payload: {
          sellerAccountId: auth.sellerAccountId,
          supplierCandidateId: parsed.data.supplierCandidateId,
          targetMarginRate: parsed.data.targetMarginRate,
          reason: parsed.data.reason,
          replacedOverrideId: existing?.id ?? null,
        },
      });
    });

    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] save product override failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

export async function removeProductOverrideAction(
  overrideId: string,
  supplierCandidateId: string,
): Promise<ActionResult> {
  const parsed = z
    .object({
      overrideId: z.string().uuid(),
      supplierCandidateId: z.string().uuid(),
    })
    .safeParse({ overrideId, supplierCandidateId });
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:remove-product-override',
  );
  if (!auth.ok) return auth;

  try {
    const owns = await candidateBelongsToSeller(
      getDb(),
      parsed.data.supplierCandidateId,
      auth.sellerAccountId,
    );
    if (!owns) return { ok: false, reason: 'not_found' };

    let notFound = false;

    await getDb().transaction(async (tx) => {
      const removed = await removeProductOverride(
        tx,
        parsed.data.overrideId,
        parsed.data.supplierCandidateId,
      );

      if (removed === null) {
        notFound = true;
        return;
      }

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action: 'product_pricing_override.removed',
        entityType: 'PricingProductOverride',
        entityId: parsed.data.overrideId,
        payload: {
          sellerAccountId: auth.sellerAccountId,
          supplierCandidateId: parsed.data.supplierCandidateId,
        },
      });
    });

    if (notFound) return { ok: false, reason: 'not_found' };

    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] remove product override failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

const saveVariantOverrideInputSchema = z.object({
  supplierCandidateId: z.string().uuid(),
  supplierVariantId: z.string().trim().min(1).max(128),
  targetMarginRate: marginRateSchema,
  reason: reasonSchema,
  additionalJustification: z
    .string()
    .trim()
    .min(MIN_REASON_LENGTH, 'Explain the materially different cost or risk.')
    .max(500),
});

export async function saveVariantOverrideAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = saveVariantOverrideInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:save-variant-override',
  );
  if (!auth.ok) return auth;

  try {
    const owns = await candidateBelongsToSeller(
      getDb(),
      parsed.data.supplierCandidateId,
      auth.sellerAccountId,
    );
    if (!owns) return { ok: false, reason: 'not_found' };

    await getDb().transaction(async (tx) => {
      const existing = await findActiveVariantOverride(
        tx,
        parsed.data.supplierCandidateId,
        parsed.data.supplierVariantId,
      );
      if (existing !== null) {
        await removeVariantOverride(
          tx,
          existing.id,
          parsed.data.supplierCandidateId,
        );
      }

      const row = await createVariantOverride(tx, {
        supplierCandidateId: parsed.data.supplierCandidateId,
        supplierVariantId: parsed.data.supplierVariantId,
        targetMarginRate: parsed.data.targetMarginRate,
        reason: parsed.data.reason,
        additionalJustification: parsed.data.additionalJustification,
        actorId: auth.actorId,
      });

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action: 'variant_pricing_override.created',
        entityType: 'PricingVariantOverride',
        entityId: row.id,
        payload: {
          sellerAccountId: auth.sellerAccountId,
          supplierCandidateId: parsed.data.supplierCandidateId,
          supplierVariantId: parsed.data.supplierVariantId,
          targetMarginRate: parsed.data.targetMarginRate,
          reason: parsed.data.reason,
          additionalJustification: parsed.data.additionalJustification,
          replacedOverrideId: existing?.id ?? null,
        },
      });
    });

    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] save variant override failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

export async function removeVariantOverrideAction(
  overrideId: string,
  supplierCandidateId: string,
): Promise<ActionResult> {
  const parsed = z
    .object({
      overrideId: z.string().uuid(),
      supplierCandidateId: z.string().uuid(),
    })
    .safeParse({ overrideId, supplierCandidateId });
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:remove-variant-override',
  );
  if (!auth.ok) return auth;

  try {
    const owns = await candidateBelongsToSeller(
      getDb(),
      parsed.data.supplierCandidateId,
      auth.sellerAccountId,
    );
    if (!owns) return { ok: false, reason: 'not_found' };

    let notFound = false;

    await getDb().transaction(async (tx) => {
      const removed = await removeVariantOverride(
        tx,
        parsed.data.overrideId,
        parsed.data.supplierCandidateId,
      );

      if (removed === null) {
        notFound = true;
        return;
      }

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action: 'variant_pricing_override.removed',
        entityType: 'PricingVariantOverride',
        entityId: parsed.data.overrideId,
        payload: {
          sellerAccountId: auth.sellerAccountId,
          supplierCandidateId: parsed.data.supplierCandidateId,
        },
      });
    });

    if (notFound) return { ok: false, reason: 'not_found' };

    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] remove variant override failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

// --- Policy history (read) --------------------------------------------------

/**
 * Read-only, `pricing_policy:read`-gated (not `:manage` — viewing history
 * needs less authority than changing a policy). Both actions scope by
 * `auth.sellerAccountId` exclusively, matching this file's IDOR discipline
 * throughout: a category code or funding-buffer lookup can only ever
 * surface the caller's own seller's history, never another tenant's.
 */

export async function getCategoryPolicyHistoryAction(
  categoryCode: string,
): Promise<ActionResult<AuditHistoryEntry[]>> {
  const parsed = z.string().trim().min(1).max(64).safeParse(categoryCode);
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(
    'pricing_policy:read',
    'pricing:category-policy-history',
  );
  if (!auth.ok) return auth;

  try {
    const data = await listAuditHistoryForSellerEntity(getDb(), {
      entityType: 'PricingCategoryPolicy',
      sellerAccountId: auth.sellerAccountId,
      payloadEquals: { categoryCode: parsed.data },
    });
    return { ok: true, data };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] category policy history read failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

/** Group-level history — bulk operations for one L1>L2 only, distinct from a single leaf's own full history above. */
export async function getCategoryGroupHistoryAction(
  l1: string,
  l2: string,
): Promise<ActionResult<AuditHistoryEntry[]>> {
  const parsed = z
    .object({
      l1: z.string().trim().min(1).max(128),
      l2: z.string().trim().min(1).max(128),
    })
    .safeParse({ l1, l2 });
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(
    'pricing_policy:read',
    'pricing:category-group-history',
  );
  if (!auth.ok) return auth;

  try {
    const data = await listAuditHistoryForSellerEntity(getDb(), {
      entityType: 'PricingCategoryPolicy',
      sellerAccountId: auth.sellerAccountId,
      payloadEquals: { bulkL1: parsed.data.l1, bulkL2: parsed.data.l2 },
    });
    return { ok: true, data };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] category group history read failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

/** At most one active funding buffer per seller, so no extra payload filter is needed — this seller's whole history for it. */
export async function getFundingBufferHistoryAction(): Promise<
  ActionResult<AuditHistoryEntry[]>
> {
  const auth = await authorize(
    'pricing_policy:read',
    'pricing:funding-buffer-history',
  );
  if (!auth.ok) return auth;

  try {
    const data = await listAuditHistoryForSellerEntity(getDb(), {
      entityType: 'PricingFxAdjustmentPolicy',
      sellerAccountId: auth.sellerAccountId,
    });
    return { ok: true, data };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] funding buffer history read failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}
