'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';
import { isPricingScopeDestination } from '@/modules/pricing/pricing-scope-destinations';
import getDb from '@/lib/db/client';
import { requirePermission } from '@/lib/auth/session';
import { can, PermissionError } from '@/lib/auth/permissions';
import type { PortalPermission } from '@/lib/auth/permissions';
import { STOREFRONT_CATALOG_TAG } from '@/lib/storefront/catalog-tag';
import { STOREFRONT_FX_BUFFER_TAG } from '@/lib/storefront/fx-buffer-tag';
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
  planReprice,
  writeReprice,
  type RepriceLine,
  type RepricePlan,
} from '@/modules/pricing/reprice';
import {
  formatScaledRate,
  isValidFxAdjustmentRate,
  isValidMarginRate,
  isValidTargetMarginRate,
  markupPercentToMarginRateScaled,
  parseScaledRate,
} from '@/modules/pricing/money-math';
import type {
  PricingFxAdjustmentPolicyRow,
  Sals3CategoryRow,
} from '@/lib/db/schema';

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

/**
 * A TARGET margin: `0 <= rate < 1`.
 *
 * Zero is allowed and means "sell at cost" — a rule a seller can mean, and one
 * `price = cost / (1 - rate)` prices correctly. `1` and above is refused
 * because the denominator vanishes there, which is why this is not the same
 * schema the contribution floor uses.
 */
const targetMarginRateSchema = z.string().refine((value) => {
  try {
    return isValidTargetMarginRate(parseScaledRate(value));
  } catch {
    return false;
  }
}, 'Enter a margin rate from 0 up to but not including 1, e.g. 0.30 for 30%.');

/**
 * A minimum-margin FLOOR: `0 < rate < 1`, the strict bound
 * `pricing_store_defaults_floor_rate_range` also enforces. A floor of zero
 * floors nothing, so it is a typo rather than a rule, and letting it past here
 * would only move the refusal to the database.
 */
