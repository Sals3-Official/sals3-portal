import { describe, expect, it } from 'vitest';
import { descriptionDocumentSchema } from '@/modules/catalog/products/description-document';
import {
  DESCRIPTION_DOCUMENT_VERSION,
  blocksMatchSaved,
  describeBlockProblem,
  descriptionBlocksToPlainText,
  emptyBlockOfType,
  isBlockEmpty,
  prepareBlocksForSave,
  type DescriptionBlock,
} from './description-blocks';

const AUTHORED: DescriptionBlock[] = [
  { type: 'paragraph', text: 'A packable 20L daypack.' },
  { type: 'heading', level: 3, text: 'Key features' },
  { type: 'bulletList', items: ['Recycled shell', 'Padded sleeve'] },
  {
    type: 'keyValueList',
    entries: [{ label: 'Daypack', value: '1' }],
  },
];

describe('description blocks', () => {
  it('keeps every block type through a save projection', () => {
    expect(prepareBlocksForSave(AUTHORED)).toEqual(AUTHORED);
  });

  it('builds a document the server schema accepts', () => {
    const parsed = descriptionDocumentSchema.safeParse({
      version: DESCRIPTION_DOCUMENT_VERSION,
      blocks: prepareBlocksForSave(AUTHORED),
    });

    expect(parsed.success).toBe(true);
  });

  it('drops blocks and rows the seller left blank', () => {
    const prepared = prepareBlocksForSave([
      { type: 'paragraph', text: '  Real copy.  ' },
      { type: 'paragraph', text: '   ' },
      { type: 'heading', level: 2, text: '' },
      { type: 'bulletList', items: ['Kept', '', '  '] },
      {
        type: 'keyValueList',
        entries: [
          { label: 'Kept', value: '1' },
          { label: '', value: '' },
        ],
      },
    ]);

    expect(prepared).toEqual([
      { type: 'paragraph', text: 'Real copy.' },
      { type: 'bulletList', items: ['Kept'] },
      { type: 'keyValueList', entries: [{ label: 'Kept', value: '1' }] },
    ]);
  });

  it('produces a document the server schema accepts from a half-filled editor', () => {
    // Every "add block" button hands the editor an empty block. Saving one
    // verbatim would fail the schema's `min(1)` text rules.
    const halfFilled: DescriptionBlock[] = [
      { type: 'paragraph', text: 'Written.' },
      emptyBlockOfType('paragraph'),
      emptyBlockOfType('heading'),
      emptyBlockOfType('bulletList'),
      emptyBlockOfType('keyValueList'),
    ];

    const parsed = descriptionDocumentSchema.safeParse({
      version: DESCRIPTION_DOCUMENT_VERSION,
      blocks: prepareBlocksForSave(halfFilled),
    });

    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.blocks).toEqual([
      { type: 'paragraph', text: 'Written.' },
    ]);
  });

  it('flattens to text without claiming the projection is reversible', () => {
    expect(descriptionBlocksToPlainText(AUTHORED)).toBe(
      [
        'A packable 20L daypack.',
        '',
        'Key features',
        '',
        'Recycled shell\nPadded sleeve',
        '',
        'Daypack: 1',
      ].join('\n'),
    );
  });

  it('reports the refusals the server would make', () => {
    expect(
      describeBlockProblem({ type: 'paragraph', text: 'Wear <b>this</b>.' }),
    ).toMatch(/Markup is not allowed/);
    expect(
      describeBlockProblem({ type: 'paragraph', text: 'Fits if a < b.' }),
    ).toBeNull();
    expect(
      describeBlockProblem({
        type: 'heading',
        level: 2,
        text: 'x'.repeat(121),
      }),
    ).toMatch(/at most 120 characters/);
  });

  it('treats a block with only whitespace as empty', () => {
    expect(isBlockEmpty({ type: 'bulletList', items: ['', '  '] })).toBe(true);
    expect(isBlockEmpty({ type: 'bulletList', items: ['', 'x'] })).toBe(false);
  });

  it('ignores blank edits when deciding whether anything changed', () => {
    expect(
      blocksMatchSaved([...AUTHORED, emptyBlockOfType('paragraph')], AUTHORED),
    ).toBe(true);
    expect(
      blocksMatchSaved(
        [...AUTHORED, { type: 'paragraph', text: 'New.' }],
        AUTHORED,
      ),
    ).toBe(false);
  });
});
