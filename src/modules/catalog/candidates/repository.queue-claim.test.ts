import { describe, expect, it } from 'vitest';
import { fakeDb, callsOf, lastCallArgs } from '../../../../test/fake-db';
import {
  claimEvaluationByCandidateId,
  listStrandedEvaluations,
  releaseEvaluationClaim,
  requeueDueRefreshes,
  requeueForSourceChange,
  requeuePolicyVersionMismatches,
} from './repository';
import { MAX_EVALUATION_ATTEMPTS } from './rules/policy';

const FUTURE = new Date(Date.now() + 300_000);
const PAST = new Date(Date.now() - 1_000);

function evaluationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'eval-1',
    candidateId: 'candidate-1',
    status: 'QUEUED',
    leasedBy: null,
    leasedUntil: null,
    attemptCount: 0,
    nextRetryAt: null,
    nextRefreshAt: null,
    ...overrides,
  };
}

const CLAIM_INPUT = {
  candidateId: 'candidate-1',
  workerId: 'worker-1',
  leaseDurationMs: 300_000,
};

describe('claimEvaluationByCandidateId - queue admission under at-least-once delivery', () => {
  it('claims a QUEUED row', async () => {
    const row = evaluationRow();
    const { db, calls } = fakeDb([
      [row],
      [{ ...row, status: 'EVALUATING', leasedBy: 'worker-1' }],
    ]);

    const claimed = await claimEvaluationByCandidateId(
      db as never,
      CLAIM_INPUT,
    );

    expect(claimed).not.toBeNull();
    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.status).toBe('EVALUATING');
    expect(set.leasedBy).toBe('worker-1');
  });

  it('recovers an EVALUATING row whose lease expired (crashed worker)', async () => {
    const row = evaluationRow({
      status: 'EVALUATING',
      leasedBy: 'dead-worker',
      leasedUntil: PAST,
    });
    const { db } = fakeDb([[row], [{ ...row, leasedBy: 'worker-1' }]]);

    await expect(
      claimEvaluationByCandidateId(db as never, CLAIM_INPUT),
    ).resolves.not.toBeNull();
  });

  it('refuses an EVALUATING row under a live lease - a duplicate delivery is a no-op', async () => {
    const { db, calls } = fakeDb([
      [
        evaluationRow({
          status: 'EVALUATING',
          leasedBy: 'other-worker',
          leasedUntil: FUTURE,
        }),
      ],
    ]);

    await expect(
      claimEvaluationByCandidateId(db as never, CLAIM_INPUT),
    ).resolves.toBeNull();
    expect(callsOf(calls, 'update')).toHaveLength(0);
  });

  it('claims a due retry with admission RETRY_DUE - the queue replaces the cron retry scan', async () => {
    const row = evaluationRow({
      status: 'EVALUATION_FAILED',
      nextRetryAt: PAST,
      attemptCount: 2,
    });
    const { db, calls } = fakeDb([[row], [{ ...row, status: 'EVALUATING' }]]);

    await expect(
      claimEvaluationByCandidateId(db as never, CLAIM_INPUT),
    ).resolves.not.toBeNull();

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.admissionReason).toBe('RETRY_DUE');
  });

  it('refuses a retry that is not yet due, and an exhausted dead letter', async () => {
    const notDue = fakeDb([
      [
        evaluationRow({
          status: 'TEMPORARILY_INELIGIBLE',
          nextRetryAt: FUTURE,
          attemptCount: 1,
        }),
      ],
    ]);
    const exhausted = fakeDb([
      [
        evaluationRow({
          status: 'EVALUATION_FAILED',
          nextRetryAt: PAST,
          attemptCount: MAX_EVALUATION_ATTEMPTS,
        }),
      ],
    ]);

    await expect(
      claimEvaluationByCandidateId(notDue.db as never, CLAIM_INPUT),
    ).resolves.toBeNull();
    await expect(
      claimEvaluationByCandidateId(exhausted.db as never, CLAIM_INPUT),
    ).resolves.toBeNull();
  });

  it('refuses a freshly decided row - no duplicate logical evidence decision', async () => {
    const { db } = fakeDb([[evaluationRow({ status: 'PASS' })]]);

    await expect(
      claimEvaluationByCandidateId(db as never, CLAIM_INPUT),
    ).resolves.toBeNull();
  });
});

