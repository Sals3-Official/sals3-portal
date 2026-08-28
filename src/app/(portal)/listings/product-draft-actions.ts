'use server';

import type { ZodError } from 'zod';
import { revalidatePath } from 'next/cache';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import captureCandidateEvidence, {
  type CaptureEvidenceResult,
} from '@/modules/catalog/candidates/capture-evidence';
import {
  bulkCreateProductDraftsInputSchema,
  createProductDraftInputSchema,
  saveProductDraftInputSchema,
  type BulkProductDraftActionResult,
  type ProductDraftActionResult,
  type ProductDraftFailureReason,
} from '@/modules/catalog/products/contracts';
import createProductDraftFromCandidate from '@/modules/catalog/products/create-draft';
import saveProductDraft from '@/modules/catalog/products/save-draft';
import type { PortalPermission } from '@/lib/auth/permissions';
import revalidateListingViews from './revalidate-listing-views';

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
 * These actions have **no UI wiring yet**, on purpose. The Product Editor and
 * `/listings` are still fixture screens; pointing their existing controls at
 * partial real persistence would make unsaved fields look saved. A protected
 * contract plus tests is the honest state until the editor is wired
 * deliberately.
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control for these cookie-backed mutations (spec §3.2).
 */

const RATE_LIMIT = { capacity: 30, refillIntervalMs: 60_000 };
/** Same point-spend ceiling as the explicit evidence-capture action. */
const EVIDENCE_CAPTURE_RATE_LIMIT = { capacity: 12, refillIntervalMs: 60_000 };

type Authorized = {
  ok: true;
  sellerAccountId: string;
  actorId: string;
};

type AuthorizationFailure = {
  ok: false;
  reason: 'denied' | 'rate_limited' | 'not_configured';
};

async function authorize(
  permission: PortalPermission,
  rateLimitKey: string,
): Promise<Authorized | AuthorizationFailure> {
  // An environment with no database is a real, expected condition (CI,
  // preview deploys). Degrade honestly rather than letting a query throw.
  if (!isDatabaseConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  let session;

  try {
    session = await requirePermission(permission);
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, reason: 'denied' };
    throw error;
  }

  // ADR-006: sourcing from a supplier is a Dropshipper capability. A Retailer
  // account holding `product:import` still may not create supplier-backed
  // catalog records.
  if (session.sellerBusinessModel !== 'DROPSHIPPER') {
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

type DraftCaptureFailure = Extract<ProductDraftActionResult, { ok: false }>;

async function createCjEvidenceAdapter() {
  const [
    { default: CjSupplierAdapter },
    { default: CjTokenManager },
    { default: PostgresSupplierSecretStore },
  ] = await Promise.all([
    import('@/modules/suppliers/providers/cj/cj-adapter'),
    import('@/modules/suppliers/providers/cj/cj-auth'),
    import('@/lib/secrets/postgres-supplier-secret-store'),
  ]);
  const secretStore = new PostgresSupplierSecretStore();

  return new CjSupplierAdapter(secretStore, new CjTokenManager(secretStore));
}

function mapCaptureFailure(
  outcome: Extract<CaptureEvidenceResult, { ok: false }>,
): DraftCaptureFailure {
  if (outcome.reason === 'rate_limited') {
    return { ok: false, reason: 'rate_limited' };
  }

  if (outcome.reason === 'not_found') {
    return { ok: false, reason: 'not_found' };
  }

  return { ok: false, reason: outcome.reason };
}

async function captureEvidenceBeforeDraft(input: {
  candidateId: string;
  sellerAccountId: string;
  actorId: string;
  adapter: Awaited<ReturnType<typeof createCjEvidenceAdapter>>;
}): Promise<DraftCaptureFailure | null> {
  const outcome = await captureCandidateEvidence(
    { adapter: input.adapter },
    {
      candidateId: input.candidateId,
      sellerAccountId: input.sellerAccountId,
      actorId: input.actorId,
    },
  );

  return outcome.ok ? null : mapCaptureFailure(outcome);
}

/**
 * Creates — or returns — the Sals3 product draft for a candidate this seller
 * owns. Idempotent: the same key with the same canonical request replays the
 * stored result, and with a different request reports a conflict.
 */
/**
 * Refuse a malformed request, and leave something behind that says why.
 *
 * All three boundary schemas in this file used to discard `parsed.error`, so an
 * `invalid_input` was a dead end: the seller saw a generic sentence and the
 * server kept no record of which field failed. Diagnosing one meant reproducing
 * it.
 *
 * The issues go to the server log and **never** into the returned message
 * (rule 34: no internal detail in a production response). What is logged is
 * zod's own `path` and `code` — deliberately not `message`, and never the
 * received value, because the value is exactly the untrusted payload and a
 * description document or a price list has no business in a log line.
 */
function refuseInvalidInput(error: ZodError): {
  ok: false;
  reason: 'invalid_input';
} {
  // eslint-disable-next-line no-console
  console.warn('[portal] product draft action rejected malformed input', {
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
    })),
  });

  return { ok: false, reason: 'invalid_input' };
}

