/**
 * The description block union, shared by the server document schema and the
 * seller-facing editor.
 *
 * `src/modules/catalog/products/description-document.ts` owns validation: it
 * is the server boundary, it is where the zod schema and the revision
 * checksum live, and it imports `node:crypto`. That makes it unreachable from
 * a client component, so the types and limits the editor needs to build a
 * valid document live here instead, in a module with no runtime dependency at
 * all. The document schema is built from these same types, so a block shape
 * the editor can produce and the server refuses is a compile error rather
 * than a runtime save failure.
 *
 * There is deliberately no `html` block and no free-form string passthrough.
 * This is an allow list, not a sanitiser — see the document module's own
 * header for why that distinction is load-bearing. Paragraph emphasis is the
 * one thing that looks like markup and is not: `./inline-runs` carries it as
 * a closed mark vocabulary the renderer turns into elements, never a string a
 * renderer has to parse.
 */

import {
  plainTextOfRuns,
  runsAreUnmarked,
  trimInlineRuns,
  type InlineRun,
} from './inline-runs';

/**
 * Bumped only when stored documents need migrating. Adding an optional block
 * type to the union does not qualify — an older document still parses.
 */
export const DESCRIPTION_DOCUMENT_VERSION = 1;

export type { InlineMark, InlineRun } from './inline-runs';
export { INLINE_MARKS, MAX_RUNS_PER_BLOCK } from './inline-runs';

export const MAX_BLOCKS = 60;
export const MAX_TEXT_LENGTH = 4_000;
export const MAX_LIST_ITEMS = 40;
export const MAX_LABEL_LENGTH = 120;
export const MAX_URL_LENGTH = 2_048;
/** Alt text is a sentence, not an essay; the same ceiling the gallery uses. */
export const MAX_ALT_LENGTH = 160;

/**
 * Columns in one table.
 *
 * Read off the motivating content, not chosen as a round number: a CJ apparel
 * size chart is a size code plus its measurements — waistline, hips, thigh,
 * foot, length is five, and the widest real ones add bust, shoulder, and
 * sleeve. Eight covers those and stops well short of a spreadsheet.
 *
 * It is deliberately small. Every column past the reading width has to be
 * reached by scrolling sideways on a phone, so a cap that permitted forty
 * would be permitting a table nobody can read — the storefront cannot make
 * twenty columns legible, and pretending otherwise in the editor is the same
 * class of promise as an image frame that does not say it crops.
 */
export const MAX_TABLE_COLUMNS = 8;

/**
 * Rows in one table's body, excluding the header row.
 *
 * The same ceiling a bullet list and a detail list use, because it answers the
 * same question — how many rows may one description block hold — and a seller
 * should not have to learn a second number. Kept as its own constant rather
 * than an alias of `MAX_LIST_ITEMS`: a table row costs up to
 * `MAX_TABLE_COLUMNS` cells where a detail row costs two, so the two may yet
 * need to diverge, and aliasing them now would hide that they are separate
 * decisions that happen to agree today.
 */
export const MAX_TABLE_ROWS = 40;

/**
 * One table cell.
 *
 * Shorter than `MAX_TEXT_LENGTH` on purpose. A cell is a measurement or a
 * short phrase — `65`, `Machine wash cold` — and one holding four thousand
 * characters would not be a cell: it would be a paragraph that has destroyed
 * the column widths of every row beside it. A cell that long wants to be a
 * paragraph block, and refusing it says so.
 *
 * Longer than a header, though, because the two are not the same thing: a
 * header sets its column's width and every row lives under it, so it is a
 * label (`MAX_LABEL_LENGTH`); a cell wraps inside a width already decided and
 * can afford a short sentence.
 */
export const MAX_TABLE_CELL_LENGTH = 200;

