'use server';

import { revalidatePath } from 'next/cache';
import getDb from '@/lib/db/client';
import {
  bulkCreateProductDraftsInputSchema,
  type BulkCreateProductDraftsResult,
  type BulkDraftRowOutcome,
} from '@/modules/catalog/products/contracts';
import createProductDraftFromCandidate from '@/modules/catalog/products/create-draft';
import { listCandidateIdsWithProducts } from '@/modules/catalog/products/repository';
import authorizeDraftAction from './draft-action-auth';

/**
 * "Add to Product Catalogue" for a page of selected pipeline candidates.
 *
 * One authorization, then one `createProductDraftFromCandidate` per candidate -
 * **sequentially, one transaction each**, never in parallel. Each draft holds a
 * pooled connection for 10-25 statements; N in flight would pin N connections
 * while the page itself still needs some. The database is co-located with the
 * function region, and most drafts are evidence-less (~10 statements), so a
 * full page of 100 is seconds, not minutes. If a run still times out, the
 * per-candidate idempotency keys make the retry cheap: everything already
 * created replays from its stored result instead of writing again.
 *
 * Tenancy is per candidate and lives INSIDE the domain module: each create
 * resolves the candidate through `findCandidateSourceForSeller`, seller filter
 * in the same WHERE as the lookup, in the same transaction as the writes. A
 * foreign candidate id in the batch yields `failed: not_found` for that row
 * and touches nothing.
 *
 * One row's failure never stops the rest - the seller gets a per-row outcome
 * list, and the client keeps failed rows selected so the retry is one click.
 */

/**
 * Deliberately its own bucket, NOT the single-draft one: one bulk call does up
 * to 100 candidates' work, so sharing the 30/min single bucket would allow
 * 3,000 drafts a minute through the side door.
 */
const BULK_RATE_LIMIT = { capacity: 10, refillIntervalMs: 60_000 };

export default async function bulkCreateProductDraftsAction(
  input: unknown,
): Promise<BulkCreateProductDraftsResult> {
  const parsed = bulkCreateProductDraftsInputSchema.safeParse(input);

  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorizeDraftAction(
    'product:import',
    'catalog-draft:bulk',
    BULK_RATE_LIMIT,
  );

  if (!auth.ok) return auth;

  const { candidateIds, idempotencyKeyBase } = parsed.data;

  // Pre-check catches a stale page (the UI disables these checkboxes). Reads
  // only ids that are about to be re-verified per row inside the create.
  const existing = new Set(
    (await listCandidateIdsWithProducts(getDb(), candidateIds)).map(
      (row) => row.sourceCandidateId,
    ),
  );

  const outcomes: BulkDraftRowOutcome[] = [];

  // eslint-disable-next-line no-restricted-syntax -- sequential on purpose: each draft is one transaction holding a pooled connection, and N in parallel would pin N connections. Same posture as run-tick.ts.
  for (const candidateId of candidateIds) {
    if (existing.has(candidateId)) {
      outcomes.push({ candidateId, status: 'already_in_catalogue' });
    } else {
      try {
        // eslint-disable-next-line no-await-in-loop -- the sequencing IS the point; see above.
        const outcome = await createProductDraftFromCandidate({
          candidateId,
          sellerAccountId: auth.sellerAccountId,
          actorId: auth.actorId,
          idempotencyKey: `${idempotencyKeyBase}:${candidateId}`,
        });

        outcomes.push(
          outcome.ok
            ? {
                candidateId,
                status: 'created',
                productId: outcome.result.productId,
                missingRequirements: outcome.result.missingRequirements,
              }
            : { candidateId, status: 'failed', reason: outcome.reason },
        );
      } catch (error) {
        // Same outward posture as the single action: generic failure out, the
        // detail stays in the server log, and the loop continues.
        // eslint-disable-next-line no-console
        console.error('[portal] bulk product draft failed for one candidate', {
          candidateId,
          error: error instanceof Error ? error.message : 'unknown',
        });
        outcomes.push({ candidateId, status: 'failed', reason: 'failed' });
      }
    }
  }

  // The pipeline needs its "In catalogue" highlights and /listings its rows.
  // NOT `updateTag(CANDIDATE_STATUS_COUNTS_TAG)` - drafting a product does not
  // move any candidate between evaluation buckets, so the counts are untouched.
  revalidatePath('/products/pipeline');
  revalidatePath('/listings');

  return { ok: true, outcomes };
}
