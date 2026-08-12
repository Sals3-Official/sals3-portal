import { z } from 'zod';
import { LANE_KEYS } from '@/modules/orders/contracts';

/**
 * The orders list keeps its whole view in the URL, so a lane is shareable and
 * the back button behaves.
 *
 * Every field uses `.catch()` rather than failing the parse. Shopee's own list
 * falls back to its "All" tab on an unrecognised `?type=`, and that is the
 * right posture here too: a stale bookmark or a hand-edited parameter should
 * land the seller on a sane view, not an error page for a read-only list.
 */

export const ORDER_SEARCH_FIELDS = [
  'order',
  'tracking',
  'buyer',
  'product',
] as const;

export const ORDER_SORTS = ['order-date-desc', 'ship-by-asc'] as const;

export const ORDER_SEARCH_FIELD_LABELS: Record<
  (typeof ORDER_SEARCH_FIELDS)[number],
  string
> = {
  order: 'Order reference',
  tracking: 'Tracking number',
  buyer: 'Buyer',
  product: 'Product',
};

export const ORDER_SORT_LABELS: Record<(typeof ORDER_SORTS)[number], string> = {
  'order-date-desc': 'Order date, newest',
  'ship-by-asc': 'Ship-by, soonest',
};

export const ordersQuerySchema = z.object({
  lane: z.enum(LANE_KEYS).catch('all'),
  /**
   * `all`, `own-stock`, or a supplier label. Left as a free string because the
   * set of connected suppliers is per-seller and not knowable at parse time;
   * `filterParcels` simply matches nothing for a label the seller does not
   * have, which is the honest result for a route they cannot see.
   */
  route: z.string().catch('all'),
  stage: z.string().catch('all'),
  reason: z.string().catch('all'),
  field: z.enum(ORDER_SEARCH_FIELDS).catch('order'),
  q: z.string().catch(''),
  sort: z.enum(ORDER_SORTS).catch('order-date-desc'),
});

export type OrdersQuery = z.infer<typeof ordersQuerySchema>;

/**
 * The subset of the query worth putting back into a link.
 *
 * Defaults are omitted so the default view is `/orders`, not
 * `/orders?lane=all&route=all&…`. `buildQueryString` already drops a key whose
 * patch value is `null`; this keeps the *starting* parameters equally clean.
 */
export function currentOrdersParams(
  query: OrdersQuery,
): Record<string, string> {
  const params: Record<string, string> = {};

  if (query.lane !== 'all') params.lane = query.lane;
  if (query.route !== 'all') params.route = query.route;
  if (query.stage !== 'all') params.stage = query.stage;
  if (query.reason !== 'all') params.reason = query.reason;
  if (query.field !== 'order') params.field = query.field;
  if (query.q !== '') params.q = query.q;
  if (query.sort !== 'order-date-desc') params.sort = query.sort;

  return params;
}
