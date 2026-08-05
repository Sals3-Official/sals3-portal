import { describe, expect, it } from 'vitest';
import buildFixtureCatalogue from './fixtures';
import { CSV_COLUMNS, previewCsv, productsToCsv, splitCsvLine } from './csv';
import type { Product } from './types';

const catalogue = buildFixtureCatalogue();

describe('productsToCsv', () => {
  it('writes the header and one line per product', () => {
    const lines = productsToCsv(catalogue).split('\n');

    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(catalogue.length + 1);
  });

  it('quotes a name that holds a comma, so the columns do not shift', () => {
    const risky: Product = { ...catalogue[0], name: 'Cooler, tall' };
    const line = productsToCsv([risky]).split('\n')[1];

    expect(line).toContain('"Cooler, tall"');
    expect(splitCsvLine(line)[1]).toBe('Cooler, tall');
  });

  it('doubles a quote inside a value', () => {
    const risky: Product = { ...catalogue[0], name: 'The "quiet" cooler' };
    const line = productsToCsv([risky]).split('\n')[1];

    expect(splitCsvLine(line)[1]).toBe('The "quiet" cooler');
  });

  it('defuses a value that a spreadsheet would read as a formula', () => {
    const risky: Product = { ...catalogue[0], name: '=SUM(A1:A9)' };
    const cell = splitCsvLine(productsToCsv([risky]).split('\n')[1])[1];

    expect(cell).toBe("'=SUM(A1:A9)");
    expect(cell.startsWith('=')).toBe(false);
  });
});

describe('splitCsvLine', () => {
  it('keeps empty cells', () => {
    expect(splitCsvLine('a,,c')).toEqual(['a', '', 'c']);
  });

  it('reads a quoted cell that holds a comma', () => {
    expect(splitCsvLine('"a,b",c')).toEqual(['a,b', 'c']);
  });
});

describe('previewCsv', () => {
  const header = CSV_COLUMNS.join(',');

  it('reports an empty file', () => {
    expect(previewCsv('').errors[0]).toBe('The file is empty.');
  });

  it('names the columns that are missing', () => {
    const preview = previewCsv('sku,name\nABC-1,Lamp');

    expect(preview.errors[0]).toContain('category');
  });

  it('reads the rows and numbers them from line 2', () => {
    const preview = previewCsv(
      `${header}\nABC-1,Lamp,fashion,nortek,draft,100.00,,4,BAR-1,lamp`,
    );

    expect(preview.errors).toEqual([]);
    expect(preview.rows).toHaveLength(1);
    expect(preview.rows[0].line).toBe(2);
    expect(preview.rows[0].values.name).toBe('Lamp');
  });

  it('stops after 500 rows and says so', () => {
    const row = 'ABC-1,Lamp,fashion,nortek,draft,100.00,,4,BAR-1,lamp';
    const text = [header, ...Array.from({ length: 600 }, () => row)].join('\n');
    const preview = previewCsv(text);

    expect(preview.rows).toHaveLength(500);
    expect(preview.errors[0]).toContain('600 rows');
  });
});
