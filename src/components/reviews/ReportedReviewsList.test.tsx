import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReportedReview } from '@/modules/reviews/moderation';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('@/app/(portal)/reviews/reported/moderation-actions', () => ({
  default: vi.fn(),
}));

/* eslint-disable import/first */
import moderateReviewAction from '@/app/(portal)/reviews/reported/moderation-actions';
import ReportedReviewsList from './ReportedReviewsList';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function reported(overrides: Partial<ReportedReview> = {}): ReportedReview {
  return {
    reviewId: 'review-1',
    rating: 2,
    deliveryRating: null,
    body: 'arrived cracked, the lid does not sit flat',
    displayName: null,
    createdAt: '2026-08-30T00:00:00.000Z',
    productId: 'product-1',
    productTitle: 'Tea caddy',
    photoCount: 0,
    reportCount: 2,
    reasons: [{ reason: 'OFF_TOPIC', count: 2 }],
    firstReportedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  refresh.mockClear();
});

describe('ReportedReviewsList and its own decision', () => {
  /**
   * The mirror-image of the reply defect reported from production on
   * 2026-08-31: a moderator's own click already told this screen the decision
   * landed, and waiting on a second, separate server read to say the same
   * thing again is what left a seller's reply sitting unreflected until a
   * manual reload.
   */
  it('removes a hidden review from its own screen without waiting on a fresh prop', async () => {
    asMock(moderateReviewAction).mockResolvedValue({
      ok: true,
      decision: 'hide',
      reportsClosed: 2,
    });

    render(<ReportedReviewsList rows={[reported()]} photos={[[]]} />);

    expect(screen.getByText('Tea caddy')).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: /hide from storefront/i }),
    );
    fireEvent.click(
      screen.getByRole('button', { name: /press again to hide/i }),
    );

    await waitFor(() =>
      expect(screen.queryByText('Tea caddy')).not.toBeInTheDocument(),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it('removes a kept review the same way, with one press', async () => {
    asMock(moderateReviewAction).mockResolvedValue({
      ok: true,
      decision: 'keep',
      reportsClosed: 1,
    });

    render(<ReportedReviewsList rows={[reported()]} photos={[[]]} />);

    fireEvent.click(screen.getByRole('button', { name: /keep published/i }));

    await waitFor(() =>
      expect(screen.queryByText('Tea caddy')).not.toBeInTheDocument(),
    );
  });

  /**
   * Once a fresh read genuinely omits the id, the local hide is redundant and
   * is dropped — the local state must never be the only reason a decided
   * review stays gone.
   */
  it('reconciles once the id is genuinely absent from a fresh prop', async () => {
    asMock(moderateReviewAction).mockResolvedValue({
      ok: true,
      decision: 'hide',
      reportsClosed: 1,
    });

    const view = render(
      <ReportedReviewsList
        rows={[reported(), reported({ reviewId: 'review-2' })]}
        photos={[[], []]}
      />,
    );

    fireEvent.click(
      screen.getAllByRole('button', { name: /hide from storefront/i })[0]!,
    );
    fireEvent.click(
      screen.getAllByRole('button', { name: /press again to hide/i })[0]!,
    );

    await waitFor(() =>
      expect(screen.getAllByText('Tea caddy')).toHaveLength(1),
    );

    view.rerender(
      <ReportedReviewsList
        rows={[reported({ reviewId: 'review-2' })]}
        photos={[[]]}
      />,
    );

    expect(screen.getAllByText('Tea caddy')).toHaveLength(1);
  });

  it('leaves the review in place on a refusal', async () => {
    asMock(moderateReviewAction).mockResolvedValue({
      ok: false,
      reason: 'failed',
      message: 'The decision could not be saved.',
    });

    render(<ReportedReviewsList rows={[reported()]} photos={[[]]} />);

    fireEvent.click(screen.getByRole('button', { name: /keep published/i }));

    await waitFor(() =>
      expect(
        screen.getByText('The decision could not be saved.'),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText('Tea caddy')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
