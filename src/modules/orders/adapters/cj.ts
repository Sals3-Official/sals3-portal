import {
  parcelStateFromCj,
  parseCjOrderStatus,
  type CjSubStatus,
} from '../cj-status';
import type {
  SupplierAdapter,
  SupplierConnectionRef,
} from '../supplier-adapter';

/**
 * CJdropshipping, the first supplier adapter.
 *
 * ADR-008 phase 1: CJ is the only verified provider. AliExpress, Printful and
 * Printify are named there as future Supplier Apps, and each will arrive as a
 * sibling of this file with its own capability list - not as a branch inside
 * shared code.
 *
 * `PAY_VIA_PAGE` is deliberately absent. CJ documents a `cjPayUrl` for page
 * payment, but ADR-008 requires page/manual payment to be an explicit,
 * separately verified fallback rather than something the UI assumes. Declaring
 * a capability we have not tested end to end would put a button in front of a
 * seller that we cannot promise completes.
 */
const cjAdapter: SupplierAdapter = {
  providerCode: 'CJ',
  displayName: 'CJdropshipping',
  capabilities: [
    'CREATE_ORDER',
    'PAY_FROM_WALLET',
    'CANCEL_ORDER',
    'GET_TRACKING',
    'PROCESS_WEBHOOK',
  ],

  toParcelState(rawStatus, rawSubStatus, fundingBlocksPayment) {
    const status = parseCjOrderStatus(rawStatus);

    // Unknown status stays unknown. Mapping it to something plausible would
    // fabricate a fact about a real order; the caller treats null as a
    // reconciliation case.
    if (status === null) return null;

    return parcelStateFromCj(
      status,
      rawSubStatus as CjSubStatus | null,
      fundingBlocksPayment ? 'LOW_BALANCE' : 'READY',
    );
  },

  spendNote(connection: SupplierConnectionRef, settled: boolean) {
    return settled
      ? `paid from your ${connection.label} account`
      : `due from your ${connection.label} account`;
  },
};

export default cjAdapter;
