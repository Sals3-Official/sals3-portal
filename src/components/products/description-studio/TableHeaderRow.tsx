'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MAX_LABEL_LENGTH } from '@/lib/products/description-blocks';

/**
 * The column-heading row of `DescriptionTableFields`'s editing grid.
 *
 * Split out of the main component so that component's own body stays a
 * rendering function rather than growing with every additional column
 * concern; this row and `TableBodyRow` are the two halves that shape splits
 * into.
 */
type TableHeaderRowProps = {
  headers: string[];
  onSetHeader: (index: number, value: string) => void;
  onRemoveColumn: (index: number) => void;
};

export default function TableHeaderRow({
  headers,
  onSetHeader,
  onRemoveColumn,
}: TableHeaderRowProps) {
  const columnCount = headers.length;

  return (
    <tr>
      {headers.map((header, columnIndex) => (
        // Index keys: a column is its position, and the block is re-rendered
        // whole on every edit.
        // eslint-disable-next-line react/no-array-index-key
        <th key={columnIndex} scope="col" className="p-1.5 align-top">
          <div className="flex items-center gap-1">
            <Input
              value={header}
              maxLength={MAX_LABEL_LENGTH}
              placeholder={`Column ${columnIndex + 1}`}
              aria-label={`Column ${columnIndex + 1} heading`}
              onChange={(event) => onSetHeader(columnIndex, event.target.value)}
              className="h-8 min-w-28 text-[13px] font-medium"
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`Remove column ${columnIndex + 1}`}
              // A table with no columns has nowhere to put a cell.
              disabled={columnCount === 1}
              onClick={() => onRemoveColumn(columnIndex)}
              className="size-7 shrink-0 p-0"
            >
              <X aria-hidden="true" className="size-3.5" />
            </Button>
          </div>
        </th>
      ))}
      {/* Head of the remove-row column. It must exist or the header row is
          one cell narrower than every body row — and it is named rather than
          left blank, because a control column with no heading is announced
          as an empty cell. */}
      <th scope="col" className="w-8">
        <span className="sr-only">Remove row</span>
      </th>
    </tr>
  );
}
