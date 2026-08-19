import type { DescriptionBlock } from './description-blocks';

/**
 * The plain-text view of a description document.
 *
 * A seller who wants to type a description into one box should be able to, and
 * most do. But there is only ever **one stored format** — the allow-listed block
 * document — so "simple text" is a *view* over it rather than a second schema.
 * Two storage shapes for one field would mean two renderers, two validators, and
 * a mode flag that could disagree with the content it describes.
 *
 * The shape simple text can represent is paragraphs followed by images:
 *
 *     [paragraph, paragraph, …][image, image, …]
 *
 * Paragraphs because blank lines separate them, images trailing because a
 * textarea cannot express *interleaved* order — there is nowhere in a string to
 * say "and here, between these two paragraphs, a photo". That is the same
 * conclusion the PDP v3.1 spec reached for its own phase one, and the reason
 * design mode exists rather than the reason simple mode is broken.
 *
 * Because the mode is derived from the content, nothing needs to be stored to
 * remember it and no migration is involved. A document that simple text can hold
 * opens in simple mode; one it cannot opens in design mode.
 */

/**
 * A guidance ceiling on the simple surface, not a schema rule.
 *
 * The document itself allows `MAX_TEXT_LENGTH` per paragraph, so this cannot
 * refuse a save and must never truncate: a seller who arrives over the ceiling —
 * by switching from a long design-mode document — keeps every word and is told
 * the count. Truncating a seller's copy to satisfy a counter would be the worst
 * possible reading of "guidance".
 */
export const SIMPLE_TEXT_SOFT_MAX = 3_000;

/** Matches the count the image strip shows, and well under `MAX_BLOCKS`. */
export const SIMPLE_MAX_IMAGES = 12;

export type DescriptionMode = 'simple' | 'design';

type ImageBlock = Extract<DescriptionBlock, { type: 'image' }>;

/** A blank line separates paragraphs; a single newline stays inside one. */
const PARAGRAPH_BREAK = /\n\s*\n/;

/**
 * Splits typed text into paragraph blocks.
 *
 * Single newlines are kept **inside** a paragraph rather than starting a new
 * one, because that is how sellers actually write a features list in a plain box
 * — a heading line, then one line per feature. The document permits `\n` in
 * paragraph text (`DISALLOWED_CONTROL` deliberately exempts tab and newline), so
 * this preserves the author's line breaks instead of collapsing them into prose.
 */
export function descriptionTextToBlocks(text: string): DescriptionBlock[] {
  return text
    .split(PARAGRAPH_BREAK)
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk !== '')
    .map((chunk) => ({ type: 'paragraph', text: chunk }));
}

/** The text view of a document's paragraphs. Images are shown as a strip, not as text. */
export function blocksToSimpleText(
  blocks: readonly DescriptionBlock[],
): string {
  return blocks
    .filter((block) => block.type === 'paragraph')
    .map((block) => block.text)
    .join('\n\n');
}

/**
 * What a given piece of typed text projects to once stored and read back.
 *
 * Lets the editor tell its own echo apart from a genuine change made elsewhere.
 * Storing trims each paragraph, so text still being typed — `Care: ` with the
 * caret after the space — is not equal to its own projection, and comparing
 * against the projection rather than against the raw value is what stops a
 * resync from eating the seller's trailing space.
 */
export function normalizeSimpleText(text: string): string {
  return blocksToSimpleText(descriptionTextToBlocks(text));
}

export function imagesOf(blocks: readonly DescriptionBlock[]): ImageBlock[] {
  return blocks.filter((block): block is ImageBlock => block.type === 'image');
}

/**
 * Rebuilds a document from the simple surface's two parts.
 *
 * Images always land after the text, which is the order simple mode can honestly
 * claim. Their relative order is the seller's, preserved from the strip.
 */
export function simpleDescriptionToBlocks(
  text: string,
  images: readonly ImageBlock[],
): DescriptionBlock[] {
  return [...descriptionTextToBlocks(text), ...images];
}

/**
 * True when simple text can hold this document without changing it.
 *
 * Deliberately strict. Emphasis counts as structure: a paragraph carrying `runs`
 * would come back plain, and losing a seller's bold silently is the same class of
 * defect as losing a heading. An image sitting *between* paragraphs also fails,
 * because simple mode would move it to the end and quietly rearrange the page.
 */
