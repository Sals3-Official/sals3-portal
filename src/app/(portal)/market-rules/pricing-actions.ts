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
} from '@/modules/catalog/candidates/repository';
import {
  createCategoryPolicy,
  createFxAdjustmentPolicy,
  createProductOverride,
  createVariantOverride,
  deactivateCategoryPolicy,
  deactivateFxAdjustmentPolicy,
  findActiveCategoryPolicy,
  findActiveFxAdjustmentPolicy,
  findActiveProductOverride,
  findActiveVariantOverride,
  findCategoryByCode,
  removeProductOverride,
  removeVariantOverride,
  reviseCategoryPolicy,
  reviseFxAdjustmentPolicy,
  searchCategories,
} from '@/modules/pricing/repository';
import {
  isValidFxAdjustmentRate,
  isValidMarginRate,
  parseScaledRate,
} from '@/modules/pricing/money-math';
import type { Sals3CategoryRow } from '@/lib/db/schema';

/**
 * Server actions for Settings → Market Rules → Category pricing / FX
 * adjustment (ADR-015 Phase 1). Every action follows the same discipline as
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

const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Enter a 3-letter ISO currency code.');

const roundingRuleSchema = z.enum(['NONE', 'NEAREST_0_99']);
const fundingRailSchema = z.enum([
  'CJ_WALLET_WIRE_TRANSFER',
  'CJ_WALLET_PAYONEER',
  'OTHER',
]);

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

  // IDOR guard: the id a seller may deactivate must be their own — never
  // trust the browser's claim about which seller owns this policy.
  if (parsed.data.sellerAccountId !== auth.sellerAccountId) {
    return { ok: false, reason: 'denied' };
  }

  try {
    await getDb().transaction(async (tx) => {
      await deactivateCategoryPolicy(tx, parsed.data.policyId);
      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action: 'category_pricing_policy.deactivated',
        entityType: 'PricingCategoryPolicy',
        entityId: parsed.data.policyId,
        payload: { sellerAccountId: auth.sellerAccountId },
      });
    });

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

// --- FX adjustment policy ---------------------------------------------------

const saveFxAdjustmentPolicyInputSchema = z.object({
  sourceCurrency: currencySchema,
  targetCurrency: currencySchema,
  fundingRail: fundingRailSchema,
  adjustmentRate: fxAdjustmentRateSchema,
  reason: reasonSchema,
  effectiveTo: z.string().datetime().optional(),
});

export async function saveFxAdjustmentPolicyAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = saveFxAdjustmentPolicyInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:save-fx-policy',
  );
  if (!auth.ok) return auth;

  try {
    await getDb().transaction(async (tx) => {
      const existing = await findActiveFxAdjustmentPolicy(
        tx,
        auth.sellerAccountId,
        parsed.data.sourceCurrency,
        parsed.data.targetCurrency,
        parsed.data.fundingRail,
      );

      const effectiveTo =
        parsed.data.effectiveTo === undefined
          ? null
          : new Date(parsed.data.effectiveTo);

      const row =
        existing === null
          ? await createFxAdjustmentPolicy(tx, {
              sellerAccountId: auth.sellerAccountId,
              sourceCurrency: parsed.data.sourceCurrency,
              targetCurrency: parsed.data.targetCurrency,
              fundingRail: parsed.data.fundingRail,
              adjustmentRate: parsed.data.adjustmentRate,
              reason: parsed.data.reason,
              actorId: auth.actorId,
              effectiveTo,
            })
          : await reviseFxAdjustmentPolicy(tx, existing, {
              adjustmentRate: parsed.data.adjustmentRate,
              reason: parsed.data.reason,
              actorId: auth.actorId,
              effectiveTo,
            });

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action:
          existing === null
            ? 'fx_adjustment_policy.created'
            : 'fx_adjustment_policy.revised',
        entityType: 'PricingFxAdjustmentPolicy',
        entityId: row.id,
        payload: {
          sellerAccountId: auth.sellerAccountId,
          sourceCurrency: parsed.data.sourceCurrency,
          targetCurrency: parsed.data.targetCurrency,
          fundingRail: parsed.data.fundingRail,
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
    console.error('[portal] save FX adjustment policy failed', {
      sellerAccountId: auth.sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

export async function deactivateFxAdjustmentPolicyAction(
  policyId: string,
  sellerAccountIdOfPolicy: string,
): Promise<ActionResult> {
  const parsed = z
    .object({ policyId: z.string().uuid(), sellerAccountId: z.string().uuid() })
    .safeParse({ policyId, sellerAccountId: sellerAccountIdOfPolicy });
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:deactivate-fx-policy',
  );
  if (!auth.ok) return auth;

  if (parsed.data.sellerAccountId !== auth.sellerAccountId) {
    return { ok: false, reason: 'denied' };
  }

  try {
    await getDb().transaction(async (tx) => {
      await deactivateFxAdjustmentPolicy(tx, parsed.data.policyId);
      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action: 'fx_adjustment_policy.deactivated',
        entityType: 'PricingFxAdjustmentPolicy',
        entityId: parsed.data.policyId,
        payload: { sellerAccountId: auth.sellerAccountId },
      });
    });

    revalidatePath('/market-rules');
    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] deactivate FX adjustment policy failed', {
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
        await removeProductOverride(tx, existing.id);
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

    await getDb().transaction(async (tx) => {
      await removeProductOverride(tx, parsed.data.overrideId);
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
        await removeVariantOverride(tx, existing.id);
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

    await getDb().transaction(async (tx) => {
      await removeVariantOverride(tx, parsed.data.overrideId);
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

    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] remove variant override failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}
