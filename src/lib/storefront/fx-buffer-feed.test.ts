import { describe, expect, it } from 'vitest';
import {
  storefrontFxBufferSchema,
  toStorefrontFxBuffer,
} from './fx-buffer-feed';

describe('the FX buffer wire contract', () => {
  it('projects a resolved buffer', () => {
    const payload = toStorefrontFxBuffer({
      outcome: 'RESOLVED',
      buffer: { bufferPercent: 1.5, policyVersion: 2, policyId: 'p1' },
    });

    expect(payload).toEqual({
      buffer: { bufferPercent: 1.5, policyVersion: 2, policyId: 'p1' },
    });
    expect(storefrontFxBufferSchema.safeParse(payload).success).toBe(true);
  });

  it.each([
    ['no active policy', { outcome: 'NONE' } as const],
    [
      'two sellers disagreeing',
      { outcome: 'AMBIGUOUS', sellerAccountCount: 2 } as const,
    ],
  ])('collapses %s to a null buffer', (_label, result) => {
    // Indistinguishable on the wire on purpose: a buyer cannot tell them
    // apart, and a consumer handed two cases would eventually treat one of
    // them as close enough to show something.
    expect(toStorefrontFxBuffer(result)).toEqual({ buffer: null });
  });

  it('always emits the key, so "no buffer" and "old portal" stay distinct', () => {
    // If the absent case omitted `buffer`, a response from a portal that has
    // never heard of buffers would be byte-identical to one saying there is
    // none. The first means show nothing; the second means the deploy order
    // went wrong, and only one of them is fine.
    const payload = toStorefrontFxBuffer({ outcome: 'NONE' });

    expect(Object.hasOwn(payload, 'buffer')).toBe(true);
    expect(storefrontFxBufferSchema.safeParse(payload).success).toBe(true);
    expect(storefrontFxBufferSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a buffer missing any half of its identity', () => {
    // The consumer mirrors this schema by hand. A partial object must fail
    // here rather than reach it, because over there it fails the whole page.
    expect(
      storefrontFxBufferSchema.safeParse({ buffer: { bufferPercent: 1.5 } })
        .success,
    ).toBe(false);
  });
});
