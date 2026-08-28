'use client';

import {
  applyContributionFloor,
  MAX_MARKUP_PERCENT,
  applyRounding,
  parseScaledRate,
  suggestedPriceMinor,
  type RoundingRule,
} from '@/modules/pricing/money-math';

/**
 * Three representative supplier costs — one where any sane floor bites, one
 * near the crossover, one where the percentage clearly dominates.
 * Deliberately round numbers, not real catalogue products: this is a worked
 * example of the rule, not a claim about anything a seller stocks.
 */
const SAMPLE_COSTS_MINOR = [200, 600, 2000] as const;

type StoreDefaultPreviewProps = {
  /** Raw field value in markup over cost, e.g. "200". Invalid renders the prompt. */
  markupPercent: string;
  /** Raw field value in whole currency, e.g. "2.50". Empty means no floor. */
  floorAmount: string;
  /**
   * Raw field value, e.g. "18". Empty means no percentage floor.
   *
   * Mutually exclusive with `floorAmount` — the two are one choice, and the
   * preview switches axis rather than trying to draw both at once.
   */
  floorPercent?: string;
  roundingRule: RoundingRule;
};

function formatUsd(minor: bigint | number): string {
  const value = typeof minor === 'bigint' ? minor : BigInt(Math.round(minor));
  const negative = value < BigInt(0);
  const magnitude = negative ? -value : value;
  const whole = magnitude / BigInt(100);
  const cents = (magnitude % BigInt(100)).toString().padStart(2, '0');
  return `${negative ? '-' : ''}US$${whole.toString()}.${cents}`;
}

export type PreviewRow = {
  costMinor: number;
  priceMinor: bigint;
  profitMinor: bigint;
  /** Profit as a share of the selling price, whole percent. */
  profitPercentOfPrice: number;
  /** Which of the two numbers set this price. */
  governedBy: 'MINIMUM' | 'MARGIN';
};

/**
 * Runs the SAME functions the server-side resolver runs
 * (`suggestedPriceMinor` → `applyContributionFloor` → `applyRounding`), so
 * this preview cannot drift from the price a product will actually get.
 * Deliberately not a second formula.
 *
 * What it leaves out, and says so on screen: the funding buffer, which is a
 * separate policy on its own card and lifts the cost basis before any of
 * this runs. A number here that silently folded it in would disagree with
 * the card the seller edits it on.
 */
export function buildPreviewRows(
  markupPercent: string,
  floorAmount: string,
  roundingRule: RoundingRule,
): PreviewRow[] | null {
  /*
    Markup over cost, the unit the field beside this one takes.

    It was a margin, and #233 renamed the dialog's field to markup without
    renaming this — so a seller who typed `200` hit the `>= 100` guard below
    and got no preview at all. The number was saved correctly the whole time;
    only the worked example vanished, which reads as the setting not working.

    Converted here rather than at the call site so the guard and the arithmetic
    cannot disagree about which unit they are in again.
  */
  const markupNumber = Number(markupPercent);

  if (
    markupPercent.trim() === '' ||
    !Number.isFinite(markupNumber) ||
    markupNumber <= 0 ||
    markupNumber > MAX_MARKUP_PERCENT
  ) {
    return null;
  }

  const marginNumber = (markupNumber / (100 + markupNumber)) * 100;

  const floorNumber = floorAmount.trim() === '' ? 0 : Number(floorAmount);

  if (!Number.isFinite(floorNumber) || floorNumber < 0) return null;

  const floorMinor = BigInt(Math.round(floorNumber * 100));

  let marginScaled: bigint;

  try {
    marginScaled = parseScaledRate((marginNumber / 100).toFixed(6));
  } catch {
    return null;
  }

  return SAMPLE_COSTS_MINOR.map((costMinor) => {
    const cost = BigInt(costMinor);
    const marginPrice = suggestedPriceMinor(cost, marginScaled);
    const floored = applyContributionFloor(marginPrice, cost, floorMinor);
    const priceMinor = applyRounding(floored, roundingRule);
    const profitMinor = priceMinor - cost;

    return {
      costMinor,
      priceMinor,
      profitMinor,
      profitPercentOfPrice: Math.round(
        (Number(profitMinor) / Number(priceMinor)) * 100,
      ),
      governedBy: floored > marginPrice ? 'MINIMUM' : 'MARGIN',
    };
  });
}

