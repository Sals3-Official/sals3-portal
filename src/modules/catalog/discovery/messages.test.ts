import { randomUUID } from 'crypto';
import { describe, expect, it } from 'vitest';
import { queueMessageSchema } from './messages';

const CONNECTION_ID = randomUUID();
const CYCLE_ID = randomUUID();
const PARTITION_ID = randomUUID();

describe('queueMessageSchema', () => {
  it('accepts every well-formed operation', () => {
    const messages = [
      {
        v: 1,
        operation: 'DISCOVERY_CYCLE_START',
        idempotencyKey: 'k1',
        supplierConnectionId: CONNECTION_ID,
      },
      {
        v: 1,
        operation: 'DISCOVERY_PARTITION',
        idempotencyKey: 'k2',
        supplierConnectionId: CONNECTION_ID,
        cycleId: CYCLE_ID,
        partitionId: PARTITION_ID,
      },
      {
        v: 1,
        operation: 'EVALUATE_CANDIDATE',
        idempotencyKey: 'k3',
        candidateId: PARTITION_ID,
        policyVersion: 'policy-v1',
        admissionReason: 'NEW_PRODUCT',
      },
      {
        v: 1,
        operation: 'RECONCILE_PRODUCT',
        idempotencyKey: 'k4',
        mode: 'SWEEP',
        supplierConnectionId: CONNECTION_ID,
      },
      {
        v: 1,
        operation: 'WEBHOOK_EVENT',
        idempotencyKey: 'k5',
        inboxId: CYCLE_ID,
        supplierConnectionId: CONNECTION_ID,
      },
      { v: 1, operation: 'OUTBOX_DISPATCH', idempotencyKey: 'k6' },
    ];

    messages.forEach((message) => {
      expect(queueMessageSchema.safeParse(message).success).toBe(true);
    });
  });

  it('rejects an unknown operation, a missing idempotency key, and a non-uuid id', () => {
    expect(
      queueMessageSchema.safeParse({
        v: 1,
        operation: 'DROP_TABLES',
        idempotencyKey: 'k',
      }).success,
    ).toBe(false);
    expect(
      queueMessageSchema.safeParse({
        v: 1,
        operation: 'OUTBOX_DISPATCH',
      }).success,
    ).toBe(false);
    expect(
      queueMessageSchema.safeParse({
        v: 1,
        operation: 'DISCOVERY_PARTITION',
        idempotencyKey: 'k',
        supplierConnectionId: 'not-a-uuid',
        cycleId: CYCLE_ID,
        partitionId: PARTITION_ID,
      }).success,
    ).toBe(false);
  });

  it('rejects an invalid admission reason - the six approved reasons are closed vocabulary', () => {
    expect(
      queueMessageSchema.safeParse({
        v: 1,
        operation: 'EVALUATE_CANDIDATE',
        idempotencyKey: 'k',
        candidateId: PARTITION_ID,
        policyVersion: 'p',
        admissionReason: 'BECAUSE_I_FELT_LIKE_IT',
      }).success,
    ).toBe(false);
  });
});
