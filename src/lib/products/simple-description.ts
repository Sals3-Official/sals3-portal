import type { DescriptionBlock } from './description-blocks';

/**
 * The plain-text view of a description document.
 *
 * A seller who wants to type a description into one box should be able to, and
 * most do. There is still only **one stored format** — the allow-listed block
 * document — so simple text is a *view* over it rather than a second schema.
 *
 * Two owner decisions shape this, and the second one costs something:
 *
 * 1. **Simple text publishes exactly what it shows.** Only the paragraphs reach
 *    the product page; a photo cannot be placed from a plain box, so a photo is
 *    not part of what simple mode publishes.
 * 2. **Switching to simple never destroys a photo.** One saved in the designed
 *    layout stays in the document, unpublished while simple mode is on, and comes
 *    back whole on switching layout again.
 *
 * Together those mean the mode **cannot be derived from the content** any more: a
 * simple-text document may legitimately hold photos it is not publishing, so the
 * blocks no longer say which mode they are in. `mode` is therefore stored on the
 * document itself — a field in the same JSONB column, so no migration is
 * involved, exactly as `runs` needed none.
 *
 * That is a flag which could in principle disagree with the content, which is
 * what this module previously avoided. The trade is deliberate: a flag that
 * decides *what publishes* is a seller's stated intent, and honouring it costs
 * less than deleting a photo they spent time uploading. A document with no `mode`
 * is a legacy one, and its mode is inferred the old way.
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
 * Rebuilds a simple-mode document: the typed paragraphs, then the photos the
 * document was already carrying.
 *
 * The photos are retained rather than published — `publishableBlocks` is what
 * drops them for the product page. Keeping them in the stored document is the
 * whole reason switching layouts is reversible.
 */
export function simpleDescriptionToBlocks(
  text: string,
  retainedImages: readonly ImageBlock[] = [],
): DescriptionBlock[] {
  return [...descriptionTextToBlocks(text), ...retainedImages];
}

/**
 * What a buyer actually sees, given the mode the seller chose.
 *
 * The one place the mode changes an outcome. Simple mode publishes its
 * paragraphs; the photos it carries are the seller's, kept for when they switch
 * layout again, and are not part of what simple text shows. Designed mode
 * publishes everything.
 *
 * Called by the storefront read model so the rule lives once, rather than being
 * re-derived by every consumer that renders a description.
 */
export function publishableBlocks(
  blocks: readonly DescriptionBlock[],
  mode: DescriptionMode,
): DescriptionBlock[] {
  if (mode === 'design') return [...blocks];

  return blocks.filter((block) => block.type === 'paragraph');
}

/**
 * True when switching to simple text would change nothing the seller has to
 * agree to.
 *
 * Photos do not disqualify a document: they are retained across the switch and
 * restored on switching back, so there is nothing to warn about. What does
 * disqualify is text structure, because that genuinely changes — a heading
 * becomes a paragraph and cannot become a heading again by itself, and emphasis
 * is dropped. Losing a seller's bold silently is the same class of defect as
 * losing a heading, so both are named before either happens.
 */
export function canUseSimpleMode(blocks: readonly DescriptionBlock[]): boolean {
  return blocks.every(
    (block) =>
      block.type === 'image' ||
      (block.type === 'paragraph' && block.runs === undefined),
  );
}

function countLoss(blocks: readonly DescriptionBlock[]) {
  return {
    headings: blocks.filter((block) => block.type === 'heading').length,
    bulletLists: blocks.filter((block) => block.type === 'bulletList').length,
    detailLists: blocks.filter((block) => block.type === 'keyValueList').length,
    emphasised: blocks.filter(
      (block) => block.type === 'paragraph' && block.runs !== undefined,
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
  if (parts.length === 0) return null;

  const listed =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

  return `Simple text cannot hold ${listed}. Your words are kept and become plain paragraphs. Photos are not affected — they stay with the description and come back if you switch layout again.`;
}

/**
 * The explicit, confirmed conversion into what simple text can hold.
 *
 * Every word survives. A heading becomes its own paragraph, a bullet list and a
 * detail list become one line per entry, and emphasis is dropped. **Photos are
 * carried through untouched**, in their existing order, so switching layout again
 * restores them — nothing a seller uploaded is destroyed by choosing a simpler
 * editor.
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

/**
 * The mode a stored document opens in.
 *
 * The stored `mode` wins whenever there is one, because a simple-text document
 * holding retained photos is indistinguishable from a designed one by content
 * alone — that ambiguity is exactly why the field exists.
 *
 * `undefined` means a document written before the field did. Those are inferred
 * the way they always were, and a legacy document holding a photo opens designed,
 * which is where its photo is visible.
 */
export function initialDescriptionMode(
  blocks: readonly DescriptionBlock[],
  storedMode?: DescriptionMode,
): DescriptionMode {
  if (storedMode !== undefined) return storedMode;

  const hasPhoto = blocks.some((block) => block.type === 'image');

  return canUseSimpleMode(blocks) && !hasPhoto ? 'simple' : 'design';
}
