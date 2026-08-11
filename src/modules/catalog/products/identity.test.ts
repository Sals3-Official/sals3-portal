import { describe, expect, it } from 'vitest';

import {
  buildOptionCombinationKey,
  canonicalRequestHash,
  deriveSals3Sku,
  normalizeOptionToken,
} from './identity';

/**
 * These functions are what make the draft flow replayable. If any of them
 * stopped being a pure function of stable provider identity, a retry would
 * produce a *different* SKU or combination key, the unique indexes would stop
 * recognising the second attempt as a duplicate, and every duplicate click
 * would create a second variant.
 */

const BASE = {
  providerCode: 'CJ_DROPSHIPPING',
  externalProductId: 'PID-1',
  externalVariantId: 'VID-1',
};

describe('deriveSals3Sku', () => {
  it('is deterministic, so a retry resolves to the same variant', () => {
    expect(deriveSals3Sku(BASE)).toBe(deriveSals3Sku(BASE));
  });

  it('differs per variant and per product', () => {
    expect(deriveSals3Sku(BASE)).not.toBe(
      deriveSals3Sku({ ...BASE, externalVariantId: 'VID-2' }),
    );
    expect(deriveSals3Sku(BASE)).not.toBe(
      deriveSals3Sku({ ...BASE, externalProductId: 'PID-2' }),
    );
  });

  it('does not collide across a shifted field boundary', () => {
    // A naive `a + b` concatenation would make ("AB","C") and ("A","BC") the
    // same input. The separator is what prevents two distinct CJ variants
    // sharing one Sals3 SKU.
    expect(
      deriveSals3Sku({
        providerCode: 'CJ',
        externalProductId: 'AB',
        externalVariantId: 'C',
      }),
    ).not.toBe(
      deriveSals3Sku({
        providerCode: 'CJ',
        externalProductId: 'A',
        externalVariantId: 'BC',
      }),
    );
  });

  it('is not derived from a supplier SKU, title, or position', () => {
    // Spec §7: "Never replace with CJ SKU". Nothing but provider identity is
    // an input, so a CJ rename or reorder cannot move a Sals3 SKU.
    expect(deriveSals3Sku(BASE)).toMatch(/^S3V-[0-9A-F]{12}$/);
  });
});

describe('normalizeOptionToken', () => {
  it('folds case and collapses whitespace', () => {
    expect(normalizeOptionToken('  Dark   Blue ')).toBe('dark blue');
  });

  it('unifies visually identical Unicode forms', () => {
    // Precomposed U+00E9 vs. e + combining acute U+0301: identical on screen,
    // different byte sequences. Without NFKC they would become two option
    // values a customer cannot tell apart.
    const precomposed = `Caf${String.fromCharCode(0x00e9)}`;
    const decomposed = `Cafe${String.fromCharCode(0x0301)}`;

    expect(precomposed).not.toBe(decomposed);
    expect(normalizeOptionToken(precomposed)).toBe(
      normalizeOptionToken(decomposed),
    );
  });
});

describe('buildOptionCombinationKey', () => {
  it('is order-independent, so the same combination always collides', () => {
    const forward = buildOptionCombinationKey([
      { optionId: 'opt-a', normalizedValue: 'black' },
      { optionId: 'opt-b', normalizedValue: 'xl' },
    ]);
    const reversed = buildOptionCombinationKey([
      { optionId: 'opt-b', normalizedValue: 'xl' },
      { optionId: 'opt-a', normalizedValue: 'black' },
    ]);

    expect(forward).toBe(reversed);
  });

  it('distinguishes genuinely different combinations', () => {
    expect(
      buildOptionCombinationKey([
        { optionId: 'opt-a', normalizedValue: 'black' },
      ]),
    ).not.toBe(
      buildOptionCombinationKey([
        { optionId: 'opt-a', normalizedValue: 'white' },
      ]),
    );
  });

  it('returns null for an unmapped variant', () => {
    // Null is what the paired check constraint uses to make such a variant
    // impossible to store as ACTIVE.
    expect(buildOptionCombinationKey([])).toBeNull();
  });
});

describe('canonicalRequestHash', () => {
  it('ignores key ordering so an equivalent replay is not a false conflict', () => {
    expect(canonicalRequestHash({ a: '1', b: '2' })).toBe(
      canonicalRequestHash({ b: '2', a: '1' }),
    );
  });

  it('changes when any field changes', () => {
    expect(canonicalRequestHash({ candidateId: 'c1' })).not.toBe(
      canonicalRequestHash({ candidateId: 'c2' }),
    );
  });

  it('separates a missing field from an empty one', () => {
    expect(canonicalRequestHash({ a: undefined })).not.toBe(
      canonicalRequestHash({ a: '' }),
    );
  });
});
