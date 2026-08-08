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
          'The seller’s authoritative list of Sals3 listings - distinct from the raw supplier feed. Proposed route: no writable Sals3 catalogue exists yet.',
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
        href: '/products/qualified/ready',
        label: 'Qualified Products',
        icon: 'circle-check',
        permission: 'catalog.candidate.read',
        description:
          'Products the automatic checks have already decided on: split into Ready (no issue) and Needs Attention (passed with a warning).',
        items: [
          {
            href: '/products/qualified/ready',
            label: 'Ready',
            icon: 'circle-check',
            permission: 'catalog.candidate.read',
            description:
              'Passed every automatic check with no open issue. Safe to customize and list as-is.',
          },
          {
            href: '/products/qualified/needs-attention',
            label: 'Needs Attention',
            icon: 'star',
            permission: 'catalog.candidate.read',
            description:
              'Passed, but with a warning flagged - read the reason before you customize and list it.',
          },
        ],
      },
      {
        href: '/products/evaluating',
        label: 'Evaluating',
        icon: 'loader',
        permission: 'catalog.candidate.read',
        description:
          'Being checked right now (pricing, stock, policy). Moves on its own to Ready, Needs Attention, or Blocked - nothing to do here.',
      },
      {
        href: '/products/blocked',
        label: 'Blocked / Rejected',
        icon: 'ban',
        permission: 'catalog.candidate.read',
        description:
          'Could not qualify - permanently (policy/pricing) or temporarily (e.g. supplier out of stock). Temporary ones retry on their own.',
      },
      {
        href: '/products/exception-queue',
        label: 'Exception Queue',
        icon: 'alert-triangle',
        permission: 'catalog.candidate.read',
        description:
          'The pipeline itself failed here (e.g. could not reach the supplier) after every retry. This needs a person, not a product judgment call.',
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
 * Patches Product Sourcing's real per-seller counts (from the automated
 * evaluation pipeline) into an already permission-filtered group list.
 * `counts === null` means no real number was resolvable this request (no
 * seller account, DB not configured) - groups pass through unbadged rather
 * than showing a fabricated or stale figure.
 */
export function withSourcingBadges(
  groups: NavGroup[],
  counts: SourcingBadgeCounts | null,
): NavGroup[] {
  if (counts === null) return groups;

  const neutral = (count: number): NavBadge => ({ count, tone: 'neutral' });
  const ifPositive = (
    count: number,
    tone: 'warning' | 'danger',
  ): NavBadge | undefined => (count > 0 ? { count, tone } : undefined);

  return groups.map((group) => {
    if (group.label !== 'Product Sourcing') return group;

    return {
      ...group,
      badge: ifPositive(counts.exceptionQueue, 'danger'),
      items: group.items.map((item) => {
        if (
          item.href === '/products/qualified/ready' &&
          item.items !== undefined
        ) {
          return {
            ...item,
            badge: neutral(counts.ready + counts.needsAttention),
            items: item.items.map((child) => {
              if (child.href === '/products/qualified/ready') {
                return { ...child, badge: neutral(counts.ready) };
              }
              if (child.href === '/products/qualified/needs-attention') {
                return {
                  ...child,
                  badge: ifPositive(counts.needsAttention, 'warning'),
                };
              }
              return child;
            }),
          };
        }
        if (item.href === '/products/evaluating') {
          return { ...item, badge: neutral(counts.evaluating) };
        }
        if (item.href === '/products/blocked') {
          return { ...item, badge: neutral(counts.blockedRejected) };
        }
        if (item.href === '/products/exception-queue') {
          return {
            ...item,
            badge: ifPositive(counts.exceptionQueue, 'danger'),
          };
        }
        return item;
      }),
    };
  });
}
