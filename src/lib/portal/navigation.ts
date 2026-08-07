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
    | 'ban'
    | 'plug';
  permission: PortalPermission;
  /** Shown on hover (expanded rail) or as the tooltip (collapsed rail) - what this screen is for, for staff who did not build it. */
  description?: string;
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
        label: 'Add Product',
        icon: 'plus',
        permission: 'product:create',
        description:
          'Create a Sals3 listing - blank, or prefilled from a qualified supplier product. Product Sourcing only supplies the candidate; the listing itself belongs here in Catalogue.',
        items: [
          {
            href: '/listings/new',
            label: 'Blank product',
            icon: 'plus',
            permission: 'product:create',
            description:
              'Start from an empty form for a product you are adding yourself.',
          },
          {
            href: '/listings/new?fixture=attention',
            label: 'From a supplier product',
            icon: 'package',
            permission: 'product:create',
            description:
              'The Product Editor: a qualified supplier product, prefilled from its validated evidence. Currently a design preview on fictional data - nothing is saved.',
          },
        ],
      },
    ],
  },
  {
    label: 'Supplier Apps',
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
