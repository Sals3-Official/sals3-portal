import {
  descriptionDocumentSchema,
  emptyDescriptionDocument,
  type DescriptionDocument,
} from './description-document';

/**
 * Pure adapters between the stored description document and the editor's
 * textarea. No database, no React - fully unit-testable.
 *
 * The editor edits PARAGRAPHS only: blank-line-separated text maps to
 * paragraph blocks and back, losslessly. A document that already contains a
 * non-paragraph block (heading, list - writable today only through the API or
 * tests) is NOT editable as text, because flattening it to paragraphs on the
 * next save would silently destroy structure. The caller renders it read-only
 * and, on a title-only save, sends the ORIGINAL document back verbatim.
 */

export function isParagraphOnly(document: DescriptionDocument): boolean {
  return document.blocks.every((block) => block.type === 'paragraph');
}

/** Paragraph blocks -> blank-line-separated text. Empty document -> ''. */
export function descriptionToText(document: DescriptionDocument): string {
  return document.blocks
    .filter((block) => block.type === 'paragraph')
    .map((block) => block.text)
    .join('\n\n');
}

/**
 * Blank-line-separated text -> paragraph blocks. Whitespace-only text is the
 * EMPTY document, which is valid - `blocks` has a max but no min - so clearing
 * the description is expressible, not an error.
 */
export function textToDescription(text: string): DescriptionDocument {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '');

  if (paragraphs.length === 0) return emptyDescriptionDocument();

  return {
    version: 1,
    blocks: paragraphs.map((paragraph) => ({
      type: 'paragraph' as const,
      text: paragraph,
    })),
  };
}

/**
 * The stored jsonb, parsed - never cast. An unparseable document (schema
 * drift, hand-edited row) degrades to the empty document plus a flag the
 * editor surfaces, instead of a render crash.
 */
export function parseStoredDescription(value: unknown): {
  document: DescriptionDocument;
  parseFailed: boolean;
} {
  const parsed = descriptionDocumentSchema.safeParse(value);

  if (!parsed.success) {
    return { document: emptyDescriptionDocument(), parseFailed: true };
  }

  return { document: parsed.data, parseFailed: false };
}