export async function createProductDraftAction(
  input: unknown,
): Promise<ProductDraftActionResult> {
  const parsed = createProductDraftInputSchema.safeParse(input);

  if (!parsed.success) return refuseInvalidInput(parsed.error);

  const auth = await authorize('product:import', 'catalog-draft:create');

  if (!auth.ok) return auth;

  try {
    const evidenceLimit = checkRateLimit(
      `catalog-evidence:create-draft:${auth.sellerAccountId}`,
      EVIDENCE_CAPTURE_RATE_LIMIT,
    );

    if (!evidenceLimit.allowed) return { ok: false, reason: 'rate_limited' };

    const adapter = await createCjEvidenceAdapter();
    const captureFailure = await captureEvidenceBeforeDraft({
      candidateId: parsed.data.candidateId,
      sellerAccountId: auth.sellerAccountId,
      actorId: auth.actorId,
      adapter,
    });

    if (captureFailure !== null) return captureFailure;

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

export async function bulkCreateProductDraftsAction(
  input: unknown,
): Promise<BulkProductDraftActionResult> {
  const parsed = bulkCreateProductDraftsInputSchema.safeParse(input);

  if (!parsed.success) return refuseInvalidInput(parsed.error);

  const auth = await authorize('product:import', 'catalog-draft:bulk-create');

  if (!auth.ok) return auth;

  try {
    const evidenceLimit = checkRateLimit(
      `catalog-evidence:bulk-create-draft:${auth.sellerAccountId}`,
      EVIDENCE_CAPTURE_RATE_LIMIT,
    );

    if (!evidenceLimit.allowed) return { ok: false, reason: 'rate_limited' };

    const adapter = await createCjEvidenceAdapter();
    let created = 0;
    let replayed = 0;
    const failed: Array<{
      candidateId: string;
      reason: ProductDraftFailureReason;
    }> = [];

    // Sequential by design: one bounded server action owns the batch, and each
    // candidate keeps its own idempotency key.
    // eslint-disable-next-line no-restricted-syntax -- ordered writes keep load bounded and toasts deterministic.
    for (const request of parsed.data.requests) {
      // eslint-disable-next-line no-await-in-loop
      const captureFailure = await captureEvidenceBeforeDraft({
        candidateId: request.candidateId,
        sellerAccountId: auth.sellerAccountId,
        actorId: auth.actorId,
        adapter,
      });

      if (captureFailure !== null) {
        failed.push({
          candidateId: request.candidateId,
          reason: captureFailure.reason,
        });

        if (
          captureFailure.reason === 'rate_limited' ||
          captureFailure.reason === 'supplier_unavailable'
        ) {
          break;
        }

        // eslint-disable-next-line no-continue
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const outcome = await createProductDraftFromCandidate({
        candidateId: request.candidateId,
        sellerAccountId: auth.sellerAccountId,
        actorId: auth.actorId,
        idempotencyKey: request.idempotencyKey,
      });

      if (outcome.ok) {
        if (outcome.result.replayed) replayed += 1;
        else created += 1;
      } else {
        failed.push({
          candidateId: request.candidateId,
          reason: outcome.reason,
        });
      }
    }

    revalidatePath('/products/pipeline');
    revalidateListingViews();

    return { ok: true, created, replayed, failed };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] bulk create product drafts failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return { ok: false, reason: 'failed' };
  }
}

export type SaveProductDraftActionResult =
  | {
      ok: true;
      /**
       * The revision this actually wrote — a new draft when the product was
       * already published. See `description-actions.ts` for why the editor
       * must adopt it rather than keep its own.
       */
      revisionId: string;
      revisionVersion: number;
      /** True when this save opened a new draft off the published revision. */
      forked: boolean;
    }
  | {
      ok: false;
      reason:
        | 'invalid_input'
        | 'denied'
        | 'rate_limited'
        | 'not_configured'
        | 'not_found'
        | 'version_conflict'
        | 'revision_in_review'
        | 'image_not_stored'
        | 'price_persistence_failed'
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

  if (!parsed.success) return refuseInvalidInput(parsed.error);

  const auth = await authorize('product:edit', 'catalog-draft:save');

  if (!auth.ok) return auth;

  try {
    const outcome = await saveProductDraft({
      request: parsed.data,
      sellerAccountId: auth.sellerAccountId,
      actorId: auth.actorId,
    });

    return outcome.ok
      ? {
          ok: true,
          revisionId: outcome.revisionId,
          revisionVersion: outcome.revisionVersion,
          forked: outcome.forked,
        }
      : { ok: false, reason: outcome.reason };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] save product draft failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return { ok: false, reason: 'failed' };
  }
}
