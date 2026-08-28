'use client';

import { MAX_MARKUP_PERCENT } from '@/modules/pricing/money-math';

/**
 * What the reserve does, shown rather than described.
 *
 * ## Why there is no supplier-cost table any more
 *
 * There used to be one: three sample costs in, three prices out, each labelled
 * with whether the base markup or the minimum had set it. That was the right
 * picture for two numbers that competed. With the base markup gone (owner
 * decision 2026-08-28) only one number is left on this dialog, and a table of
 * prices derived from a markup the dialog no longer carries would have had to
 * invent that markup to draw itself — a worked example built on a number nobody
 * typed.
 *
 * What survives is the picture that was already correct for the percentage
 * form, plus one sentence for the amount form. Each says the same thing on the
 * axis its own form actually varies along.
 *
 * ## What it leaves out, and says so on screen
 *
 * The funding buffer, which is a separate policy on its own card and lifts the
 * cost basis before any of this runs. A number here that silently folded it in
 * would disagree with the card the seller edits it on.
 */

type StoreDefaultPreviewProps = {
  /** Raw field value in whole currency, e.g. "2.50". Empty means no amount floor. */
  floorAmount: string;
  /**
   * Raw field value in markup over cost, e.g. "50". Empty means no percentage
   * floor.
   *
   * Mutually exclusive with `floorAmount` — the two are one choice, and the
   * preview switches axis rather than trying to draw both at once.
   */
  floorPercent?: string;
};

function formatUsd(minor: bigint | number): string {
  const value = typeof minor === 'bigint' ? minor : BigInt(Math.round(minor));
  const negative = value < BigInt(0);
  const magnitude = negative ? -value : value;
  const whole = magnitude / BigInt(100);
  const cents = (magnitude % BigInt(100)).toString().padStart(2, '0');
  return `${negative ? '-' : ''}US$${whole.toString()}.${cents}`;
}

/**
 * The percentage reserve, shown on the axis it actually varies along.
 *
 * A cost-based preview is the wrong picture for it. Two proportional rules
 * never cross, so against any single fixed markup a percentage floor either
 * always fires or never does, at every supplier cost alike.
 *
 * What varies is the markup the resolver floors: a **category** markup, or a
 * product or variant override (`resolver.ts`, `targetMarginRate`). A category
 * set below the reserve is exactly the case the owner asked for — "the markup
 * must never fall below operating expenses". So the meaningful axis is the
 * markup, not the cost.
 *
 * Reported as rates rather than prices because the answer is cost-independent:
 * at any supplier cost, a category below the reserve prices at the reserve.
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
 * The amount reserve, in the one sentence it takes to state.
 *
 * `applyContributionFloor` computes `max(price, cost + floor)`, so the whole
 * rule is "you keep at least this much per item, whatever the category says".
 * That answer is the same at every supplier cost and every markup, which is why
 * it needs no table: the three-row version it replaces varied supplier cost to
 * demonstrate a crossover with a base markup that no longer exists.
 *
 * Returns the reserve in minor units, or `null` when the field is empty or not
 * a usable amount. Zero is `null` rather than a row of its own — a floor of
 * nothing floors nothing, and drawing it would claim a rule where there is
 * none.
 */
export function amountReserveMinor(floorAmount: string): number | null {
  if (floorAmount.trim() === '') return null;

  const value = Number(floorAmount);

  if (!Number.isFinite(value) || value <= 0) return null;

  return Math.round(value * 100);
}

export default function StoreDefaultPreview({
  floorAmount,
  floorPercent = '',
}: StoreDefaultPreviewProps) {
  const marginFloorRows = buildMarginFloorPreviewRows(floorPercent);

  if (marginFloorRows !== null) {
    return (
      <div className="w-full">
        <p className="mb-1.5 text-xs font-semibold text-ink-muted">
          What the reserve does
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
                        ? 'the reserve'
                        : 'the category'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-xs text-ink-faint">
          Any category, product, or variant priced below the reserve is lifted
          to it. This holds at every supplier cost. The system adds your funding
          buffer after this.
        </p>
      </div>
    );
  }

  const amountMinor = amountReserveMinor(floorAmount);

  if (amountMinor !== null) {
    return (
      <p className="w-full text-xs text-ink-faint">
        Every sale leaves you at least {formatUsd(amountMinor)} above what you
        pay the supplier, whatever the category is set to. The system adds your
        funding buffer after this.
      </p>
    );
  }

  return (
    <p className="w-full text-xs text-ink-faint">
      No reserve set — categories decide every price on their own. Type a
      percentage or an amount above to see what it would change.
    </p>
  );
}
