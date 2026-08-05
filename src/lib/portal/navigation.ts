import type { PortalPermission } from '@/lib/auth/permissions';

export type NavItem = {
  href: string;
  label: string;
  icon: 'package' | 'plus' | 'upload' | 'clipboard' | 'chart' | 'star';
  permission: PortalPermission;
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
    label: 'Catalogue',
    items: [
      {
        href: '/products',
        label: 'Products',
        icon: 'package',
        permission: 'product:read',
      },
      {
        href: '/products/new',
        label: 'Add product',
        icon: 'plus',
        permission: 'product:create',
      },
      {
        href: '/products/import',
        label: 'Import and export',
        icon: 'upload',
        permission: 'product:export',
      },
    ],
  },
  {
    label: 'Review',
    items: [
      {
        href: '/products?status=pending_approval',
        label: 'Pending approval',
        icon: 'clipboard',
        permission: 'product:read',
      },
    ],
  },
];
