// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import type { CheckoutFreightQuoteResult } from './freight-quotes';
import {
  CheckoutOrderError,
  type CreateCheckoutIntentInput,
  validateSelection,
} from './orders';

vi.mock('server-only', () => ({}));

const quote: CheckoutFreightQuoteResult = {
  quotedAt: '2026-08-28T04:00:00.000Z',
  packages: [{ packageId: 'pkg_1', originCountry: 'CN', itemCount: 1 }],
  quotes: [
    {
      quoteId: 'quote-new',
      packageId: 'pkg_1',
      shippingTier: 'Standard',
      cjLogisticName: 'CJPacket Postal',
      optionId: 'option-1',
      channelId: 'channel-1',
      arrivalTime: '12-20',
      amountMinor: 409,
      regularAmountMinor: 409,
      currency: 'USD',
      originCountry: 'CN',
      destinationCountry: 'PH',
      ruleTips: [],
      expiresAt: '2026-08-28T04:15:00.000Z',
    },
  ],
  freeShipping: {
    thresholdAmountMinor: 1200,
    subtotalAmountMinor: 1000,
    amountRemainingMinor: 200,
    eligible: false,
    currency: 'USD',
  },
};

function input(
  shippingTier: 'Standard' | 'Express' | 'Expedited',
): CreateCheckoutIntentInput {
  return {
    cart: { items: [{ productId: 'product-1', quantity: 1 }] },
    address: {
      email: 'buyer@example.com',
      fullName: 'Buyer Example',
      phone: '+639171234567',
      addressLine1: '123 Main Street',
      city: 'Manila',
      region: 'National Capital Region (NCR)',
      postalCode: '1000',
      country: 'PH',
    },
    shippingSelection: {
      packageSelections: [
        {
          packageId: 'pkg_1',
          shippingTier,
          quoteId: 'quote-old',
          optionId: 'option-1',
          channelId: 'channel-1',
          cjLogisticName: 'CJPacket Postal',
          arrivalTime: '12-20',
          amountMinor: 409,
          currency: 'USD',
        },
      ],
    },
  };
}

describe('validateSelection shipping tier', () => {
  it('accepts the fresh server-classified tier and exact courier identity', () => {
    expect(validateSelection(quote, input('Standard'))).toMatchObject([
      { shippingTier: 'Standard', optionId: 'option-1' },
    ]);
  });

  it('rejects a buyer-supplied tier that no longer matches the fresh quote', () => {
    expect(() => validateSelection(quote, input('Expedited'))).toThrow(
      new CheckoutOrderError(
        'Shipping changed. Refresh delivery options and choose again.',
      ),
    );
  });

  it('rejects duplicate selections for one package', () => {
    const duplicate = input('Standard');
    duplicate.shippingSelection.packageSelections.push({
      ...duplicate.shippingSelection.packageSelections[0]!,
    });

    expect(() => validateSelection(quote, duplicate)).toThrow(
      new CheckoutOrderError('Choose a delivery option for every package.'),
    );
  });

  it('accepts a zero-priced Standard selection earned by the cart', () => {
    const freeQuote: CheckoutFreightQuoteResult = {
      ...quote,
      quotes: [{ ...quote.quotes[0]!, amountMinor: 0 }],
      freeShipping: {
        ...quote.freeShipping!,
        subtotalAmountMinor: 1200,
        amountRemainingMinor: 0,
        eligible: true,
      },
    };
    const freeInput = input('Standard');
    freeInput.shippingSelection.packageSelections[0]!.amountMinor = 0;

    expect(validateSelection(freeQuote, freeInput)).toMatchObject([
      { shippingTier: 'Standard', amountMinor: 0 },
    ]);
  });
});
