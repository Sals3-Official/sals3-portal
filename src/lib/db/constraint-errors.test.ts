import { describe, expect, it } from 'vitest';
import uniqueViolationConstraint from './constraint-errors';

/**
 * The wrapped case is the one that matters. Drizzle does not rethrow the
 * driver's error - it wraps it and hangs the original off `cause` - so a
 * check that only looks at the thrown object silently never fires, and every
 * unique violation quietly degrades to a generic failure. That is an
 * invariant failing open, which is why it is tested rather than assumed.
 */
function pgUniqueViolation(constraintName: string) {
  return { code: '23505', constraint_name: constraintName };
}

describe('uniqueViolationConstraint', () => {
  it('reads the constraint name off a bare driver error', () => {
    expect(uniqueViolationConstraint(pgUniqueViolation('some_key'))).toBe(
      'some_key',
    );
  });

  it('finds it through a wrapping error - the shape Drizzle actually throws', () => {
    const wrapped = new Error('Failed query', {
      cause: pgUniqueViolation('some_key'),
    });

    expect(uniqueViolationConstraint(wrapped)).toBe('some_key');
  });

  it('finds it through several layers of wrapping', () => {
    const inner = new Error('inner', { cause: pgUniqueViolation('some_key') });
    const outer = new Error('outer', { cause: inner });

    expect(uniqueViolationConstraint(outer)).toBe('some_key');
  });

  it('ignores a non-unique violation', () => {
    expect(
      uniqueViolationConstraint({
        code: '23503',
        constraint_name: 'some_fk',
      }),
    ).toBeNull();
  });

  it('returns null for a unique violation with no constraint name', () => {
    expect(uniqueViolationConstraint({ code: '23505' })).toBeNull();
  });

  it.each([
    ['a plain error', new Error('boom')],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'boom'],
  ])('returns null for %s', (_label, value) => {
    expect(uniqueViolationConstraint(value)).toBeNull();
  });

  it('terminates on a self-referencing cause instead of spinning', () => {
    const cyclic: { code: string; cause?: unknown } = { code: '42P01' };
    cyclic.cause = cyclic;

    expect(uniqueViolationConstraint(cyclic)).toBeNull();
  });

  it('gives up rather than walking an unbounded cause chain', () => {
    let deep: unknown = pgUniqueViolation('some_key');

    for (let i = 0; i < 20; i += 1) {
      deep = new Error(`layer-${i}`, { cause: deep });
    }

    expect(uniqueViolationConstraint(deep)).toBeNull();
  });
});
