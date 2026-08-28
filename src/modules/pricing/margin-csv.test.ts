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

  it('writes a stored margin rate back as the markup a person typed', () => {
    const csv = buildMarginCsv([
      {
        code: 'CAT-GGL-1',
        // 0.75 of the sale price is 300% on top of cost — the same price,
        // named the way the file names it.
        path: 'Animals & Pet Supplies',
        ownMarginRate: '0.750000',
        ownRoundingRule: 'NEAREST_0_99',
        marketCode: null,
      },
    ]);

    expect(csv).toContain('CAT-GGL-1,Animals & Pet Supplies,300,NEAREST_0_99');
  });

  it('exports a rate that does not divide evenly without drifting', () => {
    const csv = buildMarginCsv([
      {
        code: 'CAT-GGL-9',
        path: 'Anything',
        // What a 35% markup rounds to in a numeric(8, 6) column.
        ownMarginRate: '0.259259',
        ownRoundingRule: 'NONE',
        marketCode: null,
      },
    ]);

    expect(csv).toContain('CAT-GGL-9,Anything,35,NONE');
  });

  it('leaves the markup cell empty for a category with none — that is the template', () => {
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
        ownMarginRate: '0.750000',
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
        markupPercent: 300,
        roundingRule: 'NONE',
        marketCode: null,
      },
    ]);
  });
});

describe('parseMarginCsv', () => {
  const header = 'category_code,category_path,markup_percent,rounding';

  it('reads a plain file', () => {
    const parsed = parseMarginCsv(`${header}\nCAT-GGL-1,Anything,35,NONE`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]).toEqual({
      categoryCode: 'CAT-GGL-1',
      markupPercent: 35,
      roundingRule: 'NONE',
      marketCode: null,
    });
  });

  it('treats an empty markup as "remove the rule", not as zero', () => {
    const parsed = parseMarginCsv(`${header}\nCAT-GGL-1,Anything,,`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0].markupPercent).toBeNull();
  });

  it('keeps a typed 0 as a rule of its own — sell at cost', () => {
    const parsed = parseMarginCsv(`${header}\nCAT-GGL-1,Anything,0,NONE`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0].markupPercent).toBe(0);
  });

  it('accepts the top of the range', () => {
    const parsed = parseMarginCsv(`${header}\nCAT-GGL-1,Anything,500,NONE`);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0].markupPercent).toBe(500);
  });

  it('refuses a markup above the range and a negative one', () => {
    const parsed = parseMarginCsv(
      [
        header,
        'CAT-GGL-1,Anything,501,NONE',
        'CAT-GGL-2,Anything,-1,NONE',
      ].join('\n'),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toHaveLength(2);
    expect(parsed.errors[0].message).toMatch(/must be from 0 to 500/);
    expect(parsed.errors[1].message).toMatch(/must be from 0 to 500/);
  });

  /**
   * The same `35` meant a 35% margin under the old header and means a 35%
   * markup under this one — two different prices. Reading the old file
   * silently would reprice every category it names.
   */
  it('refuses a file still carrying the old margin_percent column', () => {
    const parsed = parseMarginCsv(
      'category_code,margin_percent\nCAT-GGL-1,35\n',
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors[0].message).toMatch(/old margin_percent column/);
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
    expect(parsed.rows[0].markupPercent).toBe(35);
  });

  it('collects every bad line instead of stopping at the first', () => {
    const parsed = parseMarginCsv(
      [
        header,
        'CAT-GGL-1,Anything,abc,NONE',
        'CAT-GGL-2,Anything,900,NONE',
        ',Anything,20,NONE',
      ].join('\n'),
    );

    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.errors).toHaveLength(3);
    expect(parsed.errors[0]).toMatchObject({ line: 2 });
    expect(parsed.errors[1].message).toMatch(/must be from 0 to 500/);
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
        // 0.8 of the sale price is 400% on top of cost.
        ownMarginRate: '0.800000',
        ownRoundingRule: 'NONE',
        marketCode: 'AU',
      },
      {
        code: 'CAT-GGL-2',
        path: 'Media',
        ownMarginRate: '0.500000',
        ownRoundingRule: 'NONE',
        marketCode: null,
      },
    ]);

    expect(csv).toContain('market_code');
    expect(csv).toContain('CAT-GGL-1,Apparel,400,NONE,AU');
    // Blank, not a keyword: the column holds a country code or nothing, exactly
    // as the database column does, so a round trip cannot invent a destination
    // named after a word like ALL.
    expect(csv).toContain('CAT-GGL-2,Media,100,NONE,\r\n');
  });

  it('reads the scope back, and blank means all destinations', () => {
    const result = parseMarginCsv(
      'category_code,markup_percent,market_code\nCAT-GGL-1,25,AU\nCAT-GGL-2,30,\n',
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
      'category_code,markup_percent,market_code\nCAT-GGL-1,25,AU\nCAT-GGL-1,30,\n',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(2);
  });

  it('still refuses the same category twice in one scope', () => {
    const result = parseMarginCsv(
      'category_code,markup_percent,market_code\nCAT-GGL-1,25,AU\nCAT-GGL-1,30,AU\n',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toContain('more than once for AU');
  });

  it('refuses a malformed destination by line number', () => {
    // A typo must be a numbered line, not a row written to a destination that
    // does not exist.
    const result = parseMarginCsv(
      'category_code,markup_percent,market_code\nCAT-GGL-1,25,aus\n',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ line: 2 });
    expect(result.errors[0]?.message).toContain(
      'not a destination you can price for',
    );
  });

  it('refuses a well-formed country that is not an offered destination', () => {
    /**
     * The hole this closed (2026-08-27). `GB` passes `^[A-Z]{2}$` and the
     * database CHECK, so until the allow list ran here a hand-edited file could
     * write an ACTIVE policy scoped to a country with no column to show it and
     * no buyer able to reach it. Import was the only write path that never
     * asked `isPricingScopeDestination`.
     */
    const result = parseMarginCsv(
      'category_code,markup_percent,market_code\nCAT-GGL-1,25,GB\n',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]).toMatchObject({ line: 2 });
  });

  it('accepts a blank destination as the Global rule', () => {
    // Blank is how a Global rule round-trips: the exporter writes an empty cell
    // for it, and this is the read half of that contract.
    const result = parseMarginCsv(
      'category_code,markup_percent,market_code\nCAT-GGL-1,25,\n',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]).toMatchObject({ marketCode: null });
  });

  it('treats a file with no market_code column as all destinations', () => {
    // Every file exported before this column existed still imports, and it
    // imports as the unscoped rule it was written for.
    const result = parseMarginCsv(
      'category_code,markup_percent\nCAT-GGL-1,25\n',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows[0]?.marketCode).toBeNull();
  });
});