export function canUseSimpleMode(blocks: readonly DescriptionBlock[]): boolean {
  const firstImage = blocks.findIndex((block) => block.type === 'image');

  return blocks.every((block, index) => {
    if (block.type === 'image') return true;
    if (block.type !== 'paragraph') return false;
    if (block.runs !== undefined) return false;

    // A paragraph after the first image would be reordered by the round trip.
    return firstImage === -1 || index < firstImage;
  });
}

function countLoss(blocks: readonly DescriptionBlock[]) {
  const firstImage = blocks.findIndex((block) => block.type === 'image');

  return {
    headings: blocks.filter((block) => block.type === 'heading').length,
    bulletLists: blocks.filter((block) => block.type === 'bulletList').length,
    detailLists: blocks.filter((block) => block.type === 'keyValueList').length,
    emphasised: blocks.filter(
      (block) => block.type === 'paragraph' && block.runs !== undefined,
    ).length,
    /** An image with any non-image block after it is one the round trip moves. */
    movedImages:
      firstImage === -1
        ? 0
        : blocks.filter(
            (block, index) =>
              block.type === 'image' &&
              blocks.slice(index + 1).some((later) => later.type !== 'image'),
          ).length,
  };
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * What switching to simple text would change, in the seller's words — or `null`
 * when it would change nothing.
 *
 * This exists because the lossy direction of this conversion has bitten this
 * codebase before: `descriptionBlocksToPlainText` carries a comment saying that
 * exact round trip "silently downgraded headings, bullets, and detail lists into
 * paragraphs". Naming the loss before it happens is the difference between a
 * conversion and a data loss.
 */
export function describeSimpleModeLoss(
  blocks: readonly DescriptionBlock[],
): string | null {
  if (canUseSimpleMode(blocks)) return null;

  const loss = countLoss(blocks);
  const parts: string[] = [];

  if (loss.headings > 0)
    parts.push(plural(loss.headings, 'heading', 'headings'));
  if (loss.bulletLists > 0) {
    parts.push(plural(loss.bulletLists, 'bullet list', 'bullet lists'));
  }
  if (loss.detailLists > 0) {
    parts.push(plural(loss.detailLists, 'detail list', 'detail lists'));
  }
  if (loss.emphasised > 0) {
    parts.push(
      `bold or italic in ${plural(loss.emphasised, 'paragraph', 'paragraphs')}`,
    );
  }
  if (loss.movedImages > 0) {
    parts.push(
      `${plural(loss.movedImages, 'image', 'images')} that sit between paragraphs`,
    );
  }

  if (parts.length === 0) return null;

  const listed =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

  return `Simple text cannot hold ${listed}. Your words are kept — the structure becomes plain paragraphs, and any image between paragraphs moves to the end.`;
}

/**
 * The explicit, confirmed conversion into what simple text can hold.
 *
 * Every word survives. A heading becomes its own paragraph, a bullet list and a
 * detail list become one line per entry, emphasis is dropped, and images move to
 * the end in their existing order. Nothing is deleted — which is what makes this
 * recoverable by retyping rather than by restoring a revision.
 */
export function flattenToSimpleMode(
  blocks: readonly DescriptionBlock[],
): DescriptionBlock[] {
  const text = blocks
    .flatMap((block): string[] => {
      if (block.type === 'paragraph' || block.type === 'heading') {
        return [block.text];
      }

      if (block.type === 'bulletList') return [block.items.join('\n')];

      if (block.type === 'keyValueList') {
        return [
          block.entries
            .map((entry) => `${entry.label}: ${entry.value}`)
            .join('\n'),
        ];
      }

      return [];
    })
    .filter((part) => part.trim() !== '')
    .join('\n\n');

  // Nothing is truncated. Each original block comes back as its own paragraph,
  // because the join above puts a blank line between them and
  // `descriptionTextToBlocks` splits on exactly that. A merged bullet list long
  // enough to exceed one paragraph's ceiling is reported by the existing
  // `describeBlockProblem` for the seller to shorten — a refusal they can see and
  // act on, rather than a silent slice through the middle of a sentence.
  return simpleDescriptionToBlocks(text, imagesOf(blocks));
}

/** The mode a stored document should open in, with no preference recorded anywhere. */
export function initialDescriptionMode(
  blocks: readonly DescriptionBlock[],
): DescriptionMode {
  return canUseSimpleMode(blocks) ? 'simple' : 'design';
}
