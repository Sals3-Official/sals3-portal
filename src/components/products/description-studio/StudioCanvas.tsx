'use client';

import { ArrowDown, ArrowUp, Copy, MoveHorizontal, X } from 'lucide-react';
import { DESCRIPTION_BLOCK_LABELS } from '@/lib/products/description-blocks';
import type { KeyedDescriptionBlock } from '@/lib/products/keyed-blocks';
import type { DescriptionBlock } from '@/lib/products/description-blocks';
import { cn } from '@/lib/utils';
import CanvasBlock from './CanvasBlock';

/**
 * The canvas: the product page's "About this product" section, editable.
 *
 * Two structural facts about the page are made visible here rather than left to
 * be discovered after publishing. Text sits in a 70ch measure, drawn as a
 * hairline guide. Images break out past it, and consecutive images pair into a
 * grid. Both are properties of the page a seller otherwise cannot see until it
 * is live, which is when a description that looked right in a form turns out to
 * be a wall of full-width photos.
 *
 * `sals3-bright` draws the guide and the selection ring. It measures 3.75:1, so
 * it clears the threshold for a component boundary and is never used for text
 * here or anywhere.
 */

/** Consecutive images render as one row, exactly as the page groups them. */
function groupBlocks(
  blocks: readonly KeyedDescriptionBlock[],
): KeyedDescriptionBlock[][] {
  return blocks.reduce<KeyedDescriptionBlock[][]>((groups, entry) => {
    const previous = groups[groups.length - 1];
    const continuesImageRow =
      entry.block.type === 'image' &&
      previous !== undefined &&
      previous[0]?.block.type === 'image';

    if (continuesImageRow && previous !== undefined) {
      return [...groups.slice(0, -1), [...previous, entry]];
    }

    return [...groups, [entry]];
  }, []);
}

/**
 * Which blocks on this canvas run past the 70ch reading measure, named for
 * whichever are actually here.
 *
 * A note about images on a description holding only a table is a note about
 * nothing, and a seller reading it would look for a photo that is not there.
 */
function wideBlockNotice(
  blocks: readonly KeyedDescriptionBlock[],
): string | null {
  const hasImage = blocks.some((entry) => entry.block.type === 'image');
  const hasTable = blocks.some((entry) => entry.block.type === 'table');

  if (hasImage && hasTable) {
    return 'Images and tables run wider than the text measure';
  }

  if (hasImage) return 'Images run wider than the text measure';
  if (hasTable) return 'Tables run wider than the text measure';

  return null;
}

