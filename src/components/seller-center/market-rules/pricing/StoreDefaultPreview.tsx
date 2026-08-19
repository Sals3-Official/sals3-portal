'use client';

import {
  applyContributionFloor,
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
  /** Raw field value, e.g. "35". Empty or invalid renders the prompt. */
  marginPercent: string;
  /** Raw field value in whole currency, e.g. "2.50". Empty means no floor. */
  floorAmount: string;
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
  marginPercent: string,
  floorAmount: string,
  roundingRule: RoundingRule,
): PreviewRow[] | null {
  const marginNumber = Number(marginPercent);

  if (
    marginPercent.trim() === '' ||
    !Number.isFinite(marginNumber) ||
    marginNumber <= 0 ||
    marginNumber >= 100
  ) {
    return null;
  }

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
  marginPercent: string,
  floorAmount: string,
): number | null {
  const margin = Number(marginPercent) / 100;
  const floorMinor = Math.round(Number(floorAmount) * 100);

  if (!Number.isFinite(margin) || margin <= 0 || margin >= 1) return null;
  if (!Number.isFinite(floorMinor) || floorMinor <= 0) return null;

  return Math.round((floorMinor * (1 - margin)) / margin);
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
  marginPercent,
  floorAmount,
  roundingRule,
}: StoreDefaultPreviewProps) {
  const rows = buildPreviewRows(marginPercent, floorAmount, roundingRule);
  const crossover = crossoverCostMinor(marginPercent, floorAmount);

  if (rows === null) {
    return (
      <p className="w-full text-xs text-ink-faint">
        Type a margin above and this will show what it does to real prices.
      </p>
    );
  }

  return (
    <div className="w-full">
      <p className="mb-1.5 text-xs font-semibold text-ink-muted">
        What these numbers do
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
        Whichever of the two gives the higher price wins.
        {crossover === null
          ? ''
          : ` Below about ${formatUsd(crossover)} supplier cost, the minimum takes over.`}{' '}
        Your funding buffer is applied on top of this separately.
      </p>
    </div>
  );
}
