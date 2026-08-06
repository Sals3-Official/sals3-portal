import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ShortlistDrawer from './ShortlistDrawer';

const SUCCESS = {
  ok: true as const,
  candidateId: '11111111-1111-4111-8111-111111111111',
  shortlistState: 'SHORTLISTED' as const,
  reused: false,
};

describe('ShortlistDrawer', () => {
  it('shows the stored candidate id and state for a shortlisted candidate', () => {
    render(
      <ShortlistDrawer
        productName="Widget"
        result={SUCCESS}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Widget')).toBeInTheDocument();
    expect(screen.getByText(SUCCESS.candidateId)).toBeInTheDocument();
    expect(screen.getByText('SHORTLISTED')).toBeInTheDocument();
  });

  it('always states that preflight has not run, so no score is implied', () => {
    render(
      <ShortlistDrawer
        productName="Widget"
        result={SUCCESS}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/full preflight has not run for this candidate/i),
    ).toBeInTheDocument();
  });

  it('distinguishes a reused candidate from a newly created one', () => {
    render(
      <ShortlistDrawer
        productName="Widget"
        result={{ ...SUCCESS, reused: true }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/already shortlisted earlier/i),
    ).toBeInTheDocument();
  });

  it('shows no candidate id when the shortlist failed', () => {
    render(
      <ShortlistDrawer
        productName="Widget"
        result={{ ok: false, reason: 'failed' }}
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Candidate ID')).not.toBeInTheDocument();
    expect(
      screen.getByText('Saving the candidate failed. Try again in a moment.'),
    ).toBeInTheDocument();
  });
});
