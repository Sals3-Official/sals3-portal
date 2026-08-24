'use client';

import {
  AlignLeft,
  Heading,
  Image as ImageIcon,
  Images,
  LayoutGrid,
  List,
  Rows3,
} from 'lucide-react';
import type { DescriptionBlockType } from '@/lib/products/description-blocks';

/**
 * What the seller can add, named after what the product page produces.
 *
 * The image entries are layout presets, not block types. The page derives image
 * layout from adjacency — one image alone runs full width at 16:9, two or more
 * pair into a grid at 4:3 — so "Two images side by side" is two consecutive
 * image blocks. Storing a group would mean a container a delete can leave
 * half-empty; deriving it cannot.
 *
 * Only layouts the page actually renders appear here. A preset the page cannot
 * produce would make this canvas a preview that lies.
 */
export type PaletteEntry = {
  id: string;
  label: string;
  type: DescriptionBlockType;
  count: number;
  hint?: string;
  icon: typeof AlignLeft;
};

export const PALETTE_TEXT: PaletteEntry[] = [
  {
    id: 'paragraph',
    label: 'Paragraph',
    type: 'paragraph',
    count: 1,
    icon: AlignLeft,
  },
  { id: 'heading', label: 'Heading', type: 'heading', count: 1, icon: Heading },
  {
    id: 'bulletList',
    label: 'Bullet list',
    type: 'bulletList',
    count: 1,
    icon: List,
  },
  {
    id: 'keyValueList',
    label: 'Detail list',
    type: 'keyValueList',
    count: 1,
    icon: Rows3,
  },
];

export const PALETTE_IMAGES: PaletteEntry[] = [
  {
    id: 'image',
    label: 'Image',
    type: 'image',
    count: 1,
    hint: 'Full width',
    icon: ImageIcon,
  },
  {
    id: 'image-pair',
    label: 'Two images',
    type: 'image',
    count: 2,
    hint: 'Side by side',
    icon: Images,
  },
  {
    id: 'image-trio',
    label: 'Three images',
    type: 'image',
    count: 3,
    hint: 'Row of three',
    icon: LayoutGrid,
  },
];

/**
 * The one designed layout, in the order `Sals3 PDP Redesign v3.1.dc.html`
 * draws it: a sub-heading, the opening paragraph, one full-width photo, the
 * feature list, two detail photos side by side, then the specifics.
 *
 * ## One, not a menu per category family
 *
 * Three category templates stood here (Apparel / Electronics / Beauty) and none
 * of them included an `image`, so the layout a seller landed on was never the
 * one the product page was designed around. Owner decision 2026-08-24: there is
 * one designed layout, and it is the canvas's. A picker also asks the seller to
 * choose before they have written anything, which is a question they cannot
 * answer yet and a decision the design has already made.
 *
 * ## It writes no copy, and that is what makes it safe to apply by default
 *
 * Every entry becomes `emptyBlockOfType`, so this adds structure and not one
 * word. Pre-written marketing prose would put words in a seller's mouth and
 * land unedited on a buyer's page — the same objection that keeps the category
 * workbook's attribute-family suggestion behind a button instead of pre-filling
 * it. Because `prepareBlocksForSave` drops every empty block, a seller who
 * opens the studio and leaves saves exactly the empty document they arrived
 * with: the layout is a starting shape, never stored content.
 *
 * The pair of consecutive `image` entries is deliberate. The product page
 * derives image layout from adjacency — one alone runs full width at 16:9, two
 * or more pair into a grid at 4:3 — so two blocks in a row *are* the side-by-side
 * row, and there is nothing else to store.
 */
export const DEFAULT_DESIGN_LAYOUT: DescriptionBlockType[] = [
  'heading',
  'paragraph',
  'image',
  'bulletList',
  'image',
  'image',
  'keyValueList',
];

const DEFAULT_LAYOUT_OUTLINE =
  'Intro · full-width photo · features · two photos · details';

type BlockPaletteProps = {
  onAdd: (entry: PaletteEntry) => void;
  onApplyLayout: (types: DescriptionBlockType[]) => void;
  /** Blocks still available before `MAX_BLOCKS`, so a preset cannot overrun it. */
  remaining: number;
  /**
   * False once the canvas holds anything, because applying the layout replaces
   * the canvas outright. The studio seeds a new description with it already, so
   * this is the control for putting it back after a seller has cleared
   * everything — never a way to discard work in progress.
   */
  canApplyLayout: boolean;
};

function PaletteButton({
  entry,
  disabled,
  onAdd,
}: {
  entry: PaletteEntry;
  disabled: boolean;
  onAdd: (entry: PaletteEntry) => void;
}) {
  const Icon = entry.icon;

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onAdd(entry)}
      className="mb-1.5 flex min-h-[38px] w-full cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-2.5 py-2 text-left text-[13.5px] text-ink transition-colors hover:border-sals3-bright hover:bg-background disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-sals3-deep" />
      {entry.label}
      {entry.hint === undefined ? null : (
        <span className="ml-auto text-[11.5px] text-ink-subtle">
          {entry.hint}
        </span>
      )}
    </button>
  );
}

export default function BlockPalette({
  onAdd,
  onApplyLayout,
  remaining,
  canApplyLayout,
}: BlockPaletteProps) {
  return (
    <div className="flex flex-col">
      <p className="mb-2 ml-1 text-[10.5px] font-bold tracking-[0.09em] text-ink-subtle uppercase">
        Add block
      </p>
      {PALETTE_TEXT.map((entry) => (
        <PaletteButton
          key={entry.id}
          entry={entry}
          disabled={remaining < entry.count}
          onAdd={onAdd}
        />
      ))}

      <hr className="mx-1 my-4 border-border" />
      <p className="mb-2 ml-1 text-[10.5px] font-bold tracking-[0.09em] text-ink-subtle uppercase">
        Add images
      </p>
      {PALETTE_IMAGES.map((entry) => (
        <PaletteButton
          key={entry.id}
          entry={entry}
          disabled={remaining < entry.count}
          onAdd={onAdd}
        />
      ))}

      <hr className="mx-1 my-4 border-border" />
      <p className="mb-2 ml-1 text-[10.5px] font-bold tracking-[0.09em] text-ink-subtle uppercase">
        Layout
      </p>
      <button
        type="button"
        disabled={!canApplyLayout || remaining < DEFAULT_DESIGN_LAYOUT.length}
        onClick={() => onApplyLayout(DEFAULT_DESIGN_LAYOUT)}
        className="min-h-[34px] cursor-pointer rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-sals3-deep hover:bg-background disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
      >
        Standard layout
        <span className="block text-[11.5px] font-normal text-ink-subtle">
          {DEFAULT_LAYOUT_OUTLINE}
        </span>
      </button>
      <p className="mt-3 ml-1 text-[11.5px] leading-relaxed text-ink-subtle">
        A new description already starts in this layout. It adds empty blocks
        and writes no copy for you.
      </p>
    </div>
  );
}