/** Matches `<div`, `</p`, `<!--`, `<?xml`. Does not match `a < b` or `5 <10`. */
export const MARKUP_OPENER = /<[a-zA-Z/!?]/;
/** C0/C1 controls except tab (09) and newline (0A). */
// eslint-disable-next-line no-control-regex
export const DISALLOWED_CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;

/**
 * A paragraph, optionally with emphasis over part of it.
 *
 * `text` stays the canonical value and `runs` stays optional, and that
 * ordering is the whole design. A consumer that knows nothing about marks —
 * the storefront today, the meta-description projection, the readiness check —
 * reads `text` and renders every word. It loses the emphasis and never loses
 * content. Compare the `image` block, which a four-member union drops whole:
 * additive-optional degrades, additive-required disappears.
 *
 * `runs` must join to exactly `text`; `description-document.ts` refuses the
 * save otherwise. Two fields that could disagree about what the seller wrote
 * would let a marked renderer and a plain renderer show different sentences.
 */
export type ParagraphBlock = {
  type: 'paragraph';
  text: string;
  runs?: InlineRun[];
};

/** Only sub-headings: the product title owns the single `h1` on the page. */
export type HeadingBlock = { type: 'heading'; level: 2 | 3; text: string };

export type BulletListBlock = { type: 'bulletList'; items: string[] };

export type KeyValueEntry = { label: string; value: string };

export type KeyValueListBlock = {
  type: 'keyValueList';
  entries: KeyValueEntry[];
};

/**
 * An image inside the description, never a gallery photo.
 *
 * `url` is a Cloudflare R2 address, allow-listed at the write boundary
 * against `CLOUDFLARE_R2_PUBLIC_BASE_URL` — a free-form URL field in a
 * document whose whole posture is "an allow list, not a sanitiser" is the
 * one addition that could undo that posture, so it is rejected rather than
 * rewritten. Deliberately checked on write and not in this shape: a stored
 * document must stay readable even if that environment variable is later
 * renamed, or every description holding an image would vanish from the
 * editor at once.
 *
 * `alt` is required and the seller's own words. The gallery defaults alt to
 * the product title, which is a known weakness; it is not repeated here.
 */
export type ImageBlock = {
  type: 'image';
  url: string;
  alt: string;
  caption?: string;
};

/**
 * A real multi-column table: seller-named columns, seller-typed rows.
 *
 * It exists because the shape it replaces was a lie about its own content. A
 * CJ size chart was being written into a `keyValueList`, with the size code as
 * the label and every measurement for that size joined into one
 * comma-separated string — `waistline 65, hips 100, thigh 61, foot 39, pants
 * length 103` — which the storefront then set as prose inside the 70ch reading
 * measure. The data was a grid, the block was a list of pairs, and the buyer
 * read a wall of text and had to count commas to find their waist.
 *
 * ## Rectangular, always
 *
 * `rows[n].length === headers.length` for every row, enforced by the document
 * schema and mirrored in `describeBlockProblem`. A ragged row is not a
 * cosmetic defect: drop one cell from the middle of a size chart and every
 * measurement after it shifts one column left, so a buyer reads a thigh
 * measurement under `Hips` and orders the wrong size. There is no honest way
 * to render that, so it is refused rather than padded — padding would invent a
 * cell the seller never wrote and place it where the wrong one used to be.
 *
 * ## Blank cells are content, not emptiness
 *
 * A header or a cell may be the empty string, which no other text position in
 * this document permits. A grid needs holes — a measurement that does not
 * apply to one size, and the corner cell above a column of row names, which is
 * blank in every size chart ever printed. Dropping a blank cell would make the
 * row ragged, which is the failure above; refusing it would make the corner
 * cell impossible. So blank is allowed, and a row that is blank all the way
 * across is dropped whole by `prepareBlocksForSave`, exactly as a blank bullet
 * or a blank detail row is.
 *
 * Columns are never dropped, blank or not. A column is named by its header and
 * every row is positioned against it, so removing one silently changes what
 * the remaining cells mean. The seller removes a column explicitly or keeps
 * it.
 *
 * `caption` is optional and is the table's accessible name on the storefront.
 * The `<table>` has no other one — a heading block above it is a sibling, not
 * a label — so this is the only place a screen-reader shopper can be told that
 * the grid they have landed in is a size chart in centimetres.
 */
