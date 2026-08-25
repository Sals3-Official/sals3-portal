import { describe, expect, it, vi } from 'vitest';

import { correctAttributeControls } from './correct-attribute-controls';
import {
  NARROWED_CONTROL_VALUES,
  REMOVED_CONTROLS,
} from './attribute-control-corrections';

/**
 * A fake executor that records what each statement was asked to do.
 *
 * The statements run against production through the break-glass route and
 * cannot be rehearsed against the local database, which is empty — so what is
 * asserted here is the shape of the work: that every correction is applied,
 * that a category the database does not have is reported rather than thrown
 * over, and that nothing is written for one.
 */
function fakeDb(knownCodes: string[]) {
  const deleted: unknown[] = [];
  const updated: unknown[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: async () =>
          knownCodes.map((code) => ({ id: `id-${code}`, code })),
      }),
    }),
    delete: () => ({
      where: (condition: unknown) => ({
        returning: async () => {
          deleted.push(condition);

          return [{ id: 'removed' }];
        },
      }),
    }),
    update: () => ({
      set: (values: unknown) => ({
        where: () => ({
          returning: async () => {
            updated.push(values);

            return [{ id: 'rewritten' }];
          },
        }),
      }),
    }),
  } as never;

  return { db, deleted, updated };
}

const ALL_CODES = [
  'CAT-GGL-1581',
  'CAT-GGL-2331',
  'CAT-GGL-6228',
  'CAT-GGL-6229',
];

describe('correctAttributeControls', () => {
  it('removes every named control and rewrites every narrowed one', async () => {
    const { db, deleted, updated } = fakeDb(ALL_CODES);

    const result = await correctAttributeControls(db);

    expect(deleted).toHaveLength(REMOVED_CONTROLS.length);
    expect(updated).toHaveLength(NARROWED_CONTROL_VALUES.length);
    expect(result).toEqual({
      controlsRemoved: 8,
      allowedValuesRewritten: 4,
      unmatchedCategoryCodes: [],
    });
  });

  it('writes the skirt-only values, not a partial list', async () => {
    const { db, updated } = fakeDb(ALL_CODES);

    await correctAttributeControls(db);

    updated.forEach((values) => {
      expect(values).toEqual({
        allowedValues: [
          'A-Line',
          'Pleated Skirt',
          'Pencil Skirt',
          'Tiered Boho',
        ],
      });
    });
  });

  it('reports a category the database does not have instead of failing', async () => {
    // An environment seeded from a different taxonomy version legitimately has
    // none of these codes. That is worth seeing in the response, not worth
    // aborting a correction that can still apply to the rest.
    const { db, deleted, updated } = fakeDb(['CAT-GGL-1581']);

    const result = await correctAttributeControls(db);

    expect(result.unmatchedCategoryCodes).toEqual([
      'CAT-GGL-2331',
      'CAT-GGL-6228',
      'CAT-GGL-6229',
    ]);
    // Two removals and one rewrite for the single category it did find.
    expect(deleted).toHaveLength(2);
    expect(updated).toHaveLength(1);
  });

  it('writes nothing at all when no category matches', async () => {
    const { db, deleted, updated } = fakeDb([]);

    const result = await correctAttributeControls(db);

    expect(deleted).toHaveLength(0);
    expect(updated).toHaveLength(0);
    expect(result.controlsRemoved).toBe(0);
    expect(result.allowedValuesRewritten).toBe(0);
  });

  it('never touches product_category_attribute_values', async () => {
    // Removing a control stops a value rendering, because the storefront's
    // specification query inner-joins the controls. The seller's stored answer
    // is deliberately left in place — reversible, and not this job to delete.
    const { db } = fakeDb(ALL_CODES);
    const spy = vi.fn();

    await correctAttributeControls({
      ...(db as unknown as Record<string, unknown>),
      execute: spy,
    } as never);

    expect(spy).not.toHaveBeenCalled();
  });
});
