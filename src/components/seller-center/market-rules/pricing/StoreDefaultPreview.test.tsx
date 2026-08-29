import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StoreDefaultPreview, {
  opexAmountMinor,
  opexPercentOf,
} from './StoreDefaultPreview';

/**
 * Two worked-example tables have stood here. Three supplier costs in and three
 * prices out, back when this dialog carried a base markup for them to be marked
 * up by; then three sample category markups against the floor.
 *
 * The owner read both and still asked what the field was. The arithmetic was
 * never the confusing part — the word was: **reserve** named the mechanism
 * instead of the money. Owner decision 2026-08-30: it is operating expenses,
 * and once it is called that the example has nothing left to explain.
 *
 * So what is pinned here is the sentence, and the two ways a field can hold
 * nothing worth saying.
 */

describe('opexPercentOf', () => {
  it('reads a usable share of cost', () => {
    expect(opexPercentOf('50')).toBe(50);
    expect(opexPercentOf('12.5')).toBe(12.5);
  });

  it('refuses a share that sets nothing aside, or one past the field’s own cap', () => {
    // Zero is a typo rather than a rule. Claiming it as a policy would put a
    // sentence on screen describing something that does not exist.
    expect(opexPercentOf('')).toBeNull();
    expect(opexPercentOf('0')).toBeNull();
    expect(opexPercentOf('-10')).toBeNull();
    expect(opexPercentOf('abc')).toBeNull();
    expect(opexPercentOf('501')).toBeNull();
  });
});

describe('opexAmountMinor', () => {
  it('reads whole currency into minor units', () => {
    expect(opexAmountMinor('2.50')).toBe(250);
    expect(opexAmountMinor('10')).toBe(1000);
  });

  it('rounds a third decimal rather than truncating it', () => {
    // The action's schema refuses "2.505" outright. Rounding here is the
    // display side agreeing, rather than showing US$2.50 for a value that
    // would be rejected on save.
    expect(opexAmountMinor('2.505')).toBe(251);
  });

  it('treats an empty or zero amount as nothing set aside', () => {
    expect(opexAmountMinor('')).toBeNull();
    expect(opexAmountMinor('   ')).toBeNull();
    expect(opexAmountMinor('0')).toBeNull();
    expect(opexAmountMinor('-1')).toBeNull();
    expect(opexAmountMinor('abc')).toBeNull();
  });
});

describe('what the dialog says', () => {
  it('states the percentage as money against a round cost', () => {
    // The owner's own reading of the field: "50% of cogs is for opex". The
    // sentence says exactly that, with the number they typed in it.
    render(<StoreDefaultPreview floorAmount="" floorPercent="50" />);

    expect(
      screen.getByText(
        /On a US\$10\.00 supplier cost, 50% is US\$5\.00 set aside/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/nothing sells below US\$15\.00/),
    ).toBeInTheDocument();
  });

  it('never draws a table again', () => {
    // Two have been tried. Both were read, and neither answered the question.
    render(<StoreDefaultPreview floorAmount="" floorPercent="50" />);

    expect(screen.queryByRole('table')).toBeNull();
  });

  it('never calls it a reserve', () => {
    // The word named the mechanism instead of the money, and is what the owner
    // could not read past through two rewrites of the example beneath it.
    render(<StoreDefaultPreview floorAmount="" floorPercent="50" />);

    expect(screen.queryByText(/reserve/i)).toBeNull();
  });

  it('states the amount form without inventing a percentage for it', () => {
    render(<StoreDefaultPreview floorAmount="2.50" floorPercent="" />);

    expect(
      screen.getByText(/sets aside US\$2\.50 for operating expenses/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  it('prefers the percentage when both somehow arrive', () => {
    /*
      The form disables one field once the other has a value and
      `pricing_store_defaults_floor_exclusive` refuses a row carrying both, so
      this is unreachable through the screen. Pinned anyway: it must never say
      two things, and the percentage is the one the resolver checks first.
    */
    render(<StoreDefaultPreview floorAmount="2.50" floorPercent="50" />);

    expect(screen.getByText(/50% is US\$5\.00 set aside/)).toBeInTheDocument();
    expect(screen.queryByText(/sets aside US\$2\.50/)).toBeNull();
  });

  it('says nothing is set aside rather than staying blank', () => {
    render(<StoreDefaultPreview floorAmount="" floorPercent="" />);

    expect(screen.getByText(/Nothing set aside yet/)).toBeInTheDocument();
  });
});
