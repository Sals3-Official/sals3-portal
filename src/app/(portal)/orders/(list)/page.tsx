import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import MarketNotConfiguredNotice from '@/components/seller-center/shared/MarketNotConfiguredNotice';
import OrdersChipRow from '@/components/seller-center/orders/OrdersChipRow';
import OrdersHandoffPanel from '@/components/seller-center/orders/OrdersHandoffPanel';
import OrdersLaneTabs from '@/components/seller-center/orders/OrdersLaneTabs';
import OrdersReprintHistoryPanel from '@/components/seller-center/orders/OrdersReprintHistoryPanel';
import OrdersResultBar from '@/components/seller-center/orders/OrdersResultBar';
import OrdersSearchBar from '@/components/seller-center/orders/OrdersSearchBar';
import OrdersSortSelect from '@/components/seller-center/orders/OrdersSortSelect';
import OrdersViewToggle from '@/components/seller-center/orders/OrdersViewToggle';
import OrdersWorkspace from '@/components/seller-center/orders/OrdersWorkspace';
import { requirePermission } from '@/lib/auth/session';
import getDb, { isDatabaseConfigured } from '@/lib/db/client';
import { readOrUnavailable } from '@/lib/db/availability';
import { buildHref } from '@/lib/portal/search-params';
import { findActiveProfileForSeller } from '@/modules/market-config/repository';
import getOrdersRepository from '@/modules/orders/repository';
import {
  ORDER_SEARCH_FIELDS,
  ORDER_SEARCH_FIELD_LABELS,
  ORDER_SORTS,
  ORDER_SORT_LABELS,
  currentOrdersParams,
  ordersQuerySchema,
} from '@/lib/seller-center/orders-query';
import { LANES } from '@/modules/orders/contracts';
import {
  countByLane,
  describeResultCount,
  filterParcels,
  sortParcels,
} from '@/modules/orders/lanes';

export const metadata: Metadata = { title: 'Orders · Seller Center' };

type OrdersPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const ATTENTION_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'funding', label: 'Funding' },
  { key: 'supplier-failure', label: 'Supplier failure' },
  { key: 'tracking-conflict', label: 'Tracking conflict' },
  { key: 'delivery-exception', label: 'Delivery exception' },
];

const RETAILER_STAGE_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'to-arrange', label: 'To arrange' },
  { key: 'arranged', label: 'Arranged' },
];

const DROPSHIPPER_STAGE_CHIPS = [
  { key: 'all', label: 'All' },
  { key: 'to-order', label: 'To order' },
  { key: 'to-pay', label: 'To pay' },
  { key: 'supplier-preparing', label: 'Supplier preparing' },
];

function OrdersDatabaseUnavailable() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Orders" description="Batch fulfillment" />
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
 * The orders list. A Server Component: it parses the view out of the URL,
 * shapes the parcels, and hands selection to the client workspace.
 *
 * The parcel data remains an interface fixture, but the workspace gate is the
 * authenticated seller's real `seller_market_profiles` record. The profile
 * carries no currency, carrier, tax, payout, or cutoff contract yet, so none
 * of those fixture values may be used to decorate a real seller's account.
 */
