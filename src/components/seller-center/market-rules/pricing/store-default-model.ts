import type { RoundingRule } from '@/modules/pricing/money-math';

/**
 * The store-default vocabulary shared by the section, the row, and the editor.
 *
 * Its own module for the same reason `category-margin-model.ts` is: the row
 * needs the grid and the types while the section needs the row, and importing
 * across those two directly is a dependency cycle.
 */

/**
 * One grid definition shared by the header and every row, so the two can never
 * drift.
 *
 * `minContributionMinor` is a plain `number` here, not the `bigint` the
 * database column is. Server Components cannot serialise a `bigint` to a client
 * component, and a per-item floor in USD cents has no business approaching
 * `Number.MAX_SAFE_INTEGER` — the conversion happens once, in the section, where
 * the row is read.
 */
export const STORE_DEFAULT_ROW_GRID =
  'grid grid-cols-[minmax(7rem,1fr)_7rem_6rem_5rem] items-center gap-x-3';

export type StoreDefaultViewModel = {
  id: string;
  /** Minor units of `minContributionCurrency`; `0` means no amount floor. */
  minContributionMinor: number;
  minContributionCurrency: string;
  /** The minimum-margin form, or `null`. Never set alongside an amount. */
  minContributionRate: string | null;
  roundingRule: RoundingRule;
  version: number;
};

/** Which of the two mutually exclusive floor forms this rule actually uses. */
export type FloorKind =
  | { kind: 'RATE'; rate: string }
  | { kind: 'AMOUNT'; minor: number; currency: string }
  | { kind: 'NONE' };

/**
 * Reads the floor off a rule without deciding a winner.
 *
 * `pricing_store_defaults_floor_exclusive` guarantees at most one is set, so
 * there is no precedence to encode — and deliberately none is invented here. If
 * a row ever carried both, the honest answer is the rate, matching the order
 * `resolveProductPricing` checks them in; the two must agree or the screen
 * would show a floor the resolver would not apply.
 */
export function floorOf(storeDefault: StoreDefaultViewModel | null): FloorKind {
  if (storeDefault === null) return { kind: 'NONE' };

  if (storeDefault.minContributionRate !== null) {
    return { kind: 'RATE', rate: storeDefault.minContributionRate };
  }

  if (storeDefault.minContributionMinor > 0) {
    return {
      kind: 'AMOUNT',
      minor: storeDefault.minContributionMinor,
      currency: storeDefault.minContributionCurrency,
    };
  }

  return { kind: 'NONE' };
}
