import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import OrdersFilterChips from '@/components/seller-center/orders/OrdersFilterChips';
import OrdersHandoffPanel from '@/components/seller-center/orders/OrdersHandoffPanel';
import OrdersReprintHistoryPanel from '@/components/seller-center/orders/OrdersReprintHistoryPanel';
import OrdersWorkspace from '@/components/seller-center/orders/OrdersWorkspace';
import { requirePermission } from '@/lib/auth/session';
import { getActiveMarket } from '@/lib/seller-center/market-config';
import {
  ORDERS,
  ORDERS_EXCLUDED_NOTE,
  filterOrders,
} from '@/lib/seller-center/mock-data/orders';
import { ordersQuerySchema } from '@/lib/seller-center/orders-query';

export const metadata: Metadata = { title: 'Orders · Seller Center' };

type OrdersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Batch fulfillment. A Server Component that parses the filter from the URL
 * and hands the filtered list to the client workspace that owns selection.
 */
export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  await requirePermission('order:read');

  const rawParams = await searchParams;
  const query = ordersQuerySchema.parse(rawParams);
  const market = getActiveMarket();
  const filtered = filterOrders(ORDERS, query.orderFilter);
  const hasExcluded = ORDERS.some((order) => order.locked);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Orders"
        description={`Batch fulfillment · ${market.carrierName} · cutoff ${market.cutoffTime} ${market.timeZone}`}
      />
      <OrdersFilterChips
        active={query.orderFilter}
        currentParams={{ orderFilter: query.orderFilter }}
      />
      {hasExcluded ? (
        <DisclosureBanner tone="warning">
          {ORDERS_EXCLUDED_NOTE}
        </DisclosureBanner>
      ) : null}
      <OrdersWorkspace orders={filtered} market={market} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OrdersReprintHistoryPanel />
        <OrdersHandoffPanel market={market} />
      </div>
    </div>
  );
}
