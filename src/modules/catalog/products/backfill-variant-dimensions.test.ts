import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';

import {
  backfillVariantDimensions,
  type BackfillVariantDimensionsResult,
} from './backfill-variant-dimensions';

/**
 * The statement itself is the deliverable here.
 *
 * It runs against production through the break-glass route and cannot be
 * rehearsed against the local database, which is empty. So the properties that
 * make it safe to run are asserted on the SQL that will actually be sent,
 * rather than left as prose in a doc comment: a reviewer can check each one
 * without a database.
 */
function capturingDb() {
  const dialect = new PgDialect();
  const statements: string[] = [];
  // Rendered through the real dialect, so the assertions below read the text
  // Postgres receives rather than a stringified builder object.
  const execute = vi.fn(async (query: SQL) => {
    statements.push(dialect.sqlToQuery(query).sql);

    return [] as unknown[];
  });

  return { db: { execute } as never, statements, execute };
}

describe('backfillVariantDimensions', () => {
  it('only touches variants whose three columns are all still null', async () => {
    const { db, statements } = capturingDb();

    await backfillVariantDimensions(db);

    const update = statements[0] ?? '';

    // Idempotency, and the guarantee that it never overwrites a value someone
    // else set — a seller's audited override included.
    expect(update).toContain('v.length_millimeters IS NULL');
    expect(update).toContain('v.width_millimeters IS NULL');
    expect(update).toContain('v.height_millimeters IS NULL');
  });

  it('matches evidence by the supplier variant id, never by array position', async () => {
    const { db, statements } = capturingDb();

    await backfillVariantDimensions(db);

    const update = statements[0] ?? '';

    // Ordering is CJ's to change. Pairing by index would hand a variant
    // another variant's box the first time the array came back reordered, and
    // nothing downstream could tell.
    expect(update).toContain("variant ->> 'vid' = pvr.external_variant_id");
  });

  it('fills all three or none, so a half-measured box is never recorded', async () => {
    const { db, statements } = capturingDb();

    await backfillVariantDimensions(db);

    const update = statements[0] ?? '';

    // `freight-quotes.ts` needs all three to compute a volume; two of three
    // reads as a measured fact while being useless.
    expect(update).toContain('e.length_mm IS NOT NULL');
    expect(update).toContain('e.width_mm IS NOT NULL');
    expect(update).toContain('e.height_mm IS NOT NULL');
  });

  it('reports what it changed and what is still missing', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'variant-1' }, { id: 'variant-2' }])
      .mockResolvedValueOnce([{ remaining: 7 }]);

    const result: BackfillVariantDimensionsResult =
      await backfillVariantDimensions({ execute } as never);

    // The remaining count is read back from the database after the write, so
    // the report describes the rows rather than the intent.
    expect(result).toEqual({ variantsFilled: 2, variantsStillMissing: 7 });
  });

  it('reports zero rather than throwing when nothing matches', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ remaining: 0 }]);

    await expect(
      backfillVariantDimensions({ execute } as never),
    ).resolves.toEqual({ variantsFilled: 0, variantsStillMissing: 0 });
  });
});
