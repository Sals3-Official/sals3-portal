import type { PortalRole } from '@/lib/auth/permissions';

/**
 * The authorization boundary for category-mapping governance — and the
 * honest report that it does not exist yet.
 *
 * ADR-014 puts platform-wide category governance in the future Admin Portal,
 * not inside a seller's tenant application. This repository has no permission
 * that expresses "may decide the platform's CJ-to-Sals3 category rules":
 * `PORTAL_PERMISSIONS` is entirely seller-scoped, and the `admin` /
 * `catalogue_reviewer` roles that look closest are the known open boundary
 * defect (`ownsProduct()` already grants them cross-seller reach, which is
 * exactly the platform-authority-inside-the-tenant-app shape ADR-014
 * rejects).
 *
 * So this gate denies every role, including `admin`. That is not a
 * placeholder waiting to be flipped to `true` — it is the correct answer
 * until a real governance authority exists, and inventing a
 * `category_mapping:manage` permission on a seller role to make a screen work
 * would quietly widen the tenant boundary this note is here to protect.
 *
 * The consequence, stated plainly: `governance.ts`'s operations are
 * server-only application functions with no Server Action, no route handler,
 * and no UI. `no-seller-facing-surface.test.ts` proves that, and the final
 * report names the missing authorization boundary as a blocker for any
 * seller- or staff-facing mapping mutation.
 */

export type CategoryGovernanceDenial = {
  allowed: false;
  /** One value for every caller. Never says which role, row, or mapping was involved. */
  reason: 'CATEGORY_GOVERNANCE_AUTHORITY_UNAVAILABLE';
  message: string;
};

export type CategoryGovernanceAuthorization =
  { allowed: true; role: PortalRole } | CategoryGovernanceDenial;

const DENIAL: CategoryGovernanceDenial = {
  allowed: false,
  reason: 'CATEGORY_GOVERNANCE_AUTHORITY_UNAVAILABLE',
  message: 'Category mapping governance is not available in this application.',
};

/**
 * An allow list, and it is empty. Not a stub: no role in this tenant
 * application holds platform category-governance authority, so the honest
 * membership of this list is nothing. Adding a role here is an ADR-014
 * decision, not a convenience.
 */
const ROLES_WITH_CATEGORY_GOVERNANCE: readonly PortalRole[] = [];

/** Denies every role today, by the allow list above. `boundaries.test.ts` proves it for each one. */
export function authorizeCategoryGovernance(
  role: PortalRole,
): CategoryGovernanceAuthorization {
  return ROLES_WITH_CATEGORY_GOVERNANCE.includes(role)
    ? { allowed: true, role }
    : DENIAL;
}
