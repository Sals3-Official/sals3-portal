// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  buildMarginCsv,
  MARGIN_CSV_HEADERS,
  parseMarginCsv,
  splitCsvLine,
} from './margin-csv';

describe('splitCsvLine', () => {
  /**
   * "Food, Beverages & Tobacco" is a real Sals3 department. A naive
   * `split(',')` shifts every column after it, so the margin of one category
   * would silently land on another.
   */
  it('keeps a quoted comma inside its own cell', () => {
    expect(
      splitCsvLine('CAT-GGL-412,"Food, Beverages & Tobacco",35,NONE'),
    ).toEqual(['CAT-GGL-412', 'Food, Beverages & Tobacco', '35', 'NONE']);
  });

  it('unescapes a doubled quote', () => {
    expect(splitCsvLine('a,"say ""hi""",1')).toEqual(['a', 'say "hi"', '1']);
  });

  it('keeps empty cells rather than dropping them', () => {
    expect(splitCsvLine('a,,c')).toEqual(['a', '', 'c']);
  });
});

describe('buildMarginCsv', () => {
  it('writes the header the parser reads back', () => {
    const csv = buildMarginCsv([]);

    expect(csv.split('\r\n')[0]).toBe(MARGIN_CSV_HEADERS.join(','));
  });

  it('writes a rate as the percentage a person typed', () => {
    const csv = buildMarginCsv([
      {
        code: 'CAT-GGL-1',
        path: 'Animals & Pet Supplies',
        ownMarginRate: '0.350000',
        ownRoundingRule: 'NEAREST_0_99',
        marketCode: null,
      },
    ]);

    expect(csv).toContain('CAT-GGL-1,Animals & Pet Supplies,35,NEAREST_0_99');
  });

  it('leaves the margin cell empty for a category with none — that is the template', () => {
    const csv = buildMarginCsv([
      {
        code: 'CAT-GGL-2',
        path: 'Apparel & Accessories',
        ownMarginRate: null,
        ownRoundingRule: null,
        marketCode: null,
      },
    ]);

    expect(csv).toContain('CAT-GGL-2,Apparel & Accessories,,');
  });

  it('quotes a path containing a comma', () => {
    const csv = buildMarginCsv([
      {
        code: 'CAT-GGL-3',
        path: 'Food, Beverages & Tobacco',
        ownMarginRate: null,
        ownRoundingRule: null,
        marketCode: null,
      },
    ]);

    expect(csv).toContain('"Food, Beverages & Tobacco"');
  });

  it('round-trips through the parser', () => {
    const csv = buildMarginCsv([
      {
        code: 'CAT-GGL-3',
        path: 'Food, Beverages & Tobacco',
        ownMarginRate: '0.425000',
        ownRoundingRule: 'NONE',
        marketCode: null,
      },
    ]);

    const parsed = parseMarginCsv(csv);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toEqual([
      {
        categoryCode: 'CAT-GGL-3',
        marginPercent: 42.5,
        roundingRule: 'NONE',
        marketCode: null,
      },
    ]);
  });
});

