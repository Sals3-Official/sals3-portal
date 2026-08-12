import type { SellerCenterMarket } from '@/lib/seller-center/market-config';
import {
  buildOrderParcels,
  buildParcelDetail,
  revealBuyerContact,
} from '@/lib/seller-center/mock-data/orders';
import type { OrderParcel, ParcelDetail, RevealedContact } from './contracts';

/**
 * The seam between the orders UI and wherever orders actually live.
 *
 * Today that is a fixture module. When the `orders` /
 * `order_line_snapshots` / `fulfillment_groups` / `supplier_order_intents`
 * tables land, only this file changes: pages, components and the reveal action
 * already speak `OrderParcel` and `ParcelDetail` and know nothing about the
 * source.
 *
 * Every method is async even though the fixtures are synchronous. A synchronous
 * signature would have to change at every call site the day a real query
 * appears, which is precisely the churn this seam exists to prevent.
 *
 * ## When the database arrives
 *
 * Wrap each read in `readOrUnavailable` from `src/lib/db/availability.ts`, and
 * put the authorization call *inside* that wrapper alongside the reads it
 * guards. Resolving the seller account is itself a query, so leaving it outside
 * crashes the page before reaching the part that was carefully protected -
 * that file documents the exact failure.
 */
export type OrdersRepository = {
  listParcels(
    market: SellerCenterMarket,
    sellerId: string,
  ): Promise<OrderParcel[]>;

  findParcelDetail(
    parcelId: string,
    market: SellerCenterMarket,
    sellerId: string,
    canRevealContact: boolean,
  ): Promise<ParcelDetail | null>;

  /**
   * Separate from `findParcelDetail` on purpose: the plaintext must never be
   * reachable from the call that renders the page, or it ends up in the page
   * payload. Only the reveal server action calls this, after checking
   * `order:fulfill`.
   */
  revealContact(
    parcelId: string,
    sellerId: string,
  ): Promise<RevealedContact | null>;
};

/**
 * Fixture-backed implementation.
 *
 * `sellerId` is accepted and currently unused - the fixtures are not
 * tenant-scoped. It is in the signature from the start because every real
 * query must filter by it, and adding the parameter later is the kind of
 * change that gets applied to four call sites and missed on the fifth.
 */
const fixtureOrdersRepository: OrdersRepository = {
  async listParcels(market) {
    return buildOrderParcels(market);
  },

  async findParcelDetail(parcelId, market, _sellerId, canRevealContact) {
    return buildParcelDetail(parcelId, market, canRevealContact);
  },

  async revealContact(parcelId) {
    return revealBuyerContact(parcelId);
  },
};

/**
 * Resolves the repository for this request.
 *
 * A function rather than a bare export so the swap is one line here, and so a
 * future implementation can depend on request state (a database client, the
 * session) without every caller learning about it.
 */
export default function getOrdersRepository(): OrdersRepository {
  return fixtureOrdersRepository;
}
