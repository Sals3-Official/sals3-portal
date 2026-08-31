import type { TableBlock } from '@/lib/products/description-blocks';

/**
 * The six ways a table block's grid changes, extracted from the component
 * that renders them.
 *
 * A plain function rather than a hook: nothing here holds its own React
 * state — every action reads the current `block` prop and calls `onChange`
 * with the next one, the same controlled-component shape the rest of the
 * description studio uses. Extracting it is what keeps
 * `DescriptionTableFields` a rendering function rather than a 200-line
 * mixture of state transitions and JSX.
 *
 * `addColumn`/`removeColumn` touch `headers` and every row's array together,
 * in one `onChange`. That is not a convenience: a document whose rows are not
 * all the width of the header row is refused by the schema, and — worse —
 * would print a seller's numbers under the wrong headings if it ever reached
 * a buyer. Keeping the grid rectangular *by construction* is what makes that
 * refusal unreachable from this screen rather than a trap waiting in it.
 */
export type TableGridActions = {
  setHeader: (index: number, value: string) => void;
  setCell: (rowIndex: number, columnIndex: number, value: string) => void;
  addColumn: () => void;
  removeColumn: (index: number) => void;
  addRow: () => void;
  removeRow: (index: number) => void;
};

export function createTableGridActions(
  block: TableBlock,
  onChange: (block: TableBlock) => void,
): TableGridActions {
  return {
    setHeader(index, value) {
      onChange({
        ...block,
        headers: block.headers.map((header, position) =>
          position === index ? value : header,
        ),
      });
    },

    setCell(rowIndex, columnIndex, value) {
      onChange({
        ...block,
        rows: block.rows.map((row, position) =>
          position === rowIndex
            ? row.map((cell, column) => (column === columnIndex ? value : cell))
            : row,
        ),
      });
    },

    addColumn() {
      onChange({
        ...block,
        headers: [...block.headers, ''],
        rows: block.rows.map((row) => [...row, '']),
      });
    },

    removeColumn(index) {
      onChange({
        ...block,
        headers: block.headers.filter((_, position) => position !== index),
        rows: block.rows.map((row) =>
          row.filter((_, position) => position !== index),
        ),
      });
    },

    addRow() {
      const columnCount = block.headers.length;

      onChange({
        ...block,
        rows: [...block.rows, Array.from({ length: columnCount }, () => '')],
      });
    },

    removeRow(index) {
      onChange({
        ...block,
        rows: block.rows.filter((_, position) => position !== index),
      });
    },
  };
}
