import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  countCandidateStatusSummaryMock,
  countCandidatesByStatusMock,
  countDeadLetteredEvaluationsMock,
  countEvaluatingCandidatesMock,
  isDatabaseConfiguredMock,
  findCataloguedCandidateIdsMock,
  listCandidatesByStatusMock,
  listDeadLetteredEvaluationsMock,
  listEvaluatingCandidatesMock,
  oldestQueuedAgeMsMock,
  requireDropshipperAccountMock,
} = vi.hoisted(() => ({
  countCandidateStatusSummaryMock: vi.fn(),
  countCandidatesByStatusMock: vi.fn(),
  countDeadLetteredEvaluationsMock: vi.fn(),
  countEvaluatingCandidatesMock: vi.fn(),
  isDatabaseConfiguredMock: vi.fn(),
  findCataloguedCandidateIdsMock: vi.fn(),
  listCandidatesByStatusMock: vi.fn(),
  listDeadLetteredEvaluationsMock: vi.fn(),
  listEvaluatingCandidatesMock: vi.fn(),
  oldestQueuedAgeMsMock: vi.fn(),
  requireDropshipperAccountMock: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  isDatabaseConfigured: isDatabaseConfiguredMock,
}));

vi.mock('@/lib/auth/seller-guard', () => ({
  requireDropshipperAccount: requireDropshipperAccountMock,
}));

// The page reads the status counts through the cached wrapper, not the query
// directly. Mocking the wrapper to the same spy keeps every assertion below
// meaningful and keeps the real `unstable_cache` - which throws outside a request
// context - out of a unit test.
vi.mock('@/modules/catalog/candidates/status-counts-cache', () => ({
  default: countCandidateStatusSummaryMock,
  CANDIDATE_STATUS_COUNTS_TAG: 'candidate-status-counts',
}));

vi.mock('@/modules/catalog/candidates/queries', () => ({
  PIPELINE_PAGE_SIZE: 100,
  countCandidateStatusSummary: countCandidateStatusSummaryMock,
  countCandidatesByStatus: countCandidatesByStatusMock,
  countDeadLetteredEvaluations: countDeadLetteredEvaluationsMock,
  countEvaluatingCandidates: countEvaluatingCandidatesMock,
  listCandidatesByStatus: listCandidatesByStatusMock,
  listDeadLetteredEvaluations: listDeadLetteredEvaluationsMock,
  listEvaluatingCandidates: listEvaluatingCandidatesMock,
  oldestQueuedAgeMs: oldestQueuedAgeMsMock,
}));

vi.mock('@/modules/catalog/products/read-model', () => ({
  findCataloguedCandidateIds: findCataloguedCandidateIdsMock,
}));

vi.mock('@/components/portal/PageHeader', () => ({
  default: ({ description, title }: { description: string; title: string }) => (
    <header>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  ),
}));

vi.mock('@/components/products/cj/PipelineTabs', () => ({
  default: ({ counts }: { counts: unknown }) => (
    <div data-testid="pipeline-tabs">
      {counts === null ? 'counts:null' : 'counts:present'}
    </div>
  ),
}));

vi.mock('@/components/products/cj/PipelinePagination', () => ({
  default: ({
    currentParams,
    page,
    total,
    totalPages,
  }: {
    currentParams: Record<string, string>;
    page: number;
    total: number;
    totalPages: number;
  }) => (
    <nav data-testid="pipeline-pagination">
      {`page:${page}/${totalPages} total:${total} params:${JSON.stringify(currentParams)}`}
    </nav>
  ),
}));

vi.mock('@/components/products/cj/PipelineSearchInput', () => ({
  default: () => <input aria-label="Search pipeline" />,
}));

vi.mock('@/components/products/cj/SourcingEmptyState', () => ({
  default: ({ description, title }: { description: string; title: string }) => (
    <section>
      <h2>{title}</h2>
      <p>{description}</p>
    </section>
  ),
}));

vi.mock('@/components/products/cj/SourcingInfoBanner', () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <aside>{children}</aside>
  ),
}));

vi.mock('@/components/seller-center/shared/StatusPill', () => ({
  default: ({ label }: { label: string }) => <p>{label}</p>,
}));

vi.mock('@/components/products/cj/AllCandidatesTable', () => ({
  default: () => <div>all candidates table</div>,
}));

