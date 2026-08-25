import type { RoundingRule } from './money-math';

/**
 * The CSV contract for bulk category-margin editing.
 *
 * Deliberately its own module, with no React and no database import, so the
 * same parser runs in a test, in the server action that applies an upload,
 * and in the client that generates the template. A second implementation of
 * "what a valid row looks like" is exactly how an import starts accepting
 * something the writer then refuses.
 *
 * Format choices, and why:
 *
 * - `category_code` is the key, never the path. A path is display text that
 *   changes with the taxonomy; the code is the stable identity every policy
 *   already references.
 * - `category_path` is exported for a person to read and IGNORED on import.
 *   A spreadsheet that shows only `CAT-GGL-1604` is unusable, but trusting
 *   an edited path would let a renamed row point somewhere else.
 * - `margin_percent` is the human unit (`35`, not `0.35`) because that is
 *   what the screen asks for. An empty cell means "no margin here", which is
 *   how the template ships and how a margin gets cleared.
 * - `rounding` accepts the two rule names, case-insensitively, and defaults
 *   to `NONE` when blank.
 * - `market_code` is the destination the line applies to, and **blank means
 *   all destinations** — the same meaning `pricing_category_policies.market_code`
 *   gives a null. ADR-015's `Amendment — 2026-08-25` flags this column as part
 *   of the decision rather than a detail, and the reason is the failure it
 *   prevents: a seller who exports Australia, edits it, and imports while the
 *   screen is showing the Philippines would otherwise write every Australian
 *   rate onto the wrong country, silently and in one click. **The file carries
 *   its own scope**, so it cannot be applied to a destination it was not
 *   written for.
 *
 * What an import does NOT do is unchanged and load-bearing: a category absent
 * from the file is left alone. Only a row that is present, with an empty
 * `margin_percent`, clears anything — and it clears only the scope its own
 * `market_code` names.
 */

export const MARGIN_CSV_HEADERS = [
  'category_code',
  'category_path',
  'margin_percent',
  'rounding',
  'market_code',
] as const;

/** Guards a paste of the wrong file — a product export, say — before it reaches any writer. */
export const MAX_CSV_ROWS = 6000;

export type MarginCsvRow = {
  categoryCode: string;
  /** `null` clears any margin on this category, in this row's own scope. */
  marginPercent: number | null;
  roundingRule: RoundingRule;
  /** `null` is the all-destinations rule, matching the column it writes. */
  marketCode: string | null;
};

export type MarginCsvRowError = {
  /** 1-based, counting the header, so it matches what a spreadsheet shows. */
  line: number;
  message: string;
};

export type MarginCsvParseResult =
  | { ok: true; rows: MarginCsvRow[] }
  | { ok: false; errors: MarginCsvRowError[] };

export type MarginCsvExportRow = {
  code: string;
  path: string;
  /** The margin set ON this category, not an inherited one — an export must round-trip. */
  ownMarginRate: string | null;
  ownRoundingRule: RoundingRule | null;
  /** The scope this row was read from. `null` exports as blank. */
  marketCode: string | null;
};

