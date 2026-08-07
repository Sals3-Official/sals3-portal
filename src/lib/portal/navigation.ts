import type { PortalPermission } from '@/lib/auth/permissions';

export type NavItem = {
  href: string;
  label: string;
  icon:
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
    | 'ban';
  permission: PortalPermission;
  /** One extra nesting level - e.g. "Qualified Products" -> Ready / Needs Attention. */
  items?: NavItem[];
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

/**
 * Navigation is filtered by permission on the server before it renders, so a
 * role never sees a link it cannot use. This is a usability measure, not the
 * authorization check - every target route checks permission again.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
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
    label: 'Catalogue',
    items: [
      {
        href: '/listings/new',
        label: 'New listing',
        icon: 'plus',
        permission: 'product:create',
      },
    ],
  },
  {
    label: 'Product Sourcing',
    items: [
      {
        href: '/products/qualified/ready',
        label: 'Qualified Products',
        icon: 'circle-check',
        permission: 'catalog.candidate.read',
        items: [
          {
            href: '/products/qualified/ready',
            label: 'Ready',
            icon: 'circle-check',
            permission: 'catalog.candidate.read',
          },
          {
            href: '/products/qualified/needs-attention',
            label: 'Needs Attention',
            icon: 'star',
            permission: 'catalog.candidate.read',
          },
        ],
      },
      {
        href: '/products/evaluating',
        label: 'Evaluating',
        icon: 'loader',
        permission: 'catalog.candidate.read',
      },
      {
        href: '/products/blocked',
        label: 'Blocked / Rejected',
        icon: 'ban',
        permission: 'catalog.candidate.read',
      },
      {
        href: '/products/exception-queue',
        label: 'Exception Queue',
        icon: 'alert-triangle',
        permission: 'catalog.candidate.read',
      },
      {
        href: '/products',
        label: 'All Supplier Products',
        icon: 'package',
        permission: 'product:read',
      },
    ],
  },
  {
    label: 'Fulfillment',
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
