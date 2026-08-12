import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import MarketNotConfiguredNotice from '@/components/seller-center/shared/MarketNotConfiguredNotice';
import OrderHistoryTimeline from '@/components/seller-center/orders/OrderHistoryTimeline';
import ParcelDetailActions from '@/components/seller-center/orders/ParcelDetailActions';
import ParcelLogisticsBlock from '@/components/seller-center/orders/ParcelLogisticsBlock';
import ParcelStatusCard from '@/components/seller-center/orders/ParcelStatusCard';
import SettlementStatement from '@/components/seller-center/orders/SettlementStatement';
import SupplierSpendPanel from '@/components/seller-center/orders/SupplierSpendPanel';
import TrackingEventFeed from '@/components/seller-center/orders/TrackingEventFeed';
import { requirePermission } from '@/lib/auth/session';
import { getActiveMarket } from '@/lib/seller-center/market-config';
import { buildParcelDetail } from '@/lib/seller-center/mock-data/orders';

export const metadata: Metadata = { title: 'Parcel · Seller Center' };

type ParcelDetailPageProps = {
  params: Promise<{ parcelId: string }>;
};

/**
 * One parcel's detail.
 *
 * Keyed on the parcel, not the order reference: a split order has two parcels
 * under one reference, and a route addressing the reference could not say
 * which of them the seller opened.
 */
export default async function ParcelDetailPage({
  params,
}: ParcelDetailPageProps) {
  await requirePermission('order:read');

  const { parcelId } = await params;
  const market = getActiveMarket();

  if (market === null) {
    return (
      <div className="flex flex-col gap-4">
        <MarketNotConfiguredNotice />
      </div>
    );
  }

  const detail = buildParcelDetail(parcelId, market);

  if (detail === null) notFound();

  const { parcel } = detail;

  return (
    <div className="flex flex-col gap-4">
      <nav className="flex items-center gap-1 text-sm text-ink-muted">
        <Link href="/orders" className="hover:text-primary hover:underline">
          Orders
        </Link>
        <span aria-hidden="true">/</span>
        <span className="text-ink">{parcel.orderRef}</span>
        {parcel.parcelCount > 1 ? (
          <span className="text-ink-faint">
            · parcel {parcel.parcelIndex} of {parcel.parcelCount}
          </span>
        ) : null}
      </nav>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <ParcelStatusCard
            status={parcel.status}
            actionsSlot={
              <ParcelDetailActions
                actions={detail.actions}
                parcelId={parcel.id}
              />
            }
          />

          <ParcelLogisticsBlock
            parcel={parcel}
            courierContactLabel={detail.courierContactLabel}
            feedSlot={<TrackingEventFeed events={detail.trackingEvents} />}
          />

          <SettlementStatement settlement={detail.settlement} />

          {/* Rail B renders as its own card, and only for dropship parcels. */}
          {detail.supplierSpend === null ? null : (
            <SupplierSpendPanel spend={detail.supplierSpend} />
          )}
        </div>

        <OrderHistoryTimeline events={detail.lifecycleEvents} />
      </div>
    </div>
  );
}
