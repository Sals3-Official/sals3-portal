'use client';

import { X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { buildHref } from '@/lib/portal/search-params';
import { getAllMarkets } from '@/lib/seller-center/market-config';
import {
  NOT_QUEUED_SENTINEL,
  type AllSupplierProductsQuery,
} from '@/lib/products/catalog-filters';
import {
  presentEvaluationStatus,
  STOCK_TEXT,
} from '@/lib/products/catalog-presentation';
import type {
  ListingState,
  StockAvailability,
  SupplierConnectionFixture,
} from '@/lib/products/catalog-types';

type ActiveFilterChipsProps = {
  basePath: string;
  query: AllSupplierProductsQuery;
  connections: SupplierConnectionFixture[];
};

type Chip = { key: string; label: string; clear: () => string };

const LISTING_LABEL: Record<ListingState, string> = {
  NOT_LISTED: 'Not listed',
  HAS_LISTING: 'Has existing listing',
  MULTIPLE_LISTINGS: 'Multiple listings',
};

function csv(value: string): string[] {
  return value === '' ? [] : value.split(',').filter((part) => part !== '');
}

function withoutValue(csvValue: string, remove: string): string | null {
  const next = csv(csvValue).filter((item) => item !== remove);

  return next.length === 0 ? null : next.join(',');
}

/**
 * Removable chips for every active filter, plus "Clear all" (spec section
 * 6). Each chip removes only its own value - multi-select filters (status,
 * stock, ships-from, listing) get one chip per selected value rather than
 * one combined chip, so a seller can back out of a single choice.
 */
export default function ActiveFilterChips({
  basePath,
  query,
  connections,
}: ActiveFilterChipsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const markets = getAllMarkets();

  const chips: Chip[] = [];

  if (query.q !== '') {
    chips.push({
      key: 'q',
      label: `Search: "${query.q}"`,
      clear: () => buildHref(basePath, searchParams, { q: null, page: null }),
    });
  }

  if (query.supplier !== 'all') {
    const connection = connections.find((item) => item.id === query.supplier);

    chips.push({
      key: 'supplier',
      label: connection?.providerDisplayName ?? query.supplier,
      clear: () =>
        buildHref(basePath, searchParams, { supplier: null, page: null }),
    });
  }

  csv(query.status).forEach((status) => {
    const label =
      status === NOT_QUEUED_SENTINEL
        ? presentEvaluationStatus(null).label
        : presentEvaluationStatus(status as never).label;

    chips.push({
      key: `status-${status}`,
      label,
      clear: () =>
        buildHref(basePath, searchParams, {
          status: withoutValue(query.status, status),
          page: null,
        }),
    });
  });

  if (query.category !== 'all') {
    chips.push({
      key: 'category',
      label: query.category,
      clear: () =>
        buildHref(basePath, searchParams, { category: null, page: null }),
    });
  }

  csv(query.stock).forEach((stock) => {
    chips.push({
      key: `stock-${stock}`,
      label: STOCK_TEXT[stock as StockAvailability].label,
      clear: () =>
        buildHref(basePath, searchParams, {
          stock: withoutValue(query.stock, stock),
          page: null,
        }),
    });
  });

  csv(query.shipsFrom).forEach((origin) => {
    chips.push({
      key: `ships-${origin}`,
      label: `Ships from ${origin}`,
      clear: () =>
        buildHref(basePath, searchParams, {
          shipsFrom: withoutValue(query.shipsFrom, origin),
          page: null,
        }),
    });
  });

  if (query.market !== 'all') {
    const market = markets.find((item) => item.code === query.market);

    chips.push({
      key: 'market',
      label: market?.name ?? query.market,
      clear: () =>
        buildHref(basePath, searchParams, { market: null, page: null }),
    });
  }

  csv(query.listing).forEach((listing) => {
    chips.push({
      key: `listing-${listing}`,
      label: LISTING_LABEL[listing as ListingState],
      clear: () =>
        buildHref(basePath, searchParams, {
          listing: withoutValue(query.listing, listing),
          page: null,
        }),
    });
  });

  if (chips.length === 0) return null;

  return (
    <div
      role="group"
      aria-label="Active filters"
      className="flex flex-wrap items-center gap-1.5"
    >
      {chips.map((chip) => (
        <Button
          key={chip.key}
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => router.push(chip.clear())}
        >
          {chip.label}
          <X aria-hidden="true" className="size-3" />
        </Button>
      ))}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => router.push(basePath)}
      >
        Clear all
      </Button>
    </div>
  );
}
