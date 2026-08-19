'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import uniqueViolationConstraint from '@/lib/db/constraint-errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { STOREFRONT_CATALOG_TAG } from '@/lib/storefront/catalog-cache';
import { recoverSupplierLabels } from '@/modules/catalog/products/recover-supplier-labels';
import renameOptionMapping from '@/modules/catalog/products/rename-option-mapping';
import saveOptionMapping from '@/modules/catalog/products/save-option-mapping';

/**
 * The protected boundary for naming a product's option axes.
 *
 * Same discipline as `publish-actions.ts`: Zod-validate, authorize, rate-limit,
 * then hand a server-resolved tenant and actor to the domain module. The input
 * carries no `sellerAccountId` and no `actorId`; both are derived from the
 * session, so a crafted payload has nothing to escalate with.
 *
 * ## The client sends names, never structure
 *
 * What crosses this boundary is only what a person decided — the axis names and
 * a display label per supplier token. `saveOptionMapping` re-derives the
 * structure from `provider_variant_references.source_option_label` and checks the
 * submission against it, so a payload cannot reassign a variant to a different
 * combination. That check is the one that matters: a wrong assignment would hand
 * a buyer one variant's price and another variant's goods.
 *
 * `position` is therefore taken from array order rather than accepted as a
 * field. An explicit client-supplied index would be a second source of truth for
 * something the server already knows.
 *
 * ## Costs nothing at the supplier
 *
 * Every input is already in the database. No CJ call, no points (ADR-017).
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control for these cookie-backed mutations.
 */

const RATE_LIMIT = { capacity: 30, refillIntervalMs: 60_000 };

/**
 * The unique index that catches two variants landing on the same combination.
 * Matched by name so the seller reads a sentence instead of a Postgres string;
 * `saveOptionMapping` validates shape first, so reaching this means the labels
 * themselves collide.
 */
const COMBINATION_CONSTRAINT = 'product_variants_active_combination_key';

const optionMappingInputSchema = z.object({
  productId: z.string().uuid(),
  /** The version the seller's screen read. Compare-and-set, not a hint. */
  expectedProductVersion: z.number().int().positive(),
  axes: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(60),
        values: z
          .array(
            z.object({
              /** The supplier's own token. The join key, never seller-edited. */
              raw: z.string().min(1),
              label: z.string().trim().min(1).max(120),
            }),
          )
          .min(2),
      }),
    )
    .min(1),
});

const renameMappingInputSchema = z.object({
  productId: z.string().uuid(),
  expectedProductVersion: z.number().int().positive(),
  axes: z
    .array(
      z.object({
        optionId: z.string().uuid(),
        name: z.string().trim().min(1).max(60),
        values: z
          .array(
            z.object({
              valueId: z.string().uuid(),
              label: z.string().trim().min(1).max(120),
            }),
          )
          .min(1),
      }),
    )
    .min(1),
});

export type RenameOptionMappingActionResult =
  | { ok: true; axisCount: number; renamedValueCount: number }
  | { ok: false; reason: string; message: string };

export type OptionMappingActionResult =
  | { ok: true; axisCount: number; mappedVariantCount: number }
  | { ok: false; reason: string; message: string };

/**
 * One sentence per refusal, in the seller's terms.
 *
 * `ALREADY_MAPPED` is not phrased as an error the seller caused. Re-mapping is
 * refused by design — it would delete rows that `product_variant_option_values`
 * and `option_combination_key` depend on — so the honest message says what the
 * state is and what would have to exist for it to change.
 */
const REFUSAL_MESSAGES: Record<string, string> = {
  invalid_input:
    'Those variant options could not be read. Give every option a name and at least two values.',
  denied: 'Your account cannot edit this product.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  not_configured: 'The catalogue database is not available right now.',
  not_found: 'This product no longer exists, or it is not yours.',
  version_conflict:
    'This product changed in another tab or session. Reload the editor and map the options again.',
  ALREADY_MAPPED:
    'This product already has a saved Variant Matrix. Its structure cannot be re-split, but the names buyers read can be edited.',
  NOT_MAPPED: 'This product has no saved Variant Matrix to rename yet.',
  UNKNOWN_AXIS:
    'Those options no longer match the saved Variant Matrix. Reload the editor and try again.',
  DUPLICATE_AXIS_NAME:
    'Two options would end up with the same name. Give each option its own name.',
  SPLIT_NOT_DERIVABLE:
    'The supplier labels on this product do not form a complete grid, so a mapping cannot be checked against them.',
  SHAPE_MISMATCH:
    'The option values submitted no longer match the supplier labels on this product. Reload the editor to pick up the current labels.',
  duplicate_combination:
    'Two variants would end up with the same combination of option values, so the mapping was not saved. This means the supplier labels themselves repeat a combination.',
  failed: 'The Variant Matrix could not be saved.',
};

