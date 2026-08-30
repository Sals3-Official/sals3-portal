import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ParcelLine } from '@/modules/orders/contracts';
import ParcelContentsCard from './ParcelContentsCard';

/**
 * This is the test that would have caught the defect.
 *
 * `ParcelLineThumbnail` having a test of its own proves the component works;
 * it does not prove this card *uses* it, and not using it was the bug. The
 * card carried `line.imageUrl` in its props the whole time and drew a grey
 * `aria-hidden` square instead, so every real order showed empty placeholders.
 */
const LINE: ParcelLine = {
  id: 'line-1',
  title: 'Outdoor Sports Cold-proof Face And Warm Mask',
  variation: 'Black',
  quantity: 1,
  unitPriceLabel: '$10.00',
  lineTotalLabel: '$10.00',
  imageUrl: 'https://cf.cjdropshipping.com/item/mask.jpg',
  acceptedOnLabel: 'as ordered on 24 Aug 2026',
  sku: 'S3V-ABAA8A8E7770',
  storefrontUrl: null,
  deliveryRangeLabel: null,
};

describe('ParcelContentsCard', () => {
  it('shows the photo of an ordered item', () => {
    render(
      <ParcelContentsCard
        lines={[LINE]}
        sellerNote={null}
        goodsTotalLabel="$10.00"
      />,
    );

    const image = screen.getByRole('img', { name: LINE.title });

    expect(image.getAttribute('src')).toContain('mask.jpg');
  });

  it('names the absence rather than drawing a blank square', () => {
    render(
      <ParcelContentsCard
        lines={[{ ...LINE, imageUrl: null }]}
        sellerNote={null}
        goodsTotalLabel="$10.00"
      />,
    );

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('No photo')).toBeTruthy();
  });
});

/**
 * The card exists to be reconciled. A seller who thinks a total looks wrong
 * needs to find the line that made it wrong, and before this the lines carried
 * a quantity and no money at all.
 */
describe('the money on each line', () => {
  it('shows each line total and the goods figure it foots to', () => {
    render(
      <ParcelContentsCard
        lines={[
          {
            ...LINE,
            id: 'line-1',
            quantity: 1,
            unitPriceLabel: '$47.43',
            lineTotalLabel: '$47.43',
          },
          {
            ...LINE,
            id: 'line-2',
            quantity: 2,
            unitPriceLabel: '$8.28',
            lineTotalLabel: '$16.56',
          },
        ]}
        sellerNote={null}
        goodsTotalLabel="$63.99"
      />,
    );

    expect(screen.getByText('$47.43')).toBeInTheDocument();
    expect(screen.getByText('$16.56')).toBeInTheDocument();
    expect(screen.getByText('$63.99')).toBeInTheDocument();
  });

  /** One of something needs no arithmetic spelled out; two does. */
  it('spells out unit x quantity only when more than one was ordered', () => {
    render(
      <ParcelContentsCard
        lines={[
          {
            ...LINE,
            id: 'single',
            quantity: 1,
            unitPriceLabel: '$47.43',
            lineTotalLabel: '$47.43',
          },
          {
            ...LINE,
            id: 'multiple',
            quantity: 3,
            unitPriceLabel: '$8.28',
            lineTotalLabel: '$24.84',
          },
        ]}
        sellerNote={null}
        goodsTotalLabel="$72.27"
      />,
    );

    expect(screen.getByText('×1')).toBeInTheDocument();
    expect(screen.getByText('$8.28 × 3')).toBeInTheDocument();
  });

  /**
   * The footer must not be summed from the lines it sits under. Both figures
   * come from `parcelPaidMinor`, so the card showing them side by side is a
   * check on the read model rather than on itself.
   */
  it('prints the goods figure it was handed, not a sum of the rows', () => {
    render(
      <ParcelContentsCard
        lines={[
          {
            ...LINE,
            id: 'only',
            quantity: 1,
            unitPriceLabel: '$10.00',
            lineTotalLabel: '$10.00',
          },
        ]}
        sellerNote={null}
        goodsTotalLabel="$999.00"
      />,
    );

    expect(screen.getByText('$999.00')).toBeInTheDocument();
  });
});
