import type { StatusPillTone } from '@/components/seller-center/shared/StatusPill';
import type { ListingsStatusFilter } from '@/lib/portal/listings-params';

/**
 * Display derivation for the REAL `product_publication_state` enum.
 *
 * Deliberately not the fixture vocabulary: the design preview showed a
 * five-state ADR-011 lifecycle (`LIVE_NEEDS_ATTENTION`, `AUTO_PAUSED`) that no
 * database column backs. Only the four persisted states are shown, so the page
 * never claims a lifecycle nuance the system does not track. When the
 * attention system ships, this is the one place to widen.
 */

export type ProductPublicationState =
  'UNPUBLISHED' | 'PUBLISHED' | 'PAUSED' | 'ARCHIVED';

type StatusPresentation = {
  label: string;
  tone: StatusPillTone;
  /** The `?status=` filter value this state answers to. */
  filter: Exclude<ListingsStatusFilter, 'all'>;
};

const PRESENTATION: Record<ProductPublicationState, StatusPresentation> = {
  UNPUBLISHED: { label: 'Draft', tone: 'neutral', filter: 'draft' },
  PUBLISHED: { label: 'Live', tone: 'success', filter: 'live' },
  PAUSED: { label: 'Paused', tone: 'warning', filter: 'paused' },
  ARCHIVED: { label: 'Archived', tone: 'neutral', filter: 'archived' },
};

export function presentPublicationState(
  state: ProductPublicationState,
): StatusPresentation {
  return PRESENTATION[state];
}

/** The states one `?status=` filter selects. `all` selects everything. */
export function statesForFilter(
  filter: ListingsStatusFilter,
): ProductPublicationState[] {
  if (filter === 'all')
    return Object.keys(PRESENTATION) as ProductPublicationState[];

  return (Object.keys(PRESENTATION) as ProductPublicationState[]).filter(
    (state) => PRESENTATION[state].filter === filter,
  );
}
