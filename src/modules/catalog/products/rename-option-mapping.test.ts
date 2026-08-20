import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * The rename path's safety is a property of *what it writes*, not of a
 * mocked call sequence: it is safe precisely because it never writes the
 * columns that carry variant identity.
 *
 * `save-option-mapping.test.ts` covers the mapping writer against a fake
 * transaction; repeating that shape here would assert the mock, not the
 * rule. Reading the module's own source for the forbidden writes is the
 * check that actually fails if someone later "improves" the rename into a
 * remap — the same technique `source-changes.ts` uses to prove it cannot
 * reach CJ.
 */

const SOURCE = readFileSync(
  resolve(__dirname, 'rename-option-mapping.ts'),
  'utf8',
);

describe('rename option mapping - what it may never write', () => {
  it('never deletes anything', () => {
    // A delete is the whole reason a full remap is refused: option rows are
    // what `product_variant_option_values` and `option_combination_key`
    // depend on.
    expect(SOURCE).not.toMatch(/\.delete\(/);
  });

  it('never writes normalized_value, the supplier token variants join on', () => {
    expect(SOURCE).not.toMatch(/normalizedValue:/);
  });

  it('never recomputes an option combination key', () => {
    expect(SOURCE).not.toMatch(/optionCombinationKey/);
    expect(SOURCE).not.toMatch(/buildOptionCombinationKey/);
  });

  it('never touches variants, offers, or their supplier bindings', () => {
    expect(SOURCE).not.toMatch(/productVariants\b/);
    expect(SOURCE).not.toMatch(/productVariantOptionValues/);
    expect(SOURCE).not.toMatch(/productOffers/);
    expect(SOURCE).not.toMatch(/offerSupplierBindings/);
  });

  it('writes exactly the display columns and the display order', () => {
    expect(SOURCE).toMatch(/\.set\(\{ name: axis\.name\.trim\(\) \}\)/);
    expect(SOURCE).toMatch(
      /\.set\(\{ label: value\.label\.trim\(\), position: index \}\)/,
    );
  });

  /**
   * `product_option_values_option_position_key` is a plain unique index — not
   * deferrable — so a straight swap collides mid-statement. Every row of the
   * axis is lifted above its own maximum first, which empties the `0..n-1`
   * range the second pass writes into. A negative sentinel is not an option:
   * `product_option_values_position_non_negative` forbids it.
   */
  it('clears the position range before assigning final positions', () => {
    expect(SOURCE).toMatch(/positionOffset/);
    expect(SOURCE).toMatch(
      /position: sql`\$\{productOptionValues\.position\} \+ \$\{positionOffset\}`/,
    );
    expect(SOURCE).not.toMatch(/position: -/);
  });

  /**
   * Order comes from array order, never from a client-supplied index — the same
   * rule `saveOptionMapping` follows, and the reason there is no second source
   * of truth for a value's place.
   */
  it('takes position from array order rather than a submitted field', () => {
    // The accepted input carries no position: the array index is the order.
    expect(SOURCE).toMatch(/values: \{ valueId: string; label: string \}\[\]/);
    expect(SOURCE).toMatch(/axis\.values\.entries\(\)/);
  });

  /**
   * A payload missing one value was harmless while only labels were written;
   * with positions written it would leave the omitted row at its offset
   * position, silently sorting it last.
   */
  it('refuses a partial axis now that order is written', () => {
    expect(SOURCE).toMatch(/incomplete/);
    expect(SOURCE).toMatch(/storedCountByAxis/);
  });

  it('is compare-and-set on the product version', () => {
    expect(SOURCE).toMatch(/version !== input\.expectedProductVersion/);
    expect(SOURCE).toMatch(/reason: 'version_conflict'/);
  });

  it('scopes every read to the calling seller', () => {
    expect(SOURCE).toMatch(/stewardSellerAccountId, input\.sellerAccountId/);
  });
});
