import { describe, expect, it } from 'vitest';
import { queueMessageSchema } from './messages';

describe('FULFILL_ORDER queue message contract', () => {
  it('accepts only the order id and idempotency key, never supplier payloads', () => {
    const parsed = queueMessageSchema.parse({
      v: 1,
      operation: 'FULFILL_ORDER',
      idempotencyKey: 'fulfill-order:22222222-2222-4222-8222-222222222222',
      orderId: '22222222-2222-4222-8222-222222222222',
    });

    expect(parsed).toEqual({
      v: 1,
      operation: 'FULFILL_ORDER',
      idempotencyKey: 'fulfill-order:22222222-2222-4222-8222-222222222222',
      orderId: '22222222-2222-4222-8222-222222222222',
    });
  });

  it('rejects missing order ids', () => {
    expect(() =>
      queueMessageSchema.parse({
        v: 1,
        operation: 'FULFILL_ORDER',
        idempotencyKey: 'fulfill-order:missing',
      }),
    ).toThrow();
  });
});
