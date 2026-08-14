import {
  CircleCheck,
  CircleDashed,
  Clock,
  Lightbulb,
  OctagonAlert,
  PauseCircle,
  Route,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { StatusPillTone } from '@/components/seller-center/shared/StatusPill';
import type {
  FieldSource,
  IssueSeverity,
  IssueSource,
  ListingLifecycleState,
  MarketEligibility,
  MediaRightsCheck,
  MediaStorageState,
  SourceProductStatus,
  SupplierConnectionStatus,
  VariantListingState,
} from '@/lib/seller-center/product-editor/types';

/**
 * Every label, tone and icon the Product Editor puts on screen, in one
 * place so two components cannot describe the same state differently.
 *
 * Two rules are enforced by shape rather than by review:
 *
 * - Status is never colour alone. Each entry carries an `icon` *and* a
 *   `label`, and `EditorStatusPill` renders both.
 * - Evaluation-status wording is not redefined here. That belongs to
 *   `presentEvaluationStatus`, which the row badges and drawers elsewhere
 *   in the portal already share.
 */

export type Presentation = {
  label: string;
  tone: StatusPillTone;
  icon: LucideIcon;
};

export const SEVERITY_PRESENTATION: Record<IssueSeverity, Presentation> = {
  BLOCKER: { label: 'Blocker', tone: 'danger', icon: OctagonAlert },
  WARNING: { label: 'Warning', tone: 'warning', icon: TriangleAlert },
  SUGGESTION: { label: 'Suggestion', tone: 'info', icon: Lightbulb },
};

export const SEVERITY_GROUP_TITLES: Record<IssueSeverity, string> = {
  BLOCKER: 'Hard blockers',
  WARNING: 'Warnings',
  SUGGESTION: 'Suggestions',
};

export const SEVERITY_EMPTY_TEXT: Record<IssueSeverity, string> = {
  BLOCKER: 'No blocker. Nothing prevents publication.',
  WARNING: 'No warning on this product.',
  SUGGESTION: 'No suggestions.',
};

export const NO_ISSUES_PRESENTATION: Presentation = {
  label: 'No issues',
  tone: 'success',
  icon: CircleCheck,
};

export function sectionBadge(severity: IssueSeverity | null): Presentation {
  return severity === null
    ? NO_ISSUES_PRESENTATION
    : SEVERITY_PRESENTATION[severity];
}

export const FIELD_SOURCE_LABELS: Record<FieldSource, string> = {
  SUPPLIER: 'Supplier value',
  SELLER: 'Seller value',
  INFERRED: 'Inferred value',
  NOT_PROVIDED: 'Not provided',
};

export const ISSUE_SOURCE_LABELS: Record<IssueSource, string> = {
  AUTOMATED_VALIDATION: 'Automated validation',
  SUPPLIER_CHANGE: 'Supplier change',
  SUGGESTION: 'Suggestion',
};

export const VARIANT_LISTING_STATE_PRESENTATION: Record<
  VariantListingState,
  Presentation
> = {
  WILL_LIST: { label: 'Will list', tone: 'success', icon: CircleCheck },
  NOT_LISTED: { label: 'Not listed', tone: 'neutral', icon: CircleDashed },
  BLOCKED: { label: 'Blocked', tone: 'danger', icon: OctagonAlert },
  PAUSED: { label: 'Paused', tone: 'danger', icon: PauseCircle },
};

export const MARKET_ELIGIBILITY_PRESENTATION: Record<
  MarketEligibility,
  Presentation
> = {
  ELIGIBLE: { label: 'Eligible', tone: 'success', icon: Route },
  ELIGIBLE_STALE_EVIDENCE: {
    label: 'Eligible — evidence is stale',
    tone: 'warning',
    icon: Clock,
  },
  NO_ROUTE: { label: 'No route', tone: 'danger', icon: OctagonAlert },
  BLOCKED: { label: 'Blocked', tone: 'danger', icon: OctagonAlert },
};

/** The media-rights check. Distinct from where the file is stored. */
export const MEDIA_RIGHTS_PRESENTATION: Record<MediaRightsCheck, Presentation> =
  {
    VERIFIED: { label: 'Verified', tone: 'success', icon: CircleCheck },
    PENDING_VERIFICATION: {
      label: 'Pending verification',
      tone: 'neutral',
      icon: Clock,
    },
    REJECTED: { label: 'Rejected', tone: 'danger', icon: OctagonAlert },
  };

/**
 * Where the file lives. Nothing claims media has been copied into
 * Sals3-controlled storage, because nothing does that today.
 */
export const MEDIA_STORAGE_LABELS: Record<MediaStorageState, string> = {
  SUPPLIER_HOSTED_SOURCE: 'Supplier-hosted source',
  PENDING_IMPORT: 'Pending import',
  STORAGE_STATUS_UNAVAILABLE: 'Storage status unavailable',
};

export const CONNECTION_STATUS_PRESENTATION: Record<
  SupplierConnectionStatus,
  Presentation
> = {
  CONNECTED: { label: 'Connected', tone: 'success', icon: CircleCheck },
  DEGRADED: { label: 'Degraded', tone: 'warning', icon: TriangleAlert },
  REAUTH_REQUIRED: {
    label: 'Reconnection required',
    tone: 'warning',
    icon: TriangleAlert,
  },
  DISCONNECTED: { label: 'Disconnected', tone: 'danger', icon: OctagonAlert },
  REVOKED: { label: 'Revoked', tone: 'danger', icon: OctagonAlert },
};

export const SOURCE_PRODUCT_STATUS_PRESENTATION: Record<
  SourceProductStatus,
  Presentation
> = {
  LISTED_BY_SUPPLIER: {
    label: 'Listed by supplier',
    tone: 'success',
    icon: CircleCheck,
  },
  DELISTED_BY_SUPPLIER: {
    label: 'Delisted by supplier',
    tone: 'danger',
    icon: OctagonAlert,
  },
};

export const LISTING_STATE_PRESENTATION: Record<
  ListingLifecycleState,
  Presentation
> = {
  DRAFT: { label: 'Draft', tone: 'neutral', icon: CircleDashed },
  PUBLISHED: { label: 'Published', tone: 'success', icon: CircleCheck },
  PUBLISHED_PAUSED: {
    label: 'Published · paused',
    tone: 'danger',
    icon: PauseCircle,
  },
};

/** Required copy on Markets: storefront availability is confirmed server-side. */
export const CHECKOUT_REVALIDATION_COPY =
  'Publication and checkout run fresh server-side checks using the current product, selected variant, and quantity.';

/**
 * The accepted-order distinction, in the same words wherever it appears.
 * A supplier change may alter the current listing; it never rewrites an
 * accepted order (ADR-007).
 */
export const ACCEPTED_ORDER_COPY =
  'An accepted order stays active unless it is cancelled through the order workflow, and keeps the product representation, variant, price basis, image reference and supplier evidence it was accepted with. A later supplier change never rewrites it.';
