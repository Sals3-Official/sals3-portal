import { describe, expect, it } from 'vitest';
import { descriptionDocumentSchema } from '@/modules/catalog/products/description-document';
import type { DescriptionBlock } from './description-blocks';
import {
  blocksToSimpleText,
  canUseSimpleMode,
  describeSimpleModeLoss,
  descriptionTextToBlocks,
  flattenToSimpleMode,
  imagesOf,
  initialDescriptionMode,
  publishableBlocks,
  simpleDescriptionToBlocks,
} from './simple-description';

type ImageBlock = Extract<DescriptionBlock, { type: 'image' }>;

const image = (name: string): ImageBlock => ({
  type: 'image',
  url: `https://media.example.com/description-media/p/${name}.webp`,
  alt: name,
});

describe('descriptionTextToBlocks', () => {
  it('splits on blank lines, not on every newline', () => {
    // How sellers actually write in a plain box: a heading line, then one line
    // per feature. Collapsing those into prose would rewrite their copy.
    expect(
      descriptionTextToBlocks(
        'Features:\nBreathable\nSix pockets\n\nCare:\nCold wash',
      ),
    ).toEqual([
      { type: 'paragraph', text: 'Features:\nBreathable\nSix pockets' },
      { type: 'paragraph', text: 'Care:\nCold wash' },
    ]);
  });

  it('drops blank paragraphs rather than storing empty blocks', () => {
    expect(descriptionTextToBlocks('One.\n\n\n\n   \n\nTwo.')).toEqual([
      { type: 'paragraph', text: 'One.' },
      { type: 'paragraph', text: 'Two.' },
    ]);
  });

  it('produces a document the server schema accepts', () => {
    const blocks = descriptionTextToBlocks('Soft cotton twill.\n\nCold wash.');

    expect(
      descriptionDocumentSchema.safeParse({ version: 1, blocks }).success,
    ).toBe(true);
  });
});

describe('the simple-text round trip', () => {
  it('returns the same text it was given', () => {
    const text =
      'Upgrade your daily wear.\n\nFeatures:\nSix pockets\nCotton twill';

    expect(blocksToSimpleText(descriptionTextToBlocks(text))).toBe(text);
  });

  it('keeps images out of the text but still in the document', () => {
    const blocks = simpleDescriptionToBlocks('Soft cotton.', [
      image('a'),
      image('b'),
    ]);

    expect(blocksToSimpleText(blocks)).toBe('Soft cotton.');
    expect(imagesOf(blocks)).toHaveLength(2);
  });

  it('always puts images after the text', () => {
    const blocks = simpleDescriptionToBlocks('One.\n\nTwo.', [image('a')]);

    expect(blocks.map((block) => block.type)).toEqual([
      'paragraph',
      'paragraph',
      'image',
    ]);
  });
});

describe('canUseSimpleMode', () => {
  it('accepts plain paragraphs alongside retained photos', () => {
    expect(
      canUseSimpleMode([
        { type: 'paragraph', text: 'One.' },
        image('a'),
        image('b'),
      ]),
    ).toBe(true);
  });

  it('accepts an empty document, so a new product starts simple', () => {
    expect(canUseSimpleMode([])).toBe(true);
    expect(initialDescriptionMode([])).toBe('simple');
  });

  it('refuses a heading, a bullet list, and a detail list', () => {
    expect(canUseSimpleMode([{ type: 'heading', level: 2, text: 'Fit' }])).toBe(
      false,
    );
    expect(canUseSimpleMode([{ type: 'bulletList', items: ['Cotton'] }])).toBe(
      false,
    );
    expect(
      canUseSimpleMode([
        { type: 'keyValueList', entries: [{ label: 'Fit', value: 'Regular' }] },
      ]),
    ).toBe(false);
  });

  it('refuses emphasis, because losing a seller’s bold silently is the same defect as losing a heading', () => {
    expect(
      canUseSimpleMode([
        {
          type: 'paragraph',
          text: 'Soft cotton',
          runs: [{ text: 'Soft cotton', marks: ['strong'] }],
        },
      ]),
    ).toBe(false);
  });

  it('accepts a photo anywhere, because switching keeps it', () => {
    // Photos are retained across a switch and restored on switching back, so
    // there is nothing for the seller to agree to.
    expect(
      canUseSimpleMode([
        { type: 'paragraph', text: 'One.' },
        image('a'),
        { type: 'paragraph', text: 'Two.' },
      ]),
    ).toBe(true);
  });
});