/** The failure arm both action results share. */
type ActionRefusal = { ok: false; reason: string; message: string };

function refuse(reason: string): ActionRefusal {
  return {
    ok: false,
    reason,
    message: REFUSAL_MESSAGES[reason] ?? REFUSAL_MESSAGES.failed ?? '',
  };
}

type Authorized = { ok: true; sellerAccountId: string; actorId: string };
type AuthorizationFailure = {
  ok: false;
  reason: 'denied' | 'rate_limited' | 'not_configured';
};

async function authorize(): Promise<Authorized | AuthorizationFailure> {
  if (!isDatabaseConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  let session;

  try {
    session = await requirePermission('product:edit');
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, reason: 'denied' };
    throw error;
  }

  // ADR-006: a supplier-backed catalogue record is a Dropshipper capability.
  if (session.sellerBusinessModel !== 'DROPSHIPPER') {
    return { ok: false, reason: 'denied' };
  }

  const limit = checkRateLimit(
    `option-mapping:${session.sellerId}`,
    RATE_LIMIT,
  );

  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  return {
    ok: true,
    sellerAccountId: session.sellerId,
    actorId: session.userId,
  };
}

export default async function saveOptionMappingAction(
  input: unknown,
): Promise<OptionMappingActionResult> {
  const parsed = optionMappingInputSchema.safeParse(input);

  if (!parsed.success) return refuse('invalid_input');

  const authorization = await authorize();

  if (!authorization.ok) return refuse(authorization.reason);

  let result;

  try {
    result = await saveOptionMapping({
      productId: parsed.data.productId,
      sellerAccountId: authorization.sellerAccountId,
      actorId: authorization.actorId,
      expectedProductVersion: parsed.data.expectedProductVersion,
      axes: parsed.data.axes,
    });
  } catch (error) {
    // A unique-violation here is a real, explainable outcome rather than a bug,
    // so it is translated instead of surfacing as an unhandled action error.
    //
    // Read through `uniqueViolationConstraint`, not by substring-matching the
    // message. Drizzle wraps the driver error and hangs the original off `cause`,
    // so the constraint name lives in `cause.constraint_name` and never reaches
    // the wrapper's `message` — an INSERT does not name its own indexes. Matching
    // on the message therefore never fires, which is the exact failure that
    // helper's doc comment warns about, and the seller would have seen an
    // unhandled action error instead of a sentence.
    if (uniqueViolationConstraint(error) === COMBINATION_CONSTRAINT) {
      return refuse('duplicate_combination');
    }

    throw error;
  }

  if (!result.ok) return refuse(result.reason);

  // The editor reads the Variant Matrix through the catalogue read-model, so the
  // listing views must re-read rather than serve the pre-mapping render.
  revalidatePath('/listings');

  /**
   * The storefront cache must expire too, and this is not theoretical.
   *
   * `loadPublishedVariants` already reads the three option tables and folds them
   * into named axes, so a mapping changes what a PDP renders. A product that is
   * *already live* can be mapped — the publish gate only guards publish — and
   * without this the PDP keeps serving the pre-mapping payload, showing one opaque
   * `Army Green-XL` after the seller successfully named Colour and Size. The save
   * worked and the page says otherwise, which reads as a broken save.
   *
   * `updateTag` rather than `revalidateTag`, and outside the domain module's
   * transaction, for the same two reasons `publish-actions.ts` gives: Next
   * reserves the former for immediate expiry inside a Server Action, and
   * announcing a change that could still roll back would publish a state that
   * never committed.
   */
  updateTag(STOREFRONT_CATALOG_TAG);

  return {
    ok: true,
    axisCount: result.axisCount,
    mappedVariantCount: result.mappedVariantCount,
  };
}