type StudioCanvasProps = {
  blocks: KeyedDescriptionBlock[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onChangeBlock: (key: string, block: DescriptionBlock) => void;
  onMove: (key: string, direction: -1 | 1) => void;
  onDuplicate: (key: string) => void;
  onRemove: (key: string) => void;
};

function BlockHandles({
  label,
  onMove,
  onDuplicate,
  onRemove,
}: {
  label: string;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const actions = [
    {
      key: 'up',
      title: `Move ${label} up`,
      icon: ArrowUp,
      run: () => onMove(-1),
    },
    {
      key: 'down',
      title: `Move ${label} down`,
      icon: ArrowDown,
      run: () => onMove(1),
    },
    { key: 'copy', title: `Duplicate ${label}`, icon: Copy, run: onDuplicate },
    { key: 'remove', title: `Remove ${label}`, icon: X, run: onRemove },
  ];

  return (
    <div className="absolute -top-3.5 -right-2 z-10 flex gap-0.5 rounded-lg border border-input bg-card p-0.5 shadow-sm">
      {actions.map(({ key, title, icon: Icon, run }) => (
        <button
          key={key}
          type="button"
          aria-label={title}
          title={title}
          onClick={run}
          className="grid size-6 cursor-pointer place-items-center rounded-md text-ink-muted hover:bg-background hover:text-sals3-deep"
        >
          <Icon aria-hidden="true" className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

export default function StudioCanvas({
  blocks,
  selectedKey,
  onSelect,
  onChangeBlock,
  onMove,
  onDuplicate,
  onRemove,
}: StudioCanvasProps) {
  const groups = groupBlocks(blocks);
  const wideNotice = wideBlockNotice(blocks);

  return (
    <div className="mx-auto max-w-[840px]">
      <div className="mb-6 flex flex-wrap items-baseline gap-3">
        <h2 className="font-display m-0 text-[20px] font-semibold tracking-[-0.02em] text-ink">
          About this product
        </h2>
        <span className="text-xs text-ink-subtle">
          Set exactly as the product page will set it
        </span>
      </div>

      {groups.map((group) => {
        const isImageRow = group[0]?.block.type === 'image';
        /*
          A table escapes the measure for the same reason an image does, and
          for a stronger one. 70ch is sized for prose; a size chart squeezed
          into it is what this block type exists to stop being — the columns
          collapse, the numbers wrap, and the grid stops being scannable
          exactly where scanning is the point. The storefront makes the same
          exception, so previewing anything narrower here would be a preview
          that lies.
        */
        const isMeasuredText = !isImageRow && group[0]?.block.type !== 'table';

        return (
          <div
            key={group[0]?.key ?? 'empty'}
            className={cn(
              'mt-[22px] first:mt-0',
              isImageRow &&
                group.length > 1 &&
                'grid grid-cols-1 gap-4 sm:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]',
              // Text keeps the page's own measure and the guide that shows it.
              // Images and tables deliberately sit outside it.
              isMeasuredText &&
                'relative max-w-[70ch] before:absolute before:inset-y-[-8px] before:left-[-16px] before:border-l before:border-dashed before:border-sals3-bright/45 after:absolute after:inset-y-[-8px] after:right-[-16px] after:border-l after:border-dashed after:border-sals3-bright/45',
            )}
          >
            {group.map((entry) => {
              const isSelected = entry.key === selectedKey;
              const label =
                DESCRIPTION_BLOCK_LABELS[entry.block.type].toLowerCase();

              return (
                <div
                  key={entry.key}
                  className={cn(
                    'relative rounded-lg',
                    isSelected &&
                      'outline-2 outline-offset-[6px] outline-sals3-bright',
                  )}
                >
                  {isSelected ? (
                    <BlockHandles
                      label={label}
                      onMove={(direction) => onMove(entry.key, direction)}
                      onDuplicate={() => onDuplicate(entry.key)}
                      onRemove={() => onRemove(entry.key)}
                    />
                  ) : null}

                  {/*
                   * A button wrapper would nest the paragraph's own controls
                   * inside a button, which is invalid and unreachable by
                   * keyboard. `onFocus` covers the keyboard path instead: the
                   * fields inside are focusable, so tabbing to one selects its
                   * block.
                   */}
                  <div
                    role="presentation"
                    onFocus={() => onSelect(entry.key)}
                    onClick={() => onSelect(entry.key)}
                  >
                    <CanvasBlock
                      block={entry.block}
                      isSelected={isSelected}
                      runLength={isImageRow ? group.length : 1}
                      blockLabel={DESCRIPTION_BLOCK_LABELS[entry.block.type]}
                      onChange={(block) => onChangeBlock(entry.key, block)}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {blocks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-strong bg-card px-5 py-10 text-center">
          <p className="m-0 text-[15px] font-medium text-ink">
            No description yet
          </p>
          <p className="mx-auto mt-1.5 max-w-[46ch] text-[13.5px] leading-relaxed text-ink-muted">
            Add a block from the left, or start from a template. The listing can
            publish without a description, but the page will show only
            specifications.
          </p>
        </div>
      ) : null}

      {wideNotice === null ? null : (
        <p className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-sals3-bright px-2.5 py-1 text-[11px] text-sals3-deep">
          <MoveHorizontal aria-hidden="true" className="size-3" />
          {wideNotice}
        </p>
      )}
    </div>
  );
}
