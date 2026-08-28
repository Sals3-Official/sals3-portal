import type { DbExecutor } from '@/lib/db/client';
import {
  findOrderParcelDetailForSeller,
  listOrderParcelsForSeller,
  orderTablesExist,
  revealParcelContactForSeller,
} from './read-model';
import type { OrderParcel, ParcelDetail, RevealedContact } from './contracts';

/**
 * The seam between the orders UI and wherever orders actually live.
 *
 * That used to be a fixture module, and the tables it was waiting for have
 * arrived: `sals3_orders`, `sals3_order_lines`, `fulfillment_groups`,
 * `checkout_intents` and `parcel_tracking_events` are written by the paid
 * checkout path (`POST /api/storefront/checkout/orders/accept`) and by the
 * fulfilment worker. `read-model.ts` is the implementation behind every method
 * here; the pages, components and reveal action still speak `OrderParcel` and
 * `ParcelDetail` and know nothing about the source, which is what let this
 * change stay inside these two files.
 *
 * Every method is async because it always was — the fixtures were synchronous
 * and the signature was written for the day they stopped being, precisely so
 * this swap touched no call site.
 *
 * ## Where the guards live, and why not here
 *
 * This module deliberately does **not** call `readOrUnavailable`, and does not
 * resolve the session. Both belong to the page, together, inside one wrapper:
 * resolving the seller account is itself a query, so a page that authorized
 * outside the wrapper would crash before reaching the part it had carefully
 * protected. `src/lib/db/availability.ts` documents that exact failure, and
 * both order pages now follow the shape `listings/page.tsx` already uses.
 *
 * Keeping the guards out of here also keeps this seam honest about what it is:
 * a data source, not a policy layer. The `sellerId` every method takes is the
 * tenant boundary, and `read-model.ts` applies it inside the SQL.
 */
export type OrdersRepository = {
  /**
   * Whether the order tables exist at all.
   *
   * Part of this seam rather than imported straight from the read model, so a
   * page still talks to exactly one thing about orders. The pages call it
   * before reading, because "not migrated here" and "no orders yet" render
   * very differently and only one of them is a reason to go looking for lost
   * sales.
   */
  tablesExist(): Promise<boolean>;

  listParcels(sellerId: string): Promise<OrderParcel[]>;

  findParcelDetail(
    parcelId: string,
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

function databaseOrdersRepository(executor?: DbExecutor): OrdersRepository {
  const options = executor === undefined ? {} : { executor };

  return {
    async tablesExist() {
      return orderTablesExist(options);
    },

    async listParcels(sellerId) {
      return listOrderParcelsForSeller(sellerId, options);
    },

    async findParcelDetail(parcelId, sellerId, canRevealContact) {
      return findOrderParcelDetailForSeller(
        parcelId,
        sellerId,
        canRevealContact,
        options,
      );
    },

    async revealContact(parcelId, sellerId) {
      return revealParcelContactForSeller(parcelId, sellerId, options);
    },
  };
}

/**
 * Resolves the repository for this request.
 *
 * A function rather than a bare export so a caller inside a transaction can
 * pass its own executor, and so the swap that just happened stayed one line.
 */
export default function getOrdersRepository(
  executor?: DbExecutor,
): OrdersRepository {
  return databaseOrdersRepository(executor);
}
