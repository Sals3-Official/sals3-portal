import type { StatusPillTone } from '@/components/seller-center/shared/StatusPill';
import type { MoneyValue } from '@/lib/seller-center/product-editor/types';
import type {
  AttentionReasonFixture,
  Availability,
  MediaStatus,
  SupplierConnectionHealth,
} from './types';

/**
 * The view model both Product Catalogue tables render - the fictional design
 * preview and the real database-backed page.
 *
 * ## Why this exists, and why `X | null` was not enough
 *
 * The rich catalogue UI was designed for a system with a stock-evidence store,
 * a media pipeline, and an attention system. This system has none of the three.
 * Handing real rows straight to the fixture components is impossible without
 * lying: `CatalogueProductFixture` declares `availability: Availability`,
 * `sellingPrice: MoneyValue`, `mediaStatus: MediaStatus` and `contentReadiness`
 * as NON-nullable, and every badge indexes a `Record<Enum, …>` with no unknown
 * arm - so a real product would have to claim `$0.00` and a specific
 * availability state it was never checked for.
 *
 * A nullable widening is not enough either, because this screen has THREE
 * states, not two:
 *
 * | state | example | renders |
 * | --- | --- | --- |
 * | a tracked value | `variantCount = 12` | the value |
 * | tracked, genuinely absent | `externalProductId IS NULL` | "No supplier reference" |
 * | a dimension we do not record | `mediaStatus` | "Not tracked yet" |
 *
 * Collapsing the last two is how "no supplier reference" starts reading as
 * "we do not track suppliers".
 */

/**
 * Why a dimension is not recorded. Each maps to a concrete, checkable fact
 * about this codebase rather than a vague "coming soon".
 */
export type NotTrackedReason =
  | 'NO_STOCK_EVIDENCE_STORE'
  | 'NO_MEDIA_WRITERS'
  | 'NO_PRICE_RESOLVED'
  | 'NO_ATTENTION_SYSTEM'
  | 'NO_CONTENT_SCORING'
  | 'NO_STOREFRONT'
  | 'NO_MANUAL_PAUSE_COLUMN';

export type Tracked<T> =
  | { kind: 'value'; value: T }
  | { kind: 'absent'; label: string }
  | { kind: 'not-tracked'; reason: NotTrackedReason };

export const NOT_TRACKED_LABEL = 'Not tracked yet';

export const NOT_TRACKED_EXPLANATIONS: Record<NotTrackedReason, string> = {
  NO_STOCK_EVIDENCE_STORE:
    'Sals3 stores no per-product stock evidence. Supplier inventory is recorded only as an observation on a variant when CJ detail evidence was captured, and nothing derives a checkout-relevant availability state from it.',
  NO_MEDIA_WRITERS:
    'No product media is recorded. The stored CJ evidence keeps a usable-image count, never the image addresses, so there is nothing truthful to classify.',
  NO_PRICE_RESOLVED:
    'No selling price is resolved. Pricing needs a mapped Sals3 category, and no product has one yet, so every offer is deliberately left unpriced rather than guessed.',
  NO_ATTENTION_SYSTEM:
    'The supplier-change attention system is not built. Nothing computes or stores attention reasons, so an empty column here is "not measured", never "all clear".',
  NO_CONTENT_SCORING:
    'No listing-quality scoring model exists. A content score here would be an invented number.',
  NO_STOREFRONT:
    'No storefront page exists for a Sals3 product yet. Publishing is unbuilt, so there is no address to link to.',
  NO_MANUAL_PAUSE_COLUMN:
    'Manual per-variant pausing is not recorded anywhere. Pausing needs a published listing, and publishing is unbuilt.',
};

export function value<T>(tracked: T): Tracked<T> {
  return { kind: 'value', value: tracked };
}

export function absent(label: string): Tracked<never> {
  return { kind: 'absent', label };
}

export function notTracked(reason: NotTrackedReason): Tracked<never> {
  return { kind: 'not-tracked', reason };
}

/**
 * Status arrives PRE-RESOLVED, not as an enum. That is what lets the fixture's
 * five-state ADR-011 lifecycle and the real four-state
 * `product_publication_state` share one row component without a nine-member
 * union or an `if (isFixture)` branch inside the UI.
 */
