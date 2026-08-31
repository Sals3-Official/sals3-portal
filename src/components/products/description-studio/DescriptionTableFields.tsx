'use client';

import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  type TableBlock,
} from '@/lib/products/description-blocks';
import { createTableGridActions } from './table-grid-actions';
import TableBodyRow from './TableBodyRow';
import TableHeaderRow from './TableHeaderRow';

/**
 * The grid, edited as a grid.
 *
 * ## Why it is a `<table>` of inputs and not a list of rows
 *
 * The other multi-field blocks are stacks — a detail row is a label and a
 * value, and a column of those reads fine in a 300px panel. A table is the one
 * block whose *shape* is the content: which column a number sits under is the
 * whole meaning of a size chart, and an editor that stacked the cells would
 * make the seller hold that mapping in their head while typing it. So the
 * editor is laid out the way the page will lay it out, and the column headings
 * are the header row of the same grid rather than a separate list of fields.
 *
 * ## Its own scroll container
 *
 * Borrowed wholesale from `ManualAssignmentTable`, which solved the same
 * problem for the variant matrix: eight columns of inputs cannot fit a 300px
 * inspector, and a grid that widens its parent makes the whole editor scroll
 * sideways. `max-h-96 overflow-auto` keeps the scrolling inside the grid, and
 * the header row is `sticky` against it so the column a cell belongs to stays
 * on screen while typing row thirty.
 *
 * ## Every cell says where it is
 *
 * `aria-label` on each input combines the column heading with the row's first
 * cell, so a screen reader announces "Hips for XL" rather than "textbox". That
 * pairing is the only thing that makes a grid navigable without sight, and it
 * is the same construction `ManualAssignmentTable` uses.
 *
 * ## Split into three files
 *
 * The mutations (`createTableGridActions`) and the two row shapes
 * (`TableHeaderRow`, `TableBodyRow`) are their own modules, so this component
 * is left as what it names itself: the grid's layout and its add-row/add-column
 * controls, not also six state transitions and both rows' full field markup.
 */
type DescriptionTableFieldsProps = {
  block: TableBlock;
  onChange: (block: TableBlock) => void;
};

export default function DescriptionTableFields({
  block,
  onChange,
}: DescriptionTableFieldsProps) {
  const actions = createTableGridActions(block, onChange);
  const columnCount = block.headers.length;

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[12.5px] font-semibold text-ink">
        Columns and rows
      </p>

      <div className="max-h-96 overflow-auto rounded-md border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <TableHeaderRow
              headers={block.headers}
              onSetHeader={actions.setHeader}
              onRemoveColumn={actions.removeColumn}
            />
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <TableBodyRow
                // Index keys: a row is its position, and the block is
                // re-rendered whole on every edit.
                // eslint-disable-next-line react/no-array-index-key
                key={rowIndex}
                row={row}
                rowIndex={rowIndex}
                headers={block.headers}
                isOnlyRow={block.rows.length === 1}
                onSetCell={actions.setCell}
                onRemoveRow={actions.removeRow}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={block.rows.length >= MAX_TABLE_ROWS}
          onClick={actions.addRow}
        >
          <Plus aria-hidden="true" />
          Add row
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={columnCount >= MAX_TABLE_COLUMNS}
          onClick={actions.addColumn}
        >
          <Plus aria-hidden="true" />
          Add column
        </Button>
      </div>

      <p className="m-0 text-[11.5px] leading-relaxed text-ink-subtle">
        Up to {MAX_TABLE_COLUMNS} columns and {MAX_TABLE_ROWS} rows. Leave a
        cell blank where a measurement does not apply — a row that is blank all
        the way across is dropped when you save.
      </p>
    </div>
  );
}
