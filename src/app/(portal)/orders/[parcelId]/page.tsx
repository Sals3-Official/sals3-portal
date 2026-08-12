import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import MarketNotConfiguredNotice from '@/components/seller-center/shared/MarketNotConfiguredNotice';
import OrderHistoryTimeline from '@/components/seller-center/orders/OrderHistoryTimeline';
import OrdersViewToggle from '@/components/seller-center/orders/OrdersViewToggle';
import ParcelBuyerCard from '@/components/seller-center/orders/ParcelBuyerCard';
import ParcelContentsCard from '@/components/seller-center/orders/ParcelContentsCard';
import ParcelDetailActions from '@/components/seller-center/orders/ParcelDetailActions';
import ParcelMoneyRow from '@/components/seller-center/orders/ParcelMoneyRow';
import ParcelRiskFacts from '@/components/seller-center/orders/ParcelRiskFacts';
import ParcelStatusCard from '@/components/seller-center/orders/ParcelStatusCard';
import SiblingParcelCard from '@/components/seller-center/orders/SiblingParcelCard';
import TrackingEventFeed from '@/components/seller-center/orders/TrackingEventFeed';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import { readOrUnavailable } from '@/lib/db/availability';
import { findActiveProfileForSeller } from '@/modules/market-config/repository';
import getOrdersRepository from '@/modules/orders/repository';
import revealParcelContactAction from './actions';

export const metadata: Metadata = { title: 'Parcel · Seller Center' };

type ParcelDetailPageProps = {
  params: Promise<{ parcelId: string }>;
};

function OrdersUnavailable() {
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-[18px] px-7 pt-6 pb-15">
      <p className="rounded-lg border border-dashed border-border bg-muted/40 px-6 py-10 text-sm text-muted-foreground">
        Orders cannot be checked right now because the database is unavailable.
        No order or market configuration was changed. Check that Postgres is
        running and that DATABASE_URL points at an existing database, then
        reload.
      </p>
    </div>
  );
}

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
  if (!isDatabaseConfigured()) {
    return <OrdersUnavailable />;
  }

  const resolved = await readOrUnavailable('orders', async () => {
    const session = await requirePermission('order:read');
    const profile = await findActiveProfileForSeller(getDb(), session.sellerId);

    return { session, profile };
  });

  if (!resolved.ok) {
    return <OrdersUnavailable />;
  }

  if (resolved.data.profile === null) {
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col gap-[18px] px-7 pt-6 pb-15">
        <MarketNotConfiguredNotice title="No active market profile" />
      </div>
    );
  }

  const { session } = resolved.data;
  // Decides whether the *button* renders. The action re-checks server-side,
  // because hiding a control is never the authorization boundary.
  const canReveal = can(session.role, 'order:fulfill');

  const { parcelId } = await params;

  const detail = await getOrdersRepository().findParcelDetail(
    parcelId,
    session.sellerId,
    canReveal,
  );

  if (detail === null) notFound();

  const { parcel } = detail;
  const isSplit = parcel.parcelCount > 1;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-[18px] px-7 pt-6 pb-15">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <nav className="flex items-center gap-1 text-sm text-ink-muted">
            <Link href="/orders" className="hover:text-primary hover:underline">
              Orders
            </Link>
            <span aria-hidden="true">/</span>
            <span className="text-ink">{parcel.orderRef}</span>
            {isSplit ? (
              <span className="text-ink-faint">
                · parcel {parcel.parcelIndex} of {parcel.parcelCount}
              </span>
            ) : null}
          </nav>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {parcel.id}
            </h1>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-medium text-ink-muted">
              {parcel.channel}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] font-medium text-ink-muted">
              {parcel.route.kind === 'OWN_STOCK'
                ? 'In-House'
                : parcel.route.connection.label}
            </span>
          </div>
          <p className="text-[12.5px] text-ink-subtle">
            Prepaid, payment captured
            {isSplit
              ? ` · ships separately from the other parcel on ${parcel.orderRef}`
              : ''}
          </p>
        </div>
        <OrdersViewToggle
          active="detail"
          listHref="/orders"
          detailHref={`/orders/${parcel.id}`}
        />
      </div>

      <div className="flex flex-wrap items-start gap-[18px]">
        <div className="flex min-w-0 flex-[2_1_560px] flex-col gap-[18px]">
          <ParcelStatusCard
            status={parcel.status}
            actionsSlot={
              <ParcelDetailActions
                actions={detail.actions}
                parcelId={parcel.id}
              />
            }
          />

          <ParcelBuyerCard
            buyer={detail.buyer}
            route={parcel.route}
            onReveal={async () => {
              'use server';

              return revealParcelContactAction(parcelId);
            }}
          />

          <ParcelContentsCard
            lines={parcel.lines}
            sellerNote={detail.sellerNote}
          />

          <ParcelMoneyRow
            settlement={detail.settlement}
            supplierSpend={detail.supplierSpend}
            buyerPaymentNote={
              isSplit
                ? `Covers the whole order ${parcel.orderRef}, both parcels. It is not money paid to you.`
                : 'What the buyer was charged. It is not money paid to you.'
            }
          />

          <ParcelRiskFacts facts={detail.riskFacts} />
        </div>

        <div className="flex min-w-0 flex-[1_1_300px] flex-col gap-[18px]">
          <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-col gap-1">
              <h2 className="font-display text-[15px] font-semibold">
                Carrier tracking
              </h2>
              <span className="text-[12px] text-ink-faint">
                Scans from the carrier and your supplier.
              </span>
            </div>
            <div className="flex items-baseline justify-between gap-3 border-b border-border pb-3 text-[12.5px]">
              <span className="text-ink-subtle">Tracking number</span>
              <span className="text-ink tabular-nums">
                {parcel.route.trackingNumber ?? 'Not issued yet'}
              </span>
            </div>
            <TrackingEventFeed events={detail.trackingEvents} />
          </section>

          <OrderHistoryTimeline events={detail.lifecycleEvents} />

          <SiblingParcelCard
            orderRef={parcel.orderRef}
            siblings={detail.siblings}
          />
        </div>
      </div>
    </div>
  );
}
