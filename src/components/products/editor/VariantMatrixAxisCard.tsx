'use client';

import type { CSSProperties, ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The card chrome around one Variant Matrix axis, shared by both editing modes.
 *
 * ## Why this exists
 *
 * The matrix is edited on two occasions — naming it for the first time, and
 * renaming a saved one — and each rendered its own card markup. They had already
 * drifted once (see `VariantMatrixValueRow`'s note on the reorder arrows that
 * only one of them had). One card, both callers.
 *
 * ## The two-column value grid
 *
 * The *idea* is borrowed — a marketplace seller centre that lays option values
 * two-up rather than in one tall column — because the problem it solves is real
 * here: on a four-colour, four-size product the stacked list ran the full height
 * of the viewport, so the pricing table underneath, the part a seller actually
 * came to fill in, started below the fold on a screen with room to spare.
 *
 * Everything visible about it is Sals3's own. The card is titled in this
 * editor's vocabulary (`Option`, never `Variation` — seller-facing copy was
 * deliberately moved off "Option groups" onto **Variant Matrix**, and importing
 * a third word would undo that), the ordinal is the portal's gradient chip, the
 * required marker is the same dot the rest of the editor uses rather than an
 * asterisk, and the header carries the axis name once the seller supplies one —
 * so a named card reads `1 · Colour` instead of repeating a generic label the
 * field below it already shows.
 *
 * It is built from two `flex-col` columns rather than a two-column grid with
 * `grid-auto-flow: column`, and that is the whole reason it is safe: the values
 * are chunked **column-major**, so the array order the reorder arrows move
 * through runs top-to-bottom inside each visible column. A row-major grid would
 * have made the ▲ button move a value *left* instead of up, which is a different
 * control wearing the same icon. Below `lg` the two columns stack and the
 * reading order collapses back to plain array order.
 *
 * A single column is kept for three values or fewer: splitting three rows across
 * two columns leaves one stranded beside a gap and reads as a missing field.
 *
 * ## Open: a photo per option value
 *
 * Requested 2026-08-22 — upload a picture against each value here, the way a
 * marketplace shows one photo per colour swatch. It is **not built, and cannot
 * be built as presentation**: media attaches to a *variant*
 * (`product_media_sources.variant_id`, one nullable column that
 * `assignVariantMedia` moves rather than copies) and
 * `product_media_sources_product_checksum_key` makes the same file
 * unrepeatable within a product. So one photo cannot stand for the four
 * variants carrying `black`. A real option-value photo needs its own column or
 * join table, its DDL applied to production *before* the Drizzle schema learns
 * it — this table is written by draft creation, publication and every seller
 * upload, and Drizzle names every column in an `INSERT` — plus the storefront
 * read model and the PDP swatch to consume it. Owner decision pending; do not
 * approximate it here.
 */

export type VariantMatrixAxisCardProps = {
  /** 1-based, matching the `Option {n} name` field this card holds. */
  ordinal: number;
  /**
   * The name the seller has given this axis, live. Shown beside the ordinal
   * once it is non-empty, so a card the seller has already answered says what
   * it is instead of repeating the generic label its own field carries.
   */
  axisName?: string;
  /**
   * Whether leaving this axis unnamed actually refuses publication. Drives the
   * required marker, which must never claim a gate the server does not raise —
   * a single-axis product is nameable but publishes either way.
   */
  required?: boolean;
  /** The name input, its error, and any category suggestion buttons. */
  nameField: ReactNode;
  /** One `VariantMatrixValueRow` per value, in axis order, keyed by the caller. */
  valueRows: ReactNode[];
};

/** Wider than three values earns the second column. See the note above. */
const TWO_COLUMN_THRESHOLD = 3;

