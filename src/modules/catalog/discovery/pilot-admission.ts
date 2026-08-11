import getDb from '@/lib/db/client';
import resolveBuyerDestinationCountryPolicy from '@/lib/country-policy/buyer-destination-country';
import {
  listPilotAdmissibleCandidates,
  requeueForManualRecheck,
} from '../candidates/repository';
import {
  composeEvaluationPolicyVersion,
  POLICY_VERSION,
} from '../candidates/rules/policy';
import { assessPilotAllowance } from './pilot-allowance-repository';
import { insertOutboxIntents } from './outbox-repository';
import dispatchOutbox from './outbox-dispatch';

/**
 * Owner-triggered admission for the development pilot.
 *
 * The normal producer of evaluation work is the freshness/policy SWEEP in
 * `handle-reconcile.ts`, but that returns early unless discovery is RUNNING
 * - and the pilot deliberately runs with discovery PAUSED, so that no new
 * product is ingested while it is in progress. Pausing therefore silences
 * the only mechanism that would feed the pilot. This function is the
 * resolution: a bounded, owner-invoked admission that does NOT consult
 * `isDiscoveryRunning`, because "stop ingesting new products" and "stop
 * evaluating the ones already chosen" are separate intentions.
 *
 * Deliberately NOT a new queue operation, self-chaining handler, or table.
 * It is a small temporary action that requeues an explicitly-bounded set and
 * hands off to the existing chain: `dispatcher.ts` drains the outbox after
 * every message, so the first batch fans out on its own.
 *
 * Idempotent. A repeated call finds nothing left to admit once the previous
 * batch has moved, and the claim in `handle-evaluate.ts` no-ops on any
 * duplicate message that still arrives.
 */

export type PilotAdmissionResult = {
  admitted: number;
  dispatched: number;
  failed: number;
  paidCount: number;
  limit: number;
  /** True when the allowance is already spent - nothing was admitted. */
  capReached: boolean;
};

export default async function admitPilotCandidates(input: {
  limit: number;
}): Promise<PilotAdmissionResult> {
  const db = getDb();
  const allowance = await assessPilotAllowance(db);

  if (allowance.exhausted) {
    return {
      admitted: 0,
      dispatched: 0,
      failed: 0,
      paidCount: allowance.paidCount,
      limit: allowance.limit,
      capReached: true,
    };
  }

  // Never admit more than the allowance can still pay for. Without this the
  // route would happily queue thousands of messages that the gate in
  // `evaluate.ts` would then refuse one by one, turning a bounded pilot into
  // a large pile of pointless work.
  const admissionLimit = Math.max(
    0,
    Math.min(input.limit, allowance.limit - allowance.paidCount),
  );

  const candidateIds = await listPilotAdmissibleCandidates(db, {
    limit: admissionLimit,
  });

  if (candidateIds.length === 0) {
    return {
      admitted: 0,
      dispatched: 0,
      failed: 0,
      paidCount: allowance.paidCount,
      limit: allowance.limit,
      capReached: false,
    };
  }

  const policyVersion = composeEvaluationPolicyVersion(
    POLICY_VERSION,
    resolveBuyerDestinationCountryPolicy().policyVersion,
  );

  const admitted = await db.transaction(async (tx) => {
    const requeued: string[] = [];

    // eslint-disable-next-line no-restricted-syntax -- one bounded batch; sequential keeps the requeue easy to reason about against its CAS.
    for (const candidateId of candidateIds) {
      // eslint-disable-next-line no-await-in-loop -- see above.
      const moved = await requeueForManualRecheck(tx, candidateId);

      if (moved) requeued.push(candidateId);
    }

    if (requeued.length > 0) {
      await insertOutboxIntents(
        tx,
        requeued.map((candidateId) => ({
          message: {
            v: 1 as const,
            operation: 'EVALUATE_CANDIDATE' as const,
            idempotencyKey: `evaluate:${candidateId}:pilot:${policyVersion}`,
            candidateId,
            policyVersion,
            admissionReason: 'RETRY_DUE' as const,
          },
        })),
      );
    }

    return requeued;
  });

  // The kick-off drain matters here for the same reason it does in
  // `control.ts`: with discovery paused there is no delivery in flight to
  // redeliver-and-drain later, so a failed publish would leave the intents
  // durably PENDING with nothing to pick them up. Surfaced to the caller.
  const drain = await dispatchOutbox();

  return {
    admitted: admitted.length,
    dispatched: drain.dispatched,
    failed: drain.failed,
    paidCount: allowance.paidCount,
    limit: allowance.limit,
    capReached: false,
  };
}
