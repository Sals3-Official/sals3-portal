import type { ParcelLifecycleState } from './contracts';

/**
 * Translates CJ's order status into a Sals3 parcel state.
 *
 * ADR-004 §2 requires internal state independent of CJ's identifiers and
 * vocabulary, and §6 forbids raw supplier names reaching a seller-facing
 * surface. This module is the only place the two vocabularies meet; nothing
 * downstream should ever branch on a CJ string.
 *
 * Verified against CJ's Shopping API documentation on 2026-08-12:
 * <https://developers.cjdropshipping.com/en/api/api2/api/shopping.html>
 */

/** CJ's documented `orderStatus` values. */
export const CJ_ORDER_STATUSES = [
  'CREATED',
  'IN_CART',
  'UNPAID',
  'UNSHIPPED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
] as const;

export type CjOrderStatus = (typeof CJ_ORDER_STATUSES)[number];

/** Present only while `orderStatus` is `UNSHIPPED`; `null` otherwise. */
export const CJ_SUB_STATUSES = ['PENDING', 'PROCESSING'] as const;

export type CjSubStatus = (typeof CJ_SUB_STATUSES)[number];

/** ADR-008's funding-readiness vocabulary. */
export const FUNDING_READINESS = [
  'READY',
  'LOW_BALANCE',
  'PAYMENT_REQUIRED',
  'FUNDING_HOLD',
  'UNKNOWN',
] as const;

export type FundingReadiness = (typeof FUNDING_READINESS)[number];

/**
 * Narrows an untrusted supplier string to a documented status.
 *
 * Returns `null` rather than guessing. An unrecognised CJ status means CJ's
 * contract changed, and mapping it onto some plausible-looking Sals3 state
 * would fabricate a fact about a real order - the caller must treat `null` as
 * a reconciliation case, not as a value with a sensible default.
 */
export function parseCjOrderStatus(raw: string): CjOrderStatus | null {
  return CJ_ORDER_STATUSES.find((status) => status === raw) ?? null;
}

/**
 * Whether a funding readiness means the supplier order cannot be paid.
 *
 * `UNKNOWN` is deliberately *not* insufficient. ADR-008 requires an
 * authoritative balance check immediately before payment, so a stale or
 * unavailable cached reading is not evidence of a shortfall - and raising
 * `AWAITING_SUPPLIER_FUNDS` on it would open a Critical attention issue, mail
 * the seller, and pause their offers every time CJ's balance endpoint
 * hiccuped. The attention lane is only useful while everything in it is real.
 */
function blocksSupplierPayment(funding: FundingReadiness): boolean {
  return (
    funding === 'LOW_BALANCE' ||
    funding === 'PAYMENT_REQUIRED' ||
    funding === 'FUNDING_HOLD'
  );
}

/**
 * The Sals3 state for a CJ supplier order.
 *
 * `UNPAID` is the only status whose meaning depends on something CJ does not
 * tell us: it means "we have not paid yet" when the wallet can cover it and
 * "we cannot pay" when it cannot. ADR-008 puts that decision on funding
 * readiness, so it is a required argument rather than an optional flag - a
 * caller that has not resolved funding cannot accidentally get the optimistic
 * answer by omitting it.
 *
 * `subStatus` is accepted for completeness and intentionally does not change
 * the result: CJ documents both `PENDING` ("paid, waiting for processing") and
 * `PROCESSING` as sub-states of `UNSHIPPED`, and both mean the same thing to a
 * seller - the supplier has the money and has not shipped yet. The distinction
 * belongs in the status *sentence*, not in the state machine.
 */
export function parcelStateFromCj(
  status: CjOrderStatus,
  subStatus: CjSubStatus | null,
  funding: FundingReadiness,
): ParcelLifecycleState {
  switch (status) {
    // CJ merges `IN_CART` into the created state; it is never shown separately.
    case 'CREATED':
    case 'IN_CART':
      return 'CJ_ORDER_CREATED';
    case 'UNPAID':
      return blocksSupplierPayment(funding)
        ? 'AWAITING_SUPPLIER_FUNDS'
        : 'CJ_PAYMENT_PENDING';
    case 'UNSHIPPED':
      return 'FULFILLING';
    case 'SHIPPED':
      return 'SHIPPED';
    case 'DELIVERED':
      return 'DELIVERED';
    case 'CANCELLED':
      return 'CANCELLED';
    default: {
      // `status` narrows to `never` here, so adding a value to
      // `CJ_ORDER_STATUSES` without handling it fails typecheck rather than
      // reaching this throw. The throw covers the runtime case where an
      // unvalidated string was cast past `parseCjOrderStatus`.
      const unhandled: never = status;

      throw new Error(`Unhandled CJ order status: ${String(unhandled)}`);
    }
  }
}

/**
 * Reconciles CJ's `DELIVERED` against a carrier's own delivery event.
 *
 * ADR-004 §5 sets a source priority and requires disagreement to enter
 * `TRACKING_CONFLICT` rather than resolving itself. It also forbids
 * automatically downgrading a terminal delivered state, which is why a
 * carrier-delivered parcel that CJ still reports in transit conflicts instead
 * of reverting to `FULFILLING`.
 */
export function reconcileDelivery(
  supplierState: ParcelLifecycleState,
  carrierReportsDelivered: boolean,
): ParcelLifecycleState {
  if (!carrierReportsDelivered) return supplierState;
  if (supplierState === 'DELIVERED') return 'DELIVERED';

  return 'TRACKING_CONFLICT';
}
