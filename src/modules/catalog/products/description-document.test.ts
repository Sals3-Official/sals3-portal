import { describe, expect, it } from 'vitest';

import {
  checksumOfDescriptionDocument,
  descriptionDocumentSchema,
  emptyDescriptionDocument,
} from './description-document';

/**
 * The description format is an allow list, so the interesting tests are the
 * rejections: anything the schema accepts is, by construction, something a
 * renderer can print as text. A regression here is a stored-XSS vector, not a
 * cosmetic validation gap.
 */

const doc = (blocks: unknown[]) => ({ version: 1, blocks });

describe('descriptionDocumentSchema', () => {
  it('accepts the four allow-listed block types', () => {
    const parsed = descriptionDocumentSchema.safeParse(
      doc([
        { type: 'paragraph', text: 'Soft cotton crew neck.' },
        { type: 'heading', level: 2, text: 'Materials' },
        { type: 'bulletList', items: ['100% cotton', 'Machine washable'] },
        {
          type: 'keyValueList',
          entries: [{ label: 'Fit', value: 'Regular' }],
        },
      ]),
    );

    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown block type rather than dropping it', () => {
    // Dropping silently would let a caller believe unsupported content was
    // saved. The block types are the allow list.
    expect(
      descriptionDocumentSchema.safeParse(
        doc([{ type: 'html', value: '<p>hi</p>' }]),
      ).success,
    ).toBe(false);
  });

  it('rejects markup-shaped text in every text-bearing position', () => {
    const payloads = [
      doc([{ type: 'paragraph', text: '<script>alert(1)</script>' }]),
      doc([{ type: 'heading', level: 2, text: '<img src=x onerror=1>' }]),
      doc([{ type: 'bulletList', items: ['fine', '</div>'] }]),
      doc([
        {
          type: 'keyValueList',
          entries: [{ label: '<!--', value: 'ok' }],
        },
      ]),
    ];

    payloads.forEach((payload) => {
      expect(descriptionDocumentSchema.safeParse(payload).success).toBe(false);
    });
  });

  it('still accepts a genuine less-than sign in prose', () => {
    // Rejecting every `<` would be an over-broad rule that breaks real copy
    // like measurements, so the pattern requires a tag-opening character.
    expect(
      descriptionDocumentSchema.safeParse(
        doc([{ type: 'paragraph', text: 'Fits waists < 80 cm.' }]),
      ).success,
    ).toBe(true);
  });

  it('rejects control characters that could break a downstream consumer', () => {
    expect(
      descriptionDocumentSchema.safeParse(
        doc([
          { type: 'paragraph', text: `null byte:${String.fromCharCode(0)}` },
        ]),
      ).success,
    ).toBe(false);
  });

  it('rejects empty and over-long text', () => {
    expect(
      descriptionDocumentSchema.safeParse(
        doc([{ type: 'paragraph', text: '   ' }]),
      ).success,
    ).toBe(false);
    expect(
      descriptionDocumentSchema.safeParse(
        doc([{ type: 'paragraph', text: 'x'.repeat(4_001) }]),
      ).success,
    ).toBe(false);
  });

  it('rejects a heading level outside the allowed sub-heading range', () => {
    // The product title owns the page's single h1.
    expect(
      descriptionDocumentSchema.safeParse(
        doc([{ type: 'heading', level: 1, text: 'Title' }]),
      ).success,
    ).toBe(false);
  });

  it('rejects an unversioned or future-versioned document', () => {
    expect(
      descriptionDocumentSchema.safeParse({ version: 2, blocks: [] }).success,
    ).toBe(false);
  });
});

describe('checksumOfDescriptionDocument', () => {
  it('is stable across key ordering, so a re-serialization is not a false edit', () => {
    const a = { version: 1 as const, blocks: [] };
    const b = { blocks: [], version: 1 as const };

    expect(checksumOfDescriptionDocument(a)).toBe(
      checksumOfDescriptionDocument(b),
    );
  });

  it('changes when content changes', () => {
    const before = emptyDescriptionDocument();
    const after = descriptionDocumentSchema.parse(
      doc([{ type: 'paragraph', text: 'Now with copy.' }]),
    );

    expect(checksumOfDescriptionDocument(before)).not.toBe(
      checksumOfDescriptionDocument(after),
    );
  });

  it('starts a supplier-sourced draft empty rather than with supplier HTML', () => {
    expect(emptyDescriptionDocument()).toEqual({ version: 1, blocks: [] });
  });
});

/**
 * Paragraph emphasis, and the one rule that makes it safe to store.
 *
 * `text` is canonical and `runs` only describes it. If the two could disagree,
 * a buyer's view would depend on whether their renderer understood marks — a
 * seller could review the styled paragraph and have different words reach every
 * consumer reading `text`, which today is the storefront, the meta-description
 * suggestion, and the readiness check.
 */
