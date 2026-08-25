'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isPricingScopeDestination } from '@/modules/pricing/pricing-scope-destinations';
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
  createStoreDefault,
  deactivateStoreDefault,
  reviseStoreDefault,
  createProductOverride,
  createVariantOverride,
  deactivateCategoryPolicy,
  deactivateFundingBufferPolicy,
  findActiveCategoryPolicy,
  findActiveFundingBufferPolicy,
  findActiveProductOverride,
  findActiveVariantOverride,
  findStoreDefaultForScope,
  findCategoriesByCodes,
  findCategoryByCode,
  findCategoryById,
  removeProductOverride,
  removeVariantOverride,
  reviseCategoryPolicy,
  reviseFundingBufferPolicy,
  reviseProductOverride,
  reviseVariantOverride,
  searchCategories,
} from '@/modules/pricing/repository';
import { parseMarginCsv } from '@/modules/pricing/margin-csv';
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
  .min(
    MIN_REASON_LENGTH,
    `Write why you made this change. Use ${MIN_REASON_LENGTH} characters or more.`,
  )
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

/**
 * Zod's own per-field messages, in the shape `ActionResult.fieldErrors`
 * already declared.
 *
 * That field existed from the first version of this file and was never
 * populated: every failure returned a bare `invalid_input`, so the UI could
 * only say "check the highlighted fields" while highlighting nothing. The
 * owner hit it on 2026-08-20 trying to set a store default — the real cause
 * was a reason under 10 characters, and nothing on screen said so.
 *
 * One message per field, first issue wins. The schemas' own `.refine`
 * messages are already written for a person to read.
 */
function toFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  error.issues.forEach((issue) => {
    const field = issue.path[0];
    if (typeof field !== 'string') return;
    if (fieldErrors[field] !== undefined) return;
    fieldErrors[field] = issue.message;
  });

  return fieldErrors;
}

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
  /**
   * The destination this rule is for, or `null` for all destinations.
   *
   * Shape-checked here as well as in the database, so a crafted payload cannot
   * write a scope the seller's own screen could never have offered.
   */
  marketCode: z
    .string()
    .refine(isPricingScopeDestination, {
      message: 'Not a destination this account can price for.',
    })
    .nullable(),
});

/**
 * The payload shape callers must build, exported so the compiler can hold them
 * to it.
 *
 * The parameter below stays `unknown` — a server action is a network boundary
 * and must validate whatever actually arrives. But `unknown` also means a
 * caller in this repo gets no help, and that is not hypothetical: when
 * `marketCode` was added to the schema on 2026-08-25 the dialog kept sending
 * the old four-field object, every save on the category tree started returning
 * `invalid_input`, and nothing failed — not the compiler, because the argument
 * was `unknown`, and not the tests, because each one passed a hand-written
 * input that already had the new field.
 *
 * Annotating the call site with this type is what makes the next omission a
 * build error instead of a broken screen.
 */
export type SaveCategoryPolicyInput = z.input<
  typeof saveCategoryPolicyInputSchema
>;

export async function saveCategoryPolicyAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = saveCategoryPolicyInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid_input',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

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
        parsed.data.marketCode,
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
              marketCode: parsed.data.marketCode,
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

// --- Bulk category margins (CSV) -------------------------------------------

const applyMarginCsvInputSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  reason: reasonSchema,
});

export type ApplyMarginCsvSummary = {
  /** Categories given a margin, or moved to a different one. */
  written: number;
  /** Categories whose margin was removed because the cell was empty. */
  cleared: number;
  /** Rows that already matched, so nothing was written for them. */
  unchanged: number;
};

/**
 * Applies a whole margin file in ONE transaction.
 *
 * All-or-nothing on purpose. A bulk price change that half-lands leaves a
 * catalogue priced by two different decisions with nothing on screen saying
 * which rows took — the operator would have to diff the file against the
 * table to find out. Refusing the file whole is recoverable; a partial apply
 * is not.
 *
 * Every row still goes through `createCategoryPolicy`/`reviseCategoryPolicy`
 * and writes its own audit event, exactly as a single edit does. Bulk is a
 * different door into the same writer, never a shortcut past it — the
 * versioned history has to read the same whether a rate arrived by form or
 * by file.
 */
export async function applyMarginCsvAction(input: unknown): Promise<
  | ({ ok: true } & { data: ApplyMarginCsvSummary })
  | {
      ok: false;
      reason:
        'invalid_input' | 'denied' | 'rate_limited' | 'not_found' | 'failed';
      fieldErrors?: Record<string, string>;
      /** One line per problem, already numbered for a spreadsheet. */
      rowErrors?: string[];
    }
