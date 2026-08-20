import type { DescriptionBlock } from './description-blocks';

/**
 * React list identity for description blocks, shared by every editor surface.
 *
 * Extracted from `DescriptionBlockEditor` so the description studio can key the
 * same document without importing a client component to get at a counter. Both
 * surfaces edit one document and can be open in sequence, so they must agree on
 * what a block's identity is; two independent counters would collide the moment
 * a block moved between them.
 */
export type KeyedDescriptionBlock = {
  /**
   * React list identity only — never a DOM id.
   *
   * Blocks carry no id of their own and this list reorders, so an index key
   * would move a seller's cursor to a different field mid-edit. The counter
   * behind it is per module instance, which differs between the server and the
   * browser, so putting it in an `id` attribute produced a hydration mismatch.
   * Field ids come from `useId` instead.
   */
  key: string;
  block: DescriptionBlock;
};

let nextBlockKey = 0;

export function keyDescriptionBlocks(
  blocks: readonly DescriptionBlock[],
): KeyedDescriptionBlock[] {
  return blocks.map((block) => {
    nextBlockKey += 1;

    return { key: `block-${nextBlockKey}`, block };
  });
}

/** One keyed block, for an insertion that does not re-key the whole list. */
export function keyDescriptionBlock(
  block: DescriptionBlock,
): KeyedDescriptionBlock {
  nextBlockKey += 1;

  return { key: `block-${nextBlockKey}`, block };
}
