import type {
  ParcelAction,
  ParcelLifecycleState,
  SupplierConnectionRef,
} from './contracts';

export type { SupplierConnectionRef };

/**
 * The provider-agnostic contract every supplier integration implements.
 *
 * ADR-008 is explicit that "the UI and order worker must not assume CJ and
 * AliExpress support identical actions", and that a seller may install several
 * supplier apps against one account. So nothing above this file may branch on
 * a provider name: a screen that says `if (provider === 'CJ')` is a screen that
 * breaks the day a second provider is connected, and it breaks silently, by
 * offering a button the provider cannot honour.
 *
 * Capabilities are declared, not inferred. An adapter that does not list
 * `CANCEL_ORDER` gets no cancel control - not a disabled one, and not one that
 * fails at the API.
 */

export const SUPPLIER_CAPABILITIES = [
  'CREATE_ORDER',
  'PAY_FROM_WALLET',
  'PAY_VIA_PAGE',
  'CANCEL_ORDER',
  'GET_TRACKING',
  'PROCESS_WEBHOOK',
] as const;

export type SupplierCapability = (typeof SUPPLIER_CAPABILITIES)[number];

export type SupplierAdapter = {
  providerCode: string;
  displayName: string;
  capabilities: readonly SupplierCapability[];
  /** Translates the provider's own order status into a Sals3 parcel state. */
  toParcelState(
    rawStatus: string,
    rawSubStatus: string | null,
    fundingBlocksPayment: boolean,
  ): ParcelLifecycleState | null;
  /** Copy for the supplier-spend footnote, e.g. "paid from your CJ account". */
  spendNote(connection: SupplierConnectionRef, settled: boolean): string;
};

export function supports(
  adapter: SupplierAdapter,
  capability: SupplierCapability,
): boolean {
  return adapter.capabilities.includes(capability);
}

/**
 * The actions a parcel offers, derived from its state and what the provider
 * can actually do.
 *
 * Deriving rather than storing is the point. A fixture or a database row
 * listing "Cancel order" would keep offering it after a provider dropped the
 * capability, and the seller would find out from a failed request.
 */
/**
 * Actions Sals3 owns, whatever the route.
 *
 * Reconciling a tracking conflict is our operation, not a provider's - ADR-004
 * §5 makes the source-priority decision ours, and it applies just as much to an
 * own-stock parcel where two carrier feeds disagree. Putting it behind a
 * supplier capability would mean a provider could switch off our own
 * reconciliation, and an own-stock conflict would offer nothing at all.
 */
export function sals3OwnedActionsFor(
  state: ParcelLifecycleState,
): ParcelAction[] {
  if (state === 'TRACKING_CONFLICT') {
    return [
      {
        id: 'resolve-conflict',
        label: 'Resolve conflict',
        variant: 'primary',
        blockedReason: 'Locked while tracking is reconciled',
      },
    ];
  }

  if (state === 'DELIVERY_EXCEPTION') {
    return [
      {
        id: 'contact-carrier',
        label: 'Contact carrier',
        variant: 'primary',
        blockedReason: null,
      },
    ];
  }

  return [];
}

export function supplierActionsFor(
  adapter: SupplierAdapter,
  state: ParcelLifecycleState,
  connection: SupplierConnectionRef,
): ParcelAction[] {
  const actions: ParcelAction[] = [];

  if (state === 'AWAITING_SUPPLIER_FUNDS') {
    if (supports(adapter, 'PAY_FROM_WALLET')) {
      actions.push({
        id: 'pay-supplier',
        label: `Pay from your ${connection.label} account`,
        variant: 'primary',
        blockedReason: 'Wallet balance too low to pay supplier',
      });
    } else if (supports(adapter, 'PAY_VIA_PAGE')) {
      actions.push({
        id: 'open-supplier-payment',
        label: `Open ${adapter.displayName} payment page`,
        variant: 'primary',
        blockedReason: null,
      });
    }
  }

  /*
   * `FULFILLMENT_FAILED` deliberately offers no action.
   *
   * It used to advertise "Retry supplier order", but nothing executed it —
   * `OrdersWorkspace`'s `handleAction` raises a "not wired to a backend" toast
   * for every id except `details`. On 2026-08-28 that button was the first
   * thing reached for on a genuinely stuck order and it did nothing, which is
   * worse than no button: it costs an operator the time to discover that the
   * obvious remedy is a prop.
   *
   * Retrying is also no longer the operator's job. The fulfillment worker now
   * reconciles by `orderNumber` before creating, so a replay of the queue
   * message recovers an orphaned CJ order on its own.
   */

  const cancellable =
    state === 'CJ_ORDER_CREATED' ||
    state === 'CJ_PAYMENT_PENDING' ||
    state === 'FULFILLING';

  if (cancellable && supports(adapter, 'CANCEL_ORDER')) {
    actions.push({
      id: 'request-supplier-cancel',
      label: 'Request cancellation',
      variant: 'secondary',
      blockedReason: null,
    });
  }

  // Always last, always available: it is navigation, not a supplier effect.
  actions.push({
    id: 'details',
    label: 'Check details',
    variant: 'secondary',
    blockedReason: null,
  });

  return actions;
}
