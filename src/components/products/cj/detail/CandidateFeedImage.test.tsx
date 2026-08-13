import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import CandidateFeedImage from './CandidateFeedImage';

const ADDRESS = 'https://cf.cjdropshipping.com/quick/product/a.jpg';

describe('CandidateFeedImage', () => {
  it('names the product and its provenance in the alt text', () => {
    render(
      <CandidateFeedImage
        address={ADDRESS}
        name="Blue mug"
        usableImageCount={3}
      />,
    );

    expect(
      screen.getByAltText('Supplier listing photo for Blue mug'),
    ).toBeInTheDocument();
  });

  /**
   * `sizes` must stay off, and this asserts the consequence rather than the
   * prop. With no `sizes`, Next's `getWidths` takes the `x` branch and emits
   * exactly two density candidates snapped to the configured sizes - 384 and
   * 640 for a 320px box. Add any `vw` token and it switches to the `w` branch,
   * whose SMALLEST candidate is 640w, so a 320px box would be filled with a
   * 640px image. Either regression - adding `sizes`, or changing the box width -
   * changes these descriptors and fails here.
   *
   * The widths are asserted, not the `x-oss-process` pipeline: vitest does not
   * load `next.config.ts`, so the default loader runs here and the custom CJ
   * loader's output only appears in a real build.
   */
  it('emits exactly two density candidates, not viewport-relative widths', () => {
    render(
      <CandidateFeedImage
        address={ADDRESS}
        name="Blue mug"
        usableImageCount={null}
      />,
    );

    const image = screen.getByAltText('Supplier listing photo for Blue mug');
    const srcset = image.getAttribute('srcset') ?? '';

    expect(image).not.toHaveAttribute('sizes');
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(srcset).toContain('w=384');
    expect(srcset).toContain('1x');
    expect(srcset).toContain('w=640');
    expect(srcset).toContain('2x');
    // The `w` branch would emit `w`-descriptor candidates instead of `1x`/`2x`.
    expect(srcset).not.toMatch(/\d+w(,|$)/);
  });

  it('says an absent address is a capture gap, not a missing photo', () => {
    render(
      <CandidateFeedImage
        address={null}
        name="Blue mug"
        usableImageCount={0}
      />,
    );

    expect(screen.getByText('No image address captured')).toBeInTheDocument();
    expect(
      screen.getByText(/does not mean the product has no photo/),
    ).toBeInTheDocument();
    expect(screen.queryByAltText(/Supplier listing photo/)).toBeNull();
  });

  /**
   * The contradiction this exists to remove: evidence counting usable images
   * while no address was stored. Without the clause the drawer shows "3 usable
   * images" beside an empty box and leaves a reviewer to guess.
   */
  it('names the counted-but-unstored contradiction when evidence saw images', () => {
    render(
      <CandidateFeedImage
        address={null}
        name="Blue mug"
        usableImageCount={3}
      />,
    );

    expect(screen.getByText(/counted 3 usable images/)).toBeInTheDocument();
  });

  it('stays silent about the count when evidence never saw any', () => {
    render(
      <CandidateFeedImage
        address={null}
        name="Blue mug"
        usableImageCount={0}
      />,
    );

    expect(screen.queryByText(/usable image/)).toBeNull();
  });
});
