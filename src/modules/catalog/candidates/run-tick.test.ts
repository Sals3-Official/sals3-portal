import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({ db: true }),
  isDatabaseConfigured: () => true,
}));

vi.mock('../discovery/outbox-dispatch', () => ({
  default: vi.fn(),
}));

vi.mock('../discovery/governed-fetch', () => ({
  default: vi.fn(),
}));

vi.mock('./evaluate', () => ({ default: vi.fn() }));

vi.mock('./lease', () => ({ default: vi.fn() }));

vi.mock('./repository', () => ({
  findCandidateById: vi.fn(),
  requeueDueRetries: vi.fn(),
}));

// eslint-disable-next-line import/first
import createGovernedFetch from '../discovery/governed-fetch';
// eslint-disable-next-line import/first
import dispatchOutbox from '../discovery/outbox-dispatch';
// eslint-disable-next-line import/first
import evaluateCandidate from './evaluate';
// eslint-disable-next-line import/first
import claimBatch from './lease';
// eslint-disable-next-line import/first
import { findCandidateById, requeueDueRetries } from './repository';
// eslint-disable-next-line import/first
import runEvaluationTick from './run-tick';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const GOVERNED_FETCH = vi.fn();

describe('runEvaluationTick', () => {
  beforeEach(() => {
    asMock(dispatchOutbox)
      .mockReset()
      .mockResolvedValue({ dispatched: 0, failed: 0 });
    asMock(requeueDueRetries).mockReset().mockResolvedValue(0);
    asMock(claimBatch).mockReset().mockResolvedValue([]);
    asMock(evaluateCandidate).mockReset().mockResolvedValue(undefined);
    asMock(createGovernedFetch).mockReset().mockReturnValue(GOVERNED_FETCH);
    asMock(findCandidateById).mockReset().mockResolvedValue({
      id: 'candidate-1',
      supplierConnectionId: 'connection-1',
    });
  });

  it('routes every break-glass evaluation through the governed fetch for its own connection', async () => {
    // Without this the tick would spend CJ points outside the shared
    // one-request-per-second limiter AND never persist the `pointsInfo` the
    // responses carry, leaving the budget every concurrent queue worker
    // consults stale.
    asMock(claimBatch).mockResolvedValue([{ candidateId: 'candidate-1' }]);

    const result = await runEvaluationTick();

    expect(createGovernedFetch).toHaveBeenCalledWith('connection-1');
    expect(evaluateCandidate).toHaveBeenCalledWith(
      { candidateId: 'candidate-1' },
      { fetchImpl: GOVERNED_FETCH },
    );
    expect(result.evaluated).toBe(1);
  });

  it('still evaluates when the candidate row cannot be read, rather than skipping the claimed work', async () => {
    asMock(claimBatch).mockResolvedValue([{ candidateId: 'candidate-1' }]);
    asMock(findCandidateById).mockResolvedValue(null);

    await runEvaluationTick();

    expect(createGovernedFetch).not.toHaveBeenCalled();
    expect(evaluateCandidate).toHaveBeenCalledWith(
      { candidateId: 'candidate-1' },
      { fetchImpl: undefined },
    );
  });

  it('drains the outbox and requeues due retries before claiming a batch', async () => {
    asMock(dispatchOutbox).mockResolvedValue({ dispatched: 3, failed: 1 });
    asMock(requeueDueRetries).mockResolvedValue(7);

    const result = await runEvaluationTick();

    expect(result).toEqual({
      outbox: { dispatched: 3, failed: 1 },
      requeuedForRetry: 7,
      claimed: 0,
      evaluated: 0,
    });
  });
});