export default async function OrdersPage({ searchParams }: OrdersPageProps) {
  if (!isDatabaseConfigured()) {
    return <OrdersDatabaseUnavailable />;
  }

  // `requirePermission()` resolves the seller account through the database.
  // Keeping it inside this guard means an outage renders an honest recovery
  // state instead of failing before the profile lookup is reached.
  const resolved = await readOrUnavailable('orders', async () => {
    const session = await requirePermission('order:read');
    const profile = await findActiveProfileForSeller(getDb(), session.sellerId);

    return { session, profile };
  });

  if (!resolved.ok) {
    return <OrdersDatabaseUnavailable />;
  }

  const { session, profile } = resolved.data;

  const rawParams = await searchParams;
  const query = ordersQuerySchema.parse(rawParams);

  if (profile === null) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Orders" description="Batch fulfillment" />
        <MarketNotConfiguredNotice title="No active market profile" />
      </div>
    );
  }

  const allParcels = await getOrdersRepository().listParcels(session.sellerId);
  const counts = new Map(
    countByLane(allParcels).map((entry) => [entry.key, entry.count]),
  );
  const parcels = sortParcels(filterParcels(allParcels, query), query.sort);
  const { countLabel, orderRefLabel } = describeResultCount(parcels);
  const channelChips = [
    { key: 'all', label: 'All channels' },
    ...[...new Set(allParcels.map((parcel) => parcel.channel))].map(
      (channel) => ({ key: channel, label: channel }),
    ),
  ];
  const currentParams = currentOrdersParams(query);

  // A route chip row only earns its place once the account actually has more
  // than one route. A pure retailer would otherwise get a filter with a single
  // option, which is noise pretending to be a control.
  // Keyed on connection id, not the provider's display name. Two accounts with
  // the same provider carry the same label, and merging them into one chip
  // would hide exactly the distinction a seller filters for - which wallet is
  // short, which account to top up.
  const routeChips = [
    { key: 'all', label: 'All' },
    ...(allParcels.some((parcel) => parcel.route.kind === 'OWN_STOCK')
      ? [{ key: 'own-stock', label: 'In-House' }]
      : []),
    ...[
      ...new Map(
        allParcels
          .filter((parcel) => parcel.route.kind === 'SUPPLIER_DROPSHIP')
          .map((parcel) => {
            const { connection } = parcel.route as Extract<
              typeof parcel.route,
              { kind: 'SUPPLIER_DROPSHIP' }
            >;

            return [connection.connectionId, connection.label] as const;
          }),
      ),
    ].map(([connectionId, label]) => ({ key: connectionId, label })),
  ];

  const stageChips =
    session.sellerBusinessModel === 'RETAILER'
      ? RETAILER_STAGE_CHIPS
      : DROPSHIPPER_STAGE_CHIPS;

  const attentionCount = counts.get('attention') ?? 0;

  return (
    // Container geometry taken from the design prototype: 1440px capped and
    // centred, 24/28/60 padding, 18px between sections. Left full-width the
    // four-column card stretches until the route and status columns sit a
    // screen apart from the items they describe.
    <div className="mx-auto flex max-w-[1440px] flex-col gap-[18px] px-7 pt-6 pb-15">
      <PageHeader
        title="Orders"
        description="One row is one parcel. Prepaid orders only."
        actions={
          <OrdersViewToggle
            active="list"
            listHref={buildHref('/orders', currentParams, {})}
            // Opens the first parcel in the list the seller is actually
            // looking at, so the switch respects their filters.
            detailHref={
              parcels.length === 0 ? null : `/orders/${parcels[0].id}`
            }
          />
        }
      />

      <OrdersLaneTabs
        lanes={LANES.map((lane) => ({
          key: lane.key,
          label: lane.label,
          count: lane.showsCount ? (counts.get(lane.key) ?? 0) : null,
          accent: lane.accent,
        }))}
        active={query.lane}
        hrefFor={(key) =>
          buildHref('/orders', currentParams, {
            lane: key === 'all' ? null : key,
            // Stage and reason belong to one lane each. Carrying them across a
            // lane switch would apply an invisible filter to the new view.
            stage: null,
            reason: null,
          })
        }
      />

      {query.lane !== 'attention' && attentionCount > 0 ? (
        <DisclosureBanner tone="warning">
          {attentionCount} parcel{attentionCount === 1 ? '' : 's'} need
          attention — a supplier order could not be funded, or tracking sources
          disagree. Open the Needs attention lane to resolve them.
        </DisclosureBanner>
      ) : null}

      {/* Route and Stage are always available - a seller filtering by supplier
          or by what they still have to do wants that in every lane, not only
          while standing in To process. Reason is the exception: it describes
          why a parcel needs attention, so it only means anything there. */}
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card px-4 py-3.5">
        {routeChips.length > 2 ? (
          <OrdersChipRow
            label="Route"
            chips={routeChips}
            active={query.route}
            hrefFor={(key) =>
              buildHref('/orders', currentParams, {
                route: key === 'all' ? null : key,
              })
            }
          />
        ) : null}
        <OrdersChipRow
          label="Stage"
          chips={stageChips}
          active={query.stage}
          hrefFor={(key) =>
            buildHref('/orders', currentParams, {
              stage: key === 'all' ? null : key,
            })
          }
        />
        {query.lane === 'attention' ? (
          <OrdersChipRow
            label="Reason"
            chips={ATTENTION_CHIPS}
            active={query.reason}
            hrefFor={(key) =>
              buildHref('/orders', currentParams, {
                reason: key === 'all' ? null : key,
              })
            }
          />
        ) : null}
      </div>

      <OrdersSearchBar
        fields={ORDER_SEARCH_FIELDS.map((field) => ({
          key: field,
          label: ORDER_SEARCH_FIELD_LABELS[field],
        }))}
        activeField={query.field}
        channels={channelChips}
        activeChannel={query.channel}
        query={query.q}
        preservedParams={Object.fromEntries(
          Object.entries(currentParams).filter(
            ([key]) => key !== 'q' && key !== 'field' && key !== 'channel',
          ),
        )}
        resetHref="/orders"
      />

      <OrdersResultBar
        countLabel={countLabel}
        contextLabel={orderRefLabel}
        sortSlot={
          <OrdersSortSelect
            options={ORDER_SORTS.map((sort) => ({
              key: sort,
              label: ORDER_SORT_LABELS[sort],
            }))}
            active={query.sort}
            defaultKey="order-date-desc"
          />
        }
      />

      <DisclosureBanner tone="info">
        This account has an active market profile for{' '}
        {profile.destinationCountryCode}. Currency, carrier, tax, payout, and
        cutoff details are not configured yet. The parcel rows below remain an
        interface preview until the orders backend exists.
      </DisclosureBanner>

      <OrdersWorkspace parcels={parcels} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <OrdersReprintHistoryPanel />
        <OrdersHandoffPanel />
      </div>
    </div>
  );
}
