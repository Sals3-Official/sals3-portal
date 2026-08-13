'use server';

import {
  createProductDraftInputSchema,
  saveProductDraftInputSchema,
  type ProductDraftActionResult,
} from '@/modules/catalog/products/contracts';
import createProductDraftFromCandidate from '@/modules/catalog/products/create-draft';
import saveProductDraft from '@/modules/catalog/products/save-draft';
import authorizeDraftAction from './draft-action-auth';

/**
 * The protected boundary for the canonical catalog draft flow.
 *
 * Same discipline as `market-rules/market-profile-actions.ts`: Zod-validate
 * the payload, authorize, rate-limit, then hand a *server-resolved* tenant and
 * actor to the domain module, which does the state change and the audit event
 * in one transaction.
 *
 * Nothing that decides authority arrives from the browser. There is no
 * `sellerAccountId`, `actorId`, `marketCode`, `price`, `policyVersion`, or
 * product-to-adopt field in either schema, so a crafted payload has nothing to
 * escalate with. The only resource reference a caller supplies is a candidate
 * id, and its ownership is re-derived server-side through the supplier
 * connection that owns it.
 *
 * Wiring: `saveProductDraftAction` is called by the real product editor at
 * `/listings/[productId]`; bulk creation goes through `bulk-draft-action.ts`,
 * which shares `authorizeDraftAction` and loops the same domain module.
 * `createProductDraftAction` remains the single-candidate contract.
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control for these cookie-backed mutations (spec §3.2).
 */

// Authorization (permission, ADR-006 business-model gate, rate limit) lives in
// `./draft-action-auth` so the bulk action shares one implementation without
// this `'use server'` file exporting it as an endpoint.
const RATE_LIMIT = { capacity: 30, refillIntervalMs: 60_000 };

/**
 * Creates — or returns — the Sals3 product draft for a candidate this seller
 * owns. Idempotent: the same key with the same canonical request replays the
 * stored result, and with a different request reports a conflict.
 */
export async function createProductDraftAction(
  input: unknown,
): Promise<ProductDraftActionResult> {
  const parsed = createProductDraftInputSchema.safeParse(input);

  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorizeDraftAction(
    'product:import',
    'catalog-draft:create',
    RATE_LIMIT,
  );

  if (!auth.ok) return auth;

  try {
    const outcome = await createProductDraftFromCandidate({
      candidateId: parsed.data.candidateId,
      sellerAccountId: auth.sellerAccountId,
      actorId: auth.actorId,
      idempotencyKey: parsed.data.idempotencyKey,
    });

    return outcome.ok
      ? { ok: true, result: outcome.result }
      : { ok: false, reason: outcome.reason };
  } catch (error) {
    // Generic outward failure; the detail stays in the server log. Never
    // return a constraint name, driver message, or stack to the client.
    // eslint-disable-next-line no-console
    console.error('[portal] create product draft failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return { ok: false, reason: 'failed' };
  }
}

export type SaveProductDraftActionResult =
  | { ok: true; revisionVersion: number }
  | {
      ok: false;
      reason:
        | 'invalid_input'
        | 'denied'
        | 'rate_limited'
        | 'not_configured'
        | 'not_found'
        | 'version_conflict'
        | 'failed';
    };

/**
 * Saves title and structured description onto an open draft revision.
 *
 * `invalid_input` covers a forbidden description document — markup-shaped
 * text, a control character, an unknown block type — because the allow-listed
 * schema rejects it at this boundary rather than storing it and hoping the
 * renderer escapes.
 */
export async function saveProductDraftAction(
  input: unknown,
): Promise<SaveProductDraftActionResult> {
  const parsed = saveProductDraftInputSchema.safeParse(input);

  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorizeDraftAction(
    'product:edit',
    'catalog-draft:save',
    RATE_LIMIT,
  );

  if (!auth.ok) return auth;

  try {
    const outcome = await saveProductDraft({
      request: parsed.data,
      sellerAccountId: auth.sellerAccountId,
      actorId: auth.actorId,
    });

    return outcome.ok
      ? { ok: true, revisionVersion: outcome.revisionVersion }
      : { ok: false, reason: outcome.reason };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] save product draft failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return { ok: false, reason: 'failed' };
  }
}
