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
