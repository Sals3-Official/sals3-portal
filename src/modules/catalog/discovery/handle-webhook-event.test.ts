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
  appendAuditEvent: vi.fn(),
  findCandidateByConnectionAndExternalId: vi.fn(),
  requeueForSourceChange: vi.fn(),
}));

vi.mock('./webhook-inbox-repository', () => ({
  findInboxEventById: vi.fn(),
  markInboxFailed: vi.fn(),
  markInboxProcessed: vi.fn(),
}));

vi.mock('./outbox-repository', () => ({ insertOutboxIntents: vi.fn() }));
vi.mock('./failure-repository', () => ({ recordDiscoveryFailure: vi.fn() }));

// eslint-disable-next-line import/first
import { randomUUID } from 'crypto';
// eslint-disable-next-line import/first
import {
  findCandidateByConnectionAndExternalId,
  requeueForSourceChange,
} from '../candidates/repository';
// eslint-disable-next-line import/first
import {
  findInboxEventById,
  markInboxProcessed,
} from './webhook-inbox-repository';
// eslint-disable-next-line import/first
import { insertOutboxIntents } from './outbox-repository';
// eslint-disable-next-line import/first
import { recordDiscoveryFailure } from './failure-repository';
// eslint-disable-next-line import/first
import handleWebhookEvent from './handle-webhook-event';

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const INBOX_ID = randomUUID();
const CONNECTION_ID = randomUUID();

const MESSAGE = {
  v: 1 as const,
  operation: 'WEBHOOK_EVENT' as const,
  idempotencyKey: `webhook:${CONNECTION_ID}:m-1`,
  inboxId: INBOX_ID,
  supplierConnectionId: CONNECTION_ID,
};

function inboxEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: INBOX_ID,
    supplier: 'CJ_DROPSHIPPING',
    supplierConnectionId: CONNECTION_ID,
    messageId: 'm-1',
    eventType: 'PRODUCT',
    operation: 'UPDATE',
    payload: { pid: 'pid-1' },
    state: 'PENDING',
    attempts: 0,
    lastErrorCode: null,
    receivedAt: new Date(),
    processedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(requeueForSourceChange).mockResolvedValue(true);
});

describe('handleWebhookEvent', () => {
  it.each([
    ['PRODUCT', 'INSERT'],
    ['PRODUCT', 'UPDATE'],
    ['PRODUCT', 'DELETE'],
    ['VARIANT', 'INSERT'],
    ['VARIANT', 'UPDATE'],
    ['VARIANT', 'DELETE'],
    ['STOCK', 'UPDATE'],
  ])(
    'requeues the affected candidate for a %s %s event and completes the inbox row',
    async (eventType, operation) => {
      asMock(findInboxEventById).mockResolvedValue(
        inboxEvent({ eventType, operation }),
      );
      asMock(findCandidateByConnectionAndExternalId).mockResolvedValue({
        id: 'candidate-1',
      });

      await handleWebhookEvent(MESSAGE);

      expect(requeueForSourceChange).toHaveBeenCalledWith(
        expect.anything(),
        'candidate-1',
      );
      expect(insertOutboxIntents).toHaveBeenCalledWith(
        expect.anything(),
        expect.arrayContaining([
          expect.objectContaining({
            message: expect.objectContaining({
              operation: 'EVALUATE_CANDIDATE',
              admissionReason: 'MATERIAL_SOURCE_CHANGE',
            }),
          }),
        ]),
      );
      expect(markInboxProcessed).toHaveBeenCalled();
    },
  );

  it('is idempotent: an already-processed inbox row is acknowledged untouched', async () => {
    asMock(findInboxEventById).mockResolvedValue(
      inboxEvent({ state: 'PROCESSED' }),
    );

    await handleWebhookEvent(MESSAGE);

    expect(requeueForSourceChange).not.toHaveBeenCalled();
    expect(markInboxProcessed).not.toHaveBeenCalled();
  });

  it('completes an event for a never-discovered product without inventing a candidate', async () => {
    asMock(findInboxEventById).mockResolvedValue(inboxEvent());
    asMock(findCandidateByConnectionAndExternalId).mockResolvedValue(null);

    await handleWebhookEvent(MESSAGE);

    expect(requeueForSourceChange).not.toHaveBeenCalled();
    expect(markInboxProcessed).toHaveBeenCalledWith(
      expect.anything(),
      INBOX_ID,
    );
  });

  it('records the unmapped-STOCK gap visibly instead of guessing an identity', async () => {
    asMock(findInboxEventById).mockResolvedValue(
      inboxEvent({ eventType: 'STOCK', payload: { vid: 'v-1' } }),
    );

    await handleWebhookEvent(MESSAGE);

    expect(recordDiscoveryFailure).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ errorCode: 'WEBHOOK_EVENT_UNMAPPED' }),
    );
    expect(markInboxProcessed).toHaveBeenCalled();
  });
});