describe('describeSimpleModeLoss', () => {
  it('says nothing when nothing would change', () => {
    expect(
      describeSimpleModeLoss([{ type: 'paragraph', text: 'One.' }, image('a')]),
    ).toBeNull();
  });

  it('names each kind of structure, with counts', () => {
    const message = describeSimpleModeLoss([
      { type: 'heading', level: 2, text: 'Fit' },
      { type: 'heading', level: 3, text: 'Sizing' },
      { type: 'bulletList', items: ['Cotton'] },
    ]);

    expect(message).toContain('2 headings');
    expect(message).toContain('1 bullet list');
  });

  it('names emphasis and promises the photos are safe', () => {
    const message = describeSimpleModeLoss([
      { type: 'heading', level: 2, text: 'Fit' },
      {
        type: 'paragraph',
        text: 'Soft',
        runs: [{ text: 'Soft', marks: ['em'] }],
      },
      image('a'),
    ]);

    expect(message).toContain('bold or italic in 1 paragraph');
    // The photo is not a loss and must not be listed as one.
    expect(message).not.toContain('photo');
    expect(message).toContain('Photos are not affected');
  });
});

describe('flattenToSimpleMode', () => {
  const rich: DescriptionBlock[] = [
    { type: 'heading', level: 2, text: 'Fit and sizing' },
    {
      type: 'paragraph',
      text: 'Runs one size small.',
      runs: [{ text: 'Runs one size small.', marks: ['strong'] }],
    },
    { type: 'bulletList', items: ['Six pockets', 'Cotton twill'] },
    {
      type: 'keyValueList',
      entries: [{ label: 'Care', value: 'Cold wash' }],
    },
    image('detail'),
  ];

  it('keeps every word', () => {
    const text = blocksToSimpleText(flattenToSimpleMode(rich));

    [
      'Fit and sizing',
      'Runs one size small.',
      'Six pockets',
      'Cotton twill',
      'Care: Cold wash',
    ].forEach((word) => expect(text).toContain(word));
  });

  it('carries the photo through untouched — the seller keeps their upload', () => {
    const flattened = flattenToSimpleMode(rich);

    expect(imagesOf(flattened)).toHaveLength(1);
    expect(imagesOf(flattened)[0]).toEqual(image('detail'));
  });

  it('drops the emphasis it warned about', () => {
    const flattened = flattenToSimpleMode(rich);

    expect(
      flattened.every(
        (block) => block.type !== 'paragraph' || block.runs === undefined,
      ),
    ).toBe(true);
  });

  it('produces a document simple mode can then hold, and the server accepts', () => {
    const flattened = flattenToSimpleMode(rich);

    expect(canUseSimpleMode(flattened)).toBe(true);
    expect(
      descriptionDocumentSchema.safeParse({ version: 1, blocks: flattened })
        .success,
    ).toBe(true);
  });

  it('is idempotent — flattening twice changes nothing further', () => {
    const once = flattenToSimpleMode(rich);

    expect(flattenToSimpleMode(once)).toEqual(once);
  });
});

describe('publishableBlocks', () => {
  const withPhoto = [
    { type: 'paragraph' as const, text: 'Soft cotton twill.' },
    image('detail'),
  ];

  it('publishes only the paragraphs in simple mode', () => {
    expect(publishableBlocks(withPhoto, 'simple')).toEqual([
      { type: 'paragraph', text: 'Soft cotton twill.' },
    ]);
  });

  it('publishes everything in the designed layout', () => {
    expect(publishableBlocks(withPhoto, 'design')).toEqual(withPhoto);
  });

  it('never mutates the document it was given', () => {
    const before = structuredClone(withPhoto);

    publishableBlocks(withPhoto, 'simple');

    expect(withPhoto).toEqual(before);
  });
});

describe('initialDescriptionMode', () => {
  const withPhoto = [
    { type: 'paragraph' as const, text: 'Soft cotton twill.' },
    image('detail'),
  ];

  it('trusts the stored mode over the content', () => {
    // The whole reason the field exists: a simple document holding a retained
    // photo is indistinguishable from a designed one by content alone.
    expect(initialDescriptionMode(withPhoto, 'simple')).toBe('simple');
    expect(initialDescriptionMode(withPhoto, 'design')).toBe('design');
  });

  it('infers designed for a legacy document holding a photo', () => {
    // Written before the field existed, so its photo was published. Opening it
    // designed is where that photo is visible, and nothing it publishes changes.
    expect(initialDescriptionMode(withPhoto)).toBe('design');
  });

  it('infers simple for a legacy text-only document', () => {
    expect(
      initialDescriptionMode([{ type: 'paragraph', text: 'Soft cotton.' }]),
    ).toBe('simple');
  });
});
