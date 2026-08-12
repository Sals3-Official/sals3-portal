import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CandidateAbsentSection from './CandidateAbsentSection';

const CAPTURED = new Date('2026-08-12T04:17:09.000Z');

describe('CandidateAbsentSection', () => {
  it('marks a never-fetched section as a note about our pipeline, with no timestamp', () => {
    render(
      <CandidateAbsentSection
        kind="not-fetched"
        message="No CJ detail evidence."
      />,
    );

    expect(screen.getByRole('note')).toBeInTheDocument();
    expect(screen.getByText('Not fetched from CJ yet')).toBeInTheDocument();
    expect(screen.queryByText(/CJ reported none/)).not.toBeInTheDocument();
    expect(screen.queryByText(/UTC/)).not.toBeInTheDocument();
  });

  it('marks a real zero observation with its capture time', () => {
    render(
      <CandidateAbsentSection
        kind="reported-zero"
        capturedAt={CAPTURED}
        message="No warehouse held stock."
      />,
    );

    expect(screen.getByText('CJ reported none')).toBeInTheDocument();
    expect(
      screen.getByText(/Observed 2026-08-12 04:17 UTC/),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Not fetched from CJ yet'),
    ).not.toBeInTheDocument();
  });

  /**
   * The contract that matters: the two states must be distinguishable by
   * structure, not only by wording, so no future restyle can collapse them into
   * each other. "Never fetched" carries `role="note"`; a real zero does not.
   */
  it('renders the two evidence absences with different roles', () => {
    const notFetched = render(
      <CandidateAbsentSection kind="not-fetched" message="Nothing fetched." />,
    );

    expect(notFetched.container.querySelector('[role="note"]')).not.toBeNull();

    const reportedZero = render(
      <CandidateAbsentSection
        kind="reported-zero"
        capturedAt={CAPTURED}
        message="None reported."
      />,
    );

    expect(reportedZero.container.querySelector('[role="note"]')).toBeNull();
  });

  it('renders a never-recorded absence as plain text, with no pill or note', () => {
    const { container } = render(
      <CandidateAbsentSection
        kind="never-recorded"
        message="No one has recorded a stock inspection."
      />,
    );

    expect(
      screen.getByText('No one has recorded a stock inspection.'),
    ).toBeInTheDocument();
    expect(container.querySelector('[role="note"]')).toBeNull();
    expect(screen.queryByText(/CJ reported none/)).not.toBeInTheDocument();
  });
});
