// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { listCategoryMarginOverview } from './repository';

/**
 * Guards the owner decision of 2026-08-19: Market Rules configures
 * departments and groups, not the near-per-item leaves ("Bicycle Jerseys",
 * "Bicycle Tights"). Per-product pricing belongs in the Product Catalogue.
 *
 * The point of the test is that the query CARRIES a depth restriction at
 * all — dropping the `where` would silently ship 5,602 rows to the browser
 * again, which is exactly the regression this narrows away. The SQL's
 * semantics are Postgres's job; what is asserted here is that the filter is
 * present and mentions both arms (depth, and already-configured rows).
 */
function capturingExecutor() {
  const calls: { where?: unknown; orderBy?: unknown } = {};
  const orderBy = vi.fn().mockResolvedValue([]);
  const where = vi.fn((condition: unknown) => {
    calls.where = condition;
    return { orderBy };
  });
  const leftJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ leftJoin }));
  const select = vi.fn(() => ({ from }));

  return { executor: { select } as never, calls, where, orderBy };
}

describe('listCategoryMarginOverview — depth cap', () => {
  it('filters rather than selecting the whole taxonomy', async () => {
    const { executor, where } = capturingExecutor();

    await listCategoryMarginOverview(executor, 'seller-1');

    // Without this the page ships every one of the 5,602 rows.
    expect(where).toHaveBeenCalledTimes(1);
  });

  it('keeps an already-configured deeper category visible instead of hiding a live rate', async () => {
    const { executor, calls } = capturingExecutor();

    await listCategoryMarginOverview(executor, 'seller-1');

    // Walk the built condition and collect every column it touches. Drizzle
    // nests its operands, so a recursive collect is stabler than reaching
    // into a particular internal field.
    const columns = new Set<string>();
    const visit = (value: unknown, depth = 0): void => {
      if (depth > 8 || value === null || typeof value !== 'object') return;
      const record = value as Record<string, unknown>;
      if (typeof record.name === 'string') columns.add(record.name);
      Object.values(record).forEach((child) => {
        if (Array.isArray(child)) child.forEach((c) => visit(c, depth + 1));
        else visit(child, depth + 1);
      });
    };
    visit(calls.where);

    // Depth arm.
    expect(columns.has('l3')).toBe(true);
    // Has-a-policy escape hatch — a single-arm filter would drop this.
    expect(columns.has('id')).toBe(true);
  });
});