describe('descriptionDocumentSchema paragraph emphasis', () => {
  const paragraph = (runs: unknown, text = 'Soft cotton twill') =>
    descriptionDocumentSchema.safeParse(
      doc([{ type: 'paragraph', text, runs }]),
    );

  it('accepts runs that join to exactly the paragraph text', () => {
    expect(
      paragraph([
        { text: 'Soft ' },
        { text: 'cotton', marks: ['strong'] },
        { text: ' twill' },
      ]).success,
    ).toBe(true);
  });

  it('accepts a paragraph with no runs at all', () => {
    expect(
      descriptionDocumentSchema.safeParse(
        doc([{ type: 'paragraph', text: 'Soft cotton twill' }]),
      ).success,
    ).toBe(true);
  });

  it('rejects runs that do not join to the text', () => {
    expect(paragraph([{ text: 'Something else entirely' }]).success).toBe(
      false,
    );
  });

  it('rejects runs that only partly cover the text', () => {
    expect(paragraph([{ text: 'Soft ' }]).success).toBe(false);
  });

  it('rejects an empty runs list, so unstyled text has one spelling', () => {
    expect(paragraph([]).success).toBe(false);
  });

  it('rejects a mark outside the closed vocabulary', () => {
    expect(
      paragraph([{ text: 'Soft cotton twill', marks: ['blink'] }]).success,
    ).toBe(false);
  });

  it('rejects a repeated mark on one run', () => {
    expect(
      paragraph([{ text: 'Soft cotton twill', marks: ['strong', 'strong'] }])
        .success,
    ).toBe(false);
  });

  it('rejects markup inside a run, exactly as it does inside plain text', () => {
    expect(
      paragraph([{ text: '<b>Soft cotton twill' }], '<b>Soft cotton twill')
        .success,
    ).toBe(false);
  });

  it('rejects an empty run rather than silently dropping it', () => {
    expect(
      paragraph([{ text: '' }, { text: 'Soft cotton twill' }]).success,
    ).toBe(false);
  });

  it('allows a whitespace-only run — the gap between two marked words is content', () => {
    expect(
      paragraph([
        { text: 'Soft', marks: ['strong'] },
        { text: ' ' },
        { text: 'cotton twill', marks: ['em'] },
      ]).success,
    ).toBe(true);
  });

  it('gives an emphasised paragraph a different checksum, so it is a real revision', () => {
    const plain = descriptionDocumentSchema.parse(
      doc([{ type: 'paragraph', text: 'Soft cotton twill' }]),
    );
    const marked = descriptionDocumentSchema.parse(
      doc([
        {
          type: 'paragraph',
          text: 'Soft cotton twill',
          runs: [{ text: 'Soft cotton twill', marks: ['strong'] }],
        },
      ]),
    );

    expect(checksumOfDescriptionDocument(plain)).not.toBe(
      checksumOfDescriptionDocument(marked),
    );
  });
});

/**
 * The emphasis rules must be unable to reject anything already stored.
 *
 * `loadDescriptionBlocks` turns a failed parse into `null`, which is an absent
 * "About this product" section rather than an error — so a refinement that
 * could reject a pre-existing document would silently empty the description on
 * every published product at once. `runs` is a new field and no stored document
 * carries it, and these cases hold that line rather than leaving it to
 * inspection.
 */
describe('descriptionDocumentSchema backward compatibility', () => {
  it('accepts a document written before emphasis existed', () => {
    const legacy = doc([
      { type: 'paragraph', text: 'A packable 20L daypack.' },
      { type: 'heading', level: 2, text: 'Materials' },
      { type: 'bulletList', items: ['Recycled shell'] },
      { type: 'keyValueList', entries: [{ label: 'Fit', value: 'Regular' }] },
      {
        type: 'image',
        url: 'https://media.example.com/description-media/p/a.webp',
        alt: 'Rear panel',
      },
    ]);

    expect(descriptionDocumentSchema.safeParse(legacy).success).toBe(true);
  });

  it('leaves a legacy document byte-identical through a parse round trip', () => {
    // Nothing is defaulted, injected, or reordered on read: the checksum that
    // identifies the stored revision has to survive the new field's arrival.
    const legacy = doc([
      { type: 'paragraph', text: 'A packable 20L daypack.' },
    ]);
    const parsed = descriptionDocumentSchema.parse(legacy);

    expect(parsed).toEqual(legacy);
    expect(checksumOfDescriptionDocument(parsed)).toBe(
      checksumOfDescriptionDocument(
        descriptionDocumentSchema.parse(doc(legacy.blocks)),
      ),
    );
  });
});
