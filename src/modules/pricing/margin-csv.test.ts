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
