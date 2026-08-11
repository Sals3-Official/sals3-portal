import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  countCandidateStatusSummaryMock,
  isDatabaseConfiguredMock,
  listCandidatesByStatusMock,
  listDeadLetteredEvaluationsMock,
  listEvaluatingCandidatesMock,
  oldestQueuedAgeMsMock,
  requireDropshipperAccountMock,
} = vi.hoisted(() => ({
  countCandidateStatusSummaryMock: vi.fn(),
  isDatabaseConfiguredMock: vi.fn(),
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

vi.mock('@/modules/catalog/candidates/queries', () => ({
  countCandidateStatusSummary: countCandidateStatusSummaryMock,
  listCandidatesByStatus: listCandidatesByStatusMock,
  listDeadLetteredEvaluations: listDeadLetteredEvaluationsMock,
  listEvaluatingCandidates: listEvaluatingCandidatesMock,
  oldestQueuedAgeMs: oldestQueuedAgeMsMock,
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
    listCandidatesByStatusMock.mockReset().mockResolvedValue([]);
    listDeadLetteredEvaluationsMock.mockReset().mockResolvedValue([]);
    listEvaluatingCandidatesMock.mockReset().mockResolvedValue([]);
    oldestQueuedAgeMsMock.mockReset().mockResolvedValue(null);
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
