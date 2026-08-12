import { randomUUID } from 'crypto';
import getDb from '@/lib/db/client';
import resolveBuyerDestinationCountryPolicy from '@/lib/country-policy/buyer-destination-country';
import { listWorkableConnections } from '@/modules/suppliers/repository';
import {
  countPolicyVersionMismatches,
  requeuePolicyVersionMismatches,
} from '../candidates/repository';
import {
  composeEvaluationPolicyVersion,
  POLICY_VERSION,
} from '../candidates/rules/policy';
import { evaluationIntent } from './handle-reconcile';
import { insertOutboxIntents } from './outbox-repository';
import dispatchOutbox from './outbox-dispatch';

/**
 * Owner-triggered, bounded re-evaluation of decisions taken under an
 * obsolete policy version.
 *
 * This exists because the automatic path cannot be reached while discovery is
 * paused. `requeuePolicyVersionMismatches` is normally driven by the
 * `RECONCILE_PRODUCT` sweep, and that handler returns early unless the run
 * state is `RUNNING` - correctly, since the freshness tiers around it do spend
 * supplier calls. Resuming to reach it would also restart broad discovery
 * (partitions and curated lanes), which does spend CJ points. This route
 * separates the two.
 *
 * Running it while paused is safe because a re-evaluation spends nothing:
 * `evaluateCandidate` screens from the stored `feed_snapshot` and the resolved
 * policy, records the decision, and returns - it holds no supplier adapter and
 * makes no CJ request (its audit payload asserts `supplierEvidenceFetched:
 * false`). `handleEvaluateCandidate` likewise has no run-state gate, so the
 * queue drains these while discovery stays paused.
 *
 * Bounded per call on purpose: the caller decides how much to re-open at a
 * time and can watch the tab counts move before continuing.
 */

export type RecheckConnectionResult = {
  supplierConnectionId: string;
  requeued: number;
  /** Rows still on an obsolete policy version after this call. */
  remaining: number;
};

export type RecheckResult = {
  policyVersion: string;
  requeued: number;
  results: RecheckConnectionResult[];
  outbox: { dispatched: number; failed: number };
};

export default async function recheckPolicyVersionMismatches(input: {
  limit: number;
  supplierConnectionId?: string;
}): Promise<RecheckResult> {
  const db = getDb();
  const policyVersion = composeEvaluationPolicyVersion(
    POLICY_VERSION,
    resolveBuyerDestinationCountryPolicy().policyVersion,
  );

  const connections = await listWorkableConnections(db);
  const targets =
    input.supplierConnectionId === undefined
      ? connections
      : connections.filter(
          (connection) => connection.id === input.supplierConnectionId,
        );

  // One token per invocation, so every call enqueues its own intents instead
  // of colliding with an earlier call's. Outbox idempotency keys are unique
  // and never pruned, so a reused key is silently dropped and the row then
  // sits in QUEUED with nothing to evaluate it - the failure mode is far
  // worse than a duplicate, which `claimEvaluationByCandidateId` absorbs as a
  // no-op.
  const requestId = randomUUID();
  const results: RecheckConnectionResult[] = [];

  // eslint-disable-next-line no-restricted-syntax -- a handful of connections, mirroring applyDiscoveryControl.
  for (const connection of targets) {
    // eslint-disable-next-line no-await-in-loop -- see above.
    const requeued = await db.transaction(async (tx) => {
      const candidateIds = await requeuePolicyVersionMismatches(
        tx,
        connection.id,
        { currentPolicyVersion: policyVersion, limit: input.limit },
      );

      await insertOutboxIntents(
        tx,
        candidateIds.map((candidateId) =>
          evaluationIntent({
            candidateId,
            policyVersion,
            admissionReason: 'POLICY_VERSION_CHANGED',
            keySuffix: `recheck:${requestId}`,
          }),
        ),
      );

      return candidateIds.length;
    });

    // eslint-disable-next-line no-await-in-loop -- see above.
    const remaining = await countPolicyVersionMismatches(db, connection.id, {
      currentPolicyVersion: policyVersion,
    });

    results.push({
      supplierConnectionId: connection.id,
      requeued,
      remaining,
    });
  }

  // Publish now. Without a delivery already in flight nothing else would
  // drain these while discovery is paused, so an undispatched intent would
  // leave every requeued row stuck in QUEUED.
  const outbox = await dispatchOutbox();

  return {
    policyVersion,
    requeued: results.reduce((total, result) => total + result.requeued, 0),
    results,
    outbox,
  };
}
