import { minorToPesoInput } from '@/lib/money';
import { totalStock } from './query';
import type { Product } from './types';

/**
 * CSV export and import parsing.
 *
 * Values are quoted and internal quotes are doubled, so a product name with a
 * comma cannot shift the columns. A leading `=`, `+`, `-`, or `@` is prefixed
 * with an apostrophe: without it, a spreadsheet treats the cell as a formula,
 * which is the CSV injection path out of an admin export.
 */

export const CSV_COLUMNS = [
  'sku',
  'name',
  'category',
  'brand',
  'status',
  'regular_price',
  'sale_price',
  'stock',
  'barcode',
  'slug',
] as const;

function escapeCell(value: string): string {
  const guarded = /^[=+\-@]/.test(value) ? `'${value}` : value;

  return `"${guarded.replace(/"/g, '""')}"`;
}

export function productsToCsv(products: readonly Product[]): string {
  const header = CSV_COLUMNS.join(',');
  const rows = products.map((product) =>
    [
      product.identifiers.sku,
      product.name,
      product.category,
      product.brand,
      product.status,
      minorToPesoInput(product.pricing.regularMinor),
      product.pricing.saleMinor === null
        ? ''
        : minorToPesoInput(product.pricing.saleMinor),
      String(totalStock(product)),
      product.identifiers.barcode ?? '',
      product.seo.slug,
    ]
      .map(escapeCell)
      .join(','),
  );

  return [header, ...rows].join('\n');
}

/** Splits one CSV line, honouring quoted cells and doubled quotes. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }

  cells.push(cell);

  return cells;
}

export type CsvPreviewRow = {
  line: number;
  values: Record<string, string>;
};

export type CsvPreview = {
  rows: CsvPreviewRow[];
  errors: string[];
};

const MAX_IMPORT_ROWS = 500;

/**
 * Reads an uploaded CSV into rows plus a list of problems. Nothing is written:
 * an import must be reviewed before it is applied, and the apply step is not
 * built yet.
 */
export function previewCsv(text: string): CsvPreview {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

  if (lines.length === 0) {
    return { rows: [], errors: ['The file is empty.'] };
  }

  const header = splitCsvLine(lines[0]).map((cell) =>
    cell.trim().toLowerCase(),
  );
  const missing = CSV_COLUMNS.filter((column) => !header.includes(column));
  const errors: string[] = [];

  if (missing.length > 0) {
    errors.push(`These columns are missing: ${missing.join(', ')}.`);
  }

  const body = lines.slice(1, MAX_IMPORT_ROWS + 1);

  if (lines.length - 1 > MAX_IMPORT_ROWS) {
    errors.push(
      `The file has ${lines.length - 1} rows. Only the first ${MAX_IMPORT_ROWS} are shown.`,
    );
  }

  const rows = body.map((line, index) => {
    const cells = splitCsvLine(line);

    return {
      line: index + 2,
      values: Object.fromEntries(
        header.map((column, position) => [column, cells[position] ?? '']),
      ),
    };
  });

  return { rows, errors };
}