export type TableBlock = {
  type: 'table';
  headers: string[];
  rows: string[][];
  caption?: string;
};

export type DescriptionBlock =
  | ParagraphBlock
  | HeadingBlock
  | BulletListBlock
  | KeyValueListBlock
  | TableBlock
  | ImageBlock;

export type DescriptionBlockType = DescriptionBlock['type'];

export const DESCRIPTION_BLOCK_LABELS: Record<DescriptionBlockType, string> = {
  paragraph: 'Paragraph',
  heading: 'Heading',
  bulletList: 'Bullet list',
  keyValueList: 'Detail list',
  table: 'Table',
  image: 'Image',
};

/**
 * The grid a fresh table starts as: three columns, two rows.
 *
 * Not one of each, which is what every other block type starts as. A table
 * with one column and one row does not read as a table on the canvas — it
 * reads as a mislabelled text box, and the seller's next move is to delete it.
 * Three by two is the smallest grid that is visibly a grid, and it is what a
 * size chart's first three columns (size, plus two measurements) look like.
 */
const NEW_TABLE_COLUMNS = 3;
const NEW_TABLE_ROWS = 2;

/**
 * A switch rather than an if-chain with a fallthrough return: the chain
 * silently handed back a detail list for any type it did not name, so
 * adding `image` to the union produced detail lists from the image buttons
 * and compiled cleanly. `never` in the default makes the next added block
 * type a compile error instead.
 */
export function emptyBlockOfType(type: DescriptionBlockType): DescriptionBlock {
  switch (type) {
    case 'paragraph':
      return { type: 'paragraph', text: '' };
    case 'heading':
      return { type: 'heading', level: 3, text: '' };
    case 'bulletList':
      return { type: 'bulletList', items: [''] };
    case 'keyValueList':
      return { type: 'keyValueList', entries: [{ label: '', value: '' }] };
    case 'table':
      return {
        type: 'table',
        headers: Array.from({ length: NEW_TABLE_COLUMNS }, () => ''),
        rows: Array.from({ length: NEW_TABLE_ROWS }, () =>
          Array.from({ length: NEW_TABLE_COLUMNS }, () => ''),
        ),
      };
    case 'image':
      return { type: 'image', url: '', alt: '' };
    default: {
      const unhandled: never = type;

      throw new Error(`Unhandled description block type: ${String(unhandled)}`);
    }
  }
}

/**
 * Every piece of seller-entered text a block carries, in render order.
 *
 * One place to walk a block's text, so the editor's own checks and the
 * plain-text projection cannot disagree about what a block contains.
 */
function textPartsOf(block: DescriptionBlock): string[] {
  if (block.type === 'paragraph' || block.type === 'heading') {
    return [block.text];
  }

  // An image's own text, not its address: `url` is machine data, and letting
  // it into the plain-text projection would put a storage URL in the
  // meta-description suggestion.
  if (block.type === 'image') {
    return block.caption === undefined
      ? [block.alt]
      : [block.alt, block.caption];
  }

  if (block.type === 'bulletList') return block.items;

  // Caption first, then the grid in reading order: header row, then each body
  // row left to right. Blanks are included rather than filtered, because every
  // caller here either trims them itself or is asking "is any of this
  // non-blank" — and filtering would make `prepareBlocksForSave` unable to use
  // this to decide whether a row is empty.
  if (block.type === 'table') {
    return [
      ...(block.caption === undefined ? [] : [block.caption]),
      ...block.headers,
      ...block.rows.flat(),
    ];
  }

  return block.entries.flatMap((entry) => [entry.label, entry.value]);
}

