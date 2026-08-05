/**
 * Role-based permissions for product work.
 *
 * The map below is an allow list: a role holds exactly the permissions listed
 * for it and nothing more. Server actions must call `can` (or
 * `requirePermission` in `./session`) before any read of a restricted resource
 * or any write. Hiding a button in the UI is never the authorization check.
 */

export const PORTAL_ROLES = [
  'admin',
  'catalogue_reviewer',
  'seller_manager',
  'seller_staff',
  'viewer',
] as const;

export type PortalRole = (typeof PORTAL_ROLES)[number];

export const PORTAL_ROLE_LABELS: Record<PortalRole, string> = {
  admin: 'Administrator',
  catalogue_reviewer: 'Catalogue reviewer',
  seller_manager: 'Seller manager',
  seller_staff: 'Seller staff',
  viewer: 'Viewer',
};

export const PORTAL_PERMISSIONS = [
  'product:read',
  'product:create',
  'product:edit',
  'product:delete',
  'product:submit',
  'product:approve',
  'product:publish',
  'product:archive',
  'product:import',
  'product:export',
  'review:reply',
  'review:moderate',
] as const;

export type PortalPermission = (typeof PORTAL_PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<PortalRole, readonly PortalPermission[]> = {
  admin: PORTAL_PERMISSIONS,
  catalogue_reviewer: [
    'product:read',
    'product:approve',
    'product:archive',
    'product:export',
    'review:moderate',
  ],
  seller_manager: [
    'product:read',
    'product:create',
    'product:edit',
    'product:delete',
    'product:submit',
    'product:publish',
    'product:archive',
    'product:import',
    'product:export',
    'review:reply',
  ],
  seller_staff: [
    'product:read',
    'product:create',
    'product:edit',
    'product:submit',
    'review:reply',
  ],
  viewer: ['product:read'],
};

export function can(role: PortalRole, permission: PortalPermission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsOf(role: PortalRole): readonly PortalPermission[] {
  return ROLE_PERMISSIONS[role];
}

/** Thrown by `requirePermission`. Carries no internal detail for the user. */
export class PermissionError extends Error {
  constructor() {
    super('You do not have permission to do this.');
    this.name = 'PermissionError';
  }
}
