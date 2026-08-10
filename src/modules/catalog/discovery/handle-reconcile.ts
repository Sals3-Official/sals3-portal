import getDb from '@/lib/db/client';
import resolveBuyerDestinationCountryPolicy from '@/lib/country-policy/buyer-destination-country';
import {
  listStrandedEvaluations,
  requeueDueRefreshes,
  requeueForSourceChange,
  requeuePolicyVersionMismatches,
} from '../candidates/repository';
import {
  composeEvaluationPolicyVersion,
  POLICY_VERSION,
} from '../candidates/rules/policy';
import { FRESHNESS_SWEEP_BATCH, FRESHNESS_SWEEP_DELAY_SECONDS } from './config';
import type { ReconcileProductMessage } from './messages';
import { insertOutboxIntents, type OutboxIntent } from './outbox-repository';
import { isDiscoveryRunning } from './run-state-repository';

/**
 * How long a `QUEUED` row may sit untouched before the sweep re-enqueues its
 * evaluation message - covers a lost message or one parked by the delivery
 * cap. Comfortably longer than any legitimate admission delay, so normal
 * in-flight work is never double-driven (and a duplicate is a claim-level
 * no-op anyway).
 */
const STRANDED_QUEUED_AFTER_MS = 2 * 60 * 60 * 1000;

/**
 * RECONCILE_PRODUCT: the freshness + recovery machinery (ADR-010 §12.2,
 * §12.6, §12.7).
 *
 * - `SWEEP`, bounded per invocation, then re-enqueues itself with a delay
 *   (queue continuation, not a cron tick):
 *   1. requeues decided rows whose `nextRefreshAt` passed (admission
 *      `EVIDENCE_EXPIRED`);
 *   2. requeues decided rows whose stored policy version is obsolete
 *      (admission `POLICY_VERSION_CHANGED`) - a policy change re-evaluates
 *      unchanged rows too, including `BLOCKED`, so no historical decision
 *      stays silently active under an obsolete rule pack;
 *   3. re-enqueues evaluation messages for stranded rows (`QUEUED` gone
 *      stale, `EVALUATING` with an expired lease) so a lost or
 *      delivery-cap-parked message can never leave a product in-flight
 *      forever.
 * - `PRODUCT`: requeues one candidate after a source-change signal
 *   (admission `MATERIAL_SOURCE_CHANGE`), used by the webhook handler.
 */

function evaluationIntent(input: {
  candidateId: string;
  policyVersion: string;
  admissionReason:
    | 'EVIDENCE_EXPIRED'
    | 'MATERIAL_SOURCE_CHANGE'
    | 'POLICY_VERSION_CHANGED'
    | 'RETRY_DUE';
  keySuffix: string;
}): OutboxIntent {
  return {
    message: {
      v: 1,
      operation: 'EVALUATE_CANDIDATE',
      idempotencyKey: `evaluate:${input.candidateId}:${input.keySuffix}`,
      candidateId: input.candidateId,
      policyVersion: input.policyVersion,
      admissionReason: input.admissionReason,
    },
  };
}

export default async function handleReconcileProduct(
  message: ReconcileProductMessage,
): Promise<void> {
  const db = getDb();
  const policyVersion = composeEvaluationPolicyVersion(
    POLICY_VERSION,
    resolveBuyerDestinationCountryPolicy().policyVersion,
  );

  if (message.mode === 'PRODUCT') {
    if (message.candidateId === undefined) return;

    await db.transaction(async (tx) => {
      const requeued = await requeueForSourceChange(tx, message.candidateId!);

      if (requeued) {
        await insertOutboxIntents(tx, [
          evaluationIntent({
            candidateId: message.candidateId!,
            policyVersion,
            admissionReason: 'MATERIAL_SOURCE_CHANGE',
            keySuffix: `source-change:${message.idempotencyKey}`,
          }),
        ]);
      }
    });
    return;
  }

  // --- SWEEP ---------------------------------------------------------------
  if (message.supplierConnectionId === undefined) return;

  const connectionId = message.supplierConnectionId;

  if (!(await isDiscoveryRunning(db, connectionId))) {
    // Paused: freshness work is background supplier spend too. Resume
    // restarts the chain.
    return;
  }

  const sweepBucket = Math.floor(
    Date.now() / (FRESHNESS_SWEEP_DELAY_SECONDS * 1000),
  );

  await db.transaction(async (tx) => {
    const refreshed = await requeueDueRefreshes(
      tx,
      connectionId,
      FRESHNESS_SWEEP_BATCH,
    );
    const policyStale = await requeuePolicyVersionMismatches(tx, connectionId, {
      currentPolicyVersion: policyVersion,
      limit: FRESHNESS_SWEEP_BATCH,
    });
    const stranded = await listStrandedEvaluations(tx, connectionId, {
      stalledSince: new Date(Date.now() - STRANDED_QUEUED_AFTER_MS),
      limit: FRESHNESS_SWEEP_BATCH,
    });

    const anyBatchFull =
      refreshed.length >= FRESHNESS_SWEEP_BATCH ||
      policyStale.length >= FRESHNESS_SWEEP_BATCH ||
      stranded.length >= FRESHNESS_SWEEP_BATCH;

    await insertOutboxIntents(tx, [
      ...refreshed.map((candidateId) =>
        evaluationIntent({
          candidateId,
          policyVersion,
          admissionReason: 'EVIDENCE_EXPIRED',
          keySuffix: `refresh:${sweepBucket}`,
        }),
      ),
      ...policyStale.map((candidateId) =>
        evaluationIntent({
          candidateId,
          policyVersion,
          admissionReason: 'POLICY_VERSION_CHANGED',
          keySuffix: `policy:${sweepBucket}`,
        }),
      ),
      ...stranded.map((candidateId) =>
        evaluationIntent({
          candidateId,
          policyVersion,
          admissionReason: 'RETRY_DUE',
          keySuffix: `stranded:${sweepBucket}`,
        }),
      ),
      // Self-chaining continuation; a full batch re-sweeps sooner.
      {
        message: {
          v: 1,
          operation: 'RECONCILE_PRODUCT',
          idempotencyKey: `freshness:${connectionId}:${sweepBucket + 1}`,
          mode: 'SWEEP',
          supplierConnectionId: connectionId,
        },
        delaySeconds: anyBatchFull ? 60 : FRESHNESS_SWEEP_DELAY_SECONDS,
      },
    ]);
  });
}