/**
 * The plain-text projection of a document.
 *
 * Used for the meta-description suggestion seam, the catalogue row's
 * content-readiness check, and anywhere else that wants "is there copy here,
 * and roughly what does it say". It is **lossy on purpose** and must never be
 * the value an editor saves back — that round trip is what silently
 * downgraded headings, bullets, and detail lists into paragraphs.
 *
 * `image` and `table` are both excluded here, for the same reason: neither is
 * prose, and this projection's two real consumers both treat the result as
 * prose. The meta-description seam runs `firstSentence()` over it, and a
 * description that opens with a table (no caption, no lead paragraph) would
 * otherwise hand that function `Size · Waist · Hips` as the opening
 * "sentence" — copy no seller wrote, that a seller could then save verbatim
 * as the live `<meta name="description">`, because nothing downstream
 * rejects a delimiter-heavy string. A table still contributes to whether the
 * *document* counts as non-empty (`description.blocks.length === 0` in
 * `read-model.ts` — a block count, not this text), so excluding it from the
 * text does not make a chart-only description register as needing content;
 * it only keeps the chart out of a field that reads as a sentence.
 */
export function descriptionBlocksToPlainText(
  blocks: readonly DescriptionBlock[],
): string {
  return blocks
    .filter((block) => block.type !== 'image' && block.type !== 'table')
    .map((block) => {
      if (block.type === 'keyValueList') {
        return block.entries
          .map((entry) => `${entry.label}: ${entry.value}`)
          .join('\n');
      }

      return textPartsOf(block).join('\n');
    })
    .join('\n\n');
}

/**
 * True when a block carries nothing a buyer would ever see.
 *
 * An image is empty when no file has been attached yet. One that has a file
 * but no alt text is not empty — it is incomplete, which is a refusal
 * (`describeBlockProblem`) rather than something to silently drop.
 */
export function isBlockEmpty(block: DescriptionBlock): boolean {
  if (block.type === 'image') return block.url.trim() === '';

  /*
    A table is empty when its *body* is, even if the seller has named the
    columns. Column headers with nothing under them are the same editing state
    an image block with no file is: a shape waiting to be filled, not content.
    Storing one would publish a header row with no rows beneath it — a table
    that announces five measurements and reports none — and the document schema
    requires at least one row for exactly that reason, so this is also what
    keeps `prepareBlocksForSave` from producing a document the server refuses.
  */
  if (block.type === 'table') {
    return block.rows.every((row) => row.every((cell) => cell.trim() === ''));
  }

  return textPartsOf(block).every((part) => part.trim() === '');
}

/**
 * How many images this block starts or continues a consecutive run of, and
 * where it sits in that run.
 *
 * The storefront derives image layout from adjacency — one image alone is
 * full width at 16:9, two or more pair into a grid at 4:3 — so the editor
 * has to read the same adjacency to tell the seller what they will get. No
 * grouping is stored: a "row of two" is two consecutive image blocks, which
 * keeps reordering and deleting from ever leaving a half-empty container
 * behind.
 */
export function imageRunAt(
  blocks: readonly DescriptionBlock[],
  index: number,
): { position: number; length: number } | null {
  if (blocks[index]?.type !== 'image') return null;

  let start = index;

  while (start > 0 && blocks[start - 1]?.type === 'image') start -= 1;

  let end = index;

  while (end + 1 < blocks.length && blocks[end + 1]?.type === 'image') end += 1;

  return { position: index - start + 1, length: end - start + 1 };
}

/**
 * The seller-facing version of the server's refusal reasons.
 *
 * The server still validates every save — this only means a seller reads
 * "Remove the `<` ..." beside the field they typed it into rather than
 * "Draft save failed" after the round trip. Returns `null` when the server
 * would accept the block.
 */
