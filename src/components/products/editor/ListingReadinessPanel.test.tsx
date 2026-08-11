import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resolveProductEditorFixture } from '@/lib/seller-center/mock-data/product-editor';
import type { ProductEditorFixture } from '@/lib/seller-center/product-editor/types';
import ListingReadinessPanel from './ListingReadinessPanel';

/** Same accessor `ProductEditor.test.tsx` uses - narrows the nullable read. */
function loadFixture(key: string): ProductEditorFixture {
  const resolved = resolveProductEditorFixture(key);

  if (resolved === null) throw new Error(`missing fixture ${key}`);

  return resolved;
}

const fixture = loadFixture('attention');

function renderPanel(compact = false) {
  const counts = fixture.issues.reduce(
    (accumulator, issue) => ({
      ...accumulator,
      [issue.severity]: (accumulator[issue.severity] ?? 0) + 1,
    }),
    {} as Record<string, number>,
  );

  return render(
    <ListingReadinessPanel
      fixture={fixture}
      blockerCount={counts.BLOCKER ?? 0}
      warningCount={counts.WARNING ?? 0}
      suggestionCount={counts.SUGGESTION ?? 0}
      onGoToSection={vi.fn()}
      onViewAll={vi.fn()}
      compact={compact}
    />,
  );
}

describe('ListingReadinessPanel - header composition', () => {
  it('renders the status, the completion percentage, and a progress bar', () => {
    renderPanel();

    expect(
      screen.getByText(`${fixture.completionPercent}% complete`),
    ).toBeInTheDocument();

    const progress = screen.getByRole('progressbar', {
      name: 'Listing completeness',
    });

    expect(progress).toHaveAttribute(
      'aria-valuenow',
      String(fixture.completionPercent),
    );
  });

  /**
   * The defect this panel was rebuilt to fix. Status and completion used to
   * live inside the "Issues & Tasks" panel, so switching tabs silently
   * removed the two facts telling the seller whether the draft could
   * publish - and left the tab strip stranded under the title as an empty
   * band. They are header content now, and must survive a tab change.
   */
  it('keeps status and progress visible after switching to Source Changes', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('tab', { name: /Source Changes/ }));

    expect(
      screen.getByText(`${fixture.completionPercent}% complete`),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('progressbar', { name: 'Listing completeness' }),
    ).toBeInTheDocument();
  });

  it('orders the header above the tab strip in the DOM', () => {
    const { container } = renderPanel();

    const progress = screen.getByRole('progressbar', {
      name: 'Listing completeness',
    });
    const tablist = screen.getByRole('tablist', { name: 'Listing readiness' });

    // The tablist comes after the progress bar. Reading order is the
    // accessible expression of the visual hierarchy the owner asked for:
    // title, state, progress, then tabs.
    expect(progress.compareDocumentPosition(tablist)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(container.querySelector('[data-slot="tabs-list"]')).toBe(tablist);
  });
});

describe('ListingReadinessPanel - tabs', () => {
  it('names both tabs with their counts and marks the issues tab selected', () => {
    renderPanel();

    const issuesTab = screen.getByRole('tab', { name: /Issues & Tasks/ });
    const changesTab = screen.getByRole('tab', { name: /Source Changes/ });

    // Ends with the count in parentheses. Asserted as a suffix rather than an
    // exact name because jsdom applies no stylesheet, so both the short and
    // the long label variant contribute to the name here.
    expect(issuesTab).toHaveAccessibleName(
      new RegExp(`\\(${fixture.issues.length}\\)$`),
    );
    expect(changesTab).toHaveAccessibleName(
      new RegExp(`\\(${fixture.sourceChanges.length}\\)$`),
    );
    expect(issuesTab).toHaveAttribute('aria-selected', 'true');
    expect(changesTab).toHaveAttribute('aria-selected', 'false');
  });

  /**
   * jsdom loads no stylesheet, so the container query cannot resolve here and
   * BOTH label variants are present in the DOM. This asserts the mechanism -
   * that each tab carries a short and a long label gated on panel width -
   * rather than which one is painted. Which one actually shows is a real
   * layout question, so it is asserted in the browser by
   * `e2e/product-editor.spec.ts`, not faked here.
   */
  it('carries a short and a long label per tab, gated on panel width', () => {
    renderPanel();

    const tablist = screen.getByRole('tablist', { name: 'Listing readiness' });

    // The rail is 272px and the primitive's triggers are `whitespace-nowrap`,
    // so a flex strip pushed "Source Changes (0)" past the panel edge. Two
    // equal grid columns cannot.
    expect(tablist).toHaveClass('grid', 'grid-cols-2', 'w-full');

    const pairs = [
      { short: 'Issues', long: 'Issues & Tasks' },
      { short: 'Changes', long: 'Source Changes' },
    ];

    screen.getAllByRole('tab').forEach((tab, index) => {
      expect(tab).toHaveClass('min-w-0');

      const { short, long } = pairs[index];

      // Short shows below the threshold, long at or above it. Exact-text
      // matchers so "Changes" cannot match inside "Source Changes".
      expect(within(tab).getByText(short, { exact: true })).toHaveClass(
        '@min-[19rem]:hidden',
      );
      expect(within(tab).getByText(long, { exact: true })).toHaveClass(
        'hidden',
        '@min-[19rem]:inline',
      );
    });
  });

  it('switches to the Source Changes panel on click', () => {
    renderPanel();

    fireEvent.click(screen.getByRole('tab', { name: /Source Changes/ }));

    expect(screen.getByRole('tab', { name: /Source Changes/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

describe('ListingReadinessPanel - issue summary', () => {
  it('renders a chip per severity, including a zero count', () => {
    renderPanel();

    const warnings = fixture.issues.filter(
      (issue) => issue.severity === 'WARNING',
    ).length;

    expect(screen.getByText('0 Blockers')).toBeInTheDocument();
    expect(
      screen.getByText(
        `${warnings} ${warnings === 1 ? 'Warning' : 'Warnings'}`,
      ),
    ).toBeInTheDocument();
  });

  it('keeps the last automated check as supporting metadata', () => {
    renderPanel();

    expect(screen.getByText(/Last automated check/)).toBeInTheDocument();
  });
});
