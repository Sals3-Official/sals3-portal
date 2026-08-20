import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  deriveSourceChanges,
  type EvidenceVariant,
  type FrozenVariant,
} from './source-changes';

const USD = 'USD';

function frozen(overrides: Partial<FrozenVariant> = {}): FrozenVariant {
  return {
    variantId: 'variant-1',
    externalVariantId: 'vid-1',
    supplierOptionLabel: 'Black-S',
    displayLabel: 'Black-S',
    supplierCost: { amountMinor: 580, currency: USD },
    supplierObservedQuantity: 100,
    retailPrice: { amountMinor: 2000, currency: USD },
    ...overrides,
  };
}

function current(overrides: Partial<EvidenceVariant> = {}): EvidenceVariant {
  return {
    vid: 'vid-1',
    optionLabel: 'Black-S',
    priceUsd: 5.8,
    totalInventory: 100,
    ...overrides,
  };
}

function derive(
  frozenRows: FrozenVariant[],
  currentRows: EvidenceVariant[],
  capturedAt: string | null = '2026-08-14T10:00:00.000Z',
) {
  return deriveSourceChanges({
    frozen: frozenRows,
    current: currentRows,
    capturedAt,
  });
}

describe('deriveSourceChanges', () => {
  it('reports nothing when the snapshot matches what was drafted', () => {
    expect(derive([frozen()], [current()])).toEqual([]);
  });

  /**
   * `7.8` in the evidence and `780` minor units on the reference are the same
   * price. Comparing them as floats would report a change nobody made, on every
   * product, forever.
   */
  it('does not invent a cost change from decimal and minor units', () => {
    expect(
      derive(
        [frozen({ supplierCost: { amountMinor: 780, currency: USD } })],
        [current({ priceUsd: 7.8 })],
      ),
    ).toEqual([]);
  });

  it('reports a cost that moved, in both directions, without demanding action', () => {
    const rose = derive([frozen()], [current({ priceUsd: 6.5 })]);
    const fell = derive([frozen()], [current({ priceUsd: 5.0 })]);

    expect(rose[0]?.title).toMatch(/supplier cost rose/);
    expect(fell[0]?.title).toMatch(/supplier cost fell/);
    expect(rose[0]?.sellerActionRequired).toBe(false);
    expect(fell[0]?.sellerActionRequired).toBe(false);
  });

  /**
   * The alarm this diff exists for. Nothing else in the source-change panel
   * tells a seller that a variant no longer clears the supplier-cost floor.
   */
  it('raises action when supplier cost overtakes the retail floor', () => {
    const changes = derive(
      [frozen({ retailPrice: { amountMinor: 920, currency: USD } })],
      [current({ priceUsd: 9.0 })],
    );

    expect(changes[0]?.title).toMatch(/supplier-cost floor/);
    expect(changes[0]?.body).toMatch(/USD 9\.00/);
    expect(changes[0]?.body).toMatch(/USD 9\.20/);
    expect(changes[0]?.body).toMatch(/USD 9\.23/);
    expect(changes[0]?.sellerActionRequired).toBe(true);
  });

  it('does not call a cost rise an alarm while it clears the floor', () => {
    const changes = derive(
      [frozen({ retailPrice: { amountMinor: 2000, currency: USD } })],
      [current({ priceUsd: 9.0 })],
    );

    expect(changes[0]?.sellerActionRequired).toBe(false);
  });

  it('treats a missing retail price as no alarm rather than a false one', () => {
    const changes = derive(
      [frozen({ retailPrice: null })],
      [current({ priceUsd: 99 })],
    );

    expect(changes[0]?.sellerActionRequired).toBe(false);
  });

  it('reports a variant the supplier no longer offers, and asks for action', () => {
    const changes = derive(
      [
        frozen(),
        frozen({
          variantId: 'v2',
          externalVariantId: 'vid-2',
          displayLabel: 'Black-M',
        }),
      ],
      [current()],
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]?.title).toMatch(/Black-M is no longer offered/);
    expect(changes[0]?.sellerActionRequired).toBe(true);
  });

  it('reports a variant the supplier added, without asking for action', () => {
    const changes = derive(
      [frozen()],
      [current(), current({ vid: 'vid-9', optionLabel: 'Black-XXL' })],
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]?.title).toMatch(/now offers Black-XXL/);
    expect(changes[0]?.sellerActionRequired).toBe(false);
  });

  /**
   * Stock moves constantly on a dropshipping feed. Reporting every fluctuation
   * would bury the two facts that cost money.
   */
  it('reports stock only when it reaches zero', () => {
    expect(derive([frozen()], [current({ totalInventory: 3 })])).toEqual([]);
    expect(
      derive([frozen()], [current({ totalInventory: 0 })])[0]?.title,
    ).toMatch(/out of stock/);
  });

  it('does not repeat an out-of-stock report for a variant drafted at zero', () => {
    expect(
      derive(
        [frozen({ supplierObservedQuantity: 0 })],
        [current({ totalInventory: 0 })],
      ),
    ).toEqual([]);
  });

  it('reports a supplier rename and says the mapping still holds', () => {
    const changes = derive(
      [frozen()],
      [current({ optionLabel: 'Jet Black-S' })],
    );

    expect(changes[0]?.title).toMatch(/was renamed by the supplier/);
    expect(changes[0]?.body).toMatch(
      /matched on the label recorded at draft time/,
    );
    expect(changes[0]?.sellerActionRequired).toBe(false);
  });

  it('puts what needs action above what does not', () => {
    const changes = derive(
      [
        frozen(),
        frozen({
          variantId: 'v2',
          externalVariantId: 'vid-2',
          displayLabel: 'Black-M',
        }),
      ],
      [current({ optionLabel: 'Jet Black-S' })],
    );

    expect(changes[0]?.sellerActionRequired).toBe(true);
    expect(changes.at(-1)?.sellerActionRequired).toBe(false);
  });

  /**
   * `occurredAt` reaches `formatDateTime`, which calls `Intl.DateTimeFormat`.
   * `Intl` throws a RangeError on an invalid date rather than printing something
   * odd, so a `capturedAt` this cannot vouch for must arrive as an empty string
   * and not as garbage the renderer will choke on. `read-model.ts` nulls
   * unparseable values before they get here; this pins the contract from below.
   */
  it('never emits a timestamp it was not given', () => {
    const changes = derive([frozen()], [current({ priceUsd: 9 })], null);

    expect(changes[0]?.occurredAt).toBe('');
  });

  /**
   * No snapshot is not the same as no change, and inventing an entry would be as
   * dishonest as reporting silence. The panel carries the caveat instead.
   */
  it('reports nothing when there is no snapshot to compare against', () => {
    expect(derive([frozen()], [])).toEqual([]);
  });

  it('carries the capture time onto every entry rather than using now', () => {
    const changes = derive(
      [frozen()],
      [current({ priceUsd: 9 })],
      '2026-01-02T03:04:05.000Z',
    );

    expect(changes[0]?.occurredAt).toBe('2026-01-02T03:04:05.000Z');
  });
});

