import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type {
  SellerSoldRow,
  SellerSoldSummary,
} from '@/modules/orders/seller-sold-read';
import SoldSummaryBand from './SoldSummaryBand';

function row(over: Partial<SellerSoldRow> = {}): SellerSoldRow {
  return {
    productId: over.productId ?? '11111111-1111-4111-8111-111111111111',
    title: 'Knitted Tam Beanie',
    imageUrl: null,
    currency: 'USD',
    units: 142,
    deliveredUnits: 142,
    orders: 118,
    revenueMinor: 133338,
    reviewCount: 12,
    averageRating: 4.6,
    ...over,
  };
}

function summary(over: Partial<SellerSoldSummary> = {}): SellerSoldSummary {
  return {
    totalUnits: 449,
    distinctOrders: 356,
    productCount: 7,
    revenueByCurrency: [{ currency: 'USD', revenueMinor: 409530 }],
    refundedUnits: 0,
    ...over,
  };
}

describe('SoldSummaryBand', () => {
  it('draws each share bar to the width its own label prints', () => {
    const { container } = render(
      <SoldSummaryBand
        summary={summary()}
        rows={[row(), row({ productId: 'b', title: 'Face Mask', units: 96 })]}
      />,
    );

    const widths = Array.from(
      container.querySelectorAll<HTMLElement>('[style*="width"]'),
    ).map((node) => node.style.width);

    // 142/449 and 96/449. A bar scaled to the leading row instead would render
    // 100% here while the label beside it still said 31.6%.
    expect(widths).toContain('31.6%');
    expect(widths).toContain('21.4%');
    expect(screen.getByText('31.6%')).toBeInTheDocument();
    expect(screen.getByText('21.4%')).toBeInTheDocument();
  });

  it('folds everything past the fifth product into one row so the column reaches 100%', () => {
    const rows = [
      row({ productId: 'a', units: 142 }),
      row({ productId: 'b', units: 96 }),
      row({ productId: 'c', units: 73 }),
      row({ productId: 'd', units: 54 }),
      row({ productId: 'e', units: 38 }),
      row({ productId: 'f', units: 27 }),
      row({ productId: 'g', units: 19 }),
    ];

    render(<SoldSummaryBand summary={summary()} rows={rows} />);

    expect(screen.getByText('2 more products')).toBeInTheDocument();
    // 46 of 449.
    expect(screen.getByText('10.2%')).toBeInTheDocument();
  });

  it('refuses to name a best seller while the top two are tied', () => {
    render(
      <SoldSummaryBand
        summary={summary({ totalUnits: 4, productCount: 2 })}
        rows={[
          row({ productId: 'a', title: 'Alpha', units: 2 }),
          row({ productId: 'b', title: 'Beta', units: 2 }),
        ]}
      />,
    );

    expect(screen.getByText('2 products tied on 2 units')).toBeInTheDocument();
    expect(
      screen.getByText('Named once one is genuinely ahead.'),
    ).toBeInTheDocument();
    // The winner branch is the only thing that prints this, so its absence is
    // what proves no single product was crowned. `Alpha` itself still appears —
    // it is a legitimate row in the share chart above.
    expect(screen.queryByText(/of everything sold/)).not.toBeInTheDocument();
  });

  it('counts only the products that arrived and were never reviewed', () => {
    render(
      <SoldSummaryBand
        summary={summary({ totalUnits: 100 })}
        rows={[
          row({
            productId: 'a',
            units: 60,
            deliveredUnits: 60,
            reviewCount: 3,
            averageRating: 4,
          }),
          row({
            productId: 'b',
            units: 25,
            deliveredUnits: 25,
            reviewCount: 0,
            averageRating: null,
          }),
          row({
            productId: 'c',
            units: 15,
            deliveredUnits: 0,
            reviewCount: 0,
            averageRating: null,
          }),
        ]}
      />,
    );

    // Only b. c has sold 15 but nothing has arrived, so nobody can review it —
    // counting it would point the seller at work that cannot be done.
    expect(screen.getByText('Delivered, not reviewed')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(
      screen.getByText(/25 delivered units between them, no review yet/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/1 more product is sold but still in transit/),
    ).toBeInTheDocument();
  });

  it('says nobody can review anything while nothing has arrived', () => {
    render(
      <SoldSummaryBand
        summary={summary({ totalUnits: 5 })}
        rows={[
          row({
            productId: 'a',
            units: 5,
            deliveredUnits: 0,
            reviewCount: 0,
            averageRating: null,
          }),
        ]}
      />,
    );

    expect(
      screen.getByText(/Nothing has arrived yet, so nobody is able to review/),
    ).toBeInTheDocument();
  });

  it('shows the refunded line only when something was refunded', () => {
    const { rerender } = render(
      <SoldSummaryBand
        summary={summary({ refundedUnits: 0 })}
        rows={[row()]}
      />,
    );

    expect(screen.queryByText('Refunded, removed')).not.toBeInTheDocument();

    rerender(
      <SoldSummaryBand
        summary={summary({ refundedUnits: 6 })}
        rows={[row()]}
      />,
    );

    expect(screen.getByText('Refunded, removed')).toBeInTheDocument();
    expect(screen.getByText('6 units')).toBeInTheDocument();
  });

  it('says nothing has sold rather than printing a zero-width chart', () => {
    render(
      <SoldSummaryBand
        summary={summary({
          totalUnits: 0,
          distinctOrders: 0,
          productCount: 0,
          revenueByCurrency: [],
        })}
        rows={[]}
      />,
    );

    expect(screen.getByText('Nothing has sold yet.')).toBeInTheDocument();
    expect(screen.getByText('Named after the first sale.')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
