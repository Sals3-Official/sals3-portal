import { describe, expect, it } from 'vitest';
import {
  describeDescriptionImageSpec,
  descriptionImageSpec,
  imageRunLengthAt,
  type DescriptionBlock,
} from './description-blocks';

/**
 * The numbers a seller is told to upload at, and the rule that picks them.
 *
 * These exist because the storefront crops with `object-cover`: a photo of the
 * wrong ratio is not letterboxed, the difference is cut off, and nothing
 * afterwards tells the seller what they lost. So the spec has to be right, and
 * it has to match the adjacency the page will actually apply.
 */

const image: DescriptionBlock = { type: 'image', url: '', alt: '' };
const paragraph: DescriptionBlock = { type: 'paragraph', text: 'x' };

describe('descriptionImageSpec', () => {
  it('gives a lone image the 16:9 the page renders it at', () => {
    // `aspect-video` in DescriptionImageRow, at `sizes` 720px on desktop.
    expect(descriptionImageSpec(1)).toEqual({
      ratio: '16:9',
      width: 1440,
      height: 810,
      layout: 'Full width',
    });
  });

  it('gives a paired image the 4:3 the grid renders it at', () => {
    expect(descriptionImageSpec(2)).toEqual({
      ratio: '4:3',
      width: 960,
      height: 720,
      layout: 'Side by side',
    });
  });

  it('treats a row of three the same as a pair', () => {
    // The page's rule is "two or more", not "exactly two".
    expect(descriptionImageSpec(3)).toEqual(descriptionImageSpec(2));
  });

  it('recommends exactly twice the rendered width', () => {
    // Not a round number pulled from nowhere: 2x is what a high-density screen
    // asks `next/image` for, and `upload-seller-media.ts` caps the long edge at
    // 2000px so anything larger is downscaled on the way in.
    expect(descriptionImageSpec(1).width).toBe(720 * 2);
    expect(descriptionImageSpec(1).width).toBeLessThanOrEqual(2000);
    expect(descriptionImageSpec(2).width).toBeLessThanOrEqual(2000);
  });

  it('keeps both specs on their stated ratio', () => {
    const single = descriptionImageSpec(1);
    const paired = descriptionImageSpec(2);

    expect(single.width / single.height).toBeCloseTo(16 / 9, 3);
    expect(paired.width / paired.height).toBeCloseTo(4 / 3, 3);
  });

  it('renders one string so every surface says it identically', () => {
    expect(describeDescriptionImageSpec(1)).toBe('16:9 · 1440 × 810 px');
    expect(describeDescriptionImageSpec(2)).toBe('4:3 · 960 × 720 px');
  });
});

describe('imageRunLengthAt', () => {
  it('counts a lone image as one', () => {
    expect(imageRunLengthAt([paragraph, image, paragraph], 1)).toBe(1);
  });

  it('counts every image in the run, from any member of it', () => {
    const blocks = [paragraph, image, image, image, paragraph];

    // Asserted from all three positions: the canvas selects whichever one the
    // seller clicked, and the spec must not depend on which that was.
    expect(imageRunLengthAt(blocks, 1)).toBe(3);
    expect(imageRunLengthAt(blocks, 2)).toBe(3);
    expect(imageRunLengthAt(blocks, 3)).toBe(3);
  });

  it('stops at the block that breaks the run', () => {
    // The default layout's own shape: a lone photo, then a list, then a pair.
    const blocks = [image, paragraph, image, image];

    expect(imageRunLengthAt(blocks, 0)).toBe(1);
    expect(imageRunLengthAt(blocks, 2)).toBe(2);
  });

  it('answers one for a text block and for an index out of range', () => {
    expect(imageRunLengthAt([paragraph], 0)).toBe(1);
    expect(imageRunLengthAt([image], -1)).toBe(1);
    expect(imageRunLengthAt([image], 9)).toBe(1);
  });
});
