import { describe, expect, it } from 'vitest';
import type { SellerSoldRow } from '@/modules/orders/seller-sold-read';
import { salesCsvFilename, sanitiseCell, soldRowsToCsv } from './sales-csv';

function row(over: Partial<SellerSoldRow> = {}): SellerSoldRow {
  return {
    productId: '11111111-1111-4111-8111-111111111111',
    title: 'Knitted Tam Beanie',
    imageUrl: null,
    currency: 'USD',
    units: 142,
    deliveredUnits: 142,
    orders: 118,
    revenueMinor: 133338,
    reviewCount: 12,
    averageRating: 4.6,
    ...over,
  };
}

describe('sanitiseCell', () => {
  it.each(['=', '+', '-', '@', '\t', '\r'])(
    'defuses a cell beginning %j so a spreadsheet reads it as text',
    (prefix) => {
      expect(sanitiseCell(`${prefix}HYPERLINK("http://x")`)).toBe(
        `'${prefix}HYPERLINK("http://x")`,
      );
    },
  );

  it('leaves an ordinary title alone', () => {
    expect(sanitiseCell('Knitted Tam Beanie')).toBe('Knitted Tam Beanie');
  });
});

describe('soldRowsToCsv', () => {
  it('writes money as a bare decimal a spreadsheet can sum', () => {
    const csv = soldRowsToCsv([row()]);

    // Not "1,333.38 USD" — the comma and the suffix would make it a string,
    // which defeats the point of exporting rather than reading the screen.
    expect(csv).toContain('"1333.38"');
    expect(csv).toContain('"USD"');
  });

  it('defuses a formula hidden in a seller-authored title', () => {
    const csv = soldRowsToCsv([row({ title: '=cmd|/c calc' })]);

    expect(csv).toContain(`"'=cmd|/c calc"`);
    expect(csv).not.toContain('"=cmd');
  });

  it('escapes a quote by doubling it, and keeps a comma inside the field', () => {
    const csv = soldRowsToCsv([row({ title: 'Beanie, 12" brim, "warm"' })]);

    expect(csv).toContain('"Beanie, 12"" brim, ""warm"""');
  });

  it('leaves the rating column empty rather than writing a zero', () => {
    const csv = soldRowsToCsv([row({ reviewCount: 0, averageRating: null })]);
    const [, body] = csv.trim().split('\r\n');

    // A 0.0 here would be read as "rated nought", which is a different claim
    // from "nobody has rated it".
    expect(body.endsWith(',""')).toBe(true);
  });

  it('numbers the rows in the order given and terminates with CRLF', () => {
    const csv = soldRowsToCsv([
      row({ productId: 'a', title: 'First' }),
      row({ productId: 'b', title: 'Second' }),
    ]);
    const lines = csv.split('\r\n');

    expect(lines[0].startsWith('"Rank"')).toBe(true);
    expect(lines[1].startsWith('"1","First"')).toBe(true);
    expect(lines[2].startsWith('"2","Second"')).toBe(true);
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('writes a header-only file when nothing sold in the window', () => {
    expect(soldRowsToCsv([]).trim().split('\r\n')).toHaveLength(1);
  });
});

describe('salesCsvFilename', () => {
  it('carries the window, because two exports minutes apart can differ', () => {
    expect(salesCsvFilename('Last 30 days')).toBe(
      'sals3-sales-last-30-days.csv',
    );
    expect(salesCsvFilename('2026-08-01 to 2026-08-31')).toBe(
      'sals3-sales-2026-08-01-to-2026-08-31.csv',
    );
  });

  it('never produces a dangling separator from an odd label', () => {
    expect(salesCsvFilename('!!!')).toBe('sals3-sales-all-time.csv');
  });
});
