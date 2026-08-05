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
    ],
  },
];
