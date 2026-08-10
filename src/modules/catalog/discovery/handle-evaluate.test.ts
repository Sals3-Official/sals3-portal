import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({
    transaction: (run: (tx: unknown) => Promise<unknown>) => run({ tx: true }),
  }),
  isDatabaseConfigured: () => true,
}));

vi.mock('../candidates/evaluate', () => ({ default: vi.fn() }));

vi.mock('../candidates/repository', () => ({
  claimEvaluationByCandidateId: vi.fn(),
  findCandidateById: vi.fn(),
  findEvaluationByCandidateId: vi.fn(),
  releaseEvaluationClaim: vi.fn(),
}));

vi.mock('./budget-repository', () => ({
  assessBackgroundBudget: vi.fn(),
}));

const { governedFetchMock } = vi.hoisted(() => ({
  governedFetchMock: vi.fn(),
}));

vi.mock('./governed-fetch', () => ({
  default: vi.fn(() => governedFetchMock),
}));

vi.mock('./outbox-repository', () => ({
  insertOutboxIntents: vi.fn(),
}));

// eslint-disable-next-line import/first
import { randomUUID } from 'crypto';
// eslint-disable-next-line import/first
import evaluateCandidate from '../candidates/evaluate';
// eslint-disable-next-line import/first
import {
  claimEvaluationByCandidateId,
  findCandidateById,
  findEvaluationByCandidateId,
  releaseEvaluationClaim,
} from '../candidates/repository';
// eslint-disable-next-line import/first
import { assessBackgroundBudget } from './budget-repository';
// eslint-disable-next-line import/first
import { insertOutboxIntents } from './outbox-repository';
// eslint-disable-next-line import/first
import handleEvaluateCandidate from './handle-evaluate';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CANDIDATE_ID = randomUUID();

const MESSAGE = {
  v: 1 as const,
  operation: 'EVALUATE_CANDIDATE' as const,
  idempotencyKey: `evaluate:${CANDIDATE_ID}:policy-v1:fp`,
  candidateId: CANDIDATE_ID,
  policyVersion: 'policy-v1',
  admissionReason: 'NEW_PRODUCT' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  asMock(findCandidateById).mockResolvedValue({
    id: CANDIDATE_ID,
    supplierConnectionId: 'connection-1',
  });
  asMock(assessBackgroundBudget).mockResolvedValue({ allowed: true });
  asMock(findEvaluationByCandidateId).mockResolvedValue({
    status: 'PASS',
    nextRetryAt: null,
    attemptCount: 0,
  });
});

describe('handleEvaluateCandidate', () => {
  it('evaluates a claimed row exactly once, through the governed (shared-limiter + pointsInfo) fetch', async () => {
    asMock(claimEvaluationByCandidateId).mockResolvedValue({
      candidateId: CANDIDATE_ID,
      status: 'EVALUATING',
    });

    await handleEvaluateCandidate(MESSAGE);

    expect(evaluateCandidate).toHaveBeenCalledTimes(1);
    expect(evaluateCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ candidateId: CANDIDATE_ID }),
      { fetchImpl: governedFetchMock },
    );
  });

  it('acknowledges a duplicate/out-of-order delivery as a no-op when nothing is claimable - never a duplicate logical decision', async () => {
    asMock(claimEvaluationByCandidateId).mockResolvedValue(null);

    await handleEvaluateCandidate(MESSAGE);

    expect(evaluateCandidate).not.toHaveBeenCalled();
    expect(insertOutboxIntents).not.toHaveBeenCalled();
  });

  it('parks the claim without burning an attempt when the points budget refuses, and persists a delayed continuation', async () => {
    asMock(claimEvaluationByCandidateId).mockResolvedValue({
      candidateId: CANDIDATE_ID,
      status: 'EVALUATING',
    });
    asMock(assessBackgroundBudget).mockResolvedValue({
      allowed: false,
      reason: 'POINTS_RESERVE',
      retryAt: new Date(Date.now() + 3_600_000),
    });

    await handleEvaluateCandidate(MESSAGE);

    expect(evaluateCandidate).not.toHaveBeenCalled();
    expect(releaseEvaluationClaim).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        candidateId: CANDIDATE_ID,
        lastErrorCode: 'POINTS_BUDGET_UNAVAILABLE',
      }),
    );
    expect(insertOutboxIntents).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.objectContaining({
            operation: 'EVALUATE_CANDIDATE',
            admissionReason: 'RETRY_DUE',
          }),
        }),
      ]),
    );
  });

  it('schedules the delayed retry successor when the evaluator recorded a retryable failure', async () => {
    asMock(claimEvaluationByCandidateId).mockResolvedValue({
      candidateId: CANDIDATE_ID,
      status: 'EVALUATING',
    });
    asMock(findEvaluationByCandidateId).mockResolvedValue({
      status: 'EVALUATION_FAILED',
      nextRetryAt: new Date(Date.now() + 60_000),
      attemptCount: 2,
    });

    await handleEvaluateCandidate(MESSAGE);

    expect(insertOutboxIntents).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.objectContaining({ admissionReason: 'RETRY_DUE' }),
          delaySeconds: expect.any(Number),
        }),
      ]),
    );
  });

  it('schedules no successor after a clean decision - freshness sweeps own the next touch', async () => {
    asMock(claimEvaluationByCandidateId).mockResolvedValue({
      candidateId: CANDIDATE_ID,
      status: 'EVALUATING',
    });

    await handleEvaluateCandidate(MESSAGE);

    expect(insertOutboxIntents).not.toHaveBeenCalled();
  });
});
