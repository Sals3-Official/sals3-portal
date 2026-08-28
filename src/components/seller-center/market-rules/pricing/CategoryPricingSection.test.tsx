// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listCategoryMarginOverviewByMarket: vi.fn(),
  findStoreDefaultForScope: vi.fn(),
  countDescendantsByPath: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({ default: () => ({ __db: true }) }));

vi.mock('@/modules/pricing/repository', () => ({
  listCategoryMarginOverviewByMarket: mocks.listCategoryMarginOverviewByMarket,
  findStoreDefaultForScope: mocks.findStoreDefaultForScope,
  countDescendantsByPath: mocks.countDescendantsByPath,
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
    policies: {},
  },
];

/** Two lanes and Global; the section's job is the wiring, not the count. */
const SCOPES = [
  { key: 'AU', label: 'Australia', marketCode: 'AU', isGlobal: false },
  { key: 'FJ', label: 'Fiji', marketCode: 'FJ', isGlobal: false },
  { key: 'GLOBAL', label: 'Global', marketCode: null, isGlobal: true },
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
    scopes: SCOPES,
  });

  return JSON.stringify(element);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listCategoryMarginOverviewByMarket.mockResolvedValue(ROWS);
  mocks.findStoreDefaultForScope.mockResolvedValue(null);
  mocks.countDescendantsByPath.mockResolvedValue(new Map());
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
    mocks.findStoreDefaultForScope.mockRejectedValue(
      new Error('relation "pricing_store_defaults" does not exist'),
    );

    const output = await renderToTree();

    expect(output).toContain(TREE_MARKER);
    expect(output).not.toContain('Category pricing is not available');
    // And it says plainly that inherited rates are incomplete, rather than
    // implying no default is configured.
    expect(output).toContain('could not be read');
  });

  /**
   * The coverage banner used to ask "which scopes have no store default row",
   * which was the right question while that row carried a fallback markup. It
   * stopped carrying one on 2026-08-28, so the old test would now be true for
   * every scope forever and the banner would be permanent furniture.
   *
   * It asks about DEPARTMENT coverage instead. Inheritance only ever walks up,
   * so a category is uncovered exactly when the department above it has no
   * markup — checking the roots decides the whole tree without walking it.
   */
  it('warns when a department has no markup in a scope', async () => {
    // `ROWS` is one root category with `policies: {}` — uncovered everywhere.
    const output = await renderToTree();

    expect(output).toContain('Some departments have no markup in');
    expect(output).toContain(TREE_MARKER);
  });

  it('stops warning once every department carries a markup', async () => {
    mocks.listCategoryMarginOverviewByMarket.mockResolvedValue([
      {
        ...ROWS[0],
        policies: {
          AU: { targetMarginRate: '0.500000', roundingRule: 'NONE' },
          FJ: { targetMarginRate: '0.500000', roundingRule: 'NONE' },
          GLOBAL: { targetMarginRate: '0.500000', roundingRule: 'NONE' },
        },
      },
    ]);

    const output = await renderToTree();

    expect(output).not.toContain('Some departments have no markup in');
  });

  it('judges coverage on departments alone, never on a child of one', async () => {
    /*
      A covered department with an uncovered child underneath it. The child
      inherits and prices fine, so the banner must stay silent — a check that
      looked at every row rather than the roots would fire here and would fire
      on essentially every account, since most categories carry no rule of
      their own.
    */
    mocks.listCategoryMarginOverviewByMarket.mockResolvedValue([
      {
        ...ROWS[0],
        policies: {
          AU: { targetMarginRate: '0.500000', roundingRule: 'NONE' },
          FJ: { targetMarginRate: '0.500000', roundingRule: 'NONE' },
          GLOBAL: { targetMarginRate: '0.500000', roundingRule: 'NONE' },
        },
      },
      {
        categoryId: 'id-2',
        code: 'CAT-GGL-2',
        path: 'Animals & Pet Supplies > Pet Supplies',
        l1: 'Animals & Pet Supplies',
        l2: 'Pet Supplies',
        l3: null,
        policies: {},
      },
    ]);

    const output = await renderToTree();

    expect(output).not.toContain('Some departments have no markup in');
  });

  it('a failed store-default read no longer changes the coverage warning', async () => {
    /*
      These were one banner's two inputs and are now unrelated: the reserve says
      nothing about whether a category can price. The read failure still gets
      its own honest notice, and the coverage answer comes from the taxonomy
      rows, which loaded fine.
    */
    mocks.findStoreDefaultForScope.mockRejectedValue(new Error('boom'));

    const output = await renderToTree();

    expect(output).toContain('could not be read');
    expect(output).toContain('Some departments have no markup in');
    expect(output).toContain(TREE_MARKER);
  });

  it('only a failed taxonomy read hides the tree — that one genuinely has nothing to show', async () => {
    mocks.listCategoryMarginOverviewByMarket.mockRejectedValue(
      new Error('boom'),
    );

    const output = await renderToTree();

    expect(output).toContain('Category pricing is not available');
    expect(output).not.toContain(TREE_MARKER);
  });
});

describe('CategoryPricingSection — descendant counts', () => {
  /**
   * The count tells a seller how much a department margin will cover, so it
   * has to come from the whole taxonomy, not from the depth-capped rows this
   * view renders. Deriving it from the rows shipped once and turned
   * "Home & Garden — 1,034 categories" into "21".
   */
  it('uses the full-taxonomy count, not the number of visible rows', async () => {
    mocks.countDescendantsByPath.mockResolvedValue(
      new Map([['Animals & Pet Supplies', 1034]]),
    );

    const output = await renderToTree();

    expect(output).toContain('"subtreeCount":1034');
  });

  it('falls back to zero for a node the count map does not mention, never to a row-derived guess', async () => {
    mocks.countDescendantsByPath.mockResolvedValue(new Map());

    const output = await renderToTree();

    expect(output).toContain('"subtreeCount":0');
  });
});

describe('CategoryPricingSection — the Global scope reads its own row', () => {
  /**
   * `null` is the scope Global stores, not "any scope".
   * `findStoreDefaultForScope` matches `market_code IS NULL` on it, so passing
   * the column key `'GLOBAL'` instead would look for a country code the table
   * has never held and report every Global default as missing.
   */
  it('reads each scope by its market code, and Global by null', async () => {
    await renderToTree();

    const scopesRead = mocks.findStoreDefaultForScope.mock.calls.map(
      (call) => call[2],
    );

    expect(scopesRead).toEqual(['AU', 'FJ', null]);
  });

  it('names an unset scope by its label, so the banner says Global and not GLOBAL', async () => {
    const output = await renderToTree();

    // The joined list the banner renders. `scope.key` would put the storage
    // spelling in front of a seller.
    expect(output).toContain('Australia, Fiji, Global');
  });
});
