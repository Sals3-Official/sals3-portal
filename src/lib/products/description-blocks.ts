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
 * header for why that distinction is load-bearing.
 */

/**
 * Bumped only when stored documents need migrating. Adding an optional block
 * type to the union does not qualify — an older document still parses.
 */
export const DESCRIPTION_DOCUMENT_VERSION = 1;

export const MAX_BLOCKS = 60;
export const MAX_TEXT_LENGTH = 4_000;
export const MAX_LIST_ITEMS = 40;
export const MAX_LABEL_LENGTH = 120;

/** Matches `<div`, `</p`, `<!--`, `<?xml`. Does not match `a < b` or `5 <10`. */
export const MARKUP_OPENER = /<[a-zA-Z/!?]/;
/** C0/C1 controls except tab (09) and newline (0A). */
// eslint-disable-next-line no-control-regex
export const DISALLOWED_CONTROL = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/;

export type ParagraphBlock = { type: 'paragraph'; text: string };

/** Only sub-headings: the product title owns the single `h1` on the page. */
export type HeadingBlock = { type: 'heading'; level: 2 | 3; text: string };

export type BulletListBlock = { type: 'bulletList'; items: string[] };

export type KeyValueEntry = { label: string; value: string };

export type KeyValueListBlock = {
  type: 'keyValueList';
  entries: KeyValueEntry[];
};

export type DescriptionBlock =
  ParagraphBlock | HeadingBlock | BulletListBlock | KeyValueListBlock;

export type DescriptionBlockType = DescriptionBlock['type'];

export const DESCRIPTION_BLOCK_LABELS: Record<DescriptionBlockType, string> = {
  paragraph: 'Paragraph',
  heading: 'Heading',
  bulletList: 'Bullet list',
  keyValueList: 'Detail list',
};

export function emptyBlockOfType(type: DescriptionBlockType): DescriptionBlock {
  if (type === 'paragraph') return { type: 'paragraph', text: '' };
  if (type === 'heading') return { type: 'heading', level: 3, text: '' };
  if (type === 'bulletList') return { type: 'bulletList', items: [''] };

  return { type: 'keyValueList', entries: [{ label: '', value: '' }] };
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

  if (block.type === 'bulletList') return block.items;

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
 */
export function descriptionBlocksToPlainText(
  blocks: readonly DescriptionBlock[],
): string {
  return blocks
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

/** True when a block carries no text a buyer would ever see. */
export function isBlockEmpty(block: DescriptionBlock): boolean {
  return textPartsOf(block).every((part) => part.trim() === '');
}

/**
 * The seller-facing version of the server's refusal reasons.
 *
 * The server still validates every save — this only means a seller reads
 * "Remove the `<` ..." beside the field they typed it into rather than
 * "Draft save failed" after the round trip. Returns `null` when the server
 * would accept the block.
 */
export function describeBlockProblem(block: DescriptionBlock): string | null {
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
      if (block.type === 'paragraph' || block.type === 'heading') {
        return { ...block, text: block.text.trim() };
      }

      if (block.type === 'bulletList') {
        return {
          ...block,
          items: block.items
            .map((item) => item.trim())
            .filter((item) => item !== ''),
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
