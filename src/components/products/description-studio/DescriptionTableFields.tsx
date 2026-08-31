'use client';

/* eslint-disable react/no-array-index-key -- A column is identified by its
   position and a row by its order; neither carries an id, and every edit
   rebuilds the whole block, so the position *is* the identity. Storing an id
   would put one in the document the storefront would then have to ignore. */
/* eslint-disable react/jsx-no-bind -- Every handler closes over the row or
   column index it acts on, so none can be hoisted out of the grid it renders. */

import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  MAX_LABEL_LENGTH,
  MAX_TABLE_CELL_LENGTH,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  type TableBlock,
} from '@/lib/products/description-blocks';

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
 */

/** A column with no heading yet still has to be nameable in an `aria-label`. */
function columnName(headers: string[], index: number): string {
  const header = headers[index]?.trim() ?? '';

  return header === '' ? `Column ${index + 1}` : header;
}

/** A row is named by its first cell — the size code, in a size chart. */
function rowName(row: string[] | undefined, index: number): string {
  const first = row?.[0]?.trim() ?? '';

  return first === '' ? `row ${index + 1}` : first;
}

type DescriptionTableFieldsProps = {
  block: TableBlock;
  onChange: (block: TableBlock) => void;
};

export default function DescriptionTableFields({
  block,
  onChange,
}: DescriptionTableFieldsProps) {
  const columnCount = block.headers.length;

  function setHeader(index: number, value: string) {
    onChange({
      ...block,
      headers: block.headers.map((header, position) =>
        position === index ? value : header,
      ),
    });
  }

  function setCell(rowIndex: number, columnIndex: number, value: string) {
    onChange({
      ...block,
      rows: block.rows.map((row, position) =>
        position === rowIndex
          ? row.map((cell, column) => (column === columnIndex ? value : cell))
          : row,
      ),
    });
  }

  /*
    Both dimensions change every row at once, in one update. That is not a
    convenience: a document whose rows are not all the width of the header row
    is refused by the schema, and — worse — would print a seller's numbers
    under the wrong headings if it ever reached a buyer. Keeping the grid
    rectangular *by construction* is what makes that refusal unreachable from
    this screen rather than a trap waiting in it.
  */
  function addColumn() {
    onChange({
      ...block,
      headers: [...block.headers, ''],
      rows: block.rows.map((row) => [...row, '']),
    });
  }

  function removeColumn(index: number) {
    onChange({
      ...block,
      headers: block.headers.filter((_, position) => position !== index),
      rows: block.rows.map((row) =>
        row.filter((_, position) => position !== index),
      ),
    });
  }

  function addRow() {
    onChange({
      ...block,
      rows: [...block.rows, Array.from({ length: columnCount }, () => '')],
    });
  }

  function removeRow(index: number) {
    onChange({
      ...block,
      rows: block.rows.filter((_, position) => position !== index),
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="m-0 text-[12.5px] font-semibold text-ink">
        Columns and rows
      </p>

      <div className="max-h-96 overflow-auto rounded-md border border-border">
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted">
            <tr>
              {block.headers.map((header, columnIndex) => (
                <th key={columnIndex} scope="col" className="p-1.5 align-top">
                  <div className="flex items-center gap-1">
                    <Input
                      value={header}
                      maxLength={MAX_LABEL_LENGTH}
                      placeholder={`Column ${columnIndex + 1}`}
                      aria-label={`Column ${columnIndex + 1} heading`}
                      onChange={(event) =>
                        setHeader(columnIndex, event.target.value)
                      }
                      className="h-8 min-w-28 text-[13px] font-medium"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove column ${columnIndex + 1}`}
                      // A table with no columns has nowhere to put a cell.
                      disabled={columnCount === 1}
                      onClick={() => removeColumn(columnIndex)}
                      className="size-7 shrink-0 p-0"
                    >
                      <X aria-hidden="true" className="size-3.5" />
                    </Button>
                  </div>
                </th>
              ))}
              {/* Head of the remove-row column. It must exist or the header row
                  is one cell narrower than every body row — and it is named
                  rather than left blank, because a control column with no
                  heading is announced as an empty cell. */}
              <th scope="col" className="w-8">
                <span className="sr-only">Remove row</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-border">
                {row.map((cell, columnIndex) => (
                  <td key={columnIndex} className="p-1.5 align-middle">
                    <Input
                      value={cell}
                      maxLength={MAX_TABLE_CELL_LENGTH}
                      aria-label={`${columnName(block.headers, columnIndex)} for ${rowName(row, rowIndex)}`}
                      onChange={(event) =>
                        setCell(rowIndex, columnIndex, event.target.value)
                      }
                      className="h-8 min-w-28 text-[13px]"
                    />
                  </td>
                ))}
                <td className="p-1.5 align-middle">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove row ${rowIndex + 1}`}
                    disabled={block.rows.length === 1}
                    onClick={() => removeRow(rowIndex)}
                    className="size-7 p-0"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </Button>
                </td>
              </tr>
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
          onClick={addRow}
        >
          <Plus aria-hidden="true" />
          Add row
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={columnCount >= MAX_TABLE_COLUMNS}
          onClick={addColumn}
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