> {
  const parsedInput = applyMarginCsvInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return {
      ok: false,
      reason: 'invalid_input',
      fieldErrors: toFieldErrors(parsedInput.error),
    };
  }

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:apply-margin-csv',
  );
  if (!auth.ok) return auth;

  const parsedCsv = parseMarginCsv(parsedInput.data.csv);

  if (!parsedCsv.ok) {
    return {
      ok: false,
      reason: 'invalid_input',
      rowErrors: parsedCsv.errors.map(
        (error) => `Line ${error.line}: ${error.message}`,
      ),
    };
  }

  if (parsedCsv.rows.length === 0) {
    return {
      ok: false,
      reason: 'invalid_input',
      rowErrors: ['The file has a header but no category rows.'],
    };
  }

  try {
    // Resolve every code up front. An unknown code is the one mistake a
    // person cannot see in their own spreadsheet, so it is named per line
    // rather than reported as a count.
    const codes = parsedCsv.rows.map((row) => row.categoryCode);
    const categories = await findCategoriesByCodes(getDb(), codes);
    const byCode = new Map(
      categories.map((category) => [category.code, category]),
    );

    const unknown = parsedCsv.rows
      .map((row, index) => ({ row, line: index + 2 }))
      .filter((entry) => !byCode.has(entry.row.categoryCode));

    if (unknown.length > 0) {
      return {
        ok: false,
        reason: 'not_found',
        rowErrors: unknown.map(
          (entry) =>
            `Line ${entry.line}: ${entry.row.categoryCode} is not a Sals3 category.`,
        ),
      };
    }

    const summary: ApplyMarginCsvSummary = {
      written: 0,
      cleared: 0,
      unchanged: 0,
    };

    await getDb().transaction(async (tx) => {
      /* eslint-disable no-await-in-loop */
      // eslint-disable-next-line no-restricted-syntax -- sequential: every row shares this transaction's connection, and the audit trail reads in file order.
      for (const row of parsedCsv.rows) {
        const category = byCode.get(row.categoryCode);

        const existing =
          category === undefined
            ? null
            : await findActiveCategoryPolicy(
                tx,
                auth.sellerAccountId,
                category.id,
                // The row's OWN scope, not the screen's. A file carries the
                // destination it was exported for, so importing it while the
                // screen shows another country cannot rewrite that country's
                // rates — the failure ADR-015's amendment names.
                row.marketCode,
              );

        // Every code was resolved before the transaction opened, so this
        // only narrows the type.
        if (category === undefined) {
          summary.unchanged += 1;
        } else if (row.marginPercent === null) {
          // An empty cell means "no margin here". Deactivating is the same
          // operation the row's own Deactivate button performs.
          if (existing === null) {
            summary.unchanged += 1;
          } else {
            await deactivateCategoryPolicy(
              tx,
              existing.id,
              auth.sellerAccountId,
            );
            summary.cleared += 1;

            await appendAuditEvent(tx, {
              actorId: auth.actorId,
              action: 'category_pricing_policy.deactivated',
              entityType: 'PricingCategoryPolicy',
              entityId: existing.id,
              payload: {
                sellerAccountId: auth.sellerAccountId,
                categoryCode: category.code,
                reason: parsedInput.data.reason,
                source: 'csv-import',
              },
            });
          }
        } else if (
          // A row that already says what the table says. Writing it would add
          // a version and an audit event that record no change.
          existing !== null &&
          Number(existing.targetMarginRate) === row.marginPercent / 100 &&
          existing.roundingRule === row.roundingRule
        ) {
          summary.unchanged += 1;
        } else {
          const targetMarginRate = (row.marginPercent / 100).toString();
          const written =
            existing === null
              ? await createCategoryPolicy(tx, {
                  sellerAccountId: auth.sellerAccountId,
                  categoryId: category.id,
                  targetMarginRate,
                  roundingRule: row.roundingRule,
                  reason: parsedInput.data.reason,
                  actorId: auth.actorId,
                  marketCode: row.marketCode,
                })
              : await reviseCategoryPolicy(tx, existing, {
                  targetMarginRate,
                  roundingRule: row.roundingRule,
                  reason: parsedInput.data.reason,
                  actorId: auth.actorId,
                });

          summary.written += 1;

          await appendAuditEvent(tx, {
            actorId: auth.actorId,
            action:
              existing === null
                ? 'category_pricing_policy.created'
                : 'category_pricing_policy.revised',
            entityType: 'PricingCategoryPolicy',
            entityId: written.id,
            payload: {
              sellerAccountId: auth.sellerAccountId,
              categoryCode: category.code,
              targetMarginRate,
              roundingRule: row.roundingRule,
              reason: parsedInput.data.reason,
              version: written.version,
              supersedesId: written.supersedesId,
              source: 'csv-import',
            },
          });
        }
      }
      /* eslint-enable no-await-in-loop */
    });

    revalidatePath('/market-rules');
    return { ok: true, data: summary };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] apply margin csv failed', {
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

