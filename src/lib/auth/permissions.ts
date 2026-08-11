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
  'overview:read',
  'order:read',
  'order:fulfill',
  'inventory:read',
  'inventory:adjust',
  'finance:read',
  'payout:read',
  'payout:manage',
  'market_rules:read',
  // Setting up / activating / suspending the seller's own operating-market
  // profile. Separate from `market_rules:read` because that permission is
  // deliberately broad (staff and viewer both hold it, so they can see which
  // rules apply to them), while changing which destinations an account is
  // configured for is an owner-level commercial decision — the same split
  // this codebase already draws between `payout:read` and `payout:manage`.
  'market_profile:manage',
  'pricing_policy:read',
  'pricing_policy:manage',
  'catalog.candidate.read',
  'catalog.candidate.shortlist',
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
    'catalog.candidate.read',
  ],
  // Seller Center "Owner" — full access, including payout destination,
  // financial settings, and market rules (mirrors the mockup's Owner role).
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
    'overview:read',
    'order:read',
    'order:fulfill',
    'inventory:read',
    'inventory:adjust',
    'finance:read',
    'payout:read',
    'payout:manage',
    'market_rules:read',
    'market_profile:manage',
    'pricing_policy:read',
    'pricing_policy:manage',
    'catalog.candidate.read',
    'catalog.candidate.shortlist',
  ],
  // Seller Center "Staff" — lists, packs, prints, edits stock, replies to
  // buyers. No finance or payout visibility (mirrors the mockup's Staff role:
  // "Cannot see payout destination or change financial settings").
  seller_staff: [
    'product:read',
    'product:create',
    'product:edit',
    'product:submit',
    'review:reply',
    'overview:read',
    'order:read',
    'order:fulfill',
    'inventory:read',
    'inventory:adjust',
    'market_rules:read',
    'catalog.candidate.read',
    'catalog.candidate.shortlist',
  ],
  // Read-only extension of this role's existing "look, don't touch"
  // posture. No financial or payout visibility.
  viewer: [
    'product:read',
    'overview:read',
    'order:read',
    'inventory:read',
    'market_rules:read',
    'catalog.candidate.read',
  ],
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