describe('parseMarginCsv', () => {
  const header = 'category_code,category_path,margin_percent,rounding';

  it('reads a plain file', () => {
    const parsed = parseMarginCsv(`${header}\nCAT-GGL-1,Anything,35,NONE`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]).toEqual({
      categoryCode: 'CAT-GGL-1',
      marginPercent: 35,
      roundingRule: 'NONE',
      marketCode: null,
    });
  });

  it('treats an empty margin as "remove the margin", not as zero', () => {
    const parsed = parseMarginCsv(`${header}\nCAT-GGL-1,Anything,,`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0].marginPercent).toBeNull();
  });

  it('tolerates a UTF-8 BOM and CRLF, which is what Excel writes', () => {
    const parsed = parseMarginCsv(
      `\ufeff${header}\r\nCAT-GGL-1,Anything,35,NONE\r\n`,
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(1);
  });

  it('accepts a trailing percent sign, because people type one', () => {
    const parsed = parseMarginCsv(`${header}\nCAT-GGL-1,Anything,35%,NONE`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0].marginPercent).toBe(35);
  });

  it('collects every bad line instead of stopping at the first', () => {
    const parsed = parseMarginCsv(
      [
        header,
        'CAT-GGL-1,Anything,abc,NONE',
        'CAT-GGL-2,Anything,150,NONE',
        ',Anything,20,NONE',
      ].join('\n'),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toHaveLength(3);
    expect(parsed.errors[0]).toMatchObject({ line: 2 });
    expect(parsed.errors[1].message).toMatch(/above 0 and below 100/);
    expect(parsed.errors[2].message).toMatch(/category_code is empty/);
  });

  it('refuses a duplicate category, which would make the last row silently win', () => {
    const parsed = parseMarginCsv(
      [header, 'CAT-GGL-1,Anything,20,NONE', 'CAT-GGL-1,Anything,40,NONE'].join(
        '\n',
      ),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0].message).toMatch(/appears more than once/);
  });

  it('refuses a file whose header is not the template', () => {
    const parsed = parseMarginCsv('name,price\nsomething,10');

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0].message).toMatch(/Download the template again/);
  });

  it('refuses an unknown rounding rule rather than defaulting it away', () => {
    const parsed = parseMarginCsv(`${header}\nCAT-GGL-1,Anything,35,SOMETHING`);

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0].message).toMatch(/NONE or NEAREST_0_99/);
  });

  it('reports line numbers a spreadsheet agrees with', () => {
    const parsed = parseMarginCsv(
      [
        header,
        'CAT-GGL-1,Anything,35,NONE',
        'CAT-GGL-2,Anything,zzz,NONE',
      ].join('\n'),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    // Header is line 1, first data row is line 2, so the bad row is line 3.
    expect(parsed.errors[0].line).toBe(3);
  });

  it('says so plainly when the file is empty', () => {
    expect(parseMarginCsv('')).toMatchObject({ ok: false });
  });
});

describe('the file carries its own destination', () => {
  it('exports the scope each row was read from', () => {
    const csv = buildMarginCsv([
      {
        code: 'CAT-GGL-1',
        path: 'Apparel',
        ownMarginRate: '0.250000',
        ownRoundingRule: 'NONE',
        marketCode: 'AU',
      },
      {
        code: 'CAT-GGL-2',
        path: 'Media',
        ownMarginRate: '0.300000',
        ownRoundingRule: 'NONE',
        marketCode: null,
      },
    ]);

    expect(csv).toContain('market_code');
    expect(csv).toContain('CAT-GGL-1,Apparel,25,NONE,AU');
    // Blank, not a keyword: the column holds a country code or nothing, exactly
    // as the database column does, so a round trip cannot invent a destination
    // named after a word like ALL.
    expect(csv).toContain('CAT-GGL-2,Media,30,NONE,\r\n');
  });

  it('reads the scope back, and blank means all destinations', () => {
    const result = parseMarginCsv(
      'category_code,margin_percent,market_code\nCAT-GGL-1,25,AU\nCAT-GGL-2,30,\n',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows.map((r) => r.marketCode)).toEqual(['AU', null]);
  });

  it('lets one category appear once per destination', () => {
    /**
     * The dedupe key is category AND scope. Keyed on the code alone this file
     * would be rejected as a duplicate, and the second scope would be
     * unreachable through import — which is most of the point of the column.
     */
    const result = parseMarginCsv(
      'category_code,margin_percent,market_code\nCAT-GGL-1,25,AU\nCAT-GGL-1,30,\n',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
  });

  it('still refuses the same category twice in one scope', () => {
    const result = parseMarginCsv(
      'category_code,margin_percent,market_code\nCAT-GGL-1,25,AU\nCAT-GGL-1,30,AU\n',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain('more than once for AU');
  });

  it('refuses a malformed destination by line number', () => {
    // A typo must be a numbered line, not a row written to a destination that
    // does not exist.
    const result = parseMarginCsv(
      'category_code,margin_percent,market_code\nCAT-GGL-1,25,aus\n',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ line: 2 });
    expect(result.errors[0]?.message).toContain('two-letter country code');
  });

  it('treats a file with no market_code column as all destinations', () => {
    // Every file exported before this column existed still imports, and it
    // imports as the unscoped rule it was written for.
    const result = parseMarginCsv(
      'category_code,margin_percent\nCAT-GGL-1,25\n',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.marketCode).toBeNull();
  });
});
