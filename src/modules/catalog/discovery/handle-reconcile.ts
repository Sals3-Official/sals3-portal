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
import { findBacklogGate } from './intake-gate-repository';
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
 * Re-sweep cadence while any tier still returned a full batch, instead of
 * waiting a whole `FRESHNESS_SWEEP_DELAY_SECONDS` window per batch. This also
 * sets the resolution of the accelerated continuation's idempotency sub-slot,
 * so shortening it cannot make two consecutive continuations collide.
 */
const ACCELERATED_SWEEP_DELAY_SECONDS = 60;

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

/**
 * Exported so the owner-triggered bounded recheck (`recheck-control.ts`)
 * enqueues byte-identical evaluation intents to the ones this sweep emits,
 * rather than keeping a second copy of the message shape in step by hand.
 */
export function evaluationIntent(input: {
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

/**
 * The freshness SWEEP message itself. Exported so `handleCycleStart`'s hourly
 * seed and the Start/Resume control action build the same message from the
 * same key format, instead of restating it at three sites.
 *
 * `keySuffix` is the caller's choice of slot identity, and it decides whether
 * the chain can be revived: `work_outbox.idempotency_key` is unique and never
 * pruned, so an hour-resolution suffix can be spent only once per hour. That
 * is correct for a periodic seed and wrong for a control action - see
 * `startOrResumeConnection`, which passes a per-call suffix so a Resume always
 * revives the chain.
 */
export function freshnessSweepIntent(input: {
  supplierConnectionId: string;
  keySuffix: string;
  delaySeconds?: number;
}): OutboxIntent {
  return {
    message: {
      v: 1,
      operation: 'RECONCILE_PRODUCT',
      idempotencyKey: `freshness:${input.supplierConnectionId}:${input.keySuffix}`,
      mode: 'SWEEP',
      supplierConnectionId: input.supplierConnectionId,
    },
    delaySeconds: input.delaySeconds,
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

  const now = Date.now();
  const sweepBucket = Math.floor(now / (FRESHNESS_SWEEP_DELAY_SECONDS * 1000));

  // The historical freeze line. Both automatic tiers below are bounded by it so
  // they cannot re-open the pipeline that existed when lean intake activated.
  //
  // Without it the two correct mechanisms deadlock each other: the intake gate
  // refuses a new `product/list` request while any evaluation work is active,
  // and the policy-version tier keeps returning historical rows to QUEUED,
  // which IS active work. Measured in production 2026-08-12 with 82,679 rows
  // still on an obsolete policy version - the backlog climbed 73 -> 324 while
  // running, `admitted_count` never left 0, and re-deciding those rows changed
  // nothing anyway because their `intended_market_codes` is empty.
  //
  // The owner-triggered recheck route passes no bound, so re-opening the frozen
  // backlog stays possible without a deploy.
  const gate = await findBacklogGate(db, connectionId);
  const freezeLine = gate?.activationAt;

  await db.transaction(async (tx) => {
    const refreshed = await requeueDueRefreshes(
      tx,
      connectionId,
      FRESHNESS_SWEEP_BATCH,
      freezeLine,
    );
    const policyStale = await requeuePolicyVersionMismatches(tx, connectionId, {
      currentPolicyVersion: policyVersion,
      limit: FRESHNESS_SWEEP_BATCH,
      createdAfter: freezeLine,
    });
    const stranded = await listStrandedEvaluations(tx, connectionId, {
      stalledSince: new Date(Date.now() - STRANDED_QUEUED_AFTER_MS),
      limit: FRESHNESS_SWEEP_BATCH,
    });

    const anyBatchFull =
      refreshed.length >= FRESHNESS_SWEEP_BATCH ||
      policyStale.length >= FRESHNESS_SWEEP_BATCH ||
      stranded.length >= FRESHNESS_SWEEP_BATCH;

    const nextDelaySeconds = anyBatchFull
      ? ACCELERATED_SWEEP_DELAY_SECONDS
      : FRESHNESS_SWEEP_DELAY_SECONDS;
    const nextAt = now + nextDelaySeconds * 1000;
    const nextBucket = Math.floor(
      nextAt / (FRESHNESS_SWEEP_DELAY_SECONDS * 1000),
    );
    const nextSweepKeySuffix = anyBatchFull
      ? `${nextBucket}:${Math.floor(
          nextAt / (ACCELERATED_SWEEP_DELAY_SECONDS * 1000),
        )}`
      : `${nextBucket}`;

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
      //
      // The key identifies the slot the successor is scheduled FOR, never the
      // slot this delivery ran in. `work_outbox.idempotency_key` is uniquely
      // indexed and rows are never pruned, so any given key can be used
      // exactly once for the lifetime of the database - a continuation keyed
      // on a slot that has already been used is silently swallowed by
      // `onConflictDoNothing` and the chain simply stops.
      //
      // That is what `sweepBucket + 1` did on the accelerated path: a full
      // batch re-sweeps in 60s, which lands inside the SAME
      // `FRESHNESS_SWEEP_DELAY_SECONDS` bucket, so the successor reused the
      // key of the delivery being processed and was dropped. Worse, the
      // hourly chain then skipped that bucket too, because the key was
      // already burnt. A backlog drained at one batch per two hours instead
      // of one per minute.
      //
      // Accelerated continuations therefore carry a sub-slot at the
      // accelerated resolution, so consecutive ones inside a bucket stay
      // distinct. The unaccelerated continuation keeps the plain bucket key
      // so it still de-duplicates against `handleCycleStart`'s hourly seed,
      // and an accelerated chain rejoins that hourly chain as soon as a batch
      // comes back short.
      freshnessSweepIntent({
        supplierConnectionId: connectionId,
        keySuffix: nextSweepKeySuffix,
        delaySeconds: nextDelaySeconds,
      }),
    ]);
  });
}
