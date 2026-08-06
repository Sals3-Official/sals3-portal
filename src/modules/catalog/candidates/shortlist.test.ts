import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `getDb()` is lazy, so the mock is a function returning a client whose
// transaction just hands the caller a sentinel executor.
vi.mock('@/lib/db/client', () => ({
  default: () => ({
    transaction: (run: (tx: unknown) => Promise<unknown>) => run({ tx: true }),
  }),
  isDatabaseConfigured: () => true,
}));

vi.mock('./repository', () => ({
  insertCandidateIfAbsent: vi.fn(),
  findCandidateByExternalId: vi.fn(),
  appendAuditEvent: vi.fn(),
  findIdempotencyRecord: vi.fn(),
  insertIdempotencyRecordIfAbsent: vi.fn(),
}));

// eslint-disable-next-line import/first
import {
  appendAuditEvent,
  findCandidateByExternalId,
  findIdempotencyRecord,
  insertCandidateIfAbsent,
  insertIdempotencyRecordIfAbsent,
} from './repository';
// eslint-disable-next-line import/first
import shortlistCandidate from './shortlist';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const COMMAND = {
  supplier: 'CJ_DROPSHIPPING' as const,
  externalProductId: 'CJLY1',
  intendedSellerId: 'seller-001',
  intendedMarketCodes: ['PH'],
  actorId: 'dev-user',
};

const KEY = 'idem-key-0123456789';

/** Mirrors `hashCommand` in the module under test. */
function expectedHash(): string {
  const canonical = JSON.stringify([
    COMMAND.supplier,
    COMMAND.externalProductId,
    COMMAND.intendedSellerId,
    [...COMMAND.intendedMarketCodes].sort(),
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

describe('shortlistCandidate', () => {
  beforeEach(() => {
    asMock(findIdempotencyRecord).mockReset().mockResolvedValue(null);
    asMock(insertCandidateIfAbsent).mockReset();
    asMock(findCandidateByExternalId).mockReset();
    asMock(appendAuditEvent).mockReset().mockResolvedValue(undefined);
    asMock(insertIdempotencyRecordIfAbsent).mockReset().mockResolvedValue(true);
  });

  it('creates a new candidate and writes one audit event', async () => {
    asMock(insertCandidateIfAbsent).mockResolvedValue({
      id: '11111111-1111-4111-8111-111111111111',
      shortlistState: 'SHORTLISTED',
    });

    const outcome = await shortlistCandidate(COMMAND, KEY);

    expect(outcome).toEqual({
      status: 'ok',
      replayed: false,
      result: {
        candidateId: '11111111-1111-4111-8111-111111111111',
        shortlistState: 'SHORTLISTED',
        reused: false,
      },
    });
    expect(asMock(appendAuditEvent)).toHaveBeenCalledTimes(1);
    expect(asMock(appendAuditEvent).mock.calls[0][1]).toMatchObject({
      action: 'CANDIDATE_SHORTLISTED',
      entityType: 'supplier_candidate',
      actorId: 'dev-user',
    });
  });

  it('reuses the existing candidate on an exact supplier-product match, without a duplicate or a second audit event', async () => {
    asMock(insertCandidateIfAbsent).mockResolvedValue(null);
    asMock(findCandidateByExternalId).mockResolvedValue({
      id: '22222222-2222-4222-8222-222222222222',
      shortlistState: 'SHORTLISTED',
    });

    const outcome = await shortlistCandidate(COMMAND, KEY);

    expect(outcome).toMatchObject({
      status: 'ok',
      result: {
        candidateId: '22222222-2222-4222-8222-222222222222',
        reused: true,
      },
    });
    expect(asMock(appendAuditEvent)).not.toHaveBeenCalled();
  });

  it('replays the stored result for the same key and same payload, without touching the candidate tables', async () => {
    const stored = {
      candidateId: '33333333-3333-4333-8333-333333333333',
      shortlistState: 'SHORTLISTED',
      reused: false,
    };
    asMock(findIdempotencyRecord).mockResolvedValue({
      requestHash: expectedHash(),
      resultReference: stored,
    });

    const outcome = await shortlistCandidate(COMMAND, KEY);

    expect(outcome).toEqual({ status: 'ok', replayed: true, result: stored });
    expect(asMock(insertCandidateIfAbsent)).not.toHaveBeenCalled();
    expect(asMock(appendAuditEvent)).not.toHaveBeenCalled();
  });

  it('reports a conflict when the same key arrives with a different payload, and writes nothing', async () => {
    asMock(findIdempotencyRecord).mockResolvedValue({
      requestHash: createHash('sha256').update('something-else').digest('hex'),
      resultReference: {},
    });

    const outcome = await shortlistCandidate(COMMAND, KEY);

    expect(outcome).toEqual({ status: 'idempotency_conflict' });
    expect(asMock(insertCandidateIfAbsent)).not.toHaveBeenCalled();
    expect(asMock(insertIdempotencyRecordIfAbsent)).not.toHaveBeenCalled();
  });

  it('rejects an invalid command at the write boundary even if a caller skipped validation', async () => {
    await expect(
      shortlistCandidate({ ...COMMAND, intendedMarketCodes: [] }, KEY),
    ).rejects.toThrow();
    expect(asMock(insertCandidateIfAbsent)).not.toHaveBeenCalled();
  });

  it('does not depend on market-code ordering when comparing an idempotent replay', async () => {
    asMock(findIdempotencyRecord).mockResolvedValue({
      requestHash: expectedHash(),
      resultReference: {
        candidateId: 'x',
        shortlistState: 'SHORTLISTED',
        reused: false,
      },
    });

    const outcome = await shortlistCandidate(
      { ...COMMAND, intendedMarketCodes: ['PH'] },
      KEY,
    );

    expect(outcome).toMatchObject({ status: 'ok', replayed: true });
  });
});
