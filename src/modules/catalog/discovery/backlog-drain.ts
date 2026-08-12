import getDb from '@/lib/db/client';
import resolveBuyerDestinationCountryPolicy from '@/lib/country-policy/buyer-destination-country';
import {
  composeEvaluationPolicyVersion,
  POLICY_VERSION,
} from '../candidates/rules/policy';
import { requeueForManualRecheck } from '../candidates/repository';
import { BACKLOG_DRAIN_BATCH } from './config';
import {
  findBacklogGate,
  listActionableBacklogCandidateIds,
} from './intake-gate-repository';
import { insertOutboxIntents } from './outbox-repository';

/**
 * ONE-TIME transition control (temporary code).
 *
 * Candidate Pipeline rows that existed when the lean intake policy activated
 * must be reconciled to it before broad discovery makes any new legacy
 * `product/list` request. This function is that reconciliation, and it is
 * deliberately cheap: it re-admits a bounded batch of pre-cutoff actionable
 * rows to the LOCAL evaluator, which under the lean policy performs supplier
 * screening from persisted feed data only. It never calls `product/query`,
 * inventory, comments, freight, or any AI service, so draining a large
 * historical backlog costs zero CJ points.
 *
 * Nothing here deletes a candidate, snapshot, evaluation, or audit event.
 * Historical evidence stays immutable and readable; only the decision is
 * re-made under the current policy.
 *
 * Safe to call repeatedly and concurrently: `requeueForManualRecheck` is a
 * guarded compare-and-set per row, and each outbox intent carries a stable
 * idempotency key, so a duplicate delivery adds no duplicate work. Once the
 * gate records `DRAIN_COMPLETE` this function stops finding anything and the
 * gate is never re-armed.
 */
export default async function drainExistingBacklog(
  supplierConnectionId: string,
): Promise<{ requeued: number; remaining: number }> {
  const db = getDb();
  const gate = await findBacklogGate(db, supplierConnectionId);

  if (gate === null || gate.state === 'DRAIN_COMPLETE') {
    return { requeued: 0, remaining: 0 };
  }

  const candidateIds = await listActionableBacklogCandidateIds(db, {
    supplierConnectionId,
    activationAt: gate.activationAt,
    limit: BACKLOG_DRAIN_BATCH,
  });

  if (candidateIds.length === 0) return { requeued: 0, remaining: 0 };

  const policyVersion = composeEvaluationPolicyVersion(
    POLICY_VERSION,
    resolveBuyerDestinationCountryPolicy().policyVersion,
  );

  const requeued = await db.transaction(async (tx) => {
    const moved: string[] = [];

    // eslint-disable-next-line no-restricted-syntax -- one bounded batch; sequential keeps each CAS easy to reason about.
    for (const candidateId of candidateIds) {
      // eslint-disable-next-line no-await-in-loop -- see above.
      const requeuedRow = await requeueForManualRecheck(tx, candidateId);

      if (requeuedRow) moved.push(candidateId);
    }

    if (moved.length > 0) {
      await insertOutboxIntents(
        tx,
        moved.map((candidateId) => ({
          message: {
            v: 1 as const,
            operation: 'EVALUATE_CANDIDATE' as const,
            // Stable per (candidate, policy): a redelivered drain cannot
            // create a second logical evaluation job for the same row.
            idempotencyKey: `evaluate:${candidateId}:backlog-drain:${policyVersion}`,
            candidateId,
            policyVersion,
            admissionReason: 'RETRY_DUE' as const,
          },
        })),
      );
    }

    return moved;
  });

  return {
    requeued: requeued.length,
    remaining: Math.max(0, candidateIds.length - requeued.length),
  };
}