// --- Store default pricing (ADR-015 §3 base layer) --------------------------

/**
 * Whole US dollars-and-cents string ("2.50") to integer minor units.
 * Validated to two decimal places so a fat-fingered "2.505" is refused,
 * not silently truncated.
 */
const contributionFloorSchema = z
  .string()
  .trim()
  .regex(
    /^\d{1,7}(\.\d{1,2})?$/,
    'Enter a non-negative amount with at most two decimals, e.g. 2.50.',
  );

function contributionFloorToMinor(value: string): bigint {
  const [whole, frac = ''] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(frac.padEnd(2, '0'));
}

const saveStoreDefaultInputSchema = z.object({
  targetMarginRate: marginRateSchema,
  minContribution: contributionFloorSchema,
  roundingRule: roundingRuleSchema,
  /**
   * The destination this rule is for, or `null` for all destinations.
   *
   * Shape-checked here as well as in the database, so a crafted payload cannot
   * write a scope the seller's own screen could never have offered.
   */
  marketCode: z
    .string()
    .refine(isPricingScopeDestination, {
      message: 'Not a destination this account can price for.',
    })
    .nullable(),

  reason: reasonSchema,
});

/** Same contract, and the same reason, as `SaveCategoryPolicyInput`. */
export type SaveStoreDefaultInput = z.input<typeof saveStoreDefaultInputSchema>;

