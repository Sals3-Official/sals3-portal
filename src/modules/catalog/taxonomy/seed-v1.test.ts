// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { seedSals3CategoriesV1 } from './seed-v1';

function fakeDb(returned: { id: string }[]) {
  const returning = vi.fn(() => Promise.resolve(returned));
  // These mocks never read their arguments - the test inspects them via
  // `.mock.calls` instead.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const onConflictDoNothing = vi.fn((options: unknown) => ({ returning }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const values = vi.fn((rows: unknown) => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));

  return { db: { insert }, insert, values, onConflictDoNothing };
}

describe('seedSals3CategoriesV1', () => {
  it('inserts every row from the bundled v1 extraction, additively', async () => {
    const { db, values, onConflictDoNothing } = fakeDb(
      Array.from({ length: 5595 }, (_v, i) => ({ id: `id-${i}` })),
    );

    const result = await seedSals3CategoriesV1(db as never);

    expect(result).toEqual({ totalInExtract: 5595, inserted: 5595 });
    expect(values).toHaveBeenCalledTimes(1);
    const inserted = values.mock.calls[0]?.[0] as { code: string }[];
    expect(inserted).toHaveLength(5595);
    expect(inserted[0]).toMatchObject({ code: 'CAT-GGL-1' });
    // Additive, not destructive - the whole point of this function existing
    // separately from the CLI script's delete-then-insert migration.
    expect(onConflictDoNothing).toHaveBeenCalledWith(
      expect.objectContaining({ target: expect.anything() }),
    );
  });

  it('reports fewer inserted than the extract size when some rows already exist', async () => {
    const { db } = fakeDb([{ id: 'id-1' }, { id: 'id-2' }]);

    const result = await seedSals3CategoriesV1(db as never);

    expect(result.totalInExtract).toBe(5595);
    expect(result.inserted).toBe(2);
  });
});
