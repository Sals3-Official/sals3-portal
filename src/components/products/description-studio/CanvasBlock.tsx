'use client';

/* eslint-disable jsx-a11y/no-autofocus -- Focus follows the block the seller
   just added or selected. Without it every insertion needs a second click
   before typing, which is worse for keyboard users, not better. */
/* eslint-disable react/no-array-index-key -- List items and detail rows carry
   no identity of their own and the block is re-rendered whole. */

import Image from 'next/image';
import InlineRunsText from '@/components/products/editor/InlineRunsText';
import { describeDescriptionImageSpec } from '@/lib/products/description-blocks';
import type { DescriptionBlock } from '@/lib/products/description-blocks';
import {
  plainTextOfRuns,
  runsFromPlainText,
  type InlineRun,
} from '@/lib/products/inline-runs';
import RichParagraphInput from './RichParagraphInput';

/**
 * One block, set exactly as the product page will set it.
 *
 * The type scale here is the PDP v3.1 target, not the 14px the storefront
 * renders today: 20px Outfit for the section heading, 16px Outfit for a block
 * heading, 15px/1.7 body in a 70ch measure, 12.5px captions. Calibrating to the
 * target is the point of the canvas — matching today's shipped page would mean
 * rebuilding this the week the redesign lands.
 *
 * Prose is edited in place because it has to be typed at the width it will be
 * read at. Multi-field blocks — lists, detail rows, images — are edited in the
 * inspector, where their fields have room and labels.
 */

const IMAGE_SIZES = '(min-width: 1280px) 760px, (min-width: 768px) 70vw, 100vw';