/**
 * The header sitting over one column of value rows.
 *
 * Repeated per column so each label sits over the alignment it describes: the
 * supplier ledger is right-aligned to its gutter, so its heading is too. Only
 * the first copy is announced — a second column of the same two words tells a
 * screen reader nothing and turns one heading into two.
 *
 * The repeat is also `hidden` below `lg`, and that is not cosmetic. Below the
 * breakpoint the two columns stack into one list, so the second header stopped
 * being a column heading and became a duplicate row of labels sitting between
 * `camel` and `pink` — which reads as the start of a second option group. Found
 * by screenshotting the section at 900px rather than by reading the diff.
 */
function ValueColumnHeader({ muted }: { muted: boolean }) {
  return (
    <div
      aria-hidden={muted ? 'true' : undefined}
      className={cn(
        'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase',
        muted ? 'hidden lg:grid' : 'grid',
      )}
    >
      <span className="flex items-center justify-end gap-1 pr-3">
        <Lock aria-hidden="true" className="size-3" />
        Supplier value
      </span>
      <span>Shown to buyers</span>
      <span className="sr-only">Reorder</span>
    </div>
  );
}

/**
 * Column-major, so array order reads downwards inside each column.
 *
 * Each chunk carries its own id: these are slices of one ordered array rather
 * than entities, so there is no natural key, and a positional one would be the
 * array-index key that misbinds React state on a reorder.
 */
function splitIntoColumns(
  rows: ReactNode[],
): { id: 'left' | 'right'; rows: ReactNode[] }[] {
  if (rows.length <= TWO_COLUMN_THRESHOLD) return [{ id: 'left', rows }];

  const height = Math.ceil(rows.length / 2);

  return [
    { id: 'left', rows: rows.slice(0, height) },
    { id: 'right', rows: rows.slice(height) },
  ];
}

export default function VariantMatrixAxisCard({
  ordinal,
  axisName,
  required = false,
  nameField,
  valueRows,
}: VariantMatrixAxisCardProps) {
  const columns = splitIntoColumns(valueRows);
  const named = axisName !== undefined && axisName.trim() !== '';

  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-background/60">
      <span
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[#018CC9] to-[#002B53]"
      />

      {/* Card header: which axis this is, and how many values it holds. The
          count is the same fact the seller would otherwise get by counting
          rows, and it is what makes a scrolled card still readable. No fill
          behind it - the portal separates a card header with a hairline and
          the gradient rule above, not with a grey band. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 pt-3 pb-2">
        <h4 className="flex items-center gap-2 text-sm font-semibold">
          <span
            aria-hidden="true"
            className="flex size-5 items-center justify-center rounded-md bg-gradient-to-br from-[#018CC9] to-[#002B53] text-[10px] font-semibold text-white"
          >
            {ordinal}
          </span>
          {/*
            The ordinal is in the chip beside this, so the word only appears
            while the axis is still unnamed. Once the seller answers, the card
            says `Colour` - the field below already carries `Option 1 name`,
            and repeating it in the header teaches nothing.
          */}
          <span className={named ? undefined : 'text-ink-muted'}>
            {named ? axisName : `Option ${ordinal}`}
          </span>
          {required ? (
            <span aria-hidden="true" className="text-destructive">
              •
            </span>
          ) : null}
        </h4>
        <span className="text-[11px] text-muted-foreground">
          {valueRows.length} {valueRows.length === 1 ? 'value' : 'values'}
        </span>
      </div>

      <div className="flex flex-col gap-3 p-3">
        {nameField}

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-ink-muted">Options</span>
          <div
            className="grid grid-cols-1 gap-x-6 gap-y-2 lg:grid-cols-[repeat(var(--matrix-columns),minmax(0,1fr))]"
            // Custom property rather than a second branch in TypeScript: the
            // column count is then a `lg:` decision in CSS, so the stacked
            // small-screen layout needs no separate code path. Cast because
            // `CSSProperties` has no index signature for custom properties.
            style={{ '--matrix-columns': columns.length } as CSSProperties}
          >
            {columns.map((column) => (
              <div key={column.id} className="flex flex-col gap-2">
                <ValueColumnHeader muted={column.id !== 'left'} />
                {column.rows}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
