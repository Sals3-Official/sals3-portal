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
vi.mock('./intake-gate-repository', () => ({ findBacklogGate: vi.fn() }));

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
import { findBacklogGate } from './intake-gate-repository';
// eslint-disable-next-line import/first
import handleReconcileProduct from './handle-reconcile';
// eslint-disable-next-line import/first
import { FRESHNESS_SWEEP_BATCH, FRESHNESS_SWEEP_DELAY_SECONDS } from './config';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const CONNECTION_ID = randomUUID();
/** The historical freeze line the backlog gate records. */
const FREEZE_LINE = new Date('2026-08-12T07:53:53.888Z');
const CANDIDATE_ID = randomUUID();

beforeEach(() => {
  vi.clearAllMocks();
  asMock(isDiscoveryRunning).mockResolvedValue(true);
  asMock(requeueDueRefreshes).mockResolvedValue([]);
  asMock(requeuePolicyVersionMismatches).mockResolvedValue([]);
  asMock(listStrandedEvaluations).mockResolvedValue([]);
  asMock(findBacklogGate).mockResolvedValue({ activationAt: FREEZE_LINE });
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

describe('handleReconcileProduct - SWEEP historical freeze', () => {
  async function sweep(): Promise<void> {
    await handleReconcileProduct({
      v: 1,
      operation: 'RECONCILE_PRODUCT',
      idempotencyKey: 'freshness:x:freeze',
      mode: 'SWEEP',
      supplierConnectionId: CONNECTION_ID,
    });
  }

  it('bounds both automatic tiers by the gate freeze line, so historical rows are never re-opened', async () => {
    // The deadlock this prevents: every QUEUED row counts as active work, the
    // intake gate refuses a new product/list request while active work exists,
    // and an unbounded policy-version tier keeps returning historical rows to
    // QUEUED - so new discovery is blocked permanently, not temporarily.
    await sweep();

    expect(requeueDueRefreshes).toHaveBeenCalledWith(
      expect.anything(),
      CONNECTION_ID,
      expect.any(Number),
      FREEZE_LINE,
    );
    expect(requeuePolicyVersionMismatches).toHaveBeenCalledWith(
      expect.anything(),
      CONNECTION_ID,
      expect.objectContaining({ createdAfter: FREEZE_LINE }),
    );
  });

  it('passes no bound when there is no gate, so a connection with no history behaves as before', async () => {
    asMock(findBacklogGate).mockResolvedValue(null);

    await sweep();

    expect(requeueDueRefreshes).toHaveBeenCalledWith(
      expect.anything(),
      CONNECTION_ID,
      expect.any(Number),
      undefined,
    );
    expect(requeuePolicyVersionMismatches).toHaveBeenCalledWith(
      expect.anything(),
      CONNECTION_ID,
      expect.objectContaining({ createdAfter: undefined }),
    );
  });

  it('leaves the stranded tier unbounded, so a pre-line row stuck in QUEUED can still recover', async () => {
    await sweep();

    expect(listStrandedEvaluations).toHaveBeenCalledWith(
      expect.anything(),
      CONNECTION_ID,
      expect.not.objectContaining({ createdAfter: expect.anything() }),
    );
  });
});

describe('handleReconcileProduct - SWEEP continuation keys', () => {
  /** The self-chaining RECONCILE_PRODUCT successor this sweep emitted. */
  async function runSweep(incomingKey: string): Promise<{
    key: string;
    delaySeconds?: number;
  }> {
    asMock(insertOutboxIntents).mockClear();

    await handleReconcileProduct({
      v: 1,
      operation: 'RECONCILE_PRODUCT',
      idempotencyKey: incomingKey,
      mode: 'SWEEP',
      supplierConnectionId: CONNECTION_ID,
    });

    const intents = asMock(insertOutboxIntents).mock.calls[0]![1] as Array<{
      message: { operation: string; idempotencyKey: string };
      delaySeconds?: number;
    }>;
    const chained = intents.find(
      (i) => i.message.operation === 'RECONCILE_PRODUCT',
    )!;

    return {
      key: chained.message.idempotencyKey,
      delaySeconds: chained.delaySeconds,
    };
  }

  it('gives every accelerated continuation a distinct key, so a full-batch backlog is not silently capped at one extra sweep', async () => {
    vi.useFakeTimers();

    try {
      // Mid-bucket on purpose: the first continuation and the one 60s later
      // both land inside the SAME FRESHNESS_SWEEP_DELAY_SECONDS bucket, which
      // is exactly the case the old `sweepBucket + 1` key could not express.
      vi.setSystemTime(new Date('2026-08-12T09:30:00.000Z'));

      asMock(requeuePolicyVersionMismatches).mockResolvedValue(
        Array.from({ length: FRESHNESS_SWEEP_BATCH }, () => randomUUID()),
      );

      const first = await runSweep('freshness:seeded-by-cycle-start');

      expect(first.delaySeconds).toBe(60);
      expect(first.key).not.toBe('freshness:seeded-by-cycle-start');

      // The accelerated successor is delivered 60s later, same bucket.
      vi.advanceTimersByTime(60_000);
      const second = await runSweep(first.key);

      expect(second.delaySeconds).toBe(60);
      // `work_outbox.idempotency_key` is unique and never pruned, so reusing
      // the incoming delivery's key means `onConflictDoNothing` drops the
      // successor and the accelerated chain dies after one extra batch.
      expect(second.key).not.toBe(first.key);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an unaccelerated continuation on the plain bucket key, so it still de-duplicates against the hourly cycle-start seed', async () => {
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date('2026-08-12T09:30:00.000Z'));

      // Every tier came back short - no acceleration.
      const chained = await runSweep('freshness:seeded-by-cycle-start');

      expect(chained.delaySeconds).toBe(FRESHNESS_SWEEP_DELAY_SECONDS);
      expect(chained.key).toBe(
        `freshness:${CONNECTION_ID}:${Math.floor(
          (Date.now() + FRESHNESS_SWEEP_DELAY_SECONDS * 1000) /
            (FRESHNESS_SWEEP_DELAY_SECONDS * 1000),
        )}`,
      );
    } finally {
      vi.useRealTimers();
    }
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
