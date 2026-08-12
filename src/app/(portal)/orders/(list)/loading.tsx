import PortalRouteLoading from '@/components/portal/PortalRouteLoading';

/*
 * This skeleton lives in a `(list)` route group rather than directly under
 * `orders/`, and the grouping is load-bearing.
 *
 * A `loading.tsx` wraps its whole segment *and every child route* in a
 * Suspense boundary. Sitting at `orders/` it therefore covered
 * `orders/[parcelId]` too, so Next streamed the shell and committed a `200`
 * before that page's body ran - and its `notFound()` for an unknown parcel
 * rendered the 404 *page* under a `200` *status*. Measured, not assumed:
 * `/orders/nope` answered `200` while `/listings/new?fixture=bogus`, which has
 * no boundary above it, answered `404`.
 *
 * The route group keeps the skeleton on the list, where the work is, and out
 * of the detail route, which must be free to answer 404 honestly. `(list)` is
 * excluded from the URL, so `/orders` is unchanged.
 *
 * The same reasoning is written out at `listings/new/page.tsx`.
 */
export default function Loading() {
  return <PortalRouteLoading />;
}
