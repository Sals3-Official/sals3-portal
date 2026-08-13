import { describe, expect, it } from 'vitest';
import { emptyDescriptionDocument } from './description-document';
import {
  descriptionToText,
  isParagraphOnly,
  parseStoredDescription,
  textToDescription,
} from './editor-view';

const PARAGRAPH_DOC = {
  version: 1 as const,
  blocks: [
    { type: 'paragraph' as const, text: 'First paragraph.' },
    { type: 'paragraph' as const, text: 'Second paragraph.' },
  ],
};

describe('description round-trip', () => {
  it('maps paragraphs to blank-line text and back losslessly', () => {
    const text = descriptionToText(PARAGRAPH_DOC);

    expect(text).toBe('First paragraph.\n\nSecond paragraph.');
    expect(textToDescription(text)).toEqual(PARAGRAPH_DOC);
  });

  /** Clearing the description is a valid save, not an error. */
  it('maps whitespace-only text to the empty document', () => {
    expect(textToDescription('')).toEqual(emptyDescriptionDocument());
    expect(textToDescription('  \n\n   \n ')).toEqual(
      emptyDescriptionDocument(),
    );
  });

  it('collapses three or more blank lines into one paragraph break', () => {
    expect(textToDescription('a\n\n\n\nb').blocks).toHaveLength(2);
  });
});

describe('isParagraphOnly', () => {
  it('accepts paragraph documents and the empty document', () => {
    expect(isParagraphOnly(PARAGRAPH_DOC)).toBe(true);
    expect(isParagraphOnly(emptyDescriptionDocument())).toBe(true);
  });

  /**
   * A structured document must NOT be editable as text - flattening a heading
   * or list to paragraphs on save would silently destroy it.
   */
  it('rejects a document holding a non-paragraph block', () => {
    expect(
      isParagraphOnly({
        version: 1,
        blocks: [
          { type: 'heading', level: 2, text: 'Specs' },
          { type: 'paragraph', text: 'Body.' },
        ],
      }),
    ).toBe(false);
  });
});

describe('parseStoredDescription', () => {
  it('parses a valid stored document', () => {
    expect(parseStoredDescription(PARAGRAPH_DOC)).toEqual({
      document: PARAGRAPH_DOC,
      parseFailed: false,
    });
  });

  /** Schema drift degrades to read-only, never a render crash. */
  it('degrades garbage to the empty document with the flag set', () => {
    expect(parseStoredDescription({ nonsense: true })).toEqual({
      document: emptyDescriptionDocument(),
      parseFailed: true,
    });
    expect(parseStoredDescription(null)).toEqual({
      document: emptyDescriptionDocument(),
      parseFailed: true,
    });
  });
});
