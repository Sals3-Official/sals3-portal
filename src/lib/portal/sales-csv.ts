import type { SellerSoldRow } from '@/modules/orders/seller-sold-read';

/**
 * The Sold tab as a spreadsheet.
 *
 * ## Why every cell is sanitised
 *
 * A product title is seller-authored text, and Excel, LibreOffice and Sheets all
 * treat a cell beginning `=`, `+`, `-`, `@` or a lone tab/carriage return as a
 * **formula**. A title like `=HYPERLINK("http://evil","Click")` therefore stops
 * being a title the moment the file is opened — the export becomes an execution
 * vector against whoever opens it, which is a real and well-documented class of
 * attack, not a theoretical one.
 *
 * Prefixing a single quote is the standard defusal: spreadsheets read it as
 * "this is text", strip it on display, and the seller sees their title.
 *
 * ## Why the numbers are unformatted
 *
 * `formatMinorUnits` renders `1,129.99 USD` for the screen. A spreadsheet cannot
 * sum that — the comma and the suffix make it a string. So money leaves here as
 * a bare major-unit decimal with the currency in its own column, which is the
 * whole reason someone exports rather than reading the screen.
 */

const CSV_HEADERS = [
  'Rank',
  'Product',
  'Units sold',
  'Orders',
  'Revenue',
  'Currency',
  'Reviews',
  'Average rating',
] as const;

/** Characters a spreadsheet reads as the start of a formula. */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

export function sanitiseCell(value: string): string {
  const first = value.slice(0, 1);

  return FORMULA_PREFIXES.includes(first) ? `'${value}` : value;
}

function quote(value: string): string {
  const safe = sanitiseCell(value);

  // Always quoted, not only when it contains a delimiter. A title carrying a
  // comma, a quote, or a newline is ordinary, and conditional quoting is where
  // hand-rolled CSV writers usually break.
  return `"${safe.replaceAll('"', '""')}"`;
}

function majorUnits(minor: number): string {
  return (minor / 100).toFixed(2);
}

export function soldRowsToCsv(rows: SellerSoldRow[]): string {
  const lines = [CSV_HEADERS.map(quote).join(',')];

  rows.forEach((row, index) => {
    lines.push(
      [
        quote(String(index + 1)),
        quote(row.title),
        quote(String(row.units)),
        quote(String(row.orders)),
        quote(majorUnits(row.revenueMinor)),
        quote(row.currency),
        quote(String(row.reviewCount)),
        quote(row.averageRating === null ? '' : row.averageRating.toFixed(1)),
      ].join(','),
    );
  });

  // CRLF: the line ending every spreadsheet reads without being asked, and what
  // RFC 4180 specifies.
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * A filename that says what is inside it.
 *
 * The window is in the name because two exports taken minutes apart can hold
 * completely different figures, and a folder of `sales.csv` files tells nobody
 * which was which.
 */
export function salesCsvFilename(rangeLabel: string): string {
  const slug = rangeLabel
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return `sals3-sales-${slug === '' ? 'all-time' : slug}.csv`;
}
