import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

/* eslint-disable import/first */
import { Table, TableBody, TableCell } from '@/components/ui/table';
import CandidateRow from './CandidateRow';
/* eslint-enable import/first */

const HREF = '/products/pipeline?tab=all&page=7&candidate=c-1';

function renderRow(extra?: React.ReactNode) {
  return render(
    <Table>
      <TableBody>
        <CandidateRow href={HREF} label="Open candidate detail for Blue mug">
          <TableCell>Blue mug</TableCell>
          <TableCell>{extra}</TableCell>
        </CandidateRow>
      </TableBody>
    </Table>,
  );
}

function row() {
  return screen.getByRole('button', {
    name: 'Open candidate detail for Blue mug',
  });
}

describe('CandidateRow', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('navigates to the drawer href without scrolling the list', () => {
    renderRow();

    fireEvent.click(row());

    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith(HREF, { scroll: false });
  });

  it('opens on Enter and Space, and ignores other keys', () => {
    renderRow();

    fireEvent.keyDown(row(), { key: 'Enter' });
    fireEvent.keyDown(row(), { key: ' ' });

    expect(push).toHaveBeenCalledTimes(2);

    fireEvent.keyDown(row(), { key: 'a' });
    fireEvent.keyDown(row(), { key: 'Tab' });

    expect(push).toHaveBeenCalledTimes(2);
  });

  /**
   * The regression that would otherwise ship. Every tab renders a control
   * inside its rows - "Recheck now" on Blocked, "Customize & List" on Ready -
   * and a bare row handler would hijack all of them.
   */
  it('does not open when a control inside the row is clicked', () => {
    renderRow(<button type="button">Recheck now</button>);

    fireEvent.click(screen.getByRole('button', { name: 'Recheck now' }));

    expect(push).not.toHaveBeenCalled();
  });

  it('does not open when a link inside the row is clicked', () => {
    renderRow(<a href="/somewhere">Source details</a>);

    fireEvent.click(screen.getByRole('link', { name: 'Source details' }));

    expect(push).not.toHaveBeenCalled();
  });

  /** Keyboard events bubbling up from a nested control must not open the row either. */
  it('ignores Enter raised inside a nested control', () => {
    renderRow(<button type="button">Recheck now</button>);

    fireEvent.keyDown(screen.getByRole('button', { name: 'Recheck now' }), {
      key: 'Enter',
    });

    expect(push).not.toHaveBeenCalled();
  });
});

describe('CandidateRow pending state', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('is not busy while idle', () => {
    renderRow();

    expect(row()).toHaveAttribute('aria-busy', 'false');
  });

  /**
   * The guard, not a nicety: without it a second click on an already-pending row
   * queues a second identical navigation.
   *
   * Honest limit of this test: with a `vi.fn()` router there is nothing to await,
   * so the transition commits before any assertion and `aria-busy="true"` is
   * never observable in jsdom. Do NOT make the component `async` to widen that
   * window - that would change production semantics to satisfy a test. The real
   * pending state is asserted in Playwright, where the navigation can be delayed.
   */
  it('pushes once per activation, never twice for one gesture', () => {
    renderRow();

    fireEvent.click(row());
    fireEvent.keyDown(row(), { key: 'Enter' });

    expect(push).toHaveBeenCalledTimes(2);
    expect(push).toHaveBeenNthCalledWith(1, HREF, { scroll: false });
  });
});

describe('CandidateRow with a selection checkbox inside', () => {
  beforeEach(() => {
    push.mockClear();
  });

  /**
   * The regression the checkbox column could introduce: base-ui's Checkbox
   * renders a `<button role="checkbox">`, and `fromNestedControl` must keep
   * treating it as a nested control - otherwise every selection click would
   * also open the detail drawer.
   */
  it('does not open the drawer when the row checkbox is clicked', () => {
    renderRow(
      <button type="button" role="checkbox" aria-checked="false">
        Select Blue mug
      </button>,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Blue mug' }));

    expect(push).not.toHaveBeenCalled();
  });

  it('tints the row when the candidate is already in the catalogue', () => {
    render(
      <Table>
        <TableBody>
          <CandidateRow
            href={HREF}
            label="Open candidate detail for Blue mug"
            inCatalogue
          >
            <TableCell>Blue mug</TableCell>
          </CandidateRow>
        </TableBody>
      </Table>,
    );

    const tintedRow = screen.getByRole('button', {
      name: 'Open candidate detail for Blue mug',
    });

    expect(tintedRow).toHaveAttribute('data-in-catalogue');
    expect(tintedRow.className).toContain(
      'data-in-catalogue:not-data-pending:bg-primary/5',
    );
  });
});

describe('CandidateRow with a DISABLED checkbox inside', () => {
  beforeEach(() => {
    push.mockClear();
  });

  /**
   * base-ui renders a disabled Checkbox as `<span role="checkbox">`, not a
   * `<button>` - so the guard must match on the role, or clicking a disabled
   * checkbox would open the drawer while the enabled one would not.
   */
  it('does not open the drawer when a disabled span-checkbox is clicked', () => {
    renderRow(
      <span role="checkbox" aria-checked="false" aria-disabled="true">
        Already in catalogue
      </span>,
    );

    fireEvent.click(screen.getByRole('checkbox'));

    expect(push).not.toHaveBeenCalled();
  });
});