export async function saveStoreDefaultAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = saveStoreDefaultInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid_input',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:save-store-default',
  );
  if (!auth.ok) return auth;

  try {
    const minContributionMinor = contributionFloorToMinor(
      parsed.data.minContribution,
    );

    await getDb().transaction(async (tx) => {
      const existing = await findStoreDefaultForScope(
        tx,
        auth.sellerAccountId,
        null,
      );

      const row =
        existing === null
          ? await createStoreDefault(tx, {
              sellerAccountId: auth.sellerAccountId,
              // The scope the screen was showing. Without this the action read
              // the destination's row and then created an unscoped one, writing
              // the all-destinations rule under a heading that said otherwise.
              marketCode: parsed.data.marketCode,
              targetMarginRate: parsed.data.targetMarginRate,
              minContributionMinor,
              minContributionCurrency: 'USD',
              roundingRule: parsed.data.roundingRule,
              reason: parsed.data.reason,
              actorId: auth.actorId,
            })
          : await reviseStoreDefault(tx, existing, {
              targetMarginRate: parsed.data.targetMarginRate,
              minContributionMinor,
              minContributionCurrency: 'USD',
              roundingRule: parsed.data.roundingRule,
              reason: parsed.data.reason,
              actorId: auth.actorId,
            });

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action:
          existing === null
            ? 'pricing_store_default.created'
            : 'pricing_store_default.revised',
        entityType: 'PricingStoreDefault',
        entityId: row.id,
        payload: {
          sellerAccountId: auth.sellerAccountId,
          targetMarginRate: parsed.data.targetMarginRate,
          minContributionMinor: minContributionMinor.toString(),
          minContributionCurrency: 'USD',
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
    console.error('[portal] save store default failed', {
      sellerAccountId: auth.sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

export async function deactivateStoreDefaultAction(
  policyId: string,
  sellerAccountIdOfPolicy: string,
): Promise<ActionResult> {
  const parsed = z
    .object({
      policyId: z.string().uuid(),
      sellerAccountId: z.string().uuid(),
    })
    .safeParse({ policyId, sellerAccountId: sellerAccountIdOfPolicy });
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:deactivate-store-default',
  );
  if (!auth.ok) return auth;

  // The client-supplied seller id is only ever compared against the
  // session's — never trusted as scope. Same discipline as
  // deactivateCategoryPolicyAction.
  if (parsed.data.sellerAccountId !== auth.sellerAccountId) {
    return { ok: false, reason: 'not_found' };
  }

  try {
    let found = false;

    await getDb().transaction(async (tx) => {
      const row = await deactivateStoreDefault(
        tx,
        parsed.data.policyId,
        auth.sellerAccountId,
      );

      if (row === null) return;
      found = true;

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action: 'pricing_store_default.deactivated',
        entityType: 'PricingStoreDefault',
        entityId: row.id,
        payload: {
          sellerAccountId: auth.sellerAccountId,
          version: row.version,
        },
      });
    });

    if (!found) return { ok: false, reason: 'not_found' };

    revalidatePath('/market-rules');
    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] deactivate store default failed', {
      sellerAccountId: auth.sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

/** At most one active store default per seller — this seller's whole history for it. */
export async function getStoreDefaultHistoryAction(): Promise<
  ActionResult<AuditHistoryEntry[]>
> {
  const auth = await authorize(
    'pricing_policy:read',
    'pricing:store-default-history',
  );
  if (!auth.ok) return auth;

  try {
    const data = await listAuditHistoryForSellerEntity(getDb(), {
      entityType: 'PricingStoreDefault',
      sellerAccountId: auth.sellerAccountId,
    });
    return { ok: true, data };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] store default history read failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

const saveFundingBufferPolicyInputSchema = z.object({
  adjustmentRate: fxAdjustmentRateSchema,
  reason: reasonSchema,
  effectiveTo: z.string().datetime().optional(),
});

export async function saveFundingBufferPolicyAction(
  input: unknown,
): Promise<ActionResult> {
  const parsed = saveFundingBufferPolicyInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid_input',
      fieldErrors: toFieldErrors(parsed.error),
    };
  }

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
    const outcome = await getDb().transaction(async (tx) => {
      // Inside the transaction, so the ownership proof cannot go stale between
      // the check and the write it authorizes.
      const owns = await candidateBelongsToSeller(
        tx,
        parsed.data.supplierCandidateId,
        auth.sellerAccountId,
      );
      if (!owns) return { owns: false as const };

      const existing = await findActiveProductOverride(
        tx,
        parsed.data.supplierCandidateId,
      );

      // A new value for an existing override is a revision, not a delete plus
      // an unrelated new record: the previous row becomes SUPERSEDED and the
      // new one continues its version chain.
      const row =
        existing === null
          ? await createProductOverride(tx, {
              supplierCandidateId: parsed.data.supplierCandidateId,
              targetMarginRate: parsed.data.targetMarginRate,
              reason: parsed.data.reason,
              actorId: auth.actorId,
            })
          : await reviseProductOverride(tx, existing, {
              targetMarginRate: parsed.data.targetMarginRate,
              reason: parsed.data.reason,
              actorId: auth.actorId,
            });

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action:
          existing === null
            ? 'product_pricing_override.created'
            : 'product_pricing_override.revised',
        entityType: 'PricingProductOverride',
        entityId: row.id,
        payload: {
          sellerAccountId: auth.sellerAccountId,
          supplierCandidateId: row.supplierCandidateId,
          targetMarginRate: parsed.data.targetMarginRate,
          previousTargetMarginRate: existing?.targetMarginRate ?? null,
          reason: parsed.data.reason,
          version: row.version,
          supersedesId: row.supersedesId,
        },
      });

      return { owns: true as const };
    });

    if (!outcome.owns) return { ok: false, reason: 'not_found' };

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
    const outcome = await getDb().transaction(async (tx) => {
      const owns = await candidateBelongsToSeller(
        tx,
        parsed.data.supplierCandidateId,
        auth.sellerAccountId,
      );
      if (!owns) return { owns: false as const };

      const existing = await findActiveVariantOverride(
        tx,
        parsed.data.supplierCandidateId,
        parsed.data.supplierVariantId,
      );

      const row =
        existing === null
          ? await createVariantOverride(tx, {
              supplierCandidateId: parsed.data.supplierCandidateId,
              supplierVariantId: parsed.data.supplierVariantId,
              targetMarginRate: parsed.data.targetMarginRate,
              reason: parsed.data.reason,
              additionalJustification: parsed.data.additionalJustification,
              actorId: auth.actorId,
            })
          : await reviseVariantOverride(tx, existing, {
              targetMarginRate: parsed.data.targetMarginRate,
              reason: parsed.data.reason,
              additionalJustification: parsed.data.additionalJustification,
              actorId: auth.actorId,
            });

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action:
          existing === null
            ? 'variant_pricing_override.created'
            : 'variant_pricing_override.revised',
        entityType: 'PricingVariantOverride',
        entityId: row.id,
        payload: {
          sellerAccountId: auth.sellerAccountId,
          supplierCandidateId: row.supplierCandidateId,
          supplierVariantId: row.supplierVariantId,
          targetMarginRate: parsed.data.targetMarginRate,
          previousTargetMarginRate: existing?.targetMarginRate ?? null,
          reason: parsed.data.reason,
          additionalJustification: parsed.data.additionalJustification,
          version: row.version,
          supersedesId: row.supersedesId,
        },
      });

      return { owns: true as const };
    });

    if (!outcome.owns) return { ok: false, reason: 'not_found' };

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
