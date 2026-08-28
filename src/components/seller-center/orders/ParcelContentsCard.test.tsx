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
  imageUrl: 'https://cf.cjdropshipping.com/item/mask.jpg',
  acceptedOnLabel: 'as ordered on 24 Aug 2026',
  sku: 'S3V-ABAA8A8E7770',
  storefrontUrl: null,
  deliveryRangeLabel: null,
};

describe('ParcelContentsCard', () => {
  it('shows the photo of an ordered item', () => {
    render(<ParcelContentsCard lines={[LINE]} sellerNote={null} />);

    const image = screen.getByRole('img', { name: LINE.title });

    expect(image.getAttribute('src')).toContain('mask.jpg');
  });

  it('names the absence rather than drawing a blank square', () => {
    render(
      <ParcelContentsCard
        lines={[{ ...LINE, imageUrl: null }]}
        sellerNote={null}
      />,
    );

    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('No photo')).toBeTruthy();
  });
});