/**
 * The crossover: below this supplier cost the minimum sets the price, above
 * it the margin does. `cost = floor × (1 − m) / m` — the one number that
 * generalises past the three sample rows. `null` when there is no floor, or
 * no crossover to state.
 */
export function crossoverCostMinor(
  markupPercent: string,
  floorAmount: string,
): number | null {
  // Markup in, like `buildPreviewRows` — the two must read the same field the
  // same way or the crossover would describe a price the rows never show.
  const markupNumber = Number(markupPercent);
  const margin =
    Number.isFinite(markupNumber) && markupNumber > 0
      ? markupNumber / (100 + markupNumber)
      : Number.NaN;
  const floorMinor = Math.round(Number(floorAmount) * 100);

  if (!Number.isFinite(margin) || margin <= 0 || margin >= 1) return null;
  if (!Number.isFinite(floorMinor) || floorMinor <= 0) return null;

  return Math.round((floorMinor * (1 - margin)) / margin);
}

/**
 * The percentage floor, shown on the axis it actually varies along.
 *
 * A cost-based preview is the wrong picture for it. Two proportional rules
 * never cross, so against the store default's own margin a percentage floor can
 * never fire at any supplier cost — the observation the comment below records,
 * and the reason the amount form came first.
 *
 * But the margin the resolver floors is not the store default's. It is whatever
 * layer won: a **category** margin, or a product or variant override
 * (`resolver.ts`, `targetMarginRate`). Those are the numbers that vary, and a
 * category set below the floor is exactly the case the owner asked for — "the
 * margin must never fall below operating expenses". So the meaningful axis is
 * the margin, not the cost.
 *
 * Reported as rates rather than prices because the answer is cost-independent:
 * at any supplier cost, a category below the floor prices at the floor.
 */
export type MarginFloorPreviewRow = {
  categoryPercent: number;
  effectivePercent: number;
  governedBy: 'MINIMUM' | 'MARGIN';
};

export function buildMarginFloorPreviewRows(
  floorPercent: string,
): MarginFloorPreviewRow[] | null {
  const floor = Number(floorPercent);

  if (
    floorPercent.trim() === '' ||
    !Number.isFinite(floor) ||
    floor <= 0 ||
    floor > MAX_MARKUP_PERCENT
  ) {
    return null;
  }

  /*
    Markup, like every other number on this screen.

    Comparing markups gives the same answer as comparing the margins they
    convert to — `k / (100 + k)` is strictly increasing — so the table decides
    exactly what the resolver decides, while showing the seller the unit they
    typed. Two units on one dialog is what made this unreadable.

    Three sample markups spanning the floor: clearly under, at it, clearly over.
    Derived from the floor itself, so the table stays meaningful whatever is
    typed.
  */
  const samples = [
    Math.max(1, Math.round(floor / 2)),
    Math.round(floor),
    Math.min(MAX_MARKUP_PERCENT, Math.round(floor * 2)),
  ];

  return samples.map((categoryPercent) => ({
    categoryPercent,
    effectivePercent: Math.max(categoryPercent, floor),
    governedBy: categoryPercent < floor ? 'MINIMUM' : 'MARGIN',
  }));
}

/**
 * The rule, shown rather than described. Three costs in, three prices out,
 * each labelled with which of the two numbers decided it and what is left
 * for the seller — the fastest way to see what the margin and the minimum
 * actually do. This exists because the prose alone did not land: the owner
 * read the original copy and could not tell what the fields were for.
 *
 * The profit column is also the honest answer to "why is the minimum an
 * amount and not a percentage": on the floor-governed row the effective
 * percentage is visibly HIGHER than the margin setting, which is the whole
 * point — two proportional rules would never cross, so a percentage floor
 * could never fire.
 */
