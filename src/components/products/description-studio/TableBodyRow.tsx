'use client';

import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MAX_TABLE_CELL_LENGTH } from '@/lib/products/description-blocks';

/** A column with no heading yet still has to be nameable in an `aria-label`. */
function columnName(headers: string[], index: number): string {
  const header = headers[index]?.trim() ?? '';

  return header === '' ? `Column ${index + 1}` : header;
}

/** A row is named by its first cell — the size code, in a size chart. */
function rowName(row: string[], index: number): string {
  const first = row[0]?.trim() ?? '';

  return first === '' ? `row ${index + 1}` : first;
}

/**
 * One data row of `DescriptionTableFields`'s editing grid: a cell input per
 * column, each labelled by the pairing `TableHeaderRow`'s heading and this
 * row's own name, plus the row's remove control.
 */
type TableBodyRowProps = {
  row: string[];
  rowIndex: number;
  headers: string[];
  /** Whether this is the only row left — the last row cannot be removed. */
  isOnlyRow: boolean;
  onSetCell: (rowIndex: number, columnIndex: number, value: string) => void;
  onRemoveRow: (rowIndex: number) => void;
};

export default function TableBodyRow({
  row,
  rowIndex,
  headers,
  isOnlyRow,
  onSetCell,
  onRemoveRow,
}: TableBodyRowProps) {
  return (
    <tr className="border-t border-border">
      {row.map((cell, columnIndex) => (
        // Index keys: a column is its position, and the block is re-rendered
        // whole on every edit.
        // eslint-disable-next-line react/no-array-index-key
        <td key={columnIndex} className="p-1.5 align-middle">
          <Input
            value={cell}
            maxLength={MAX_TABLE_CELL_LENGTH}
            aria-label={`${columnName(headers, columnIndex)} for ${rowName(row, rowIndex)}`}
            onChange={(event) =>
              onSetCell(rowIndex, columnIndex, event.target.value)
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
          disabled={isOnlyRow}
          onClick={() => onRemoveRow(rowIndex)}
          className="size-7 p-0"
        >
          <X aria-hidden="true" className="size-3.5" />
        </Button>
      </td>
    </tr>
  );
}
