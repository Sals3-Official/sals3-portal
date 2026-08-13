import type { PortalPermission } from '@/lib/auth/permissions';

export type NavIconName =
  | 'package'
  | 'plus'
  | 'upload'
  | 'clipboard'
  | 'chart'
  | 'star'
  | 'layout-dashboard'
  | 'boxes'
  | 'banknote'
  | 'scroll-text'
  | 'alert-triangle'
  | 'circle-check'
  | 'loader'
  | 'ban'
  | 'plug'
  | 'settings';

/**
 * A count worth a seller's attention gets a coloured pill (`warning`/
 * `danger`); a purely informational total (e.g. "51 qualified products")
 * gets the plain `neutral` numeral style instead - the rail's own "urgency
 * is scarce" rule. Omit `badge` entirely rather than pass `{ count: 0 }`
 * when no real figure backs it yet - a missing figure is never a zero.
 */
export type NavBadge = {
  count: number;
  tone: 'neutral' | 'warning' | 'danger';
};

export type NavItem = {
  href: string;
  label: string;
  icon: NavIconName;
  permission: PortalPermission;
  /** Shown on hover (expanded rail) or as the tooltip (collapsed rail) - what this screen is for, for staff who did not build it. */
  description?: string;
  /** One extra nesting level - e.g. "Qualified Products" -> Ready / Needs Attention. */
  items?: NavItem[];
  badge?: NavBadge;
};

export type NavGroup = {
  label: string;
  /** Icon for the group's own parent row. */
  icon: NavIconName;
  items: NavItem[];
  badge?: NavBadge;
  /**
   * True when this group's one item *is* the group - Overview, Supplier
   * Apps, Orders, Inventory render as one flat 40px link with no separate
   * parent row and no chevron. Every other group (including Settings, which
   * has only one child, "Market Rules") gets a real parent row: this is not
   * derivable from a plain item count - the approved prototype renders
   * Settings with a chevron disclosing its single child, so it must be
   * stated per group rather than inferred.
   */
  solo?: boolean;
};

/**
 * Navigation is filtered by permission on the server before it renders, so a
 * role never sees a link it cannot use. This is a usability measure, not the
 * authorization check - every target route checks permission again.
 *
 * `badge` fields are left undefined here on purpose: they are illustrative
 * fixture numbers in the design and must never ship as hardcoded figures.
 * `(portal)/layout.tsx` fills in the ones backed by a real query (Product
 * Sourcing's counts, from the automated evaluation pipeline) and leaves the
 * rest unset - Catalogue, Orders, and Money/Payouts have no real backend yet.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    icon: 'layout-dashboard',
    solo: true,
    items: [
      {
        href: '/overview',
        label: 'Overview',
        icon: 'layout-dashboard',
        permission: 'overview:read',
      },
    ],
  },
  {
    label: 'Dropship Catalogue',
    icon: 'package',
    items: [
      {
        href: '/listings',
        label: 'Product Catalogue',
        icon: 'package',
        permission: 'product:read',
        description:
          'The seller’s authoritative list of Sals3 listings - distinct from the raw supplier feed. Currently a design preview on fictional data; no writable Sals3 catalogue exists yet.',
      },
      {
        href: '/listings/new?fixture=attention',
        label: 'Add Product',
        icon: 'plus',
        permission: 'product:create',
        description:
          'The Product Editor, prefilled from a qualified supplier product - currently a design preview on fictional data. The blank essentials-first wizard is still reachable at /listings/new directly.',
      },
    ],
  },
  {
    label: 'Supplier Apps',
    icon: 'plug',
    solo: true,
    items: [
      {
        href: '/supplier-apps',
        label: 'Supplier Apps',
        icon: 'plug',
        permission: 'catalog.candidate.shortlist',
        description:
          'Connect your own supplier account (CJ Dropshipping). Product Sourcing only pulls from whatever you connect here.',
      },
    ],
  },
  {
    label: 'Product Sourcing',
    icon: 'circle-check',
    items: [
      {
        href: '/products/pipeline',
        label: 'Candidate Pipeline',
        icon: 'circle-check',
        permission: 'catalog.candidate.read',
        description:
          'Every candidate the automated pipeline has touched, one window - Ready, Needs Attention, Evaluating, Blocked/Rejected, and Exception Queue as tabs instead of separate pages.',
      },
      {
        href: '/products',
        label: 'All Supplier Products',
        icon: 'package',
        permission: 'product:read',
        description:
          'The raw, unfiltered supplier feed - every product before automatic evaluation. Browse only; evaluation still happens on its own.',
      },
    ],
  },
  {
    label: 'Fulfillment',
    icon: 'clipboard',
    solo: true,
    items: [
      {
        href: '/orders',
        label: 'Orders',
        icon: 'clipboard',
        permission: 'order:read',
      },
    ],
  },
  {
    label: 'Inventory',
    icon: 'boxes',
    solo: true,
    items: [
      {
        href: '/inventory',
        label: 'Inventory',
        icon: 'boxes',
        permission: 'inventory:read',
      },
    ],
  },
  {
    label: 'Money',
    icon: 'banknote',
    items: [
      {
        href: '/finances',
        label: 'Finances',
        icon: 'chart',
        permission: 'finance:read',
      },
      {
        href: '/payouts',
        label: 'Payouts',
        icon: 'banknote',
        permission: 'payout:read',
      },
    ],
  },
  {
    label: 'Settings',
    icon: 'settings',
    items: [
      {
        href: '/market-rules',
        label: 'Market rules',
        icon: 'scroll-text',
        permission: 'market_rules:read',
      },
    ],
  },
];

export type SourcingBadgeCounts = {
  ready: number;
  needsAttention: number;
  evaluating: number;
  blockedRejected: number;
  exceptionQueue: number;
};

/**
 * Patches Candidate Pipeline's real per-seller counts (from the automated
 * evaluation pipeline) into an already permission-filtered group list.
 * `counts === null` means no real number was resolvable this request (no
 * seller account, DB not configured) - groups pass through unbadged rather
 * than showing a fabricated or stale figure.
 *
 * One badge, not five: the count is always the total across every status
 * (matches the page's own "All" tab exactly, so the sidebar and the page
 * never disagree), and only the *colour* changes with the worst signal
 * present - an exhausted exception needs a person (danger), a warning still
 * lets you list but is worth reading first (warning), anything else is a
 * plain informational total (neutral).
 */
export function withSourcingBadges(
  groups: NavGroup[],
  counts: SourcingBadgeCounts | null,
): NavGroup[] {
  if (counts === null) return groups;

  const total =
    counts.ready +
    counts.needsAttention +
    counts.evaluating +
    counts.blockedRejected +
    counts.exceptionQueue;
  const tone: NavBadge['tone'] = (() => {
    if (counts.exceptionQueue > 0) return 'danger';
    if (counts.needsAttention > 0) return 'warning';
    return 'neutral';
  })();

  return groups.map((group) => {
    if (group.label !== 'Product Sourcing') return group;

    return {
      ...group,
      items: group.items.map((item) =>
        item.href === '/products/pipeline'
          ? { ...item, badge: { count: total, tone } }
          : item,
      ),
    };
  });
}
