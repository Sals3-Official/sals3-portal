import { describe, expect, it } from 'vitest';
import { findSupplierAdapter, registeredProviderCodes } from './adapters';
import {
  supplierActionsFor,
  supports,
  type SupplierAdapter,
  type SupplierConnectionRef,
} from './supplier-adapter';

/**
 * These tests exist for the second provider, not the first.
 *
 * Everything passes today with CJ alone. What they actually protect is the day
 * AliExpress or Printful is connected: a screen that assumed CJ's capabilities
 * would offer a control the new provider cannot honour, and the seller would
 * find out from a failed request rather than from a missing button.
 */

const CONNECTION: SupplierConnectionRef = {
  connectionId: 'conn-test',
  providerCode: 'TEST',
  label: 'Test · Main',
};

/** A provider that can create orders and nothing else. */
const MINIMAL: SupplierAdapter = {
  providerCode: 'TEST',
  displayName: 'Test Provider',
  capabilities: ['CREATE_ORDER'],
  toParcelState: () => null,
  spendNote: () => 'paid from your test account',
};

describe('registry', () => {
  it('registers CJ', () => {
    expect(registeredProviderCodes()).toContain('CJ');
    expect(findSupplierAdapter('CJ')?.displayName).toBe('CJdropshipping');
  });

  it('returns null for an unregistered provider rather than a default', () => {
    // A fallback adapter would hand some other provider's capabilities to a
    // connection nobody has reviewed.
    expect(findSupplierAdapter('ALIEXPRESS')).toBeNull();
    expect(findSupplierAdapter('')).toBeNull();
  });
});

describe('capability gating', () => {
  it('offers no cancel control when the provider cannot cancel', () => {
    const actions = supplierActionsFor(MINIMAL, 'FULFILLING', CONNECTION);

    expect(actions.map((action) => action.id)).not.toContain(
      'request-supplier-cancel',
    );
  });

  it('offers cancel when the provider declares it', () => {
    const cj = findSupplierAdapter('CJ');

    expect(cj).not.toBeNull();
    expect(supports(cj as SupplierAdapter, 'CANCEL_ORDER')).toBe(true);
    expect(
      supplierActionsFor(cj as SupplierAdapter, 'FULFILLING', CONNECTION).map(
        (action) => action.id,
      ),
    ).toContain('request-supplier-cancel');
  });

  it('offers no wallet payment when the provider cannot take one', () => {
    const actions = supplierActionsFor(
      MINIMAL,
      'AWAITING_SUPPLIER_FUNDS',
      CONNECTION,
    );

    expect(actions.map((action) => action.id)).not.toContain('pay-supplier');
  });

  it('names the connection, not the provider, in the pay action', () => {
    // Two accounts with one provider must be distinguishable: "top up CJ" is
    // useless when the seller holds two CJ wallets.
    const cj = findSupplierAdapter('CJ') as SupplierAdapter;
    const [pay] = supplierActionsFor(cj, 'AWAITING_SUPPLIER_FUNDS', CONNECTION);

    expect(pay.label).toContain(CONNECTION.label);
  });

  it('always offers details, since navigation is not a supplier effect', () => {
    expect(
      supplierActionsFor(MINIMAL, 'DELIVERED', CONNECTION).map(
        (action) => action.id,
      ),
    ).toContain('details');
  });
});

describe('CJ adapter translation', () => {
  const cj = findSupplierAdapter('CJ') as SupplierAdapter;

  it('translates a documented status', () => {
    expect(cj.toParcelState('SHIPPED', null, false)).toBe('SHIPPED');
    expect(cj.toParcelState('UNSHIPPED', 'PENDING', false)).toBe('FULFILLING');
  });

  it('splits UNPAID on whether funding blocks payment', () => {
    expect(cj.toParcelState('UNPAID', null, false)).toBe('CJ_PAYMENT_PENDING');
    expect(cj.toParcelState('UNPAID', null, true)).toBe(
      'AWAITING_SUPPLIER_FUNDS',
    );
  });

  it('returns null for an undocumented status instead of guessing', () => {
    expect(cj.toParcelState('PARTIALLY_SHIPPED', null, false)).toBeNull();
  });

  it('distinguishes settled from outstanding spend', () => {
    expect(cj.spendNote(CONNECTION, true)).toContain('paid from');
    expect(cj.spendNote(CONNECTION, false)).toContain('due from');
  });
});