export type CatalogueStatusView = { label: string; tone: StatusPillTone };

/**
 * One menu control's state, resolved by the adapter.
 *
 * `disabled` carries a `suffix` appended to the label rather than a tooltip: a
 * dropdown item is not a hover surface, and a seller who opens a menu to find a
 * greyed row deserves the reason on the same line. It is also what keeps the
 * design preview's existing `View Live Page (not live)` wording byte-identical.
 */
export type MenuItemState =
  | { kind: 'hidden' }
  | { kind: 'enabled' }
  | { kind: 'disabled'; suffix: string };

export const HIDDEN: MenuItemState = { kind: 'hidden' };
export const ENABLED: MenuItemState = { kind: 'enabled' };

export function disabled(suffix: string): MenuItemState {
  return { kind: 'disabled', suffix };
}

/**
 * Action gating is pre-resolved for the same reason status is: the row stops
 * asking `status === 'LIVE'` and renders what it is told, so one row component
 * serves a five-state fictional lifecycle and a four-state real one.
 */
export type CatalogueRowActionsView = {
  editHref: string;
  editPrice: MenuItemState;
  pause: MenuItemState;
  resume: MenuItemState;
  publish: MenuItemState;
  restore: MenuItemState;
  duplicate: MenuItemState;
  viewLive: MenuItemState;
  archive: MenuItemState;
};

/** The row control a caller asked for. The row itself performs nothing. */
export type CatalogueRowAction =
  | 'editPrice'
  | 'pause'
  | 'resume'
  | 'publish'
  | 'restore'
  | 'duplicate'
  | 'viewLive'
  | 'archive';

/**
 * The variant row's single button, resolved by the adapter.
 *
 * The fixture picks between Pause / Review & resume / Request fresh check from
 * `manuallyPaused` and `availability`. Neither is recorded for real, which is
 * exactly why the decision belongs in the adapter and not in the row.
 */
export type VariantActionView = {
  kind: 'PAUSE' | 'RESUME' | 'RECHECK';
  label: string;
  isDisabled: boolean;
  /** Native tooltip for the disabled case; `undefined` renders no attribute. */
  disabledReason: string | undefined;
};

export type CatalogueVariantView = {
  id: string;
  optionLabel: Tracked<string>;
  sals3VariantId: string;
  sellerSku: Tracked<string>;
  supplierVariantId: Tracked<string>;
  hasImage: Tracked<boolean>;
  sellingPrice: Tracked<MoneyValue>;
  supplierCost: Tracked<MoneyValue>;
  availability: Tracked<Availability>;
  supplierObservedQuantity: Tracked<number>;
  lastCheckedAt: Tracked<string>;
  action: VariantActionView;
};

export type CatalogueRowView = {
  id: string;
  sals3ProductId: string;
  name: string;
  hasImage: Tracked<boolean>;
  status: CatalogueStatusView;
  categoryPath: Tracked<string>;
  createdAt: string;
  supplierProviderName: Tracked<string>;
  supplierReference: Tracked<string>;
  supplierConnectionHealth: Tracked<SupplierConnectionHealth>;
  sellingPrice: Tracked<MoneyValue>;
  availability: Tracked<Availability>;
  mediaStatus: Tracked<MediaStatus>;
  contentReadiness: Tracked<'TOP' | 'GOOD' | 'NEEDS_IMPROVEMENT'>;
  attentionReasons: Tracked<AttentionReasonFixture[]>;
  /**
   * `value(null)` renders nothing at all. That is how a draft avoids a
   * "pause reason: not tracked" line, which would be noise on a row that was
   * never paused - only a paused row asks the question.
   */
  pauseReason: Tracked<string | null>;
  /**
   * Real supplier-evidence lines printed under Availability - supplier-side
   * status, how fresh the evidence is, when it was captured.
   *
   * Empty for the design preview, which invents none of it. It exists because
   * the lean table this screen replaced showed these facts, and a richer UI
   * that quietly dropped them would be a genuine regression dressed up as an
   * upgrade. They are plain strings: the adapter has already decided what is
   * worth saying, and an empty array renders nothing at all.
   */
  evidenceNotes: string[];
  variants: CatalogueVariantView[];
  actions: CatalogueRowActionsView;
};
