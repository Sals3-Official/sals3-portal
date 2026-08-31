import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SellerReviewRow } from '@/modules/reviews/seller-read';

const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock('@/app/(portal)/reviews/reply-actions', () => ({
  default: vi.fn(),
}));

/* eslint-disable import/first */
import replyToReviewAction from '@/app/(portal)/reviews/reply-actions';
import ReviewList from './ReviewList';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function review(overrides: Partial<SellerReviewRow> = {}): SellerReviewRow {
  return {
    id: 'review-1',
    rating: 5,
    deliveryRating: null,
    body: 'Fits exactly like the size chart said.',
    displayName: 'Hezekiah A.',
    createdAt: '2026-08-19T10:00:00.000Z',
    productId: 'product-1',
    productTitle: 'Storage box',
    variantLabel: null,
    imageUrl: null,
    photoCount: 0,
    orderNumber: 'S3-2026-1',
    reply: null,
    ...overrides,
  };
}

async function replyAs(text: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
  fireEvent.change(screen.getByLabelText('Your reply'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Post reply' }));

  // Waits for the dialog to actually close before the caller inspects the row
  // or hands down a new prop — the save runs inside an async transition, and
  // asserting or rerendering ahead of it is exactly the race this suite exists
  // to rule out.
  await waitFor(() =>
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
  );
}

beforeEach(() => {
  refresh.mockClear();
});

describe('ReviewList and its own reply', () => {
  /**
   * The defect this covers. Reported from production 2026-08-31: a seller
   * replied, the dialog closed, and the row still read "No reply yet" until a
   * manual page reload. `router.refresh()` asks Next to re-fetch this page's
   * server data, but nothing promises *when* that finishes, and the row a
   * seller looks back at is exactly the moment it has not.
   */
  it('shows the reply on its own row without waiting on a fresh prop', async () => {
    asMock(replyToReviewAction).mockResolvedValue({
      ok: true,
      replyVersion: 1,
    });

    render(<ReviewList reviews={[review()]} />);

    expect(screen.getByText('No reply yet')).toBeInTheDocument();

    await replyAs('Thanks for the kind words!');

    expect(screen.getByText(/thanks for the kind words/i)).toBeInTheDocument();
    // The pill flips the instant the reply shows — the two must never disagree.
    expect(screen.queryByText('No reply yet')).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  /**
   * Once the server catches up, its own answer wins — never held forever, and
   * never in a state that could disagree with what a second tab now shows.
   */
  it('drops the local reply once a fresh prop carries it at the same version', async () => {
    asMock(replyToReviewAction).mockResolvedValue({
      ok: true,
      replyVersion: 1,
    });

    const view = render(<ReviewList reviews={[review()]} />);

    await replyAs('Thanks!');

    view.rerender(
      <ReviewList
        reviews={[
          review({
            reply: {
              body: 'Thanks!',
              version: 1,
              createdAt: '2026-08-31T00:00:00.000Z',
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText('Thanks!')).toBeInTheDocument();
  });

  /**
   * A version the reply overlay does not yet know about — a second tab or
   * session replying first — must show through rather than being papered over
   * by the first tab's own local guess.
   */
  it('lets a newer server version override the local one', async () => {
    asMock(replyToReviewAction).mockResolvedValue({
      ok: true,
      replyVersion: 1,
    });

    const view = render(<ReviewList reviews={[review()]} />);

    await replyAs('Mine');

    view.rerender(
      <ReviewList
        reviews={[
          review({
            reply: {
              body: 'Someone else answered first',
              version: 2,
              createdAt: '2026-08-31T00:05:00.000Z',
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText('Someone else answered first')).toBeInTheDocument();
    expect(screen.queryByText('Mine')).toBeNull();
  });

  it('leaves the row alone on a refusal', async () => {
    asMock(replyToReviewAction).mockResolvedValue({
      ok: false,
      reason: 'invalid_input',
      message: 'That could not be read.',
    });

    render(<ReviewList reviews={[review()]} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    fireEvent.change(screen.getByLabelText('Your reply'), {
      target: { value: 'xx' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Post reply' }));

    await waitFor(() =>
      expect(screen.getByText('That could not be read.')).toBeInTheDocument(),
    );
    expect(screen.getByText('No reply yet')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
});
