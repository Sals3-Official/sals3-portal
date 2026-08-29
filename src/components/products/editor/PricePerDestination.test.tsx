import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ pricesByDestinationAction: vi.fn() }));

vi.mock('@/app/(portal)/listings/price-by-destination-actions', () => ({
  default: mocks.pricesByDestinationAction,
}));

/* eslint-disable import/first */
import PricePerDestination from './PricePerDestination';

/**
 * The gap this closes: `Retail price` showed one destination's number under a
 * heading that claimed none. On 2026-08-29 the same product carried a 200%
 * markup in AU, PH and FJ and 0% in NZ, US and CA — so the column was true in
 * one country and wrong in three, with nothing on screen saying which.
 *
 * Base UI opens a tooltip on focus as well as hover, and focus is what a test
 * can drive deterministically. The keyboard path is the one being asserted
 * either way: a tooltip only a mouse can open is one half the people who need
 * it cannot reach.
 */

const DESTINATIONS = [
  {
    marketCode: 'AU',
    label: 'Australia',
    price: { amountMinor: 2070, currency: 'USD' },
    unavailableLabel: null,
  },
  {
    marketCode: 'NZ',
    label: 'New Zealand',
    price: { amountMinor: 690, currency: 'USD' },
    unavailableLabel: null,
  },
];

function open() {
  fireEvent.focus(
    screen.getByRole('button', {
      name: 'What this variant costs in each destination',
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pricesByDestinationAction.mockResolvedValue({
    ok: true,
    destinations: DESTINATIONS,
  });
});

describe('PricePerDestination', () => {
  it('asks for nothing until somebody opens it', () => {
    // Six resolver queries per destination. A 27-variant table that fetched
    // eagerly would be roughly 1,100 queries to render something most sellers
    // never look at.
    render(
      <PricePerDestination variantId="11111111-1111-4111-a111-111111111111">
        <span>$20.70</span>
      </PricePerDestination>,
    );

    expect(mocks.pricesByDestinationAction).not.toHaveBeenCalled();
  });

  it('shows every destination and its own price', async () => {
    render(
      <PricePerDestination variantId="11111111-1111-4111-a111-111111111111">
        <span>$20.70</span>
      </PricePerDestination>,
    );

    open();

    expect(await screen.findByText('Australia')).toBeInTheDocument();
    /*
      Twice on purpose: once in the trigger, once beside `Australia`.

      That duplication is the answer to the question the feature exists for —
      it is what tells a seller which country the unqualified number in the
      column belongs to. An assertion that avoided the collision by giving
      Australia a different price would have tested a scenario that cannot
      happen.
    */
    expect(screen.getAllByText('$20.70')).toHaveLength(2);
    // And the point of the whole feature: the same product, a different number.
    expect(screen.getByText('New Zealand')).toBeInTheDocument();
    expect(screen.getByText('$6.90')).toBeInTheDocument();
  });

  it('asks once per row, not once per hover', async () => {
    /*
      A seller comparing variants runs along a column. Re-asking on every pass
      would turn one question into dozens of six-query runs, and prices only
      move when a rule is saved — which reloads this page.
    */
    render(
      <PricePerDestination variantId="11111111-1111-4111-a111-111111111111">
        <span>$20.70</span>
      </PricePerDestination>,
    );

    open();
    await screen.findByText('Australia');

    fireEvent.blur(
      screen.getByRole('button', {
        name: 'What this variant costs in each destination',
      }),
    );
    open();

    await waitFor(() =>
      expect(mocks.pricesByDestinationAction).toHaveBeenCalledTimes(1),
    );
  });

  it('names the destination the rules refuse, rather than dropping it', async () => {
    // "No price" and "priced at nothing" are different facts, and a destination
    // silently missing from the list reads as one that does not exist.
    mocks.pricesByDestinationAction.mockResolvedValue({
      ok: true,
      destinations: [
        {
          marketCode: 'CA',
          label: 'Canada',
          price: null,
          unavailableLabel: 'No margin policy — set a category markup',
        },
      ],
    });

    render(
      <PricePerDestination variantId="11111111-1111-4111-a111-111111111111">
        <span>$20.70</span>
      </PricePerDestination>,
    );

    open();

    expect(await screen.findByText('Canada')).toBeInTheDocument();
    expect(
      screen.getByText('No margin policy — set a category markup'),
    ).toBeInTheDocument();
  });

  it('says a refusal out loud rather than rendering an empty box', async () => {
    // A tooltip that shows nothing on error is indistinguishable from one still
    // loading, and from a product that genuinely has no prices. Those want
    // different responses from the seller.
    mocks.pricesByDestinationAction.mockResolvedValue({
      ok: false,
      reason: 'denied',
    });

    render(
      <PricePerDestination variantId="11111111-1111-4111-a111-111111111111">
        <span>$20.70</span>
      </PricePerDestination>,
    );

    open();

    expect(
      await screen.findByText(/do not have permission to see these prices/),
    ).toBeInTheDocument();
  });

  it('survives the action throwing outright', async () => {
    mocks.pricesByDestinationAction.mockRejectedValue(new Error('offline'));

    render(
      <PricePerDestination variantId="11111111-1111-4111-a111-111111111111">
        <span>$20.70</span>
      </PricePerDestination>,
    );

    open();

    expect(
      await screen.findByText(/could not be worked out right now/),
    ).toBeInTheDocument();
  });
});
