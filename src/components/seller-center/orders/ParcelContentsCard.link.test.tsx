import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ParcelLine } from '@/modules/orders/contracts';
import ParcelContentsCard from './ParcelContentsCard';

const LINE: ParcelLine = {
  id: 'line-1',
  title: 'Straight Color Matching Casual All-matching Pants',
  variation: 'Light Gray-L',
  quantity: 1,
  imageUrl: null,
  acceptedOnLabel: 'as ordered on 28 Aug 2026',
  sku: 'S3V-6B18FBBBA77D',
  storefrontUrl: null,
  deliveryRangeLabel: null,
};

describe('ParcelContentsCard product link', () => {
  it('opens the product page in a new tab, without handing it the opener', () => {
    render(
      <ParcelContentsCard
        lines={[
          { ...LINE, storefrontUrl: 'https://storefront.test/p/grey-pants' },
        ]}
        sellerNote={null}
      />,
    );

    const link = screen.getByRole('link', { name: LINE.title });

    expect(link.getAttribute('href')).toBe(
      'https://storefront.test/p/grey-pants',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    // `target="_blank"` without this hands the opened page a live
    // `window.opener` handle back into an authenticated portal session.
    expect(link.getAttribute('rel')).toContain('noopener');
  });

  /**
   * `storefrontUrl` is null for two honest reasons - the product is not live,
   * or this deployment has no storefront configured - and neither should
   * render a link that 404s.
   */
  it('renders plain text when there is no product page to open', () => {
    render(<ParcelContentsCard lines={[LINE]} sellerNote={null} />);

    expect(screen.queryByRole('link', { name: LINE.title })).toBeNull();
    expect(screen.getByText(LINE.title)).toBeTruthy();
  });
});
