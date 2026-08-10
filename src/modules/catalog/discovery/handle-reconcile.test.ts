import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({
    transaction: (run: (tx: unknown) => Promise<unknown>) => run({ tx: true }),
  }),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/lib/country-policy/buyer-destination-country', () => ({
  default: () => ({
    countryCodes: ['AU'],
    policyVersion: 'buyer-destination-v2',
    source: 'test',
    effective: 'ENABLED',
  }),
}));

vi.mock('../candidates/repository', () => ({
  listStrandedEvaluations: vi.fn(),
  requeueDueRefreshes: vi.fn(),
  requeueForSourceChange: vi.fn(),
  requeuePolicyVersionMismatches: vi.fn(),
}));

vi.mock('./outbox-repository', () => ({ insertOutboxIntents: vi.fn() }));
vi.mock('./run-state-repository', () => ({ isDiscoveryRunning: vi.fn() }));

// eslint-disable-next-line import/first
import { randomUUID } from 'crypto';
// eslint-disable-next-line import/first
import {
  listStrandedEvaluations,
  requeueDueRefreshes,
  requeueForSourceChange,
  requeuePolicyVersionMismatches,
} from '../candidates/repository';
// eslint-disable-next-line import/first
import { insertOutboxIntents } from './outbox-repository';
// eslint-disable-next-line import/first
import { isDiscoveryRunning } from './run-state-repository';
// eslint-disable-next-line import/first
import handleReconcileProduct from './handle-reconcile';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CONNECTION_ID = randomUUID();
const CANDIDATE_ID = randomUUID();

beforeEach(() => {
  vi.clearAllMocks();
  asMock(isDiscoveryRunning).mockResolvedValue(true);
  asMock(requeueDueRefreshes).mockResolvedValue([]);
  asMock(requeuePolicyVersionMismatches).mockResolvedValue([]);
  asMock(listStrandedEvaluations).mockResolvedValue([]);
});

describe('handleReconcileProduct - SWEEP (freshness tiers)', () => {
  it('requeues due-refresh rows with EVIDENCE_EXPIRED evaluation intents and re-chains itself with a delay', async () => {
    asMock(requeueDueRefreshes).mockResolvedValue([CANDIDATE_ID]);

    await handleReconcileProduct({
      v: 1,
      operation: 'RECONCILE_PRODUCT',
      idempotencyKey: 'freshness:x:1',
      mode: 'SWEEP',
      supplierConnectionId: CONNECTION_ID,
    });

    const intents = asMock(insertOutboxIntents).mock.calls[0]![1] as Array<{
      message: { operation: string; admissionReason?: string };
      delaySeconds?: number;
    }>;

    expect(
      intents.some(
        (i) =>
          i.message.operation === 'EVALUATE_CANDIDATE' &&
          i.message.admissionReason === 'EVIDENCE_EXPIRED',
      ),
    ).toBe(true);
    // The self-chaining continuation - queue delay, never a cron tick.
    expect(
      intents.some(
        (i) =>
          i.message.operation === 'RECONCILE_PRODUCT' &&
          (i.delaySeconds ?? 0) > 0,
      ),
    ).toBe(true);
  });

  it('does no freshness work while paused', async () => {
    asMock(isDiscoveryRunning).mockResolvedValue(false);

    await handleReconcileProduct({
      v: 1,
      operation: 'RECONCILE_PRODUCT',
      idempotencyKey: 'freshness:x:2',
      mode: 'SWEEP',
      supplierConnectionId: CONNECTION_ID,
    });

    expect(requeueDueRefreshes).not.toHaveBeenCalled();
    expect(requeuePolicyVersionMismatches).not.toHaveBeenCalled();
  });

  it('requeues policy-version mismatches with POLICY_VERSION_CHANGED - a policy change re-evaluates unchanged rows, BLOCKED included', async () => {
    const staleCandidate = randomUUID();

    asMock(requeuePolicyVersionMismatches).mockResolvedValue([staleCandidate]);

    await handleReconcileProduct({
      v: 1,
      operation: 'RECONCILE_PRODUCT',
      idempotencyKey: 'freshness:x:5',
      mode: 'SWEEP',
      supplierConnectionId: CONNECTION_ID,
    });

    expect(requeuePolicyVersionMismatches).toHaveBeenCalledWith(
      expect.anything(),
      CONNECTION_ID,
      expect.objectContaining({ currentPolicyVersion: expect.any(String) }),
    );

    const intents = asMock(insertOutboxIntents).mock.calls[0]![1] as Array<{
      message: {
        operation: string;
        admissionReason?: string;
        candidateId?: string;
      };
    }>;

    expect(
      intents.some(
        (i) =>
          i.message.operation === 'EVALUATE_CANDIDATE' &&
          i.message.admissionReason === 'POLICY_VERSION_CHANGED' &&
          i.message.candidateId === staleCandidate,
      ),
    ).toBe(true);
  });

  it('re-enqueues stranded QUEUED/expired-EVALUATING rows so a lost or delivery-cap-parked message never strands a product', async () => {
    const strandedCandidate = randomUUID();

    asMock(listStrandedEvaluations).mockResolvedValue([strandedCandidate]);

    await handleReconcileProduct({
      v: 1,
      operation: 'RECONCILE_PRODUCT',
      idempotencyKey: 'freshness:x:6',
      mode: 'SWEEP',
      supplierConnectionId: CONNECTION_ID,
    });

    const intents = asMock(insertOutboxIntents).mock.calls[0]![1] as Array<{
      message: {
        operation: string;
        admissionReason?: string;
        candidateId?: string;
      };
    }>;

    expect(
      intents.some(
        (i) =>
          i.message.operation === 'EVALUATE_CANDIDATE' &&
          i.message.admissionReason === 'RETRY_DUE' &&
          i.message.candidateId === strandedCandidate,
      ),
    ).toBe(true);
  });
});

describe('handleReconcileProduct - PRODUCT', () => {
  it('requeues one candidate for a source-change re-evaluation', async () => {
    asMock(requeueForSourceChange).mockResolvedValue(true);

    await handleReconcileProduct({
      v: 1,
      operation: 'RECONCILE_PRODUCT',
      idempotencyKey: 'reconcile:x:3',
      mode: 'PRODUCT',
      candidateId: CANDIDATE_ID,
    });

    expect(requeueForSourceChange).toHaveBeenCalledWith(
      expect.anything(),
      CANDIDATE_ID,
    );
    expect(insertOutboxIntents).toHaveBeenCalled();
  });

  it('enqueues nothing when the candidate was not requeueable (in-flight or already queued)', async () => {
    asMock(requeueForSourceChange).mockResolvedValue(false);

    await handleReconcileProduct({
      v: 1,
      operation: 'RECONCILE_PRODUCT',
      idempotencyKey: 'reconcile:x:4',
      mode: 'PRODUCT',
      candidateId: CANDIDATE_ID,
    });

    expect(insertOutboxIntents).not.toHaveBeenCalled();
  });
});
