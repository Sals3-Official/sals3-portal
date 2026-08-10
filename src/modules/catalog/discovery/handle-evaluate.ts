import { randomUUID } from 'crypto';
import getDb from '@/lib/db/client';
import evaluateCandidate from '../candidates/evaluate';
import {
  claimEvaluationByCandidateId,
  findCandidateById,
  findEvaluationByCandidateId,
  releaseEvaluationClaim,
} from '../candidates/repository';
import { LEASE_DURATION_MS } from '../candidates/rules/policy';
import {
  BUDGET_RETRY_DELAY_SECONDS,
  PRODUCT_QUERY_POINTS_COST,
} from './config';
import type { EvaluateCandidateMessage } from './messages';
import { assessBackgroundBudget } from './budget-repository';
import createGovernedFetch from './governed-fetch';
import { insertOutboxIntents } from './outbox-repository';

/**
 * Points-budget admission parking: when the budget refuses, the claim is
 * released WITHOUT burning an attempt and a delayed continuation is
 * persisted. Never keeps a function alive sleeping until a refill.
 */
export async function parkEvaluationForBudget(input: {
  candidateId: string;
  workerId: string;
  policyVersion: string;
  retryAt: Date;
}): Promise<void> {
  const db = getDb();

  await releaseEvaluationClaim(db, {
    candidateId: input.candidateId,
    workerId: input.workerId,
    lastErrorCode: 'POINTS_BUDGET_UNAVAILABLE',
  });
  await insertOutboxIntents(db, [
    {
      message: {
        v: 1,
        operation: 'EVALUATE_CANDIDATE',
        idempotencyKey: `evaluate:${input.candidateId}:budget:${input.retryAt.getTime()}`,
        candidateId: input.candidateId,
        policyVersion: input.policyVersion,
        admissionReason: 'RETRY_DUE',
      },
      delaySeconds: Math.max(
        60,
        Math.min(
          Math.ceil((input.retryAt.getTime() - Date.now()) / 1000),
          BUDGET_RETRY_DELAY_SECONDS * 4,
        ),
      ),
    },
  ]);
}

/**
 * EVALUATE_CANDIDATE: one logical evaluation job for a PID plus
 * evidence/policy version. At-least-once safe: admission is a `FOR UPDATE`
 * claim (QUEUED, expired-lease EVALUATING, or a due retry), so a duplicate
 * or out-of-order delivery finds nothing claimable and acknowledges as a
 * no-op - never a duplicate logical evidence decision.
 *
 * The evaluation itself (screening -> evidence fetch -> qualification ->
 * decision + snapshot + audit) is the EXISTING evaluator, unchanged; this
 * handler only adds queue admission, the points-budget gate, and the
 * delayed-retry successor.
 */
export default async function handleEvaluateCandidate(
  message: EvaluateCandidateMessage,
): Promise<void> {
  const db = getDb();
  const workerId = randomUUID();

  const claimed = await db.transaction(async (tx) =>
    claimEvaluationByCandidateId(tx, {
      candidateId: message.candidateId,
      workerId,
      leaseDurationMs: LEASE_DURATION_MS,
    }),
  );

  if (claimed === null) return;

  // Points-budget gate BEFORE any supplier work: the evidence fetch spends
  // detail + inventory points. A refused budget releases the claim without
  // burning an attempt and parks a delayed continuation.
  const candidate = await findCandidateById(db, message.candidateId);

  if (candidate !== null) {
    const budget = await assessBackgroundBudget(db, {
      supplierConnectionId: candidate.supplierConnectionId,
      requiredPoints: PRODUCT_QUERY_POINTS_COST * 2,
    });

    if (!budget.allowed) {
      await parkEvaluationForBudget({
        candidateId: message.candidateId,
        workerId,
        policyVersion: message.policyVersion,
        retryAt: budget.retryAt,
      });
      return;
    }
  }

  // Governed fetch: every supplier call of this evaluation goes through the
  // shared database limiter (concurrent workers cannot collectively exceed
  // the provider rate) and persists pointsInfo from the real responses.
  await evaluateCandidate(claimed, {
    fetchImpl:
      candidate === null
        ? undefined
        : createGovernedFetch(candidate.supplierConnectionId),
  });

  // Schedule the delayed retry successor when the evaluator recorded one -
  // the queue replaces the old cron-tick retry scan, so a retryable row must
  // never wait for a scheduler that no longer exists.
  const after = await findEvaluationByCandidateId(db, message.candidateId);

  if (
    after !== null &&
    (after.status === 'TEMPORARILY_INELIGIBLE' ||
      after.status === 'EVALUATION_FAILED') &&
    after.nextRetryAt !== null
  ) {
    const delaySeconds = Math.max(
      1,
      Math.ceil((after.nextRetryAt.getTime() - Date.now()) / 1000),
    );

    await insertOutboxIntents(db, [
      {
        message: {
          v: 1,
          operation: 'EVALUATE_CANDIDATE',
          idempotencyKey: `evaluate:${message.candidateId}:retry:${after.attemptCount}:${after.nextRetryAt.getTime()}`,
          candidateId: message.candidateId,
          policyVersion: message.policyVersion,
          admissionReason: 'RETRY_DUE',
        },
        delaySeconds,
      },
    ]);
  }
}
