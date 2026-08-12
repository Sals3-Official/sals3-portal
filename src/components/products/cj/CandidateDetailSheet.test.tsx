import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => vi.fn());

vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

/* eslint-disable import/first */
import CandidateDetailSheet from './CandidateDetailSheet';
/* eslint-enable import/first */

const CLOSE_HREF = '/products/pipeline?tab=all&page=7';

function renderSheet() {
  return render(
    <CandidateDetailSheet
      closeHref={CLOSE_HREF}
      title="Blue mug"
      description="Ready"
    >
      <p>Panel body</p>
    </CandidateDetailSheet>,
  );
}

/**
 * By role alone, and named by its title. base-ui sets `aria-labelledby` to the
 * `SheetTitle`, which beats any `aria-label`, so the accessible name is always
 * the product name - not something the component can pin.
 */
function dialog() {
  return screen.getByRole('dialog', { name: 'Blue mug' });
}

describe('CandidateDetailSheet', () => {
  beforeEach(() => {
    push.mockClear();
  });

  it('is open on mount, titled by the product, and renders its children', () => {
    renderSheet();

    expect(dialog()).toBeInTheDocument();
    expect(screen.getByText('Panel body')).toBeInTheDocument();
  });

  it('closes by navigating to the close href', () => {
    renderSheet();

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    expect(push).toHaveBeenCalledWith(CLOSE_HREF, { scroll: false });
  });

  /**
   * A class assertion on purpose. The 85% width is the requirement most likely
   * to regress invisibly: if someone edits the `sheet` primitive's defaults, or
   * drops the `sm:max-w-none` override, the panel silently shrinks to 24rem
   * instead of failing anything. Both defaults must stay beaten.
   */
  it('beats both of the primitive width defaults', () => {
    renderSheet();

    const classes = dialog().className;

    expect(classes).toContain('md:data-[side=right]:w-[85vw]');
    expect(classes).toContain('md:data-[side=right]:max-w-[85vw]');
    expect(classes).toContain('data-[side=right]:sm:max-w-none');
    expect(classes).not.toContain('data-[side=right]:w-3/4');
    expect(classes).not.toContain('data-[side=right]:sm:max-w-sm');
  });
});
