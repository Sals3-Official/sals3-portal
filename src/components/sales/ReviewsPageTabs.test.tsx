import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ReviewsPageTabs from './ReviewsPageTabs';

describe('ReviewsPageTabs', () => {
  it('links each tab to its own URL so a view can be shared', () => {
    render(
      <ReviewsPageTabs active="reviews" reviewCount={19} soldUnits={449} />,
    );

    expect(screen.getByRole('link', { name: /Reviews/ })).toHaveAttribute(
      'href',
      '/reviews',
    );
    expect(screen.getByRole('link', { name: /Sold/ })).toHaveAttribute(
      'href',
      '/reviews?view=sold',
    );
  });

  it('marks only the open tab as current', () => {
    render(<ReviewsPageTabs active="sold" reviewCount={19} soldUnits={449} />);

    expect(screen.getByRole('link', { name: /Sold/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: /Reviews/ })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('renders no sold badge at all when the order tables are absent', () => {
    render(
      <ReviewsPageTabs active="reviews" reviewCount={19} soldUnits={null} />,
    );

    // A zero here would read as "nothing has sold", which is a different and
    // false claim from "this environment cannot count sales".
    expect(screen.getByRole('link', { name: 'Sold' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
