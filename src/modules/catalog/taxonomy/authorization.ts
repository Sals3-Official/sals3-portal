import { can, type PortalRole } from '@/lib/auth/permissions';

/**
 * The authorization boundary for category-mapping governance.
 *
 * ADR-014 originally put platform-wide category governance in a future Admin
 * Portal, not inside this tenant application — reasoning that one decision
 * here reclassifies every product any seller sources under a given supplier
 * category, which is a platform-wide effect, not a per-seller one. This gate
 * denied every role, including `admin`, on that basis from 2026-08-14.
 *
 * The owner reversed that assignment on 2026-08-15: category-mapping
 * decisions are made directly in this application's product editor, where
 * products are actually added and modified, rather than in a separate
 * control-plane app. The cross-seller, platform-wide effect is accepted as
 * the intended behaviour, not a defect to route around — a CJ supplier
 * category means one Sals3 category across the whole marketplace, regardless
 * of which seller's product happened to be open when someone decided it.
 *
 * `catalog.category_mapping.manage` (`permissions.ts`) is the resulting
 * permission, granted 2026-08-15 to every role that can already touch product
 * data (`admin`, `catalogue_reviewer`, `seller_manager`, `seller_staff`) —
 * only `viewer` is excluded, matching its existing "look, don't touch"
 * posture, which holds no write permission anywhere in this system. Not
 * narrowed further for now by deliberate owner choice: role/access
 * refinement is separate, deferred work.
 *
 * This never touches the "CJ Category" field shown as required supplier
 * evidence in the editor's Specifications tab — that field reads only
 * `product.supplierCategoryPath` (see `read-model.ts`'s `editorSpecifications`,
 * fixed 2026-08-15 to stay isolated from exactly this kind of curated
 * decision) and stays the supplier's own text, unaffected by anything this
 * module does.
 */

export type CategoryGovernanceDenial = {
  allowed: false;
  /** One value for every denied caller. Never says which role, row, or mapping was involved. */
  reason: 'CATEGORY_GOVERNANCE_AUTHORITY_UNAVAILABLE';
  message: string;
};

export type CategoryGovernanceAuthorization =
  { allowed: true; role: PortalRole } | CategoryGovernanceDenial;

const DENIAL: CategoryGovernanceDenial = {
  allowed: false,
  reason: 'CATEGORY_GOVERNANCE_AUTHORITY_UNAVAILABLE',
  message: 'You do not have permission to decide a category mapping.',
};

/** Delegates to the real permission system rather than a private allow list. */
export function authorizeCategoryGovernance(
  role: PortalRole,
): CategoryGovernanceAuthorization {
  return can(role, 'catalog.category_mapping.manage')
    ? { allowed: true, role }
    : DENIAL;
}
