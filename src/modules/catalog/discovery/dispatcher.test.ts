import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({}),
  isDatabaseConfigured: () => true,
}));

vi.mock('./handle-cycle-start', () => ({ default: vi.fn() }));
vi.mock('./handle-partition', () => ({ default: vi.fn() }));
vi.mock('./handle-evaluate', () => ({ default: vi.fn() }));
vi.mock('./handle-reconcile', () => ({ default: vi.fn() }));
vi.mock('./handle-webhook-event', () => ({ default: vi.fn() }));
vi.mock('./outbox-dispatch', () => ({ default: vi.fn() }));
vi.mock('./failure-repository', () => ({ recordDiscoveryFailure: vi.fn() }));

// eslint-disable-next-line import/first
import { randomUUID } from 'crypto';
// eslint-disable-next-line import/first
import handleCycleStart from './handle-cycle-start';
// eslint-disable-next-line import/first
import handlePartition from './handle-partition';
// eslint-disable-next-line import/first
import handleEvaluateCandidate from './handle-evaluate';
// eslint-disable-next-line import/first
import dispatchOutbox from './outbox-dispatch';
// eslint-disable-next-line import/first
import { recordDiscoveryFailure } from './failure-repository';
// eslint-disable-next-line import/first
import { MAX_QUEUE_DELIVERIES } from './config';
// eslint-disable-next-line import/first
import handleQueueMessage from './dispatcher';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const META = { messageId: 'm-1', deliveryCount: 1 };
const CONNECTION_ID = randomUUID();

beforeEach(() => {
  vi.clearAllMocks();
  asMock(dispatchOutbox).mockResolvedValue({ dispatched: 0, failed: 0 });
});

describe('handleQueueMessage', () => {
  it('routes a valid message to its handler and drains the outbox before acknowledging', async () => {
    await handleQueueMessage(
      {
        v: 1,
        operation: 'DISCOVERY_CYCLE_START',
        idempotencyKey: 'k',
        supplierConnectionId: CONNECTION_ID,
      },
      META,
    );

    expect(handleCycleStart).toHaveBeenCalledTimes(1);
    expect(dispatchOutbox).toHaveBeenCalledTimes(1);
  });

  it('parks an unparseable message as a visible failure and acknowledges - poison messages never crash-loop', async () => {
    await handleQueueMessage({ operation: 'GARBAGE' }, META);

    expect(recordDiscoveryFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'QUEUE_MESSAGE_INVALID' }),
    );
    expect(handleCycleStart).not.toHaveBeenCalled();
    expect(handlePartition).not.toHaveBeenCalled();
  });

  it('parks a message past the delivery cap as the PG dead-letter record the transport does not provide', async () => {
    await handleQueueMessage(
      {
        v: 1,
        operation: 'EVALUATE_CANDIDATE',
        idempotencyKey: 'k',
        candidateId: CONNECTION_ID,
        policyVersion: 'p',
        admissionReason: 'NEW_PRODUCT',
      },
      { messageId: 'm-2', deliveryCount: MAX_QUEUE_DELIVERIES + 1 },
    );

    expect(recordDiscoveryFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'QUEUE_DELIVERIES_EXHAUSTED' }),
    );
    expect(handleEvaluateCandidate).not.toHaveBeenCalled();
  });

  it('throws (leaving the delivery unacknowledged for redelivery) when successors could not be published', async () => {
    asMock(dispatchOutbox).mockResolvedValue({ dispatched: 1, failed: 2 });

    await expect(
      handleQueueMessage(
        { v: 1, operation: 'OUTBOX_DISPATCH', idempotencyKey: 'k' },
        META,
      ),
    ).rejects.toThrow('undispatched successors');
  });

  it('handles OUTBOX_DISPATCH as a pure drain', async () => {
    await handleQueueMessage(
      { v: 1, operation: 'OUTBOX_DISPATCH', idempotencyKey: 'k' },
      META,
    );

    expect(dispatchOutbox).toHaveBeenCalledTimes(1);
  });
});