/**
 * The table half of `describeBlockProblem`, mirroring the document schema's
 * own table rules so a seller reads them beside the grid rather than after a
 * failed round trip.
 *
 * Named separately because a table has four independent refusals where every
 * other block has one, and folding them into the chain below would bury them.
 */
function describeTableProblem(block: TableBlock): string | null {
  if (block.headers.length > MAX_TABLE_COLUMNS) {
    return `A table holds at most ${MAX_TABLE_COLUMNS} columns.`;
  }

  if (block.rows.length > MAX_TABLE_ROWS) {
    return `A table holds at most ${MAX_TABLE_ROWS} rows.`;
  }

  // The editor adds and removes cells across every row at once, so this cannot
  // come from the seller — it is what a hand-built payload or a future writer
  // would produce, and it is the one table defect that misinforms rather than
  // merely looking wrong: every cell after the gap reports under the wrong
  // column heading.
  if (block.rows.some((row) => row.length !== block.headers.length)) {
    return 'Every row must have one cell for each column.';
  }

  if (block.headers.some((header) => header.trim().length > MAX_LABEL_LENGTH)) {
    return `A column heading is at most ${MAX_LABEL_LENGTH} characters.`;
  }

  if (
    block.rows.some((row) =>
      row.some((cell) => cell.trim().length > MAX_TABLE_CELL_LENGTH),
    )
  ) {
    return `A table cell is at most ${MAX_TABLE_CELL_LENGTH} characters. Longer copy belongs in a paragraph.`;
  }

  return null;
}

export function describeBlockProblem(block: DescriptionBlock): string | null {
  if (block.type === 'image') {
    if (block.url.trim() === '') return 'Upload an image for this block.';

    if (block.alt.trim() === '') {
      return 'Describe the image for shoppers using a screen reader. Alt text is required.';
    }

    if (block.alt.trim().length > MAX_ALT_LENGTH) {
      return `Alt text is at most ${MAX_ALT_LENGTH} characters.`;
    }
  }

  const parts = textPartsOf(block).filter((part) => part.trim() !== '');

  if (parts.some((part) => MARKUP_OPENER.test(part))) {
    return 'Markup is not allowed. Remove the tag and use a heading, bullet, or detail block instead.';
  }

  if (parts.some((part) => DISALLOWED_CONTROL.test(part))) {
    return 'Remove the control characters from this block.';
  }

  if (block.type === 'heading' && block.text.trim().length > MAX_LABEL_LENGTH) {
    return `A heading is at most ${MAX_LABEL_LENGTH} characters.`;
  }

  if (
    block.type === 'keyValueList' &&
    block.entries.some((entry) => entry.label.trim().length > MAX_LABEL_LENGTH)
  ) {
    return `A detail label is at most ${MAX_LABEL_LENGTH} characters.`;
  }

  if (block.type === 'table') {
    const problem = describeTableProblem(block);

    if (problem !== null) return problem;
  }

  if (parts.some((part) => part.trim().length > MAX_TEXT_LENGTH)) {
    return `Text is at most ${MAX_TEXT_LENGTH.toLocaleString()} characters.`;
  }

  if (block.type === 'bulletList' && block.items.length > MAX_LIST_ITEMS) {
    return `A bullet list holds at most ${MAX_LIST_ITEMS} items.`;
  }

  if (block.type === 'keyValueList' && block.entries.length > MAX_LIST_ITEMS) {
    return `A detail list holds at most ${MAX_LIST_ITEMS} rows.`;
  }

  return null;
}

/**
 * The document as it should be stored: blank blocks and blank rows dropped.
 *
 * An empty block is an editing state, not content. Saving one would fail the
 * server's `min(1)` text rules, and a document that round-trips a blank
 * paragraph would render an empty gap on the storefront.
 */
