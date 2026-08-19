// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listCategoryMarginOverview: vi.fn(),
  findActiveStoreDefault: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({ default: () => ({ __db: true }) }));

vi.mock('@/modules/pricing/repository', () => ({
  listCategoryMarginOverview: mocks.listCategoryMarginOverview,
  findActiveStoreDefault: mocks.findActiveStoreDefault,
}));

/* eslint-disable import/first */
import CategoryPricingSection from './CategoryPricingSection';

const ROWS = [
  {
    categoryId: 'id-1',
    code: 'CAT-GGL-1',
    path: 'Animals & Pet Supplies',
    l1: 'Animals & Pet Supplies',
    l2: null,
    l3: null,
    policy: null,
  },
];

/**
 * These are Server Components, so they are exercised by awaiting the
 * element they return and walking its props — no DOM, no renderer. What is
 * being asserted is the read/failure wiring, which is where the regression
 * lived, not the markup (`CategoryMarginTree.test.tsx` covers that).
 */
/** The tree is the only child carrying a `nodes` prop — component identity itself does not survive JSON serialization. */
const TREE_MARKER = '"nodes":';

async function renderToTree(): Promise<string> {
  const element = await CategoryPricingSection({
    sellerAccountId: 'seller-1',
    canManage: true,
  });

  return JSON.stringify(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listCategoryMarginOverview.mockResolvedValue(ROWS);
  mocks.findActiveStoreDefault.mockResolvedValue(null);
});

describe('CategoryPricingSection — read isolation', () => {
  /**
   * The regression this file exists for. Observed in production on
   * 2026-08-19: the feature deployed before `pricing_store_defaults` was
   * migrated, the store-default read threw, and because both reads shared
   * one `Promise.all`/`try`, the whole 220-group category tree vanished
   * behind "Category pricing is not available right now." The taxonomy read
   * had succeeded the entire time.
   */
  it('still renders the tree when the store-default read fails outright', async () => {
    mocks.findActiveStoreDefault.mockRejectedValue(
      new Error('relation "pricing_store_defaults" does not exist'),
    );

    const output = await renderToTree();

    expect(output).toContain(TREE_MARKER);
    expect(output).not.toContain('Category pricing is not available');
    // And it says plainly that inherited rates are incomplete, rather than
    // implying no default is configured.
    expect(output).toContain('could not be read');
  });

  it('a failed store-default read is never presented as "no default configured"', async () => {
    mocks.findActiveStoreDefault.mockRejectedValue(new Error('boom'));

    const output = await renderToTree();

    expect(output).not.toContain('No store default exists yet');
  });

  it('a successful read with no default still shows the first-run notice', async () => {
    mocks.findActiveStoreDefault.mockResolvedValue(null);

    const output = await renderToTree();

    expect(output).toContain('No store default exists yet');
    expect(output).toContain(TREE_MARKER);
  });

  it('a real default shows neither banner', async () => {
    mocks.findActiveStoreDefault.mockResolvedValue({
      targetMarginRate: '0.350000',
      roundingRule: 'NONE',
    });

    const output = await renderToTree();

    expect(output).not.toContain('No store default exists yet');
    expect(output).not.toContain('could not be read');
  });

  it('only a failed taxonomy read hides the tree — that one genuinely has nothing to show', async () => {
    mocks.listCategoryMarginOverview.mockRejectedValue(new Error('boom'));

    const output = await renderToTree();

    expect(output).toContain('Category pricing is not available');
    expect(output).not.toContain(TREE_MARKER);
  });
});
