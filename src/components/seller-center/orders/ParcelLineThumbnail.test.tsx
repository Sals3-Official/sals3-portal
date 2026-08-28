import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ParcelLineThumbnail from './ParcelLineThumbnail';

/**
 * The regression this exists for.
 *
 * Both order cards drew a grey `bg-muted` square and never rendered
 * `line.imageUrl`. The address was read from the database, carried through the
 * read model and into `ParcelLine`, and then dropped by the component — so a
 * seller opening a real order saw empty placeholders where the item photos
 * should be, with nothing in the data to blame.
 *
 * Asserting that an `img` reaches the document is the whole point: a test that
 * only checked the component rendered *something* would have passed against
 * the placeholder that caused this.
 */
describe('ParcelLineThumbnail', () => {
  it('renders the frozen photo when the line has one', () => {
    render(
      <ParcelLineThumbnail
        imageUrl="https://cf.cjdropshipping.com/item/beanie.jpg"
        title="Knitted Tam Beanie"
        size={56}
      />,
    );

    const image = screen.getByRole('img', { name: 'Knitted Tam Beanie' });

    expect(image).toBeTruthy();
    // `next/image` rewrites `src` through the portal's custom loader, so the
    // assertion is that the original address survives into it rather than that
    // `src` equals it exactly.
    expect(image.getAttribute('src')).toContain('beanie.jpg');
  });

  it('says there is no photo rather than showing an empty square', () => {
    render(
      <ParcelLineThumbnail imageUrl={null} title="Mystery Item" size={44} />,
    );

    expect(screen.queryByRole('img')).toBeNull();
    // "This line has no photo" is a fact a seller packing an order needs. The
    // old placeholder was `aria-hidden` and said nothing to anyone.
    expect(screen.getByText('No photo')).toBeTruthy();
  });
});