export function prepareBlocksForSave(
  blocks: readonly DescriptionBlock[],
): DescriptionBlock[] {
  return blocks
    .map((block): DescriptionBlock => {
      if (block.type === 'heading') {
        return { ...block, text: block.text.trim() };
      }

      /**
       * A paragraph's `runs` are trimmed with its text, not after it.
       *
       * Trimming `text` alone would leave runs joining to the untrimmed string,
       * which the document schema refuses — every paragraph with a trailing
       * space would fail to save for a reason no seller could see or act on.
       * Deriving `text` from the trimmed runs keeps the two in step by
       * construction rather than by two matching `.trim()` calls.
       *
       * `runs` is dropped when nothing is emphasised so unstyled text has one
       * canonical spelling; an empty list is refused by the schema, and two
       * spellings of "no emphasis" would checksum differently and read as a
       * real edit in the revision history.
       */
      if (block.type === 'paragraph') {
        if (block.runs === undefined) {
          return { type: 'paragraph', text: block.text.trim() };
        }

        const runs = trimInlineRuns(block.runs);
        const text = plainTextOfRuns(runs);

        return runsAreUnmarked(runs)
          ? { type: 'paragraph', text }
          : { type: 'paragraph', text, runs };
      }

      if (block.type === 'image') {
        const caption = block.caption?.trim() ?? '';

        return {
          type: 'image',
          url: block.url.trim(),
          alt: block.alt.trim(),
          // Dropped rather than stored blank: an empty `<figcaption>` is a
          // gap under the image, and the field is optional by design.
          ...(caption === '' ? {} : { caption }),
        };
      }

      if (block.type === 'bulletList') {
        return {
          ...block,
          items: block.items
            .map((item) => item.trim())
            .filter((item) => item !== ''),
        };
      }

      /**
       * Trim everything, drop rows that are blank all the way across, and
       * change no row's width.
       *
       * Dropping a blank *cell* is what the other list blocks do and is
       * precisely what this one must not: it would make the row shorter than
       * the header row, which the schema refuses and which — if it ever got
       * through — would print the seller's numbers under the wrong headings.
       * A hole in a grid is content, so it survives; a row with nothing in it
       * anywhere is an editing artefact, so it does not.
       *
       * A blank *column* also survives, deliberately. It is named by its
       * header and every row is positioned against it, so removing one here
       * would silently re-point every cell to its left neighbour's meaning.
       * The inspector's "Remove column" is how a column goes.
       */
      if (block.type === 'table') {
        const caption = block.caption?.trim() ?? '';

        return {
          type: 'table',
          headers: block.headers.map((header) => header.trim()),
          rows: block.rows
            .map((row) => row.map((cell) => cell.trim()))
            .filter((row) => row.some((cell) => cell !== '')),
          // Dropped rather than stored blank, exactly as an image's is: an
          // empty `<caption>` is a gap above the table, and the field is
          // optional by design.
          ...(caption === '' ? {} : { caption }),
        };
      }

      return {
        ...block,
        entries: block.entries
          .map((entry) => ({
            label: entry.label.trim(),
            value: entry.value.trim(),
          }))
          .filter((entry) => entry.label !== '' || entry.value !== ''),
      };
    })
    .filter((block) => !isBlockEmpty(block));
}

/**
 * Whether two block lists would store the same document.
 *
 * Compares the prepared (trimmed, blank-dropped) form, so trailing
 * whitespace or a half-typed empty block does not count as an edit that
 * needs saving.
 */
export function blocksMatchSaved(
  left: readonly DescriptionBlock[],
  right: readonly DescriptionBlock[],
): boolean {
  return (
    JSON.stringify(prepareBlocksForSave(left)) ===
    JSON.stringify(prepareBlocksForSave(right))
  );
}