const recoverInputSchema = z.object({ productId: z.string().uuid() });

export type RecoverLabelsActionResult =
  | { ok: true; recoveredCount: number; alreadyLabelledCount: number }
  | { ok: false; reason: string; message: string };

const RECOVER_MESSAGES: Record<string, string> = {
  invalid_input: 'That product could not be read.',
  denied: 'Your account cannot edit this product.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  not_configured: 'The catalogue database is not available right now.',
  not_found: 'This product no longer exists, or it is not yours.',
  NO_STORED_EVIDENCE:
    'No supplier evidence is stored for this product, so there are no labels to recover. Nothing was changed.',
  NO_LABELS_IN_EVIDENCE:
    'The stored supplier evidence for this product carries no variant labels, so there is nothing to recover. Nothing was changed.',
  failed: 'The supplier labels could not be recovered.',
};

/**
 * Recovering supplier labels a draft never recorded, from the editor.
 *
 * This exists as a Server Action rather than only as `scripts/`'s backfill
 * because reaching production from a terminal needs a database URL, and a seller
 * who can open their own product in the portal already has everything the check
 * requires: a session, a tenant, and `product:edit` on their own catalogue. The
 * deployed application holds the connection; the seller holds the authority.
 *
 * Scoped to one product, and to the caller's own tenancy, which the domain module
 * folds into the same predicate that finds the row. It fills only `NULL` — a
 * recorded label is supplier content and is never overwritten — so pressing it
 * twice is safe and the second press reports nothing recovered.
 *
 * Costs nothing at the supplier: the labels are read from
 * `supplier_snapshots.evidence`, already in the database (ADR-017).
 */
export async function recoverSupplierLabelsAction(
  input: unknown,
): Promise<RecoverLabelsActionResult> {
  const parsed = recoverInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      reason: 'invalid_input',
      message: RECOVER_MESSAGES.invalid_input ?? '',
    };
  }

  const authorization = await authorize();

  if (!authorization.ok) {
    return {
      ok: false,
      reason: authorization.reason,
      message: RECOVER_MESSAGES[authorization.reason] ?? '',
    };
  }

  const result = await recoverSupplierLabels({
    productId: parsed.data.productId,
    sellerAccountId: authorization.sellerAccountId,
    actorId: authorization.actorId,
  });

  if (!result.ok) {
    return {
      ok: false,
      reason: result.reason,
      message: RECOVER_MESSAGES[result.reason] ?? RECOVER_MESSAGES.failed ?? '',
    };
  }

  // A recovered label changes what the editor derives and what a published PDP
  // renders, so both caches must expire — same reasoning as the mapping save
  // above, and for the same reason it is done outside the transaction.
  if (result.recoveredCount > 0) {
    revalidatePath('/listings');
    updateTag(STOREFRONT_CATALOG_TAG);
  }

  return {
    ok: true,
    recoveredCount: result.recoveredCount,
    alreadyLabelledCount: result.alreadyLabelledCount,
  };
}

/**
 * Rename an existing Variant Matrix.
 *
 * The words a buyer reads, and nothing else. `renameOptionMapping` explains
 * why that is safe where a full remap is not: the option-combination key is
 * built from the supplier's own token, so a display label carries no
 * identity and can be corrected without touching a variant, a cart, or an
 * accepted order.
 */
export async function renameOptionMappingAction(
  input: unknown,
): Promise<RenameOptionMappingActionResult> {
  const parsed = renameMappingInputSchema.safeParse(input);

  if (!parsed.success) return refuse('invalid_input');

  const authorization = await authorize();

  if (!authorization.ok) return refuse(authorization.reason);

  const result = await renameOptionMapping({
    productId: parsed.data.productId,
    sellerAccountId: authorization.sellerAccountId,
    actorId: authorization.actorId,
    expectedProductVersion: parsed.data.expectedProductVersion,
    axes: parsed.data.axes,
  });

  if (!result.ok) return refuse(result.reason);

  // Same reasoning as the mapping save: the editor reads the matrix through
  // the catalogue read-model, so the listing views must re-read.
  revalidatePath('/listings');

  return {
    ok: true,
    axisCount: result.axisCount,
    renamedValueCount: result.renamedValueCount,
  };
}
