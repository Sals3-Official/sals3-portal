import { can, type PortalRole } from '@/lib/auth/permissions';

/**
 * The authorization boundary for a seller declaring their own product's
 * Sals3 category.
 *
 * ADR-014 originally put category governance in a future Admin Portal, not
 * inside this tenant application — reasoning that one decision would
 * reclassify every product any seller sources under a given CJ supplier
 * category, a platform-wide effect. This gate denied every role, including
 * `admin`, on that basis from 2026-08-14.
 *
 * The owner reversed that assignment on 2026-08-15, twice over: first to
 * move the decision into this application's product editor while keeping
 * the platform-wide, CJ-category-keyed effect; then, the same day, to drop
 * the platform-wide effect entirely. Tagging a product's Sals3 category is
 * each seller's own business call about their own catalogue, on their own
 * risk — a mistagged product simply sells worse under the wrong category.
 * `decideProductSals3Category` (`products/decide-category.ts`) reflects the
 * final shape: one seller's pick changes only the one product they had
 * open, never another product or another seller's. Quality guardrails on
 * tagging are deliberately deferred, separate work.
 *
 * `catalog.category_mapping.manage` (`permissions.ts`) is the resulting
 * permission, granted to every role that already holds `product:edit`
 * (`admin`, `seller_manager`, `seller_staff`) — the same precondition every
 * other product-mutation action in this codebase requires, because a
 * session without it (`catalogue_reviewer`, `viewer`) is not scoped to one
 * seller's own product the way this write is. Not narrowed further for now
 * by deliberate owner choice: role/access refinement is separate, deferred
 * work.
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