describe('releaseEvaluationClaim', () => {
  it('returns the row to QUEUED without consuming an attempt, scoped to the exact worker', async () => {
    const { db, calls } = fakeDb([[]]);

    await releaseEvaluationClaim(db, {
      candidateId: 'candidate-1',
      workerId: 'worker-1',
      lastErrorCode: 'POINTS_BUDGET_UNAVAILABLE',
    });

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.status).toBe('QUEUED');
    expect('attemptCount' in set).toBe(false);
  });
});

describe('requeueDueRefreshes - the freshness sweep', () => {
  it('requeues due rows with admission EVIDENCE_EXPIRED and returns their candidate ids', async () => {
    const { db, calls } = fakeDb([
      [
        { id: 'eval-1', candidateId: 'candidate-1' },
        { id: 'eval-2', candidateId: 'candidate-2' },
      ],
      [],
    ]);

    await expect(requeueDueRefreshes(db, 'connection-1', 50)).resolves.toEqual([
      'candidate-1',
      'candidate-2',
    ]);

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.status).toBe('QUEUED');
    expect(set.admissionReason).toBe('EVIDENCE_EXPIRED');
    expect(set.attemptCount).toBe(0);
  });

  it('does nothing when no deadline has passed', async () => {
    const { db, calls } = fakeDb([[]]);

    await expect(requeueDueRefreshes(db, 'connection-1', 50)).resolves.toEqual(
      [],
    );
    expect(callsOf(calls, 'update')).toHaveLength(0);
  });
});

describe('requeuePolicyVersionMismatches - ADR-010 §12.6', () => {
  it('requeues stale-policy decided rows (BLOCKED included) with admission POLICY_VERSION_CHANGED', async () => {
    const { db, calls } = fakeDb([
      [
        { id: 'eval-1', candidateId: 'candidate-1' },
        { id: 'eval-2', candidateId: 'candidate-2' },
      ],
      [],
    ]);

    await expect(
      requeuePolicyVersionMismatches(db, 'connection-1', {
        currentPolicyVersion: 'policy-v2',
        limit: 50,
      }),
    ).resolves.toEqual(['candidate-1', 'candidate-2']);

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.status).toBe('QUEUED');
    expect(set.admissionReason).toBe('POLICY_VERSION_CHANGED');
    expect(set.attemptCount).toBe(0);
  });

  it('changes nothing when every decision already carries the current policy version', async () => {
    const { db, calls } = fakeDb([[]]);

    await expect(
      requeuePolicyVersionMismatches(db, 'connection-1', {
        currentPolicyVersion: 'policy-v2',
        limit: 50,
      }),
    ).resolves.toEqual([]);
    expect(callsOf(calls, 'update')).toHaveLength(0);
  });
});

describe('listStrandedEvaluations - lost/parked message recovery', () => {
  it('returns candidates stuck QUEUED past the stall threshold or EVALUATING with an expired lease', async () => {
    const { db } = fakeDb([
      [{ candidateId: 'candidate-1' }, { candidateId: 'candidate-2' }],
    ]);

    await expect(
      listStrandedEvaluations(db, 'connection-1', {
        stalledSince: new Date(Date.now() - 2 * 60 * 60 * 1000),
        limit: 50,
      }),
    ).resolves.toEqual(['candidate-1', 'candidate-2']);
  });

  it('mutates nothing - recovery happens through re-enqueued messages, never a direct state edit', async () => {
    const { db, calls } = fakeDb([[]]);

    await listStrandedEvaluations(db, 'connection-1', {
      stalledSince: new Date(),
      limit: 50,
    });

    expect(callsOf(calls, 'update')).toHaveLength(0);
  });
});

describe('requeueForSourceChange - webhook-driven re-evaluation', () => {
  it('requeues a decided row with admission MATERIAL_SOURCE_CHANGE', async () => {
    const { db, calls } = fakeDb([[{ id: 'eval-1' }]]);

    await expect(requeueForSourceChange(db, 'candidate-1')).resolves.toBe(true);

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.admissionReason).toBe('MATERIAL_SOURCE_CHANGE');
  });

  it('is idempotent - an already-requeued or in-flight row matches nothing', async () => {
    const { db } = fakeDb([[]]);

    await expect(requeueForSourceChange(db, 'candidate-1')).resolves.toBe(
      false,
    );
  });
});
