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
export const MAX_URL_LENGTH = 2_048;
/** Alt text is a sentence, not an essay; the same ceiling the gallery uses. */
export const MAX_ALT_LENGTH = 160;

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

export type DescriptionBlock =
  | ParagraphBlock
  | HeadingBlock
  | BulletListBlock
  | KeyValueListBlock
  | ImageBlock;

export type DescriptionBlockType = DescriptionBlock['type'];

export const DESCRIPTION_BLOCK_LABELS: Record<DescriptionBlockType, string> = {
  paragraph: 'Paragraph',
  heading: 'Heading',
  bulletList: 'Bullet list',
  keyValueList: 'Detail list',
  image: 'Image',
};

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
    .filter((block) => block.type !== 'image')
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
