import getDb, { type Database } from '@/lib/db/client';

import type { DiscardProductDraftInput } from './contracts';
import discardDraftRevision from './discard-draft-revision';
import { findProductForSteward } from './repository';

/**
 * Transaction and tenant boundary for abandoning an open draft.
 *
 * Same two-layer split as `save-draft.ts` over `open-draft-for-edit.ts`: this
 * file resolves the tenant and owns the transaction, and
 * `discard-draft-revision.ts` holds the state machine. The freeze, the
 * restored `current_revision_id`, and the audit event are three writes that
 * must land together — a discard that froze the draft and failed to move the
 * product would leave it published from a revision the editor can no longer
 * write to, which is the `version_conflict` dead end this whole feature exists
 * to remove.
 *
 * `findProductForSteward` is the tenant check and it happens inside the
 * transaction, so the seller account is re-derived from the session's own
 * account rather than trusted from the request — a product another seller
 * stewards is `not_found`, indistinguishable from one that does not exist.
 */
export type DiscardProductDraftOutcome =
  | { ok: true; restoredRevisionId: string; restoredRevisionVersion: number }
  | {
      ok: false;
      reason: 'not_found' | 'version_conflict' | 'no_published_revision';
    };

export default async function discardProductDraft(input: {
  request: DiscardProductDraftInput;
  sellerAccountId: string;
  actorId: string;
  database?: Database;
  now?: Date;
}): Promise<DiscardProductDraftOutcome> {
  const database = input.database ?? getDb();
  const now = input.now ?? new Date();
  const { request } = input;

  return database.transaction(async (tx) => {
    const product = await findProductForSteward(
      tx,
      request.productId,
      input.sellerAccountId,
    );

    if (product === null) return { ok: false as const, reason: 'not_found' };

    const outcome = await discardDraftRevision(tx, {
      product,
      revisionId: request.revisionId,
      expectedRevisionVersion: request.expectedRevisionVersion,
      actorId: input.actorId,
      now,
    });

    return outcome.ok
      ? {
          ok: true as const,
          restoredRevisionId: outcome.restoredRevisionId,
          restoredRevisionVersion: outcome.restoredRevisionVersion,
        }
      : { ok: false as const, reason: outcome.reason };
  });
}
