import { describe, expect, it } from 'vitest';
import coverageChecksum from './coverage-checksum';

const IDENTITY = {
  partitionId: 'partition-1',
  categoryId: 'cat-1',
  timeFromMs: 1_600_000_000_000,
  timeToMs: 1_600_003_600_000,
  priceFromCents: null,
  priceToCents: null,
};

describe('coverageChecksum', () => {
  it('is order-independent over the PID set (sorted before hashing)', () => {
    const a = coverageChecksum({ ...IDENTITY, uniquePids: ['p1', 'p2', 'p3'] });
    const b = coverageChecksum({ ...IDENTITY, uniquePids: ['p3', 'p1', 'p2'] });

    expect(a).toBe(b);
  });

  it('differs when the PID set differs', () => {
    const a = coverageChecksum({ ...IDENTITY, uniquePids: ['p1', 'p2'] });
    const b = coverageChecksum({ ...IDENTITY, uniquePids: ['p1', 'p2', 'p3'] });

    expect(a).not.toBe(b);
  });

  it('binds the immutable partition identity - the same PID set under different filters never matches', () => {
    const pids = ['p1', 'p2'];
    const a = coverageChecksum({ ...IDENTITY, uniquePids: pids });
    const b = coverageChecksum({
      ...IDENTITY,
      priceFromCents: 0,
      uniquePids: pids,
    });
    const c = coverageChecksum({
      ...IDENTITY,
      partitionId: 'partition-2',
      uniquePids: pids,
    });

    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});
