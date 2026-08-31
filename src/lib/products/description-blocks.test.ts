import { describe, expect, it } from 'vitest';
import { descriptionDocumentSchema } from '@/modules/catalog/products/description-document';
import {
  DESCRIPTION_DOCUMENT_VERSION,
  MAX_TABLE_CELL_LENGTH,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  blocksMatchSaved,
  imageRunAt,
  describeBlockProblem,
  descriptionBlocksToPlainText,
  emptyBlockOfType,
  firstBlockProblem,
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

  it('keeps an image block through a save projection, dropping a blank caption', () => {
    expect(
      prepareBlocksForSave([
        {
          type: 'image',
          url: 'https://cdn.example.com/a.webp',
          alt: '  Chest measured flat  ',
          caption: '   ',
        },
      ]),
    ).toEqual([
      {
        type: 'image',
        url: 'https://cdn.example.com/a.webp',
        alt: 'Chest measured flat',
      },
    ]);
  });

  it('drops an image block with no file but keeps one missing only alt text', () => {
    const prepared = prepareBlocksForSave([
      { type: 'image', url: '', alt: '' },
      { type: 'image', url: 'https://cdn.example.com/a.webp', alt: '' },
    ]);

    // The second survives so the seller is refused with a reason rather than
    // watching their upload disappear.
    expect(prepared).toEqual([
      { type: 'image', url: 'https://cdn.example.com/a.webp', alt: '' },
    ]);
  });

  it('requires alt text on an uploaded image', () => {
    expect(
      describeBlockProblem({
        type: 'image',
        url: 'https://cdn.example.com/a.webp',
        alt: '',
      }),
    ).toMatch(/Alt text is required/);
    expect(describeBlockProblem({ type: 'image', url: '', alt: '' })).toMatch(
      /Upload an image/,
    );
  });

  it('keeps image addresses out of the plain-text projection', () => {
    const text = descriptionBlocksToPlainText([
      { type: 'paragraph', text: 'Copy.' },
      { type: 'image', url: 'https://cdn.example.com/a.webp', alt: 'A hat' },
    ]);

    expect(text).toBe('Copy.');
  });

  it('reads image layout from adjacency, the way the storefront does', () => {
    const image = {
      type: 'image',
      url: 'https://cdn.example.com/a.webp',
      alt: 'x',
    } as const;
    const blocks: DescriptionBlock[] = [
      { type: 'paragraph', text: 'Intro.' },
      image,
      image,
      image,
      { type: 'paragraph', text: 'Outro.' },
      image,
    ];

    expect(imageRunAt(blocks, 0)).toBeNull();
    expect(imageRunAt(blocks, 1)).toEqual({ position: 1, length: 3 });
    expect(imageRunAt(blocks, 3)).toEqual({ position: 3, length: 3 });
    // The paragraph breaks the run, so the last image stands alone.
    expect(imageRunAt(blocks, 5)).toEqual({ position: 1, length: 1 });
  });

  it('accepts an image document at the server schema', () => {
    const parsed = descriptionDocumentSchema.safeParse({
      version: DESCRIPTION_DOCUMENT_VERSION,
      blocks: [
        {
          type: 'image',
          url: 'https://cdn.example.com/a.webp',
          alt: 'A hat',
          caption: 'Front view',
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it('refuses an image whose alt text is markup', () => {
    const parsed = descriptionDocumentSchema.safeParse({
      version: DESCRIPTION_DOCUMENT_VERSION,
      blocks: [
        {
          type: 'image',
          url: 'https://cdn.example.com/a.webp',
          alt: '<img onerror=x>',
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });
});

/**
 * The seam both editors save through, and the reason it has to know about runs.
 *
 * Trimming `text` while leaving `runs` untouched would break the document
 * schema's join invariant on any paragraph ending in a space — a save refused
 * for a reason no seller could see or act on.
 */
describe('prepareBlocksForSave paragraph emphasis', () => {
  it('trims the runs with the text so the two still join', () => {
    const [block] = prepareBlocksForSave([
      {
        type: 'paragraph',
        text: '  Soft cotton  ',
        runs: [{ text: '  Soft ' }, { text: 'cotton  ', marks: ['strong'] }],
      },
    ]);

    expect(block).toEqual({
      type: 'paragraph',
      text: 'Soft cotton',
      runs: [{ text: 'Soft ' }, { text: 'cotton', marks: ['strong'] }],
    });
  });

  it('produces a document the schema accepts', () => {
    const blocks = prepareBlocksForSave([
      {
        type: 'paragraph',
        text: 'Soft cotton ',
        runs: [{ text: 'Soft ' }, { text: 'cotton ', marks: ['em'] }],
      },
    ]);

    expect(
      descriptionDocumentSchema.safeParse({ version: 1, blocks }).success,
    ).toBe(true);
  });

  it('drops `runs` entirely when nothing is emphasised', () => {
    const [block] = prepareBlocksForSave([
      {
        type: 'paragraph',
        text: 'Soft cotton',
        runs: [{ text: 'Soft cotton' }],
      },
    ]);

    expect(block).toEqual({ type: 'paragraph', text: 'Soft cotton' });
  });

  it('leaves a paragraph that never had runs alone', () => {
    const [block] = prepareBlocksForSave([
      { type: 'paragraph', text: ' Soft cotton ' },
    ]);

    expect(block).toEqual({ type: 'paragraph', text: 'Soft cotton' });
  });

  it('drops a paragraph whose runs were nothing but whitespace', () => {
    expect(
      prepareBlocksForSave([
        { type: 'paragraph', text: '   ', runs: [{ text: '   ' }] },
      ]),
    ).toEqual([]);
  });
});

describe('firstBlockProblem', () => {
  it('names the image the server would refuse, and where it is', () => {
    const refused = firstBlockProblem([
      { type: 'paragraph', text: 'Copy.' },
      { type: 'image', url: 'https://cdn.example.com/a.webp', alt: '' },
    ]);

    expect(refused?.index).toBe(1);
    expect(refused?.problem).toMatch(/Alt text is required/);
  });

  /**
   * The bug this exists for: an image with a file and no alt text passed the
   * editor and failed `descriptionDocumentSchema`, which surfaced as
   * "Remove any pasted formatting" — the wrong cause and an impossible fix.
   */
  it('agrees with the document schema about what is storable', () => {
    const blocks: DescriptionBlock[] = [
      { type: 'image', url: 'https://cdn.example.com/a.webp', alt: '' },
    ];

    expect(firstBlockProblem(blocks)).not.toBeNull();
    expect(
      descriptionDocumentSchema.safeParse({
        version: DESCRIPTION_DOCUMENT_VERSION,
        blocks: prepareBlocksForSave(blocks),
      }).success,
    ).toBe(false);
  });

  it('ignores a block that is about to be dropped rather than stored', () => {
    // An image row with no file yet is an editing state. `prepareBlocksForSave`
    // removes it, so refusing the save on its account would block a seller for
    // a block that never reaches the server.
    const blocks: DescriptionBlock[] = [
      { type: 'paragraph', text: 'Copy.' },
      { type: 'image', url: '', alt: '' },
    ];

    expect(firstBlockProblem(blocks)).toBeNull();
    expect(
      descriptionDocumentSchema.safeParse({
        version: DESCRIPTION_DOCUMENT_VERSION,
        blocks: prepareBlocksForSave(blocks),
      }).success,
    ).toBe(true);
  });

  it('passes a complete document', () => {
    expect(firstBlockProblem(AUTHORED)).toBeNull();
  });
});

/**
 * The table is the one block whose *shape* is the content, so its tests are
 * about the shape rather than about the words: a row that lost a cell puts a
 * seller's numbers under the wrong headings, which is a defect a buyer acts on
 * rather than one they merely notice.
 */
describe('the table block', () => {
  const SIZE_CHART: DescriptionBlock = {
    type: 'table',
    caption: 'Measurements in centimetres',
    headers: ['Size', 'Waist', 'Hips'],
    rows: [
      ['M', '65', '100'],
      ['L', '69', ''],
    ],
  };

  it('survives a save projection with its blank cell intact', () => {
    // The blank `Hips` for L is content, not an omission: dropping it would
    // make the row narrower than the header row, and the schema — rightly —
    // refuses that.
    expect(prepareBlocksForSave([SIZE_CHART])).toEqual([SIZE_CHART]);
    expect(
      descriptionDocumentSchema.safeParse({
        version: DESCRIPTION_DOCUMENT_VERSION,
        blocks: prepareBlocksForSave([SIZE_CHART]),
      }).success,
    ).toBe(true);
  });

  it('trims cells and drops rows that are blank all the way across', () => {
    expect(
      prepareBlocksForSave([
        {
          type: 'table',
          caption: '  ',
          headers: ['  Size  ', 'Waist'],
          rows: [
            ['  M  ', ' 65 '],
            ['   ', '  '],
            ['L', ''],
          ],
        },
      ]),
    ).toEqual([
      {
        type: 'table',
        headers: ['Size', 'Waist'],
        // The all-blank row is gone; `L`'s blank waist is not, because that row
        // still says something and its width has to match the header row.
        rows: [
          ['M', '65'],
          ['L', ''],
        ],
      },
    ]);
  });

  it('treats named columns with no rows under them as an editing state', () => {
    const headersOnly: DescriptionBlock = {
      type: 'table',
      headers: ['Size', 'Waist'],
      rows: [['', '']],
    };

    expect(isBlockEmpty(headersOnly)).toBe(true);
    // Dropped rather than refused, so a seller who added a table and has not
    // filled it in yet can still save the rest of their description — and the
    // document never reaches the schema's `rows.min(1)` with an empty list.
    expect(firstBlockProblem([headersOnly])).toBeNull();
    expect(prepareBlocksForSave([headersOnly])).toEqual([]);
  });

  it('starts as a grid the seller can recognise as one', () => {
    const fresh = emptyBlockOfType('table');

    expect(fresh).toEqual({
      type: 'table',
      headers: ['', '', ''],
      rows: [
        ['', '', ''],
        ['', '', ''],
      ],
    });
    // Every row is the width of the header row from the moment it exists, so
    // the ragged shape is unreachable from an untouched block.
    expect(describeBlockProblem(fresh)).toBeNull();
  });

  it('refuses a row that does not have one cell per column', () => {
    const ragged: DescriptionBlock = {
      type: 'table',
      headers: ['Size', 'Waist', 'Hips'],
      rows: [['M', '65']],
    };

    expect(describeBlockProblem(ragged)).toMatch(/one cell for each column/);
    expect(
      descriptionDocumentSchema.safeParse({
        version: DESCRIPTION_DOCUMENT_VERSION,
        blocks: [ragged],
      }).success,
    ).toBe(false);
  });

  it('refuses more columns, more rows, or longer cells than it allows', () => {
    const row = (width: number) => Array.from({ length: width }, () => 'x');

    expect(
      describeBlockProblem({
        type: 'table',
        headers: row(MAX_TABLE_COLUMNS + 1),
        rows: [row(MAX_TABLE_COLUMNS + 1)],
      }),
    ).toMatch(new RegExp(`at most ${MAX_TABLE_COLUMNS} columns`));

    expect(
      describeBlockProblem({
        type: 'table',
        headers: ['Size'],
        rows: Array.from({ length: MAX_TABLE_ROWS + 1 }, () => ['x']),
      }),
    ).toMatch(new RegExp(`at most ${MAX_TABLE_ROWS} rows`));

    expect(
      describeBlockProblem({
        type: 'table',
        headers: ['Size'],
        rows: [['x'.repeat(MAX_TABLE_CELL_LENGTH + 1)]],
      }),
    ).toMatch(/belongs in a paragraph/);
  });

  it('is excluded from the plain-text projection, like an image', () => {
    /*
      The projection feeds `firstSentence()` in the meta-description
      suggestion seam. A table included there hands that function
      `Size · Waist · Hips` as the opening "sentence" of a description that
      opens with a chart and nothing else — copy no seller wrote, saveable
      verbatim as the live `<meta name="description">` because nothing
      downstream rejects a delimiter-heavy string. Excluding the table is
      what keeps a size chart from ever reaching that field, the same
      protection an image already has here.
    */
    expect(
      descriptionBlocksToPlainText([
        { type: 'paragraph', text: 'Real copy.' },
        SIZE_CHART,
      ]),
    ).toBe('Real copy.');
  });

  it('does not count as content-readiness text even though the block itself still counts', () => {
    // A chart-only description must not register as needing content: that
    // check reads `blocks.length`, not this text, so excluding the table from
    // the text is safe by construction rather than by coincidence.
    expect(descriptionBlocksToPlainText([SIZE_CHART])).toBe('');
    expect(isBlockEmpty(SIZE_CHART)).toBe(false);
  });
});