export default function StoreDefaultPreview({
  markupPercent,
  floorAmount,
  floorPercent = '',
  roundingRule,
}: StoreDefaultPreviewProps) {
  const marginFloorRows = buildMarginFloorPreviewRows(floorPercent);

  if (marginFloorRows !== null) {
    return (
      <div className="w-full">
        <p className="mb-1.5 text-xs font-semibold text-ink-muted">
          What the minimum does
        </p>
        <div className="overflow-x-auto">
          <table className="w-full max-w-xl text-xs">
            <thead>
              <tr className="text-left text-ink-faint">
                <th scope="col" className="py-1 pr-4 font-medium">
                  A category set to
                </th>
                <th scope="col" className="py-1 pr-4 font-medium">
                  Actually prices at
                </th>
                <th scope="col" className="py-1 font-medium">
                  Set by
                </th>
              </tr>
            </thead>
            <tbody>
              {marginFloorRows.map((row) => (
                <tr
                  key={row.categoryPercent}
                  className="border-t border-border"
                >
                  <td className="py-1 pr-4 tabular-nums">
                    {row.categoryPercent}%
                  </td>
                  <td className="py-1 pr-4 font-semibold tabular-nums">
                    {row.effectivePercent}%
                  </td>
                  <td className="py-1">
                    <span
                      className={
                        row.governedBy === 'MINIMUM'
                          ? 'font-semibold text-sals3-deep'
                          : 'text-ink-muted'
                      }
                    >
                      {row.governedBy === 'MINIMUM'
                        ? 'the minimum'
                        : 'the margin'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-ink-faint">
          Any category, product, or variant priced below the minimum is lifted
          to it. This holds at every supplier cost.
        </p>
      </div>
    );
  }

  const rows = buildPreviewRows(markupPercent, floorAmount, roundingRule);
  const crossover = crossoverCostMinor(markupPercent, floorAmount);

  if (rows === null) {
    return (
      <p className="w-full text-xs text-ink-faint">
        Type a markup above. Then you can see the effect on real prices.
      </p>
    );
  }

  return (
    <div className="w-full">
      <p className="mb-1.5 text-xs font-semibold text-ink-muted">
        What these two numbers do
      </p>
      <div className="overflow-x-auto">
        <table className="w-full max-w-xl text-xs">
          <thead>
            <tr className="text-left text-ink-faint">
              <th scope="col" className="py-1 pr-4 font-medium">
                You pay the supplier
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                Customer pays
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                You keep
              </th>
              <th scope="col" className="py-1 font-medium">
                Set by
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.costMinor} className="border-t border-border">
                <td className="py-1 pr-4 tabular-nums">
                  {formatUsd(row.costMinor)}
                </td>
                <td className="py-1 pr-4 font-semibold tabular-nums">
                  {formatUsd(row.priceMinor)}
                </td>
                <td className="py-1 pr-4 tabular-nums">
                  {formatUsd(row.profitMinor)}{' '}
                  <span className="text-ink-faint">
                    ({row.profitPercentOfPrice}%)
                  </span>
                </td>
                <td className="py-1">
                  <span
                    className={
                      row.governedBy === 'MINIMUM'
                        ? 'font-semibold text-sals3-deep'
                        : 'text-ink-muted'
                    }
                  >
                    {row.governedBy === 'MINIMUM'
                      ? 'the minimum'
                      : 'the margin'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1.5 text-xs text-ink-faint">
        The system uses the higher of the two prices.
        {crossover === null
          ? ''
          : ` The minimum gives the higher price below a supplier cost of ${formatUsd(crossover)}.`}{' '}
        The system adds your funding buffer after this.
      </p>
    </div>
  );
}
