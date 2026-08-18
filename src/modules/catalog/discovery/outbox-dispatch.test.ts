import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({}),
  isDatabaseConfigured: () => true,
}));

vi.mock('./outbox-repository', () => ({
  claimDispatchableOutbox: vi.fn(),
  markOutboxDispatched: vi.fn(),
  releaseOutboxAttempt: vi.fn(),
}));

vi.mock('./failure-repository', () => ({ recordDiscoveryFailure: vi.fn() }));

const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }));

vi.mock('./queue-transport', () => ({
  default: () => ({ publish: publishMock }),
}));

// eslint-disable-next-line import/first
import {
  claimDispatchableOutbox,
  markOutboxDispatched,
  releaseOutboxAttempt,
} from './outbox-repository';
// eslint-disable-next-line import/first
import { recordDiscoveryFailure } from './failure-repository';
// eslint-disable-next-line import/first
import dispatchOutbox from './outbox-dispatch';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'outbox-1',
    operation: 'OUTBOX_DISPATCH',
    payload: { v: 1, operation: 'OUTBOX_DISPATCH', idempotencyKey: 'k-1' },
    idempotencyKey: 'k-1',
    notBefore: null,
    state: 'PENDING',
    attempts: 1,
    lastErrorCode: null,
    leaseToken: 'lease-1',
    leasedUntil: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    dispatchedAt: null,
    updatedAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  publishMock.mockResolvedValue(undefined);
});

describe('dispatchOutbox', () => {
  it('publishes each claimed row with its idempotency key and confirms it (CAS)', async () => {
    asMock(claimDispatchableOutbox).mockResolvedValue([outboxRow()]);

    const result = await dispatchOutbox();

    expect(result).toEqual({ dispatched: 1, failed: 0 });
    expect(publishMock).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'OUTBOX_DISPATCH' }),
      expect.objectContaining({ idempotencyKey: 'k-1' }),
    );
    expect(markOutboxDispatched).toHaveBeenCalledWith(expect.anything(), {
      id: 'outbox-1',
      leaseToken: expect.any(String),
    });
  });

  it('releases a failed publish for backoff retry instead of confirming - crash-safe either side of the publish', async () => {
    asMock(claimDispatchableOutbox).mockResolvedValue([outboxRow()]);
    publishMock.mockRejectedValue(new Error('transport down'));

    const result = await dispatchOutbox();

    expect(result).toEqual({ dispatched: 0, failed: 1 });
    expect(markOutboxDispatched).not.toHaveBeenCalled();
    expect(releaseOutboxAttempt).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'QUEUE_PUBLISH_FAILED' }),
    );
  });

  it('parks a row whose stored payload no longer parses as a permanent visible failure', async () => {
    asMock(claimDispatchableOutbox).mockResolvedValue([
      outboxRow({ payload: { junk: true } }),
    ]);

    const result = await dispatchOutbox();

    expect(result).toEqual({ dispatched: 0, failed: 1 });
    expect(publishMock).not.toHaveBeenCalled();
    expect(recordDiscoveryFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'OUTBOX_PAYLOAD_INVALID' }),
    );
  });

  it('derives the queue delay from the persisted notBefore', async () => {
    asMock(claimDispatchableOutbox).mockResolvedValue([
      outboxRow({ notBefore: new Date(Date.now() + 600_000) }),
    ]);

    await dispatchOutbox();

    const options = publishMock.mock.calls[0]![1] as { delaySeconds: number };
    expect(options.delaySeconds).toBeGreaterThan(550);
    expect(options.delaySeconds).toBeLessThanOrEqual(600);
  });

  it('passes targeted claim filters through for order-critical drains', async () => {
    asMock(claimDispatchableOutbox).mockResolvedValue([]);

    await dispatchOutbox({
      batchSize: 1,
      idempotencyKeys: ['fulfill-order:order-1'],
      operations: ['FULFILL_ORDER'],
    });

    expect(claimDispatchableOutbox).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        batchSize: 1,
        idempotencyKeys: ['fulfill-order:order-1'],
        operations: ['FULFILL_ORDER'],
      }),
    );
  });
});