const floorMarginRateSchema = z.string().refine((value) => {
  try {
    return isValidMarginRate(parseScaledRate(value));
  } catch {
    return false;
  }
}, 'Enter a minimum margin strictly between 0 and 1, e.g. 0.30 for 30%.');

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
  /**
   * A second permission the caller must ALSO hold.
   *
   * Repricing is the one action on this screen that writes outside the pricing
   * tables: it changes the price on a live offer, which is a publication act.
   * Holding the margin rules is not the same authority as changing what a buyer
   * is charged today, so that action asks for both rather than widening what
   * `pricing_policy:manage` means for every other action in this file.
   */
  alsoRequire?: PortalPermission,
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

  if (alsoRequire !== undefined && !can(session.role, alsoRequire)) {
    return { ok: false, reason: 'denied' };
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
  targetMarginRate: targetMarginRateSchema,
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
        } else if (row.markupPercent === null) {
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
          //
          // Compared as scaled BigInts, not as `Number`s: the stored rate is a
          // `numeric(8, 6)` string and the file carries a markup, so the only
          // honest comparison is between the two at the same fixed-point scale.
          existing !== null &&
          parseScaledRate(existing.targetMarginRate) ===
            markupPercentToMarginRateScaled(row.markupPercent) &&
          existing.roundingRule === row.roundingRule
        ) {
          summary.unchanged += 1;
        } else {
          // The file speaks markup over cost; the column stores a margin rate.
          const targetMarginRate = formatScaledRate(
            markupPercentToMarginRateScaled(row.markupPercent),
          );
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

const saveStoreDefaultInputSchema = z
  .object({
    targetMarginRate: targetMarginRateSchema,
    minContribution: contributionFloorSchema,
    /**
     * The minimum-margin form of the operating-expense floor, or `null`.
     *
     * Owner rule 2026-08-26: the minimum is either a percentage or an amount,
     * never both. The refinement below is the first of three gates — the form
     * disables one field once the other has a value, and
     * `pricing_store_defaults_floor_exclusive` refuses the row outright. The
     * database gate is the one that matters, because a CSV import or a repair
     * statement reaches neither of the other two.
     */
    minContributionRate: floorMarginRateSchema.nullable(),
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
  })
  .refine(
    (value) =>
      !(
        value.minContributionRate !== null && Number(value.minContribution) > 0
      ),
    {
      // Reported against the percentage field, because that is the newer of the
      // two and the one a seller is most likely to have just typed.
      path: ['minContributionRate'],
      message:
        'Set a minimum as a percentage or as an amount, not both. Clear one to use the other.',
    },
  );

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
      /*
        Read the scope being saved, not the unscoped rule.

        This asked for `null` while the create path below wrote
        `parsed.data.marketCode`, so a save for Australia decided
        create-vs-revise from the all-destinations row — and where one existed,
        revised *that* instead of creating Australia's. The read and the write
        have to name the same scope or the screen and the database describe
        different rules.
      */
      const existing = await findStoreDefaultForScope(
        tx,
        auth.sellerAccountId,
        parsed.data.marketCode,
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
              minContributionRate: parsed.data.minContributionRate,
              roundingRule: parsed.data.roundingRule,
              reason: parsed.data.reason,
              actorId: auth.actorId,
            })
          : await reviseStoreDefault(tx, existing, {
              targetMarginRate: parsed.data.targetMarginRate,
              minContributionMinor,
              minContributionCurrency: 'USD',
              minContributionRate: parsed.data.minContributionRate,
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

/**
 * Returns the row it wrote, not just `ok`.
 *
 * The card used to learn the new value only from the next server render, so a
 * seller stared at an unchanged card until a whole page round trip finished and
 * frequently reloaded by hand, believing the save had failed. The write is
 * authoritative the moment it commits; handing it straight back lets the card
 * say so immediately, and the background refresh becomes reconciliation rather
 * than the only source of truth.
 */
export async function saveFundingBufferPolicyAction(
  input: unknown,
): Promise<ActionResult<PricingFxAdjustmentPolicyRow>> {
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
    const saved = await getDb().transaction(async (tx) => {
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

      return row;
    });

    revalidatePath('/market-rules');
    /*
      The storefront prices its approximate local figure off this policy, so a
      buffer edit has to reach the feed and not only this screen.

      `updateTag`, not `revalidateTag`: this is a Server Action, and the
      read-your-own-writes semantic is the one `updateTag` exists for -- the
      same reasoning `publish-actions.ts` records.

      Note what this does NOT do: it does not reprice live offers. The same
      policy also lifts the cost basis inside `resolveProductPricing`, and
      `reprice.ts` is what carries a policy change onto already-published
      prices. Wiring the buffer into that is its own decision, not a side
      effect of expiring a cache tag.
    */
    updateTag(STOREFRONT_FX_BUFFER_TAG);
    return { ok: true, data: saved };
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
    // Deactivating must stop the storefront buffering at once. This is the half
    // that makes the consumer's "a served null forgets the last good value"
    // reachable in practice rather than only after the cache expires.
    updateTag(STOREFRONT_FX_BUFFER_TAG);
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
  targetMarginRate: targetMarginRateSchema,
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
  targetMarginRate: targetMarginRateSchema,
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

// --- Repricing live offers --------------------------------------------------

const applyRepriceInputSchema = z.object({
  /**
   * The digest of the plan the seller actually looked at.
   *
   * Not the prices themselves. A client that could post prices could post any
   * price; this posts only "the plan I approved looked like this", and the
   * server recomputes the numbers from the rules either way.
   */
  fingerprint: z.string().trim().min(1).max(64),
  reason: reasonSchema,
  /**
   * Whether the plan the seller approved included the prices they typed.
   *
   * Recomputed against, never trusted: the apply re-plans with this same flag
   * and compares digests, so a request claiming a reclaim the preview did not
   * show produces a different fingerprint and is refused as stale. That is the
   * whole guard — this field cannot widen a run on its own.
   */
  reclaimSellerPriced: z.boolean().default(false),
});

/** One row of the preview, already shaped for the screen. */
export type RepricePreviewLine = {
  offerId: string;
  productTitle: string;
  sku: string;
  marketCode: string;
  status: RepriceLine['status'];
  currentPriceMinor: number | null;
  currentPriceCurrency: string | null;
  newPriceMinor: number | null;
  newPriceCurrency: string | null;
  reasonLabel: string | null;
};

export type RepricePreview = {
  counts: RepricePlan['counts'];
  truncated: boolean;
  candidateCount: number;
  fingerprint: string;
  /** Everything except the rows where nothing happens — those are a count, not a list. */
  lines: RepricePreviewLine[];
};

export type RepriceSummary = {
  written: number;
  unchanged: number;
  unpriceable: number;
  manual: number;
};

function toPreviewLine(line: RepriceLine): RepricePreviewLine {
  return {
    offerId: line.offerId,
    productTitle: line.productTitle,
    sku: line.sku,
    marketCode: line.marketCode,
    status: line.status,
    currentPriceMinor: line.currentPriceMinor,
    currentPriceCurrency: line.currentPriceCurrency,
    newPriceMinor: line.newPriceMinor,
    newPriceCurrency: line.newPriceCurrency,
    reasonLabel: line.reasonLabel,
  };
}

/**
 * What repricing would do, written nowhere.
 *
 * A margin rule is not a price — it becomes one only when the resolver runs
 * against a real supplier cost. Showing a seller the resulting numbers before
 * anything is written is the difference between changing a rule and changing
 * what thousands of buyers are charged, and this action is the half that lets
 * them tell those apart.
 */
export async function previewRepriceAction(
  reclaimSellerPriced = false,
): Promise<ActionResult<RepricePreview>> {
  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:preview-reprice',
    'product:publish',
  );
  if (!auth.ok) return auth;

  try {
    const plan = await planReprice(getDb(), auth.sellerAccountId, {
      reclaimSellerPriced,
    });

    return {
      ok: true,
      data: {
        counts: plan.counts,
        truncated: plan.truncated,
        candidateCount: plan.candidateCount,
        fingerprint: plan.fingerprint,
        // The unchanged rows are the majority and say nothing; every row that
        // would move, be skipped, or refuse is listed by name.
        lines: plan.lines
          .filter((line) => line.status !== 'UNCHANGED')
          .map(toPreviewLine),
      },
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] reprice preview failed', {
      sellerAccountId: auth.sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Writes the new prices onto live offers.
 *
 * Three guards, each answering a different way this can go wrong:
 *
 * - **The plan is recomputed here**, never taken from the caller. The client
 *   sends a digest and a reason; every number written comes from the resolver
 *   inside this request.
 * - **The digest must still match.** A rule saved in another tab, or a supplier
 *   cost that landed between the preview and the click, changes what would be
 *   written — and a seller who approved one set of numbers has not approved a
 *   different set. That refuses as `stale_preview` and asks for a fresh look.
 * - **Every write carries the offer version it was planned from**, so a
 *   concurrent republish aborts the whole run rather than interleaving with it.
 *
 * Offers the resolver refused and prices a person typed are not part of the
 * write set at all. They keep the price they have, and the result says how
 * many — silently leaving them out would report a clean run over a catalogue
 * that is still half-priced by the old rule.
 */
export async function applyRepriceAction(input: unknown): Promise<
  | ({ ok: true } & { data: RepriceSummary })
  | {
      ok: false;
      reason:
        | 'invalid_input'
        | 'denied'
        | 'rate_limited'
        | 'stale_preview'
        | 'version_conflict'
        | 'failed';
      fieldErrors?: Record<string, string>;
    }
> {
  const parsedInput = applyRepriceInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return {
      ok: false,
      reason: 'invalid_input',
      fieldErrors: toFieldErrors(parsedInput.error),
    };
  }

  const auth = await authorize(
    'pricing_policy:manage',
    'pricing:apply-reprice',
    'product:publish',
  );
  if (!auth.ok) return auth;

  try {
    /*
      Planned outside the transaction on purpose.

      The plan is a read that runs the resolver once per live offer — several
      queries each. Holding a write transaction open for all of that would lock
      nothing useful and block everything else; the version check on each
      update is what makes the short write safe, not the length of the
      transaction.
    */
    const plan = await planReprice(getDb(), auth.sellerAccountId, {
      reclaimSellerPriced: parsedInput.data.reclaimSellerPriced,
    });

    if (plan.fingerprint !== parsedInput.data.fingerprint) {
      return { ok: false, reason: 'stale_preview' };
    }

    if (plan.counts.changed === 0) {
      return {
        ok: true,
        data: {
          written: 0,
          unchanged: plan.counts.unchanged,
          unpriceable: plan.counts.unpriceable,
          manual: plan.counts.manual,
        },
      };
    }

    const written = await getDb().transaction(async (tx) => {
      const result = await writeReprice(tx, plan.lines, {
        actorId: auth.actorId,
        sellerAccountId: auth.sellerAccountId,
      });

      if (!result.ok) return result;

      // One audit event per offer, the same shape publication writes. A price
      // change a buyer can see is never a bulk footnote.
      // eslint-disable-next-line no-restricted-syntax
      for (const line of plan.lines.filter(
        (candidate) => candidate.status === 'CHANGED',
      )) {
        // eslint-disable-next-line no-await-in-loop
        await appendAuditEvent(tx, {
          actorId: auth.actorId,
          action: 'catalog_product_offer.repriced',
          entityType: 'product_offer',
          entityId: line.offerId,
          payload: {
            sellerAccountId: auth.sellerAccountId,
            productId: line.productId,
            sku: line.sku,
            marketCode: line.marketCode,
            previousPriceMinor: line.currentPriceMinor,
            priceMinor: line.newPriceMinor,
            priceCurrency: line.newPriceCurrency,
            /*
              Which of two different things happened to this offer: a rule moved
              a price the rules already owned, or a person's own decision was
              taken back. `previousPriceMinor` above is what makes the second
              one recoverable at all -- product_offers has no history table.
            */
            reclaimedFromSeller: line.reclaimed,
            reason: parsedInput.data.reason,
            resolvedLayer:
              line.decision !== null &&
              line.decision.outcome === 'PRODUCT_MARGIN_ESTIMATE'
                ? line.decision.resolvedLayer
                : null,
            source: 'market-rules-reprice',
          },
        });
      }

      return result;
    });

    if (!written.ok) return { ok: false, reason: 'version_conflict' };

    /*
      Announced only after the transaction committed. Expiring the buyer-facing
      cache for a write that could still roll back would publish a state that
      never existed — the same ordering `publish-actions.ts` records.
    */
    updateTag(STOREFRONT_CATALOG_TAG);
    revalidatePath('/market-rules');

    return {
      ok: true,
      data: {
        written: written.written,
        unchanged: plan.counts.unchanged,
        unpriceable: plan.counts.unpriceable,
        manual: plan.counts.manual,
      },
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] reprice apply failed', {
      sellerAccountId: auth.sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}