/**
 * The first block the server would refuse, and why — the seller-facing
 * pre-flight for a save.
 *
 * `describeBlockProblem` already existed and was already rendered beside the
 * *selected* block, which is exactly the case a seller who never selected it
 * does not see. So an uploaded photo with no alt text reached
 * `descriptionDocumentSchema`, whose `alt` is `min(1)`, and came back as
 * `invalid_input` — copy that reads "Remove any pasted formatting", naming a
 * cause that was not the cause and an action that could not fix it.
 *
 * Blocks `prepareBlocksForSave` drops are skipped, so a half-added image row
 * with no file is an editing state rather than a refusal — the same rule, read
 * from the same predicate, so the two cannot disagree about which blocks are
 * about to be stored.
 *
 * The index is the caller's own, not the prepared list's: the editor needs to
 * select the offending block, and prepared indices no longer address it.
 */
export function firstBlockProblem(
  blocks: readonly DescriptionBlock[],
): { index: number; problem: string } | null {
  const refused = blocks
    .map((block, index) => ({
      index,
      problem: isBlockEmpty(block) ? null : describeBlockProblem(block),
    }))
    .filter(
      (entry): entry is { index: number; problem: string } =>
        entry.problem !== null,
    );

  return refused[0] ?? null;
}

/**
 * What a description photo should actually be, per layout.
 *
 * The storefront renders these with `object-cover` inside a fixed aspect box
 * (`sals3-ecommerce/src/components/product/DescriptionImageRow.tsx`), so a
 * mis-shaped upload is **cropped, not letterboxed** — a seller who uploads a
 * tall photo into a 16:9 slot loses the top and bottom of it and is never told.
 * Naming the ratio at the point of upload is the only place that can prevent it.
 *
 * ## Where the numbers come from
 *
 * Ratio and rendered width are read off the consumer, not chosen here:
 *
 * - **Alone** — `aspect-video` (16:9), `sizes="(min-width: 1024px) 720px, 100vw"`.
 * - **Two or three in a row** — `aspect-[4/3]`, `sizes="(min-width: 640px) 33vw, 100vw"`,
 *   in a `minmax(240px, 1fr)` grid.
 *
 * The recommendation is 2x the rendered width, which is what a high-density
 * screen asks `next/image` for. Above that is wasted: `upload-seller-media.ts`
 * re-encodes every upload to WebP at a 2000px long edge, so a larger original
 * is downscaled on the way in and buys the seller nothing.
 *
 * `runLength` is the adjacency the page derives — the same number
 * `CanvasBlock` already uses to pick the ratio — so the spec and the frame it
 * describes can never disagree.
 */
export type DescriptionImageSpec = {
  /** Human ratio, e.g. `16:9`. */
  ratio: string;
  /** Recommended upload width in pixels. */
  width: number;
  /** Recommended upload height in pixels. */
  height: number;
  /** Short label for the layout this spec belongs to. */
  layout: string;
};

export function descriptionImageSpec(runLength: number): DescriptionImageSpec {
  return runLength > 1
    ? { ratio: '4:3', width: 960, height: 720, layout: 'Side by side' }
    : { ratio: '16:9', width: 1440, height: 810, layout: 'Full width' };
}

/** `16:9 · 1440 × 810 px` — one string, so every surface says it identically. */
export function describeDescriptionImageSpec(runLength: number): string {
  const spec = descriptionImageSpec(runLength);

  return `${spec.ratio} · ${spec.width} × ${spec.height} px`;
}

/**
 * How many images sit in the consecutive run containing `index`.
 *
 * The product page derives image layout from adjacency, so this is the number
 * that decides a photo's ratio — and it is the same rule `StudioCanvas`
 * already groups by. Kept here rather than in a component so the canvas and
 * the upload panel cannot disagree about which spec a photo needs; a
 * non-image block, or an index out of range, is a run of one.
 */
export function imageRunLengthAt(
  blocks: readonly DescriptionBlock[],
  index: number,
): number {
  if (blocks[index]?.type !== 'image') return 1;

  let start = index;
  let end = index;

  while (start > 0 && blocks[start - 1]?.type === 'image') start -= 1;
  while (end < blocks.length - 1 && blocks[end + 1]?.type === 'image') end += 1;

  return end - start + 1;
}