/** RFC 4180 quoting, applied only where it is needed. */
function escapeCell(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Splits one CSV line, honouring quoted cells that contain commas — every
 * taxonomy path with a comma in it ("Food, Beverages & Tobacco") depends on
 * this, and a naive `split(',')` silently shifts every later column.
 */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (inQuotes) {
      if (char !== '"') {
        cell += char;
      } else if (line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = false;
      }
    } else if (char === '"') {
      inQuotes = true;
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

/**
 * The file a seller downloads: every category they can set, with whatever
 * they have already set. Filled in, it is an export; emptied, it is the
 * template. One artefact, so there is no second format to keep in step.
 */
export function buildMarginCsv(rows: MarginCsvExportRow[]): string {
  const lines = [MARGIN_CSV_HEADERS.join(',')];

  rows.forEach((row) => {
    const marginPercent =
      row.ownMarginRate === null
        ? ''
        : String(Math.round(Number(row.ownMarginRate) * 10000) / 100);

    lines.push(
      [
        escapeCell(row.code),
        escapeCell(row.path),
        marginPercent,
        row.ownRoundingRule ?? '',
        // Blank rather than a literal 'ALL': the column holds a country code or
        // nothing, exactly as the database column does, so a round trip cannot
        // invent a destination named after a keyword.
        row.marketCode ?? '',
      ].join(','),
    );
  });

  // A trailing newline: some spreadsheets drop the last row without it.
  return `${lines.join('\r\n')}\r\n`;
}

function parseRoundingRule(raw: string): RoundingRule | undefined {
  const value = raw.trim().toUpperCase();

  if (value === '' || value === 'NONE') return 'NONE';
  if (value === 'NEAREST_0_99' || value === 'NEAREST .99')
    return 'NEAREST_0_99';

  return undefined;
}

/**
 * Reads an uploaded file back into rows, collecting EVERY problem rather
 * than stopping at the first.
 *
 * A bulk edit that reports one error per attempt turns a 213-row file into
 * 213 round trips. The caller decides what to do with the list; this never
 * repairs a row it does not understand.
 */
export function parseMarginCsv(text: string): MarginCsvParseResult {
  const errors: MarginCsvRowError[] = [];
  const rows: MarginCsvRow[] = [];
  /**
   * Keyed on category **and scope**, not category alone.
   *
   * The same category legitimately appears twice now — once for a destination
   * and once blank for all destinations — and they are two different rows in
   * two different partial unique indexes. Deduping on the code alone would
   * reject that file as a duplicate and make the second scope unreachable
   * through import.
   */
  const seenScopedCodes = new Set<string>();

  // Tolerate CRLF, LF, and a UTF-8 BOM — all three come out of Excel.
  const lines = text
    .replace(/^\ufeff/, '')
    .split(/\r\n|\n|\r/)
    .filter((line, index) => index === 0 || line.trim() !== '');

  if (lines.length === 0 || lines[0].trim() === '') {
    return { ok: false, errors: [{ line: 1, message: 'The file is empty.' }] };
  }

  const header = splitCsvLine(lines[0]).map((cell) =>
    cell.trim().toLowerCase(),
  );
  const codeIndex = header.indexOf('category_code');
  const marginIndex = header.indexOf('margin_percent');
  const roundingIndex = header.indexOf('rounding');
  const marketIndex = header.indexOf('market_code');

  if (codeIndex === -1 || marginIndex === -1) {
    return {
      ok: false,
      errors: [
        {
          line: 1,
          message:
            'The header must contain category_code and margin_percent. Download the template again.',
        },
      ],
    };
  }

  if (lines.length - 1 > MAX_CSV_ROWS) {
    return {
      ok: false,
      errors: [
        {
          line: 1,
          message: `The file has more than ${MAX_CSV_ROWS} rows. Check that this is the margin template.`,
        },
      ],
    };
  }

  lines.slice(1).forEach((line, index) => {
    const lineNumber = index + 2;
    const cells = splitCsvLine(line);
    const categoryCode = (cells[codeIndex] ?? '').trim();

    if (categoryCode === '') {
      errors.push({ line: lineNumber, message: 'category_code is empty.' });
      return;
    }

    const rawMarket =
      marketIndex === -1 ? '' : (cells[marketIndex] ?? '').trim().toUpperCase();

    /**
     * Shape-checked against the same `^[A-Z]{2}$` the database enforces, so a
     * typo is a numbered line rather than a row written to a destination that
     * does not exist. Blank is the all-destinations rule and is not an error.
     */
    if (rawMarket !== '' && !/^[A-Z]{2}$/.test(rawMarket)) {
      errors.push({
        line: lineNumber,
        message: `market_code "${rawMarket}" must be a two-letter country code, or blank for all destinations.`,
      });
      return;
    }

    const marketCode = rawMarket === '' ? null : rawMarket;
    const scopedKey = `${categoryCode}|${marketCode ?? ''}`;

    if (seenScopedCodes.has(scopedKey)) {
      errors.push({
        line: lineNumber,
        message:
          marketCode === null
            ? `${categoryCode} appears more than once for all destinations.`
            : `${categoryCode} appears more than once for ${marketCode}.`,
      });
      return;
    }
    seenScopedCodes.add(scopedKey);

    const roundingRule =
      roundingIndex === -1
        ? 'NONE'
        : parseRoundingRule(cells[roundingIndex] ?? '');

    if (roundingRule === undefined) {
      errors.push({
        line: lineNumber,
        message: 'rounding must be NONE or NEAREST_0_99.',
      });
      return;
    }

    const rawMargin = (cells[marginIndex] ?? '').trim();

    if (rawMargin === '') {
      rows.push({
        categoryCode,
        marginPercent: null,
        roundingRule,
        marketCode,
      });
      return;
    }

    // `Number('')` is 0 and `Number(' ')` is 0 — both already handled above,
    // so anything non-numeric reaching here is a real mistake, not a blank.
    const marginPercent = Number(rawMargin.replace(/%$/, ''));

    if (!Number.isFinite(marginPercent)) {
      errors.push({
        line: lineNumber,
        message: `margin_percent "${rawMargin}" is not a number.`,
      });
      return;
    }

    if (marginPercent <= 0 || marginPercent >= 100) {
      errors.push({
        line: lineNumber,
        message: `margin_percent must be above 0 and below 100. Line has ${marginPercent}.`,
      });
      return;
    }

    rows.push({ categoryCode, marginPercent, roundingRule, marketCode });
  });

  if (errors.length > 0) return { ok: false, errors };

  return { ok: true, rows };
}
