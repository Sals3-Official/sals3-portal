'use client';

import { MAX_MARKUP_PERCENT } from '@/modules/pricing/money-math';

/**
 * What the opex figure means, in the seller's own words.
 *
 * ## Why there is no table any more
 *
 * There have been two. First three supplier costs in and three prices out, back
 * when this dialog also carried a base markup for them to be marked up by. Then,
 * after that field went, three sample category markups against the floor.
 *
 * The owner read both and still asked what the field was — and on 2026-08-30
 * said so plainly. The arithmetic was never the confusing part. The word was:
 * **reserve** named the mechanism instead of the money. It is operating
 * expenses, and once it is called that the worked example has nothing left to
 * explain.
 *
 * So this is one sentence with the seller's own number in it. Anything longer
 * has been tried twice.
 *
 * ## What it leaves out, and says so
 *
 * The funding buffer, which is a separate policy on its own card and lifts the
 * cost basis before any of this runs. A number here that silently folded it in
 * would disagree with the card the seller edits it on.
 */

type StoreDefaultPreviewProps = {
  /** Raw field value in whole currency, e.g. "2.50". Empty means no amount. */
  floorAmount: string;
  /**
   * Raw field value as a share of supplier cost, e.g. "50". Empty means none.
   *
   * Mutually exclusive with `floorAmount` — the two are one choice, and the
   * sentence switches rather than trying to say both at once.
   */
  floorPercent?: string;
};

/** A round number to say the percentage against. Not a real supplier cost. */
const SAMPLE_COST_MINOR = 1000;

function formatUsd(minor: number): string {
  const whole = Math.trunc(minor / 100);
  const cents = Math.abs(minor % 100)
    .toString()
    .padStart(2, '0');

  return `US$${whole}.${cents}`;
}

/**
 * The opex percentage, or `null` when the field holds nothing usable.
 *
 * The same open band the form and the database enforce. A share of zero sets
 * nothing aside and is a typo rather than a rule; refusing it here keeps the
 * sentence from claiming a policy that does not exist.
 */
export function opexPercentOf(floorPercent: string): number | null {
  const value = Number(floorPercent);

  if (
    floorPercent.trim() === '' ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_MARKUP_PERCENT
  ) {
    return null;
  }

  return value;
}

/**
 * The opex amount in minor units, or `null`.
 *
 * Zero is `null` rather than a case of its own: setting nothing aside is not a
 * policy, and stating it as one would claim a rule where there is none.
 */
export function opexAmountMinor(floorAmount: string): number | null {
  if (floorAmount.trim() === '') return null;

  const value = Number(floorAmount);

  if (!Number.isFinite(value) || value <= 0) return null;

  return Math.round(value * 100);
}

export default function StoreDefaultPreview({
  floorAmount,
  floorPercent = '',
}: StoreDefaultPreviewProps) {
  const percent = opexPercentOf(floorPercent);

  if (percent !== null) {
    const opex = Math.round((SAMPLE_COST_MINOR * percent) / 100);

    return (
      <p className="w-full text-xs text-ink-faint">
        On a {formatUsd(SAMPLE_COST_MINOR)} supplier cost, {percent}% is{' '}
        {formatUsd(opex)} set aside for operating expenses — so nothing sells
        below {formatUsd(SAMPLE_COST_MINOR + opex)}. The system adds your
        funding buffer on top of this.
      </p>
    );
  }

  const amountMinor = opexAmountMinor(floorAmount);

  if (amountMinor !== null) {
    return (
      <p className="w-full text-xs text-ink-faint">
        Every sale sets aside {formatUsd(amountMinor)} for operating expenses,
        whatever the category is set to. The system adds your funding buffer on
        top of this.
      </p>
    );
  }

  return (
    <p className="w-full text-xs text-ink-faint">
      Nothing set aside yet — categories decide every price on their own. Type a
      percentage or an amount above.
    </p>
  );
}