function ImageFigure({
  block,
  runLength,
}: {
  block: Extract<DescriptionBlock, { type: 'image' }>;
  runLength: number;
}) {
  // Adjacency decides the ratio, exactly as the page decides it: one image
  // alone is 16:9, two or more in a row are 4:3.
  const ratio = runLength > 1 ? 'aspect-[4/3]' : 'aspect-video';

  return (
    <figure className="m-0 flex flex-col gap-2">
      <div
        className={`${ratio} relative overflow-hidden rounded-xl border border-border bg-surface-sunken`}
      >
        {block.url === '' ? (
          <span className="absolute inset-0 grid flex-col place-items-center gap-1 px-3 text-center text-[12.5px] text-ink-subtle">
            <span>No image yet. Upload one in the panel on the right.</span>
            {/* The frame crops with `object-cover`, so the ratio is not advice
                — it is what the seller loses if they ignore it. */}
            <span className="font-medium text-ink-muted">
              {describeDescriptionImageSpec(runLength)}
            </span>
          </span>
        ) : (
          <Image
            src={block.url}
            alt={block.alt}
            fill
            sizes={IMAGE_SIZES}
            loading="lazy"
            className="object-cover"
          />
        )}
      </div>
      {block.caption === undefined || block.caption === '' ? null : (
        <figcaption className="text-[12.5px] leading-[1.55] text-ink-subtle">
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * The table as the product page will draw it: a real `<table>`, outside the
 * reading measure, in its own horizontal scroller.
 *
 * Deliberately close to `sals3-ecommerce`'s `DescriptionTable` rather than to
 * the inspector's editing grid. The canvas's whole claim is that it sets
 * content "exactly as the product page will set it", and a table is the one
 * block where a seller can most easily build something that looks fine in a
 * form and is unreadable on a phone — eight columns of measurements is the
 * shape that does it. Previewing the scroller is how they find that out here
 * instead of after publishing.
 *
 * The first cell of each row is a `<th scope="row">`, matching the storefront:
 * in a size chart the leftmost column is the size, and it names every number
 * beside it.
 */
function TablePreview({
  block,
}: {
  block: Extract<DescriptionBlock, { type: 'table' }>;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-[13.5px]">
        {block.caption === undefined || block.caption === '' ? null : (
          <caption className="px-3 py-2 text-left text-[12.5px] text-ink-subtle">
            {block.caption}
          </caption>
        )}
        <thead className="bg-surface-sunken">
          <tr>
            {block.headers.map((header, index) => (
              <th
                // Index keys: a column is its position, and the block is
                // re-rendered whole on every edit.
                key={`header-${index}`}
                scope="col"
                className="border-b border-border px-3 py-2 text-left font-semibold whitespace-nowrap text-ink"
              >
                {header === '' ? (
                  <span className="font-normal text-ink-subtle italic">
                    Column {index + 1}
                  </span>
                ) : (
                  header
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {block.rows.map((row, rowIndex) => (
            <tr key={`row-${rowIndex}`} className="border-t border-border">
              {row.map((cell, columnIndex) =>
                columnIndex === 0 ? (
                  <th
                    key={`cell-${columnIndex}`}
                    scope="row"
                    className="px-3 py-2 text-left font-medium whitespace-nowrap text-ink"
                  >
                    {cell}
                  </th>
                ) : (
                  <td
                    key={`cell-${columnIndex}`}
                    className="px-3 py-2 text-ink-muted"
                  >
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type CanvasBlockProps = {
  block: DescriptionBlock;
  isSelected: boolean;
  /** How many images this block's consecutive run holds. 1 for a text block. */
  runLength: number;
  onChange: (block: DescriptionBlock) => void;
  blockLabel: string;
};

export default function CanvasBlock({
  block,
  isSelected,
  runLength,
  onChange,
  blockLabel,
}: CanvasBlockProps) {
  if (block.type === 'image') {
    return <ImageFigure block={block} runLength={runLength} />;
  }

  if (block.type === 'paragraph') {
    /*
      `whitespace-pre-line` on both previews below, because this canvas claims
      to set text "exactly as the product page will set it" (`StudioCanvas`)
      and the product page now honours a paragraph's single newlines.

      Those newlines are deliberate: `descriptionTextToBlocks` keeps them inside
      the block rather than splitting on them, so a seller writing a heading
      line and one line per feature gets one paragraph carrying the layout they
      typed. Without this the seller previewed a run-on line, published, and
      found the storefront had rendered something else — the preview's own
      promise broken by the surface making it.

      `pre-line` rather than `pre-wrap`, matching the storefront: newlines are
      honoured, runs of spaces still collapse, so an accidental double space is
      not previewed as if it would publish.
    */
    const runs: InlineRun[] = block.runs ?? runsFromPlainText(block.text);

    if (!isSelected) {
      return block.text === '' ? (
        <p className="m-0 text-[15px] leading-[1.7] text-ink-subtle italic">
          Empty paragraph. Select it to write.
        </p>
      ) : (
        <p className="m-0 text-[15px] leading-[1.7] whitespace-pre-line text-ink-muted text-pretty">
          <InlineRunsText text={block.text} runs={block.runs} />
        </p>
      );
    }

    const hasEmphasis = runs.some((run) => (run.marks ?? []).length > 0);

    return (
      <div className="flex flex-col gap-2">
        {/* Shown only when there is emphasis to see. Without marks it would
            repeat the field below it word for word. */}
        {hasEmphasis ? (
          <p className="m-0 text-[15px] leading-[1.7] whitespace-pre-line text-ink-muted text-pretty">
            <InlineRunsText text={block.text} runs={block.runs} />
          </p>
        ) : null}
        <RichParagraphInput
          runs={runs}
          blockLabel={blockLabel}
          onChange={(nextRuns) => {
            const text = plainTextOfRuns(nextRuns);
            const isPlain = nextRuns.every(
              (run) => (run.marks ?? []).length === 0,
            );

            // `runs` is omitted entirely for unemphasised text: the document
            // schema refuses an empty list, and one canonical spelling of "no
            // emphasis" keeps the revision checksum stable.
            onChange(
              isPlain
                ? { type: 'paragraph', text }
                : { type: 'paragraph', text, runs: nextRuns },
            );
          }}
        />
      </div>
    );
  }

  if (block.type === 'heading') {
    const className =
      block.level === 2
        ? 'font-display text-[18px] font-semibold text-ink'
        : 'font-display text-[16px] font-semibold text-ink';

    if (!isSelected) {
      return block.text === '' ? (
        <p className={`m-0 ${className} text-ink-subtle italic`}>
          Empty heading. Select it to write.
        </p>
      ) : (
        <p className={`m-0 ${className}`}>{block.text}</p>
      );
    }

    return (
      <input
        autoFocus
        value={block.text}
        aria-label={blockLabel}
        placeholder="Section heading"
        onChange={(event) => onChange({ ...block, text: event.target.value })}
        className={`w-full rounded-lg border border-input bg-card px-3 py-2 ${className} placeholder:font-normal placeholder:text-ink-subtle focus-visible:border-transparent focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-sals3-bright`}
      />
    );
  }

  if (block.type === 'bulletList') {
    return (
      <ul className="m-0 flex list-disc flex-col gap-2 pl-5 marker:text-ink-subtle">
        {block.items.map((item, index) => (
          <li
            // Index keys: this list is rendered whole and reordering happens in
            // the inspector, which rebuilds the block.
            key={`${index}-${item}`}
            className="text-[15px] leading-[1.7] text-ink-muted"
          >
            {item === '' ? (
              <span className="text-ink-subtle italic">Empty item</span>
            ) : (
              item
            )}
          </li>
        ))}
      </ul>
    );
  }

  if (block.type === 'table') {
    return <TablePreview block={block} />;
  }

  return (
    <dl className="m-0 grid grid-cols-1 gap-x-5 gap-y-2.5 sm:grid-cols-[minmax(0,150px)_minmax(0,1fr)]">
      {block.entries.flatMap((entry, index) => [
        <dt
          key={`label-${index}-${entry.label}`}
          className="text-[13.5px] text-ink-subtle"
        >
          {entry.label === '' ? 'Untitled' : entry.label}
        </dt>,
        <dd
          key={`value-${index}-${entry.value}`}
          className="m-0 text-[15px] text-ink"
        >
          {entry.value === '' ? (
            <span className="text-ink-subtle italic">Empty</span>
          ) : (
            entry.value
          )}
        </dd>,
      ])}
    </dl>
  );
}
