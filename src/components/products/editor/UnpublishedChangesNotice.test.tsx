import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UnpublishedChangesNotice from './UnpublishedChangesNotice';

/**
 * The notice gained a `Discard draft` control on 2026-08-28, closing part 74's
 * open item: editing a published listing forks a draft, and until now nothing
 * could retire it, so an edit the seller thought better of was published by the
 * next `Publish Update`.
 *
 * These pin the two halves that are easy to get wrong — the control must not
 * appear where it cannot be honoured, and the notice must still render without
 * it, because the fixture/design-preview editor has no revision to discard.
 */

const DISCARD = /discard draft/i;

describe('UnpublishedChangesNotice', () => {
  it('renders nothing for a product that was never published', () => {
    const { container } = render(
      <UnpublishedChangesNotice
        isPublished={false}
        hasUnpublishedChanges
        onDiscard={vi.fn()}
      />,
    );

    // There is no published copy to differ from, so claiming a pending change
    // would be its own small untruth — and the discard would have nothing to
    // fall back to.
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when the draft matches what is published', () => {
    const { container } = render(
      <UnpublishedChangesNotice
        isPublished
        hasUnpublishedChanges={false}
        onDiscard={vi.fn()}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('states the gap and offers the way out of it', () => {
    const onDiscard = vi.fn();

    render(
      <UnpublishedChangesNotice
        isPublished
        hasUnpublishedChanges
        onDiscard={onDiscard}
      />,
    );

    expect(screen.getByText(/saved, but not live yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: DISCARD }));

    // The notice only opens the confirmation; the write belongs to the editor,
    // so this must not be the thing that discards.
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('omits the control entirely when no discard action was supplied', () => {
    render(<UnpublishedChangesNotice isPublished hasUnpublishedChanges />);

    // Absent rather than disabled: on a fixture screen there is nothing the
    // seller could do to make it work, and a control that always fails reads
    // as a broken product.
    expect(screen.getByText(/saved, but not live yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: DISCARD })).toBeNull();
  });

  it('disables the control while a discard is in flight', () => {
    render(
      <UnpublishedChangesNotice
        isPublished
        hasUnpublishedChanges
        onDiscard={vi.fn()}
        isDiscarding
      />,
    );

    expect(screen.getByRole('button', { name: /discarding/i })).toBeDisabled();
  });
});
