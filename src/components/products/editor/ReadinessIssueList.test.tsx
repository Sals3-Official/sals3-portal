import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReadinessIssue } from '@/lib/seller-center/product-editor/types';
import ReadinessIssueList from './ReadinessIssueList';

function issue(
  overrides: Partial<ReadinessIssue> & { id: string },
): ReadinessIssue {
  return {
    severity: 'WARNING',
    title: 'Untitled issue',
    explanation: 'Explanation text.',
    affectedScope: 'Somewhere',
    source: 'AUTOMATED_VALIDATION',
    section: 'basic',
    reasonCode: null,
    resolution: 'Do something about it.',
    ...overrides,
  };
}

describe('ReadinessIssueList - zero-blocker state', () => {
  it('shows a compact positive line instead of an empty Hard Blockers group', () => {
    render(
      <ReadinessIssueList
        issues={[issue({ id: 'w1', severity: 'WARNING' })]}
        onGoToSection={vi.fn()}
      />,
    );

    expect(screen.getByText('No publication blockers')).toBeInTheDocument();
    expect(screen.queryByText('Hard blockers')).toBeNull();
    expect(screen.queryByText('Nothing prevents publication.')).toBeNull();
  });
});

describe('ReadinessIssueList - compact rail capping', () => {
  const manyIssues = Array.from({ length: 6 }, (_unused, index) =>
    issue({ id: `w${index}`, title: `Warning ${index}`, severity: 'WARNING' }),
  );

  it('caps rendered rows and offers View all issues for the rest', () => {
    render(
      <ReadinessIssueList
        issues={manyIssues}
        onGoToSection={vi.fn()}
        maxVisible={4}
        onViewAll={vi.fn()}
      />,
    );

    expect(screen.getByText('Warning 0')).toBeInTheDocument();
    expect(screen.getByText('Warning 3')).toBeInTheDocument();
    expect(screen.queryByText('Warning 4')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'View all issues (6)' }),
    ).toBeInTheDocument();
  });

  it('calls onViewAll when the overflow button is used', () => {
    const onViewAll = vi.fn();

    render(
      <ReadinessIssueList
        issues={manyIssues}
        onGoToSection={vi.fn()}
        maxVisible={4}
        onViewAll={onViewAll}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'View all issues (6)' }),
    );

    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it('renders every issue and no overflow button when uncapped', () => {
    render(<ReadinessIssueList issues={manyIssues} onGoToSection={vi.fn()} />);

    expect(screen.getByText('Warning 5')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /View all issues/ }),
    ).toBeNull();
  });
});

describe('ReadinessIssueList - progressive disclosure', () => {
  it('keeps full explanation and resolution collapsed until Details is opened', () => {
    render(
      <ReadinessIssueList
        issues={[
          issue({
            id: 'w1',
            title: 'Needs a closer look',
            explanation: 'The long explanation text.',
            resolution: 'Fix it this way.',
          }),
        ]}
        onGoToSection={vi.fn()}
      />,
    );

    expect(screen.getByText('Needs a closer look')).toBeInTheDocument();
    expect(screen.queryByText('The long explanation text.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByText('The long explanation text.')).toBeInTheDocument();
    expect(screen.getByText('Fix it this way.')).toBeInTheDocument();
  });

  it('calls onGoToSection with the issue section', () => {
    const onGoToSection = vi.fn();

    render(
      <ReadinessIssueList
        issues={[issue({ id: 'w1', section: 'media' })]}
        onGoToSection={onGoToSection}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Go to section' }));

    expect(onGoToSection).toHaveBeenCalledWith('media');
  });
});
