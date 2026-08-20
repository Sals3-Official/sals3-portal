// @vitest-environment node
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * What this write may never do, read from its own source.
 *
 * Same technique as `rename-option-mapping.test.ts`: the safety of a narrow
 * write is a property of the columns it touches, and a mocked transaction would
 * assert the mock instead of the rule. Pointing a photo at a variant is safe
 * precisely because it is one nullable column — the moment this module learns to
 * write an address, a checksum, or a rights basis, it is a different feature
 * with a different review.
 */
const SOURCE = readFileSync(
  resolve(__dirname, 'assign-variant-media.ts'),
  'utf8',
);

describe('assign variant media - what it may never write', () => {
  it('writes only the variant pointer', () => {
    expect(SOURCE).toMatch(/\.set\(\{ variantId: input\.variantId \}\)/);
    // One `.set(` in the whole module.
    expect(SOURCE.match(/\.set\(/gu)).toHaveLength(1);
  });

  it('never touches the stored evidence about the file itself', () => {
    expect(SOURCE).not.toMatch(/sourceUrl:/);
    expect(SOURCE).not.toMatch(/checksum:/);
    expect(SOURCE).not.toMatch(/rightsBasis:/);
    expect(SOURCE).not.toMatch(/reviewState:/);
    expect(SOURCE).not.toMatch(/merchantCenterEligible:/);
  });

  it('never deletes a media row or an object', () => {
    expect(SOURCE).not.toMatch(/\.delete\(/);
    expect(SOURCE).not.toMatch(/DeleteObjectCommand/);
  });

  it('scopes the product to the calling seller', () => {
    expect(SOURCE).toMatch(/findProductForSteward/);
    expect(SOURCE).toMatch(/input\.sellerAccountId/);
  });

  /**
   * The case a tenant check alone lets through: a media id or variant id that
   * belongs to a *different product of the same seller*. Both are matched on the
   * resolved product's own id, so neither can be joined across products.
   */
  it('matches both rows on the resolved product id', () => {
    expect(SOURCE).toMatch(/eq\(productVariants\.productId, product\.id\)/);
    expect(SOURCE).toMatch(/eq\(productMediaSources\.productId, product\.id\)/);
  });

  /**
   * `UPDATE ... RETURNING` in Postgres reports the row after the statement, so
   * the previous holder has to be read first or the audit trail records the
   * destination twice.
   */
  it('reads the previous holder before writing, not from RETURNING', () => {
    expect(SOURCE).toMatch(/previousVariantId: existing\.variantId/);
    expect(SOURCE).not.toMatch(/previousVariantId: productMediaSources/);
  });

  it('records the move in the append-only audit trail', () => {
    expect(SOURCE).toMatch(/appendAuditEvent/);
    expect(SOURCE).toMatch(/variantMediaAssigned/);
  });

  it('costs nothing at the supplier', () => {
    // No client, no request, no points (ADR-017): the photo is already stored.
    expect(SOURCE).not.toMatch(/cjClient|callCj|fetch\(/);
  });
});
