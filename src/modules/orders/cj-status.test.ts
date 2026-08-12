import { describe, expect, it } from 'vitest';
import {
  CJ_ORDER_STATUSES,
  FUNDING_READINESS,
  parcelStateFromCj,
  parseCjOrderStatus,
  reconcileDelivery,
  type CjOrderStatus,
} from './cj-status';
import { PARCEL_LIFECYCLE_STATES } from './contracts';

describe('parseCjOrderStatus', () => {
  it('accepts every documented status', () => {
    CJ_ORDER_STATUSES.forEach((status) => {
      expect(parseCjOrderStatus(status)).toBe(status);
    });
  });

  it('rejects an undocumented status instead of guessing', () => {
    // CJ changing its contract must become a reconciliation case, not a
    // plausible-looking Sals3 state invented on a real order.
    expect(parseCjOrderStatus('PARTIALLY_SHIPPED')).toBeNull();
    expect(parseCjOrderStatus('unpaid')).toBeNull();
    expect(parseCjOrderStatus('')).toBeNull();
  });
});

describe('parcelStateFromCj', () => {
  it('maps every documented status to a real lifecycle state', () => {
    const known = new Set<string>(PARCEL_LIFECYCLE_STATES);

    CJ_ORDER_STATUSES.forEach((status) => {
      FUNDING_READINESS.forEach((funding) => {
        const state = parcelStateFromCj(status, null, funding);

        expect(known.has(state), `${status}/${funding} → ${state}`).toBe(true);
      });
    });
  });

  it('merges IN_CART into the created state', () => {
    expect(parcelStateFromCj('IN_CART', null, 'READY')).toBe(
      'CJ_ORDER_CREATED',
    );
    expect(parcelStateFromCj('CREATED', null, 'READY')).toBe(
      'CJ_ORDER_CREATED',
    );
  });

  it('splits UNPAID on funding readiness', () => {
    expect(parcelStateFromCj('UNPAID', null, 'READY')).toBe(
      'CJ_PAYMENT_PENDING',
    );
    expect(parcelStateFromCj('UNPAID', null, 'LOW_BALANCE')).toBe(
      'AWAITING_SUPPLIER_FUNDS',
    );
    expect(parcelStateFromCj('UNPAID', null, 'PAYMENT_REQUIRED')).toBe(
      'AWAITING_SUPPLIER_FUNDS',
    );
    expect(parcelStateFromCj('UNPAID', null, 'FUNDING_HOLD')).toBe(
      'AWAITING_SUPPLIER_FUNDS',
    );
  });

  it('does not treat UNKNOWN funding as a shortfall', () => {
    // An unavailable balance reading is not evidence of insufficient funds.
    // ADR-008 requires an authoritative check immediately before payment, and
    // raising AWAITING_SUPPLIER_FUNDS here would open a Critical attention
    // issue every time CJ's balance endpoint hiccuped.
    expect(parcelStateFromCj('UNPAID', null, 'UNKNOWN')).toBe(
      'CJ_PAYMENT_PENDING',
    );
  });

  it('treats both UNSHIPPED sub-states as fulfilling', () => {
    expect(parcelStateFromCj('UNSHIPPED', 'PENDING', 'READY')).toBe(
      'FULFILLING',
    );
    expect(parcelStateFromCj('UNSHIPPED', 'PROCESSING', 'READY')).toBe(
      'FULFILLING',
    );
  });

  it('passes terminal statuses through', () => {
    expect(parcelStateFromCj('SHIPPED', null, 'READY')).toBe('SHIPPED');
    expect(parcelStateFromCj('DELIVERED', null, 'READY')).toBe('DELIVERED');
    expect(parcelStateFromCj('CANCELLED', null, 'READY')).toBe('CANCELLED');
  });

  it('ignores funding readiness for every status except UNPAID', () => {
    CJ_ORDER_STATUSES.filter((status) => status !== 'UNPAID').forEach(
      (status: CjOrderStatus) => {
        const ready = parcelStateFromCj(status, null, 'READY');

        FUNDING_READINESS.forEach((funding) => {
          expect(parcelStateFromCj(status, null, funding)).toBe(ready);
        });
      },
    );
  });
});

describe('reconcileDelivery', () => {
  it('leaves the supplier state alone while the carrier reports nothing', () => {
    expect(reconcileDelivery('FULFILLING', false)).toBe('FULFILLING');
    expect(reconcileDelivery('SHIPPED', false)).toBe('SHIPPED');
  });

  it('agrees when both sources report delivered', () => {
    expect(reconcileDelivery('DELIVERED', true)).toBe('DELIVERED');
  });

  it('conflicts rather than downgrading a delivered parcel', () => {
    // ADR-004 §5: disagreement is reconciled explicitly and a terminal
    // delivered state is never automatically walked back.
    expect(reconcileDelivery('SHIPPED', true)).toBe('TRACKING_CONFLICT');
    expect(reconcileDelivery('FULFILLING', true)).toBe('TRACKING_CONFLICT');
  });
});
