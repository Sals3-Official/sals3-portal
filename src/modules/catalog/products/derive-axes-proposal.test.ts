// @vitest-environment node
import { describe, expect, it } from 'vitest';
import deriveAxesProposal from './derive-axes-proposal';

/**
 * Naming the derived split for the internal API's `auto: true` mode. The
 * STRUCTURE is `deriveOptionSplit`'s (tested in `option-split.test.ts`);
 * these tests cover only the naming heuristic and its refusals.
 */

const VARIANTS = (labels: (string | null)[]) =>
  labels.map((label, index) => ({ variantId: `variant-${index}`, label }));

describe('deriveAxesProposal', () => {
  it('names a colour-by-size grid Colour and Size', () => {
    const axes = deriveAxesProposal(
      VARIANTS(['Black-M', 'Black-L', 'Khaki-M', 'Khaki-L']),
    );

    expect(axes).not.toBeNull();
    expect(axes?.map((axis) => axis.name)).toEqual(['Colour', 'Size']);
    expect(axes?.[1].values).toEqual([
      { raw: 'M', label: 'M' },
      { raw: 'L', label: 'L' },
    ]);
  });

  it('a single-colour product derives to Size alone - the constant position is dropped, the black-only work trousers of 2026-09-02', () => {
    const axes = deriveAxesProposal(
      VARIANTS(['Black-M', 'Black-L', 'Black-XL']),
    );

    expect(axes?.map((axis) => axis.name)).toEqual(['Size']);
  });

  it('labels that do not derive cleanly are a null - map by hand, never a guess', () => {
    expect(deriveAxesProposal(VARIANTS(['Black-M', 'Black-M']))).toBeNull();
    expect(deriveAxesProposal(VARIANTS([null, null]))).toBeNull();
  });

  it('two positions the heuristic would name identically are a null', () => {
    // Two non-size positions - both would be Colour.
    expect(
      deriveAxesProposal(
        VARIANTS(['Black-Zip', 'Black-Button', 'Khaki-Zip', 'Khaki-Button']),
      ),
    ).toBeNull();
  });
});
