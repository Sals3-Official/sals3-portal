import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import OrderHistoryTimeline from '@/components/seller-center/orders/OrderHistoryTimeline';
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
import { readOrUnavailable } from '@/lib/db/availability';
import { isDatabaseConfigured } from '@/lib/db/client';
import getOrdersRepository from '@/modules/orders/repository';
import revealParcelContactAction from './actions';

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
  const { parcelId } = await params;

  if (!isDatabaseConfigured()) notFound();

  // The permission check runs inside the wrapper with the read it guards:
  // resolving the seller account is a query, so authorizing outside it would
  // crash before reaching the protected part. See `lib/db/availability.ts`.
  const resolved = await readOrUnavailable('parcel detail', async () => {
    const session = await requirePermission('order:read');
    const repository = getOrdersRepository();

    // No tables here means no parcel here. A 404 is the honest answer for a
    // single parcel - the list screen is where the migration gap is explained,
    // because that is where somebody arrives asking where their orders went.
    if (!(await repository.tablesExist())) return null;

    return repository.findParcelDetail(
      parcelId,
      session.sellerId,
      // Decides whether the *button* renders. The action re-checks
      // server-side, because hiding a control is never the authorization
      // boundary.
      can(session.role, 'order:fulfill'),
    );
  });

  // A database that did not answer is not a parcel that does not exist. It
  // renders as a named outage rather than a 404, so nobody reads a blip as a
  // deleted order and goes looking for who removed it.
  if (!resolved.ok) {
    return (
      <div className="mx-auto flex max-w-[1440px] flex-col gap-4 px-7 pt-6 pb-15">
        <nav className="flex items-center gap-1 text-sm text-ink-muted">
          <Link href="/orders" className="hover:text-primary hover:underline">
            Orders
          </Link>
        </nav>
        <div className="rounded-lg border border-border bg-card px-6 py-10 text-center">
          <p className="text-sm font-medium text-foreground">
            Orders could not be loaded
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            This parcel could not be loaded. Nothing was changed.
          </p>
        </div>
      </div>
    );
  }

  const detail = resolved.data;

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
            {/* The crumb stops at the section. The reference used to sit here
                too, and now that the heading carries it the two would print
                the same string twice in a row. */}
          </nav>
          <div className="flex flex-wrap items-center gap-2.5">
            {/* The order reference, not the parcel's uuid. A seller has no
                use for 36 characters of hexadecimal as the title of a page,
                and the reference is the one identifier they and their buyer
                both recognise. The uuid stays in the URL, which is where an
                opaque key belongs. */}
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {parcel.orderRef}
              {isSplit ? (
                <span className="text-ink-subtle">
                  {' '}
                  · parcel {parcel.parcelIndex} of {parcel.parcelCount}
                </span>
              ) : null}
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
