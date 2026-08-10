import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReadinessIssue } from '@/lib/seller-center/product-editor/types';
import EditorSectionNavigation from './EditorSectionNavigation';

const ISSUES: ReadinessIssue[] = [
  {
    id: 'b1',
    severity: 'BLOCKER',
    title: 'Blocked thing',
    explanation: 'x',
    affectedScope: 'x',
    source: 'AUTOMATED_VALIDATION',
    section: 'variants',
    reasonCode: null,
    resolution: 'x',
  },
];

/**
 * Two presentations of the same seven sections live in the DOM at once -
 * a wrapped button row for wide layouts and a native `Jump to section`
 * select for narrow ones - switched by a container query rather than by
 * mounting/unmounting. These tests exercise both without asserting on
 * which one is visually shown, since jsdom does not evaluate Tailwind's
 * compiled CSS.
 */
describe('EditorSectionNavigation', () => {
  it('offers a labelled Jump to section control for narrow layouts', () => {
    render(
      <EditorSectionNavigation
        issues={ISSUES}
        activeSection="basic"
        onGoToSection={vi.fn()}
      />,
    );

    const select = screen.getByLabelText('Jump to section');

    expect(select).toHaveValue('basic');
    expect(
      screen.getByRole('option', { name: 'Variants & Pricing — Blocker' }),
    ).toBeInTheDocument();
  });

  it('navigates when a section is chosen from the jump control', () => {
    const onGoToSection = vi.fn();

    render(
      <EditorSectionNavigation
        issues={ISSUES}
        activeSection="basic"
        onGoToSection={onGoToSection}
      />,
    );

    fireEvent.change(screen.getByLabelText('Jump to section'), {
      target: { value: 'variants' },
    });

    expect(onGoToSection).toHaveBeenCalledWith('variants');
  });

  it('flags the blocked section in the wide button row too', () => {
    render(
      <EditorSectionNavigation
        issues={ISSUES}
        activeSection="basic"
        onGoToSection={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: /Variants & Pricing/ }),
    ).toBeInTheDocument();
    // The badge is an icon plus a count, not the word "Blocker" repeated -
    // its accessible name is what a screen reader announces instead.
    expect(screen.getByLabelText('1 blocker issue')).toBeInTheDocument();
  });

  it('has no raw overflow scrollbar container', () => {
    const { container } = render(
      <EditorSectionNavigation
        issues={ISSUES}
        activeSection="basic"
        onGoToSection={vi.fn()}
      />,
    );

    expect(container.querySelector('.overflow-x-auto')).toBeNull();
  });
});