/**
 * A repository guard, not a behavioural test.
 *
 * The whole premise of this diff is that it is free: both halves are already in
 * the database, so it must never reach a supplier. The failure mode worth
 * preventing is a *future edit* quietly adding an import — which a test on
 * today's behaviour would never catch — so this scans the module's real source,
 * the same way `taxonomy/boundaries.test.ts` guards the category pilot.
 */
describe('source-change detection costs no CJ points', () => {
  const SUPPLIER_REACH = [
    /CjSupplierAdapter/,
    /from\s+['"]@\/modules\/suppliers/,
    /from\s+['"]@\/lib\/cj\//,
    /\bfetch\s*\(/,
    /api2\.0/,
    /cjdropshipping/i,
  ];

  it('imports nothing that could reach the supplier', () => {
    const source = readFileSync(join(__dirname, 'source-changes.ts'), 'utf8');
    // Strip comments: this file explains *why* it makes no CJ call, and those
    // sentences must not trip the scan they describe.
    const runtime = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    SUPPLIER_REACH.forEach((pattern) => {
      expect(runtime).not.toMatch(pattern);
    });
  });

  it('reads no database of its own, so it cannot widen into a query', () => {
    const source = readFileSync(join(__dirname, 'source-changes.ts'), 'utf8');
    const runtime = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    expect(runtime).not.toMatch(/from\s+['"]drizzle-orm['"]/);
    expect(runtime).not.toMatch(/@\/lib\/db/);
  });
});