vi.mock('@/components/products/cj/BlockedCandidatesTable', () => ({
  default: () => <div>blocked candidates table</div>,
}));

vi.mock('@/components/products/cj/EvaluatingCandidatesTable', () => ({
  default: () => <div>evaluating candidates table</div>,
}));

vi.mock('@/components/products/cj/ExceptionQueueTable', () => ({
  default: () => <div>exception candidates table</div>,
}));

vi.mock('@/components/products/cj/QualifiedCandidatesTable', () => ({
  default: () => <div>qualified candidates table</div>,
}));

// eslint-disable-next-line import/first
import ProductSourcingPipelinePage from './page';

const SELLER_ACCOUNT = {
  id: 'seller-1',
  identityId: 'user-1',
  businessModel: 'DROPSHIPPER',
  verificationState: 'VERIFIED',
  accountState: 'ACTIVE',
  createdAt: new Date(),
  updatedAt: new Date(),
};

function searchParams(params: Record<string, string> = {}) {
  return Promise.resolve(params);
}

describe('ProductSourcingPipelinePage', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    isDatabaseConfiguredMock.mockReset().mockReturnValue(true);
    requireDropshipperAccountMock
      .mockReset()
      .mockResolvedValue({ sellerAccount: SELLER_ACCOUNT });
    countCandidateStatusSummaryMock.mockReset().mockResolvedValue({
      ready: 1,
      needsAttention: 2,
      evaluating: 3,
      blockedRejected: 4,
      exceptionQueue: 5,
    });
    countCandidatesByStatusMock.mockReset().mockResolvedValue(0);
    countDeadLetteredEvaluationsMock.mockReset().mockResolvedValue(0);
    countEvaluatingCandidatesMock.mockReset().mockResolvedValue(0);
    listCandidatesByStatusMock.mockReset().mockResolvedValue([]);
    listDeadLetteredEvaluationsMock.mockReset().mockResolvedValue([]);
    listEvaluatingCandidatesMock.mockReset().mockResolvedValue([]);
    findCataloguedCandidateIdsMock.mockReset().mockResolvedValue(new Set());
    oldestQueuedAgeMsMock.mockReset().mockResolvedValue(null);
  });

  it('reports the tab total in the header, not the rows on this page', async () => {
    countCandidateStatusSummaryMock.mockResolvedValue({
      ready: 0,
      needsAttention: 0,
      evaluating: 1_361,
      blockedRejected: 86_605,
      exceptionQueue: 0,
    });
    listCandidatesByStatusMock.mockResolvedValue([{ candidateId: 'c-1' }]);

    render(
      await ProductSourcingPipelinePage({
        searchParams: searchParams({ tab: 'blocked' }),
      }),
    );

    expect(screen.getByText('86,605 candidates')).toBeInTheDocument();
    expect(screen.getByTestId('pipeline-pagination')).toHaveTextContent(
      'page:1/867 total:86605 params:{"tab":"blocked"}',
    );
    expect(listCandidatesByStatusMock).toHaveBeenCalledWith(
      'seller-1',
      ['BLOCKED', 'TEMPORARILY_INELIGIBLE'],
      { limit: 100, offset: 0, search: '' },
    );
  });

  it('clamps a page past the end onto the last page that has rows', async () => {
    countCandidateStatusSummaryMock.mockResolvedValue({
      ready: 0,
      needsAttention: 0,
      evaluating: 0,
      blockedRejected: 250,
      exceptionQueue: 0,
    });
    listCandidatesByStatusMock.mockResolvedValue([{ candidateId: 'c-1' }]);

    render(
      await ProductSourcingPipelinePage({
        searchParams: searchParams({ tab: 'blocked', page: '9999' }),
      }),
    );

    expect(listCandidatesByStatusMock).toHaveBeenCalledWith(
      'seller-1',
      ['BLOCKED', 'TEMPORARILY_INELIGIBLE'],
      { limit: 100, offset: 200, search: '' },
    );
    expect(screen.getByTestId('pipeline-pagination')).toHaveTextContent(
      'page:3/3 total:250',
    );
  });

  it('hides pagination when the tab fits on one page', async () => {
    listCandidatesByStatusMock.mockResolvedValue([{ candidateId: 'c-1' }]);

    render(
      await ProductSourcingPipelinePage({
        searchParams: searchParams({ tab: 'blocked' }),
      }),
    );

    expect(screen.queryByTestId('pipeline-pagination')).not.toBeInTheDocument();
  });

  it('searches the whole tab in SQL and counts the matches, not the page', async () => {
    countCandidateStatusSummaryMock.mockResolvedValue({
      ready: 0,
      needsAttention: 0,
      evaluating: 0,
      blockedRejected: 86_605,
      exceptionQueue: 0,
    });
    countCandidatesByStatusMock.mockResolvedValue(3);
    listCandidatesByStatusMock.mockResolvedValue([{ candidateId: 'c-1' }]);

    render(
      await ProductSourcingPipelinePage({
        searchParams: searchParams({ tab: 'blocked', q: '  phone case  ' }),
      }),
    );

    // The fourth argument is the filter set, and `undefined` here is the
    // assertion that matters: Blocked is not one of the two tabs that accept
    // filters, so it must reach the query with no predicate rather than with
    // one the tab's own scope would ignore.
    expect(countCandidatesByStatusMock).toHaveBeenCalledWith(
      'seller-1',
      ['BLOCKED', 'TEMPORARILY_INELIGIBLE'],
      'phone case',
      undefined,
    );
    expect(listCandidatesByStatusMock).toHaveBeenCalledWith(
      'seller-1',
      ['BLOCKED', 'TEMPORARILY_INELIGIBLE'],
      { limit: 100, offset: 0, search: 'phone case', filters: undefined },
    );
    expect(
      screen.getByText('3 candidates matching "phone case"'),
    ).toBeInTheDocument();
    expect(screen.getByText('blocked candidates table')).toBeInTheDocument();
  });

  it('separates a search that matched nothing from a tab that holds nothing', async () => {
    countCandidateStatusSummaryMock.mockResolvedValue({
      ready: 0,
      needsAttention: 0,
      evaluating: 0,
      blockedRejected: 86_605,
      exceptionQueue: 0,
    });
    countCandidatesByStatusMock.mockResolvedValue(0);

    render(
      await ProductSourcingPipelinePage({
        searchParams: searchParams({ tab: 'blocked', q: 'nothing-matches' }),
      }),
    );

    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(
      screen.getByText(
        'No candidate in Blocked / Rejected matches "nothing-matches".',
      ),
    ).toBeInTheDocument();
  });

  it('pages the exception queue through its own dead-letter query', async () => {
    countCandidateStatusSummaryMock.mockResolvedValue({
      ready: 0,
      needsAttention: 0,
      evaluating: 0,
      blockedRejected: 0,
      exceptionQueue: 150,
    });
    listDeadLetteredEvaluationsMock.mockResolvedValue([{ candidateId: 'c-1' }]);

    render(
      await ProductSourcingPipelinePage({
        searchParams: searchParams({ tab: 'exception', page: '2' }),
      }),
    );

    expect(listDeadLetteredEvaluationsMock).toHaveBeenCalledWith('seller-1', {
      limit: 100,
      offset: 100,
      search: '',
    });
    expect(screen.getByTestId('pipeline-pagination')).toHaveTextContent(
      'page:2/2 total:150',
    );
  });

  it('renders an empty pipeline when the candidate list read fails', async () => {
    listCandidatesByStatusMock.mockRejectedValue(
      new Error('column "next_refresh_at" does not exist'),
    );

    render(
      await ProductSourcingPipelinePage({
        searchParams: searchParams({ tab: 'all' }),
      }),
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'Product Sourcing' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Nothing has been evaluated yet'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('pipeline-tabs')).toHaveTextContent(
      'counts:null',
    );
    // eslint-disable-next-line no-console
    expect(console.error).toHaveBeenCalledWith(
      '[portal] CJ pipeline lookup failed',
      'column "next_refresh_at" does not exist',
    );
  });

  it('renders zero-count tabs when the count read fails', async () => {
    countCandidateStatusSummaryMock.mockRejectedValue(
      new Error('database read failed'),
    );

    render(
      await ProductSourcingPipelinePage({
        searchParams: searchParams({ tab: 'ready' }),
      }),
    );

    expect(screen.getByTestId('pipeline-tabs')).toHaveTextContent(
      'counts:null',
    );
    expect(screen.getByText('No candidates are ready yet')).toBeInTheDocument();
    // eslint-disable-next-line no-console
    expect(console.error).toHaveBeenCalledWith(
      '[portal] CJ pipeline lookup failed',
      'database read failed',
    );
  });
});
