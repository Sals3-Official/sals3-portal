'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DESCRIPTION_DOCUMENT_VERSION,
  blocksMatchSaved,
  descriptionBlocksToPlainText,
  prepareBlocksForSave,
  type DescriptionBlock,
} from '@/lib/products/description-blocks';
import {
  autoListVariants,
  filledSpecificationCount,
  isCategoryAttributeUnresolved,
  issuesOfSeverity,
  publishDecision,
  sectionSeverity,
} from '@/lib/seller-center/product-editor/derive';
import {
  clampRetailAmountMinorToSupplierFloor,
  minimumRetailAmountMinorForSupplierCost,
} from '@/lib/pricing/retail-price-floor';
import {
  EDITOR_SECTIONS,
  type CategoryAttributeFieldFixture,
  type EditorLifecycle,
  type EditorSectionId,
  type MediaItemFixture,
  type ProductEditorFixture,
  type ReadinessIssue,
  type SpecificationFixture,
  type VariantFixture,
} from '@/lib/seller-center/product-editor/types';
import { suggestMetaDescription } from '@/lib/seller-center/product-editor/suggest-meta-description';
import describeRefusedUploads from '@/lib/products/describe-refused-uploads';
import previewMedia from '@/lib/products/preview-media';
import { PUBLISH_GATES } from '@/lib/products/publish-gates';
import predictPublishBlockers from '@/lib/seller-center/product-editor/publish-blockers';
import {
  initialDescriptionMode,
  type DescriptionMode,
} from '@/lib/products/simple-description';
import resolveVariantValuePhotos from '@/lib/seller-center/product-editor/variant-value-photos';
import BasicInformationSection from './BasicInformationSection';
import BulkPricingDialog, { type BulkPricingMode } from './BulkPricingDialog';
import CategoryAttributesSection from './category-attributes/CategoryAttributesSection';
import {
  keyDescriptionBlocks,
  type KeyedDescriptionBlock,
} from './DescriptionBlockEditor';
import DescriptionSection from './DescriptionSection';
import DraftStorefrontPreview from './DraftStorefrontPreview';
import EditorActionBar from './EditorActionBar';
import EditorSectionCard from './EditorSectionCard';
import EditorSectionNavigation from './EditorSectionNavigation';
import EditorSheet from './EditorSheet';
import EditorStateBanners from './EditorStateBanners';
import ListingReadinessPanel from './ListingReadinessPanel';
import ProductEditorHeader from './ProductEditorHeader';
import PublishSuccessDialog from './PublishSuccessDialog';
import ReviewPublishSection from './ReviewPublishSection';
import SpecificationsSection from './SpecificationsSection';
import SupplierSourceDrawer from './SupplierSourceDrawer';
import UnpublishedChangesNotice from './UnpublishedChangesNotice';
import VariantImagePicker from './VariantImagePicker';
import VariantOptionMappingSection from './VariantOptionMappingSection';
import VariantPricingTable from './VariantPricingTable';

/**
 * A real `product_media_sources` id, as opposed to the placeholder the
 * supplier panel falls back to when a product's only supplier photo is the
 * feed's bare address with no provenance row behind it. Nothing can be
 * positioned in that case, so the grip is withheld rather than offered and
 * refused.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

type ProductEditorWorkspaceProps = {
  fixture: ProductEditorFixture;
  /**
   * Server-rendered evidence, passed in as a slot. Markets needs
   * no client state, so rendering it on the server keeps it out of the
   * client bundle while the interactive shell still positions it.
   */
  marketsSection: React.ReactNode;
  /** Entry state from `?state=`. Development only - see `query.ts`. */
  initialLifecycle: EditorLifecycle;
  /** Database draft save boundary. Omitted for fixture/design-preview mode. */
  saveDraftAction?: (input: unknown) => Promise<
    | { ok: true; revisionId: string; revisionVersion: number; forked: boolean }
    | {
        ok: false;
        reason:
          | 'invalid_input'
          | 'unauthenticated'
          | 'denied'
          | 'rate_limited'
          | 'not_configured'
          | 'not_found'
          | 'version_conflict'
          | 'revision_in_review'
          | 'image_not_stored'
          | 'price_persistence_failed'
          | 'failed';
      }
  >;
  /**
   * Abandons the forked draft and puts the product back on its published
   * revision. Omitted for fixture/design-preview mode, where there is no
   * persisted revision to discard.
   */
  discardDraftAction?: (input: unknown) => Promise<
    | {
        ok: true;
        restoredRevisionId: string;
        restoredRevisionVersion: number;
      }
    | {
        ok: false;
        reason:
          | 'invalid_input'
          | 'denied'
          | 'rate_limited'
          | 'not_configured'
          | 'not_found'
          | 'version_conflict'
          | 'no_published_revision'
          | 'failed';
      }
  >;
  /**
   * The narrow description save, so its own section can save without committing
   * a retail price the seller was still deciding on.
   */
  saveDescriptionAction?: (input: unknown) => Promise<
    | {
        ok: true;
        revisionId: string;
        revisionVersion: number;
        contentChecksum: string;
        forked: boolean;
      }
    | { ok: false; reason: string; message: string }
  >;
  publishAction?: (input: unknown) => Promise<
    | {
        ok: true;
        slug: string;
        offerCount: number;
        availability: 'AVAILABLE' | 'UNAVAILABLE' | 'UNKNOWN';
      }
    | { ok: false; reason: string; detail?: string }
  >;
  /**
   * Option-mapping write boundary. Omitted for fixture/design-preview mode, so
   * the section pre-fills and explains itself there but offers no save.
   */
  optionMappingAction?: (
    input: unknown,
  ) => Promise<
    | { ok: true; axisCount: number; mappedVariantCount: number }
    | { ok: false; reason: string; message: string }
  >;
  /**
   * Rename boundary for an already-saved Variant Matrix. Display words only —
   * see `rename-option-mapping.ts` for why that is safe where a re-split is
   * not.
   */
  renameOptionMappingAction?: (
    input: unknown,
  ) => Promise<
    | { ok: true; axisCount: number; renamedValueCount: number }
    | { ok: false; reason: string; message: string }
  >;
  /**
   * Recovery boundary for supplier labels a draft never recorded. Omitted for
   * fixture mode, which has no stored evidence to recover from.
   */
  recoverLabelsAction?: (
    input: unknown,
  ) => Promise<
    | { ok: true; recoveredCount: number; alreadyLabelledCount: number }
    | { ok: false; reason: string; message: string }
  >;
  /** The full Sals3 Taxonomy v1 tree, for the category picker's search. */
  sals3CategoryOptions?: { code: string; path: string }[];
  /**
   * Category-mapping decision boundary. Omitted for fixture/design-preview
   * mode, so the picker still lets someone search the tree but offers no
   * save (owner decision 2026-08-15 — see `taxonomy/authorization.ts`).
   */
  decideCategoryAction?: (
    input: unknown,
  ) => Promise<
    | { ok: true; categoryCode: string; categoryPath: string }
    | { ok: false; reason: string; message: string }
  >;
  /**
   * Seller-photo upload boundary (Vercel Blob, owner decision 2026-08-17).
   * Omitted for fixture/design-preview mode, so the Product media Upload
   * tile stays disabled with an honest "no real product to attach a photo
   * to" reason instead of a fake success.
   */
  uploadMediaAction?: (formData: FormData) => Promise<
    | {
        ok: true;
        media: {
          id: string;
          sourceUrl: string;
          contentType: string;
          byteSize: number;
          widthPixels: number;
          heightPixels: number;
        };
      }
    | { ok: false; reason: string; message: string }
  >;
  /**
   * Variant-photo assignment boundary — points a stored photo at one variant, or
   * clears it. Omitted for fixture/design-preview mode, where the Image cell
   * reports the state and offers no control.
   */
  assignVariantMediaAction?: (
    input: unknown,
  ) => Promise<
    | { ok: true; mediaId: string; variantId: string | null }
    | { ok: false; reason: string; message: string }
  >;
  /** Seller-photo delete boundary. Omitted for fixture/design-preview mode. */
  deleteMediaAction?: (
    input: unknown,
  ) => Promise<{ ok: true } | { ok: false; reason: string; message: string }>;
  /**
   * Gallery-arrangement boundary — order, and therefore the cover. Omitted for
   * fixture/design-preview mode, where the grid renders without a drag grip
   * rather than with one that forgets.
   */
  reorderMediaAction?: (
    input: unknown,
  ) => Promise<{ ok: true } | { ok: false; reason: string; message: string }>;
  /**
   * Category-driven specification save boundary. Omitted for fixture/
   * design-preview mode, so the section still renders and explains itself
   * but offers no save.
   */
  saveCategoryAttributesAction?: (
    input: unknown,
  ) => Promise<
    | { ok: true; productVersion: number }
    | { ok: false; reason: string; message: string }
  >;
  /**
   * Meta Description save boundary. Omitted for fixture/design-preview
   * mode, so the field still renders, suggests, and previews but offers no
   * save.
   */
  saveMetaDescriptionAction?: (
    input: unknown,
  ) => Promise<
    | { ok: true; productVersion: number }
    | { ok: false; reason: string; message: string }
  >;
  /**
   * "Show supplier photo" toggle save boundary. Omitted for fixture/
   * design-preview mode, so the switch still renders but offers no save.
   */
  saveShowSupplierPhotoAction?: (
    input: unknown,
  ) => Promise<
    | { ok: true; productVersion: number }
    | { ok: false; reason: string; message: string }
  >;
  /**
   * Description-image upload boundary. Separate from `uploadMediaAction`
   * because a description image is not gallery media: it produces no
   * `product_media_sources` row, is never a cover candidate, and is
   * referenced only by the description document.
   */
  uploadDescriptionImageAction?: (
    formData: FormData,
  ) => Promise<
    | { ok: true; url: string; widthPixels: number; heightPixels: number }
    | { ok: false; reason: string; message: string }
  >;
};

const EXIT_HREF = '/products/pipeline?tab=ready';

/**
 * Seller-facing copy for every way a discard can be refused.
 *
 * A `Record` over the reason union rather than a chain of comparisons, so a
 * reason added to the action without copy here is a compile error — the same
 * discipline `publish-gates.ts` uses for publish refusals, and for the same
 * reason: the failure a seller sees must never fall through to a generic
 * sentence someone forgot to write.
 */
const DISCARD_FAILURE_COPY: Record<
  | 'invalid_input'
  | 'denied'
  | 'rate_limited'
  | 'not_configured'
  | 'not_found'
  | 'version_conflict'
  | 'no_published_revision'
  | 'failed',
  string
> = {
  invalid_input: 'Nothing was changed. Please reload and try again.',
  denied: 'Your account cannot edit this listing.',
  rate_limited: 'Too many changes at once. Wait a moment and try again.',
  not_configured: 'The catalogue database is not available right now.',
  not_found: 'This listing could not be found on your account.',
  version_conflict:
    'This listing changed in another tab. Reload and try again.',
  no_published_revision:
    'This listing has never been published, so there is no earlier version to return to.',
  failed: 'Nothing was changed. Please try again.',
};
/** Titles the local gate predictor owns, so a server copy of one is dropped. */
const PREDICTED_GATE_TITLES = new Set([
  ...Object.values(PUBLISH_GATES).map((gate) => gate.title),
  'No Sals3 category has been decided yet',
]);

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PUBLISH_FAILURE_MESSAGES: Record<string, string> = {
  invalid_input: 'The publish request was invalid.',
  unauthenticated: 'Sign in again before publishing.',
  denied: 'Your account cannot publish this product.',
  rate_limited: 'Too many publish attempts. Try again shortly.',
  not_configured: 'Publishing is not configured for this environment.',
  not_found: 'This product was not found for this seller.',
  version_conflict:
    'This product changed elsewhere. Refresh before publishing again.',
  validation_failed: 'Server validation blocked publication.',
  failed: 'No listing was published.',
};

/**
 * Why a draft save was refused, in the seller's terms.
 *
 * `revision_in_review` is not reachable today — nothing writes `IN_REVIEW` or
 * `CHANGES_REQUESTED` — but it is a real server answer with a real cause, and
 * "No database change was made." would tell a seller nothing about a block
 * they cannot clear by retrying. The same wording is in
 * `description-actions.ts`, which refuses the narrow save the same way.
 */
const DRAFT_SAVE_FAILURE_MESSAGES: Record<string, string> = {
  version_conflict:
    'This draft changed elsewhere. Refresh before saving again.',
  revision_in_review:
    'This listing is in review. Changes are blocked until the review finishes.',
  image_not_stored:
    'One image is not stored in Sals3. Upload it again and save.',
  price_persistence_failed:
    'One retail price could not be saved. Refresh and try again before publishing.',
};

/** Falls back rather than claiming a cause the server did not give. */
function draftSaveFailureMessage(reason: string): string {
  return DRAFT_SAVE_FAILURE_MESSAGES[reason] ?? 'No database change was made.';
}

function descriptionDocumentFrom(
  blocks: KeyedDescriptionBlock[],
  mode: DescriptionMode,
) {
  return {
    version: DESCRIPTION_DOCUMENT_VERSION,
    // Saved with the document because the content can no longer imply it: a
    // simple-text description legitimately retains photos it is not publishing.
    mode,
    blocks: prepareBlocksForSave(blocks.map((entry) => entry.block)),
  };
}

/** A bulk price change must never touch a variant policy has ruled out. */
function isBulkPriceable(variant: VariantFixture): boolean {
  return (
    variant.listingState !== 'BLOCKED' && variant.listingState !== 'PAUSED'
  );
}

function retailAmountAboveSupplierCost(
  amountMinor: number,
  retailCurrency: string,
  supplierCost: VariantFixture['supplierCost'],
): number {
  if (amountMinor <= 0 || retailCurrency !== supplierCost.currency) {
    return amountMinor;
  }

  return clampRetailAmountMinorToSupplierFloor(
    amountMinor,
    supplierCost.amountMinor,
  );
}

function retailPriceIssue(fixture: ProductEditorFixture): ReadinessIssue {
  return {
    id: `${fixture.fixtureKey}-retail-price`,
    severity: 'BLOCKER',
    title: 'Retail price is required',
    explanation: 'Enter a retail price greater than zero for every variant.',
    affectedScope: 'Variants & Pricing',
    source: 'AUTOMATED_VALIDATION',
    section: 'variants',
    reasonCode: null,
    resolution: 'Set the retail price.',
  };
}

/**
 * A warning, not a blocker (owner decision 2026-08-15): a missing or wrong
 * Sals3 category is each seller's own business risk — a mistagged product
 * simply sells worse — not something a technical gate should decide for
 * them. A blocker here would also retroactively stop every already-live
 * product from republishing the moment this shipped, since none of them
 * have ever gone through this picker; a warning still surfaces the reminder
 * without that disruption.
 */
/**
 * Locally re-derived, the same way `retailPriceIssue` is: a lightweight
 * "is it filled" check the seller sees update as they type, not a re-run of
 * `validateCategoryAttributeSubmission`'s full dropdown/custom-value/shape
 * rules — that authoritative check happens server-side on save
 * (`saveCategoryAttributes`) and again at publish (`publish.ts`).
 */
/**
 * What a specification save would store, as one comparable string.
 *
 * The Specification section has its own Save button, and pressing Publish
 * without pressing it first sent the publish request while every edited
 * attribute stayed in the tab — the seller watched a value they had just typed
 * fail to appear on the published listing, with nothing on screen having said
 * it was unsaved. Publish now flushes first, and this is how it knows there is
 * anything to flush.
 *
 * Sorted by attribute name so a re-render that returns the fields in a
 * different order is not read as an edit.
 */
function categoryAttributeFingerprint(
  fields: readonly CategoryAttributeFieldFixture[],
): string {
  return JSON.stringify(
    [...fields]
      .map((field) => ({
        name: field.attributeName,
        values: field.values,
        isCustomValue: field.isCustomValue,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  );
}

function categoryAttributeIssues(
  fixture: ProductEditorFixture,
  fields: CategoryAttributeFieldFixture[],
): ReadinessIssue[] {
  // Never a BLOCKER: a category attribute control (however the workbook
  // marks it) no longer gates publish server-side (`publish.ts`), so a
  // locally-derived issue that still disabled the button here would
  // disagree with what the server actually does.
  return fields
    .filter((field) => isCategoryAttributeUnresolved(field))
    .map((field) => ({
      id: `${fixture.fixtureKey}-specification-${field.attributeName}`,
      severity: 'WARNING',
      title: `${field.attributeName} is ${field.requirement === 'REQUIRED' ? 'required' : 'recommended'}`,
      explanation:
        field.requirement === 'REQUIRED'
          ? `This category requires a value for "${field.attributeName}". Publishing is not blocked, but buyers may see this attribute blank.`
          : `This category recommends a value for "${field.attributeName}".`,
      affectedScope: 'Specification',
      source: 'AUTOMATED_VALIDATION',
      section: 'specification',
      reasonCode: null,
      resolution: `Fill in ${field.attributeName}.`,
    }));
}

/**
 * The interactive shell. Everything stateful in the editor lives here and
 * nowhere else, so the section components stay presentational and the page
 * stays a Server Component.
 *
 * Layout responds to its own **container** width, not the viewport. That
 * matters because the portal rail collapses and expands: at 1440px with
 * the rail expanded there is nowhere near enough room for three columns,
 * and a viewport media query would happily render them anyway and squeeze
 * the editor to an unusable width. Container queries make the panels fold
 * into drawers exactly when the space runs out, without this route
 * reaching out and overriding the seller's own sidebar preference.
 *
 * Nothing here persists. Save and publish move local state and say so;
 * they call no endpoint and mutate no listing, and a refresh resets
 * everything.
 */
export default function ProductEditorWorkspace({
  fixture,
  marketsSection,
  initialLifecycle,
  saveDraftAction,
  discardDraftAction,
  saveDescriptionAction,
  publishAction,
  optionMappingAction,
  recoverLabelsAction,
  sals3CategoryOptions = [],
  decideCategoryAction,
  uploadMediaAction,
  deleteMediaAction,
  reorderMediaAction,
  assignVariantMediaAction,
  saveCategoryAttributesAction,
  saveMetaDescriptionAction,
  saveShowSupplierPhotoAction,
  uploadDescriptionImageAction,
  renameOptionMappingAction,
}: ProductEditorWorkspaceProps) {
  const router = useRouter();

  const [productName, setProductName] = useState(fixture.productName);
  const [sellerSku, setSellerSku] = useState(fixture.sellerSku);
  const [brandDeclaration, setBrandDeclaration] = useState(
    fixture.brandDeclaration,
  );
  /**
   * The description document's own blocks, not a flattened string. The
   * editor used to be handed `descriptionText` and re-parse it into
   * paragraphs on save, which rewrote a document's headings, bullet lists,
   * and detail lists as prose the first time anyone opened the page.
   */
  const [descriptionBlocks, setDescriptionBlocks] = useState(() =>
    keyDescriptionBlocks(fixture.descriptionBlocks),
  );
  const [descriptionMode, setDescriptionMode] = useState<DescriptionMode>(() =>
    initialDescriptionMode(fixture.descriptionBlocks, fixture.descriptionMode),
  );

  /**
   * What the description was last *saved* as, which stops being the value the
   * page was rendered with the moment this section saves on its own.
   *
   * Without it, `Revert to last saved` would offer to restore the pre-save
   * document and `Save description` would stay lit after succeeding — both
   * telling the seller their saved work is unsaved.
   */
  const [savedDescriptionBlocks, setSavedDescriptionBlocks] = useState<
    DescriptionBlock[]
  >(fixture.descriptionBlocks);

  /**
   * Compared in prepared form, so a blank block someone added and abandoned
   * does not make Revert look available when nothing would actually change.
   */
  /**
   * The mode is part of the saved document, so it is part of "unchanged".
   *
   * Comparing blocks alone left the foot of the page reading `No unsaved
   * changes` after a seller switched editor — the stored `mode` differed from
   * the one on screen and nothing said so, which is a screen asserting
   * something it had not checked.
   */
  const [savedDescriptionMode, setSavedDescriptionMode] =
    useState<DescriptionMode>(() =>
      initialDescriptionMode(
        fixture.descriptionBlocks,
        fixture.descriptionMode,
      ),
    );

  const descriptionIsUnchanged =
    descriptionMode === savedDescriptionMode &&
    blocksMatchSaved(
      descriptionBlocks.map((entry) => entry.block),
      savedDescriptionBlocks,
    );

  /**
   * Seeded from the auto-suggestion seam (`suggest-meta-description.ts`,
   * never an AI call) only when nothing has been saved yet — a product that
   * already has one shows exactly what was saved, never a freshly
   * re-derived suggestion overwriting it on every render.
   * `metaDescriptionIsSuggested` tracks whether the field still holds that
   * unedited suggestion so the field can label it as such; it clears the
   * moment the seller types.
   */
  const [metaDescription, setMetaDescription] = useState(() =>
    fixture.metaDescriptionText !== ''
      ? fixture.metaDescriptionText
      : suggestMetaDescription({
          productName: fixture.productName,
          categoryLabel:
            fixture.sals3CategoryPath.split(' > ').pop()?.trim() ?? null,
          brandDeclaration: fixture.brandDeclaration,
          descriptionText: fixture.descriptionText,
          specificationHighlights: fixture.categoryAttributes
            .flatMap((attribute) => attribute.values)
            .map((value) => value.trim())
            .filter((value) => value.length > 0)
            .slice(0, 3),
          variantHighlights: [
            ...new Set(fixture.variants.map((variant) => variant.optionLabel)),
          ].slice(0, 3),
        }),
  );
  const [metaDescriptionIsSuggested, setMetaDescriptionIsSuggested] = useState(
    fixture.metaDescriptionText === '',
  );
  const [specifications, setSpecifications] = useState<SpecificationFixture[]>(
    fixture.specifications,
  );
  const [categoryAttributes, setCategoryAttributes] = useState<
    CategoryAttributeFieldFixture[]
  >(fixture.categoryAttributes);

  /**
   * `useState(fixture.categoryAttributes)` only reads its argument on mount.
   * `handleDecideCategory` calls `router.refresh()` after a category
   * decision, which re-renders this already-mounted client component with a
   * fresh `fixture` prop carrying the new category's controls - but the
   * `categoryAttributes` copy above stayed frozen at whatever the very first
   * render saw, so the Specification section kept showing the old category's
   * fields (or none) until a full page reload remounted the component.
   * `sals3CategoryCode` changes exactly when the resolved category changes
   * (unlike `categoryAttributesControlsVersion`, which names the shared
   * workbook extraction and is identical across every category), so it is
   * the correct resync key - and only that, so unrelated refreshes (media
   * upload, option mapping save) do not discard a seller's in-progress,
   * unsaved specification edits. Adjusted during render (React's documented
   * "adjusting state when a prop changes" pattern) rather than in an effect,
   * so the stale fields never commit to the screen even for one frame.
   */
  const [prevCategoryCode, setPrevCategoryCode] = useState(
    fixture.sals3CategoryCode,
  );

  /**
   * The last specification values known to be in the database, for telling an
   * unsaved edit from a saved one. Resynced with `categoryAttributes` itself and
   * on the same key, so the two never disagree about which category's fields
   * they describe.
   */
  const [savedCategoryAttributes, setSavedCategoryAttributes] = useState<
    CategoryAttributeFieldFixture[]
  >(fixture.categoryAttributes);

  if (fixture.sals3CategoryCode !== prevCategoryCode) {
    setPrevCategoryCode(fixture.sals3CategoryCode);
    setCategoryAttributes(fixture.categoryAttributes);
    setSavedCategoryAttributes(fixture.categoryAttributes);
  }
  /**
   * Seeded through `autoListVariants`, which replaces the two bulk buttons that
   * used to ask the seller to press for a state the data already settled.
   */
  const [variants, setVariants] = useState<VariantFixture[]>(() =>
    autoListVariants(fixture.variants),
  );

  /**
   * Option labels come back from the server after a rename; everything else in
   * `variants` stays the seller's.
   *
   * Same defect as the category-attribute resync below, in a second place.
   * `useState(fixture.variants)` reads its argument only on mount, and
   * `handleRenameOptionMapping` calls `router.refresh()`, which re-renders this
   * already-mounted client component with a fresh `fixture` but never remounts
   * it. So "Save names" reported success while every row underneath — and the
   * storefront preview beside them — kept showing the old label until a full
   * page reload. The seller's only way to find out whether the save worked was
   * to refresh and look, which is exactly the "did it save?" state a save button
   * exists to remove.
   *
   * Only the label fields are copied across. Replacing the whole row would throw
   * away retail prices and list toggles the seller has typed but not saved yet —
   * a far worse bug than the one being fixed, and the reason this is keyed on a
   * signature of the labels rather than on the fixture identity.
   */
  const optionLabelSignature = fixture.variants
    .map((variant) => `${variant.id}:${variant.optionLabel}`)
    .join('|');
  const [prevOptionLabelSignature, setPrevOptionLabelSignature] =
    useState(optionLabelSignature);

  if (optionLabelSignature !== prevOptionLabelSignature) {
    setPrevOptionLabelSignature(optionLabelSignature);
    setVariants((current) =>
      current.map((variant) => {
        const fresh = fixture.variants.find((row) => row.id === variant.id);

        return fresh === undefined
          ? variant
          : { ...variant, optionLabel: fresh.optionLabel };
      }),
    );
  }
  const [media, setMedia] = useState<MediaItemFixture[]>(fixture.media);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);
  const [deletingMediaId, setDeletingMediaId] = useState<string | null>(null);
  const [showSupplierPhoto, setShowSupplierPhoto] = useState(
    fixture.showSupplierPhoto,
  );
  const [isTogglingSupplierPhoto, setIsTogglingSupplierPhoto] = useState(false);

  const [isDirty, setIsDirty] = useState(false);
  const [lifecycle, setLifecycle] = useState<EditorLifecycle>(initialLifecycle);
  const [activeSection, setActiveSection] = useState<EditorSectionId>('basic');
  const [expandedVariantId, setExpandedVariantId] = useState<string | null>(
    null,
  );
  const [readinessOpen, setReadinessOpen] = useState(false);
  // Collapsed by default (owner decision 2026-08-17): Supplier Details is
  // evidence a seller checks occasionally, not something read on every
  // visit. Controlled, not just `defaultOpen`, so `goToSection` can expand
  // it on the way to a blocker/warning that lives inside it.
  const [specsOpen, setSpecsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [sourceDrawerOpen, setSourceDrawerOpen] = useState(false);
  const [exitDialogOpen, setExitDialogOpen] = useState(false);
  /**
   * The published listing, once there is one. Null until a real publish
   * succeeds, so design-preview mode can never raise this dialog.
   */
  /** The variant whose photo picker is open, if any. */
  const [imagePickerVariantId, setImagePickerVariantId] = useState<
    string | null
  >(null);
  const [published, setPublished] = useState<{
    slug: string;
    offerCount: number;
  } | null>(null);
  const [bulkPricingMode, setBulkPricingMode] =
    useState<BulkPricingMode | null>(null);
  const [previewMarketCode, setPreviewMarketCode] = useState(
    fixture.markets[0]?.code ?? '',
  );
  const [previewVariantId, setPreviewVariantId] = useState(
    fixture.variants[0]?.id ?? '',
  );
  /**
   * The revision this tab is writing to, and the version it last observed.
   *
   * The id is state, not a straight read of `fixture.draftSaveTarget`, because
   * a save on a published product lands on a *different row* from the one the
   * server rendered: it forks a new draft off the published revision. Holding
   * the id in the prop meant the screen kept naming the settled revision after
   * the fork, so the fork happened once and every save after it was refused as
   * a version conflict — a fix that looked correct on the server and did
   * nothing for the seller.
   *
   * Both are adopted from the save result for the same reason the version
   * already was: this screen has just moved the row it is editing.
   */
  const [draftRevisionId, setDraftRevisionId] = useState(
    fixture.draftSaveTarget?.revisionId ?? null,
  );
  const [draftRevisionVersion, setDraftRevisionVersion] = useState(
    fixture.draftSaveTarget?.expectedRevisionVersion ?? null,
  );
  /**
   * Whether the storefront is behind the draft on screen. Seeded from the
   * server (a fork from an earlier session survives a reload) and set on every
   * successful revision-scoped save of a published product, because that save
   * is exactly what opens the gap.
   */
  const [hasUnpublishedChanges, setHasUnpublishedChanges] = useState(
    fixture.publishedRevision !== null && !fixture.publishedRevision.isCurrent,
  );
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [isDiscarding, setIsDiscarding] = useState(false);

  /**
   * Offered only where it can actually be honoured: a real action, a persisted
   * revision to discard, and a published copy to fall back to. On a fixture
   * screen or an unpublished draft the control is absent rather than disabled,
   * because there is nothing the seller could do to make it work.
   */
  const canDiscardDraft =
    discardDraftAction !== undefined &&
    draftRevisionId !== null &&
    draftRevisionVersion !== null &&
    fixture.draftSaveTarget !== null &&
    fixture.publishedRevision !== null;

  const discardProductId = fixture.draftSaveTarget?.productId ?? null;

  const handleDiscardDraft = useCallback(async () => {
    if (
      discardDraftAction === undefined ||
      discardProductId === null ||
      draftRevisionId === null ||
      draftRevisionVersion === null
    ) {
      return;
    }

    setIsDiscarding(true);

    try {
      const result = await discardDraftAction({
        productId: discardProductId,
        revisionId: draftRevisionId,
        expectedRevisionVersion: draftRevisionVersion,
      });

      if (!result.ok) {
        toast('Discard failed.', {
          description: DISCARD_FAILURE_COPY[result.reason],
        });

        return;
      }

      // Retarget onto the published revision this discard restored. Doing it
      // from the result rather than from a refreshed fixture is deliberate:
      // these two are `useState`, so `router.refresh()` alone would leave them
      // naming the revision that was just retired.
      setDraftRevisionId(result.restoredRevisionId);
      setDraftRevisionVersion(result.restoredRevisionVersion);
      setHasUnpublishedChanges(false);
      setDiscardDialogOpen(false);
      toast('Draft discarded.', {
        description: 'This listing is back to the published version.',
      });
      router.refresh();
    } finally {
      setIsDiscarding(false);
    }
  }, [
    discardDraftAction,
    discardProductId,
    draftRevisionId,
    draftRevisionVersion,
    router,
  ]);

  /**
   * `products.version`, as this tab last observed it.
   *
   * Every product-level write here is a compare-and-set on it, and
   * `router.refresh()` is asynchronous — so two writes in one interaction
   * (specifications flushed, then publish) cannot both read the version the
   * fixture rendered with: the second would be refused as `version_conflict`
   * for having done exactly what it was asked to do.
   *
   * Resynced from the fixture only when the fixture is *ahead*. The column only
   * ever increases, so a refresh that lands after a newer local write must not
   * pull the token backwards.
   */
  const fixtureProductVersion =
    fixture.publishTarget?.expectedProductVersion ?? null;
  const [productVersion, setProductVersion] = useState(fixtureProductVersion);

  if (
    fixtureProductVersion !== null &&
    (productVersion === null || fixtureProductVersion > productVersion)
  ) {
    setProductVersion(fixtureProductVersion);
  }

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  // Unsaved-draft protection. The prototype keeps changes in the tab, so
  // the only real risk is the seller navigating away and losing them.
  useEffect(() => {
    if (!isDirty) return undefined;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };

    window.addEventListener('beforeunload', onBeforeUnload);

    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [isDirty]);

  /**
   * Keeps the section nav in step with manual scrolling, not just clicks.
   * An `IntersectionObserver` rather than a scroll handler: it reports
   * which section is on screen without running work on every scroll frame,
   * and it never influences the layout itself - that stays pure CSS.
   *
   * Feature-detected: this is a progressive enhancement over the nav's
   * click behaviour, so an environment without the API (jsdom, an old
   * browser) simply keeps the clicked section highlighted.
   */
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);

        if (visible.length === 0) return;

        const id = visible[0].target.id.replace('sec-', '');

        setActiveSection(id as EditorSectionId);
      },
      { rootMargin: '-96px 0px -60% 0px' },
    );

    EDITOR_SECTIONS.forEach((section) => {
      const element = document.getElementById(`sec-${section.id}`);

      if (element !== null) observer.observe(element);
    });

    return () => observer.disconnect();
  }, []);

  const touch = useCallback(() => {
    setIsDirty(true);
    setLifecycle('IDLE');
  }, []);

  const goToSection = useCallback((section: EditorSectionId) => {
    setActiveSection(section);
    setReadinessOpen(false);
    // A collapsed Supplier Details must never hide the blocker/warning a
    // reader was just sent to find.
    if (section === 'specs') setSpecsOpen(true);
    document
      .getElementById(`sec-${section}`)
      ?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, []);

  const updateVariant = useCallback(
    (variantId: string, patch: Partial<VariantFixture>) => {
      setVariants((current) =>
        current.map((variant) =>
          variant.id === variantId ? { ...variant, ...patch } : variant,
        ),
      );
      touch();
    },
    [touch],
  );

  const currentIssues = useMemo(() => {
    const hasMissingRetailPrice = variants.some(
      (variant) => variant.retailPrice.amountMinor <= 0,
    );

    const withoutLocalIssues = fixture.issues.filter(
      (issue) =>
        issue.title !== 'Selling price is not resolved' &&
        issue.title !== 'Retail price is required' &&
        // Locally re-derived gates replace any server copy of the same title,
        // so one condition never renders twice.
        !PREDICTED_GATE_TITLES.has(issue.title) &&
        issue.section !== 'specification',
    );
    const localIssues = [
      // Every publication gate the editor can decide for itself, from one shared
      // catalogue with `publish.ts`. The panel used to know three of eleven, so
      // a seller could read Ready and be refused for a reason never shown.
      // Live state, not `fixture`: these three change under the seller's hands,
      // and a gate reading the page-load snapshot reports a state they have
      // already left.
      ...predictPublishBlockers(fixture, {
        variants,
        media,
        showSupplierPhoto,
      }),
      ...(hasMissingRetailPrice ? [retailPriceIssue(fixture)] : []),
      ...categoryAttributeIssues(fixture, categoryAttributes),
    ];

    return [...withoutLocalIssues, ...localIssues];
  }, [fixture, variants, media, showSupplierPhoto, categoryAttributes]);

  const currentFixture = useMemo(
    () => ({
      ...fixture,
      issues: currentIssues,
    }),
    [currentIssues, fixture],
  );

  const decision = useMemo(
    () => publishDecision(currentFixture, lifecycle),
    [currentFixture, lifecycle],
  );
  const warnings = useMemo(
    () => issuesOfSeverity(currentIssues, 'WARNING'),
    [currentIssues],
  );

  const bulkPriceable = useMemo(
    () => variants.filter(isBulkPriceable),
    [variants],
  );
  const bulkAffected = useMemo(() => bulkPriceable, [bulkPriceable]);
  const bulkMinimumRetailPrice = useMemo(() => {
    const matchingCosts = bulkAffected
      .filter(
        (variant) =>
          variant.supplierCost.currency === fixture.source.sourceCurrency,
      )
      .map((variant) =>
        minimumRetailAmountMinorForSupplierCost(
          variant.supplierCost.amountMinor,
        ),
      );

    if (matchingCosts.length === 0) return null;

    return {
      amountMinor: Math.max(...matchingCosts),
      currency: fixture.source.sourceCurrency,
    };
  }, [bulkAffected, fixture.source.sourceCurrency]);

  const applyBulkPricing = (amountMinor: number) => {
    const affectedIds = new Set(bulkAffected.map((variant) => variant.id));

    setVariants((current) =>
      current.map((variant) => {
        if (!affectedIds.has(variant.id)) return variant;

        return {
          ...variant,
          retailPrice: {
            amountMinor: retailAmountAboveSupplierCost(
              amountMinor,
              variant.retailPrice.currency,
              variant.supplierCost,
            ),
            currency: variant.retailPrice.currency,
          },
          attention: amountMinor <= 0 ? 'Retail price required' : null,
        };
      }),
    );

    const skipped = variants.length - affectedIds.size;

    setBulkPricingMode(null);
    touch();

    if (skipped > 0) {
      toast(`${skipped} variant${skipped === 1 ? '' : 's'} were skipped.`, {
        description:
          'A bulk price change never touches a blocked or paused variant.',
      });
    }
  };

  /**
   * The same compare-and-set token every product-level write on this screen
   * uses. Captured in a local so its non-null narrowing survives into the
   * closures below — `optionMappingTarget` further down is the same value, named
   * for the section that needed it first.
   */
  const attributeSaveTarget = fixture.publishTarget;

  const attributesAreUnsaved =
    categoryAttributeFingerprint(categoryAttributes) !==
    categoryAttributeFingerprint(savedCategoryAttributes);

  /**
   * The specification write itself, without the screen feedback around it.
   *
   * Separated from the section's own Save button because Publish needs the same
   * write: the section's button was the only way these fields ever reached the
   * database, so pressing Publish on freshly typed specifications published
   * without them. Returning the resulting `products.version` is what lets the
   * publish that follows compare-and-set against the row this write just left.
   *
   * It does not call `router.refresh()`. A caller that is about to publish must
   * not race a re-render of the fixture it is publishing from.
   */
  const flushCategoryAttributes =
    saveCategoryAttributesAction === undefined || attributeSaveTarget === null
      ? undefined
      : async (): Promise<
          { ok: true; productVersion: number } | { ok: false; message: string }
        > => {
          // Every currently-rendered field is submitted, including an empty
          // array for one the seller cleared. `saveCategoryAttributes`
          // treats an attribute name absent from the payload as "untouched"
          // and one present with no accepted value as "delete the stored
          // row" — omitting a cleared field here left its old, now-stale
          // value in the database after save and refresh.
          const attributes = Object.fromEntries(
            categoryAttributes.map((field) => [
              field.attributeName,
              field.values,
            ]),
          );

          const result = await saveCategoryAttributesAction({
            productId: attributeSaveTarget.productId,
            expectedProductVersion:
              productVersion ?? attributeSaveTarget.expectedProductVersion,
            attributes,
          });

          if (!result.ok) return { ok: false, message: result.message };

          setProductVersion(result.productVersion);
          setSavedCategoryAttributes(categoryAttributes);

          return { ok: true, productVersion: result.productVersion };
        };

  const onSaveDraft = async () => {
    setLifecycle('SAVING');

    // Same reasoning as the publish path: the seller pressed Save, so every
    // pending edit on the screen is saved, including the ones that belong to a
    // separate versioned write.
    if (attributesAreUnsaved && flushCategoryAttributes !== undefined) {
      const flushed = await flushCategoryAttributes();

      if (!flushed.ok) {
        setLifecycle('SAVE_FAILED');
        toast('Draft save failed.', {
          description: `The specifications were not saved. ${flushed.message}`,
        });

        return;
      }
    }

    if (
      saveDraftAction !== undefined &&
      fixture.draftSaveTarget !== null &&
      draftRevisionId !== null &&
      draftRevisionVersion !== null
    ) {
      const result = await saveDraftAction({
        productId: fixture.draftSaveTarget.productId,
        revisionId: draftRevisionId,
        expectedRevisionVersion: draftRevisionVersion,
        title: productName,
        // The draft L1 dropdown that used to set this was removed from the
        // screen (superseded by the real curated category decision) — this
        // is now a read-only pass-through of whatever value was already
        // stored, never a value this screen can change.
        sals3CategoryL1: fixture.sals3CategoryL1,
        descriptionDocument: descriptionDocumentFrom(
          descriptionBlocks,
          descriptionMode,
        ),
        variantRetailPrices: variants
          .filter(
            (variant) =>
              UUID_PATTERN.test(variant.id) &&
              variant.retailPrice.amountMinor > 0,
          )
          .map((variant) => ({
            variantId: variant.id,
            amountMinor: variant.retailPrice.amountMinor,
            currency: variant.retailPrice.currency,
          })),
      });

      if (result.ok) {
        setDraftRevisionId(result.revisionId);
        setDraftRevisionVersion(result.revisionVersion);
        setSavedDescriptionBlocks(
          descriptionBlocks.map((entry) => entry.block),
        );
        setSavedDescriptionMode(descriptionMode);
        setLifecycle('SAVED');
        setIsDirty(false);

        if (fixture.publishedRevision !== null) {
          setHasUnpublishedChanges(true);
        }

        toast('Draft saved.');

        return;
      }

      setLifecycle('SAVE_FAILED');
      toast('Draft save failed.', {
        description: draftSaveFailureMessage(result.reason),
      });

      return;
    }

    timerRef.current = setTimeout(() => {
      setLifecycle('SAVED');
      setIsDirty(false);
    }, 500);
  };

  const onPublish = async () => {
    setLifecycle('VALIDATING');

    /**
     * Specifications are flushed before the publish request, not left behind by
     * it.
     *
     * The Specification section owns its own Save button, so a seller who typed
     * a value and pressed Publish published the old value — or none — while the
     * new one sat in the tab. Publishing is the strongest statement of intent on
     * this screen; it cannot be the one action that discards an edit.
     *
     * A failed flush stops the publish. Publishing anyway would put a listing
     * live that contradicts what the seller is looking at, which is worse than
     * not publishing.
     */
    let expectedProductVersion =
      productVersion ?? fixture.publishTarget?.expectedProductVersion ?? null;

    if (attributesAreUnsaved && flushCategoryAttributes !== undefined) {
      const flushed = await flushCategoryAttributes();

      if (!flushed.ok) {
        setLifecycle('VALIDATION_FAILED');
        toast('Nothing was published.', {
          description: `The specifications could not be saved first, so the publish was stopped. ${flushed.message}`,
        });

        return;
      }

      expectedProductVersion = flushed.productVersion;
    }

    if (
      publishAction !== undefined &&
      fixture.publishTarget !== null &&
      expectedProductVersion !== null
    ) {
      const result = await publishAction({
        productId: fixture.publishTarget.productId,
        expectedProductVersion,
        variantRetailPrices: variants
          .filter((variant) => UUID_PATTERN.test(variant.id))
          .map((variant) => ({
            variantId: variant.id,
            amountMinor: variant.retailPrice.amountMinor,
            currency: variant.retailPrice.currency,
          })),
      });

      if (result.ok) {
        setLifecycle('IDLE');
        setIsDirty(false);
        // The draft on screen is what the storefront now serves, so the gap
        // this notice reports is closed until the next edit reopens it.
        setHasUnpublishedChanges(false);
        router.refresh();
        // A dialog rather than a toast: this is the end of the task, it names a
        // path worth reading, and the seller most likely wants to leave for the
        // catalogue. See `PublishSuccessDialog`.
        setPublished({ slug: result.slug, offerCount: result.offerCount });

        return;
      }

      setLifecycle('VALIDATION_FAILED');
      toast('Publish failed.', {
        description:
          result.detail ??
          PUBLISH_FAILURE_MESSAGES[result.reason] ??
          'No listing was published.',
      });

      return;
    }

    timerRef.current = setTimeout(() => {
      setLifecycle('IDLE');
      toast('Design preview — nothing was published.', {
        description:
          'This screen has no publication backend. No listing was created and no request was sent.',
      });
    }, 700);
  };

  const onExit = () => {
    if (isDirty) {
      setExitDialogOpen(true);

      return;
    }

    router.push(EXIT_HREF);
  };

  /**
   * One definition each, rendered in two places: inline on a wide
   * container, inside a sheet below it. Duplicating the markup is how the
   * drawer and the rail drift into showing different things.
   */
  const renderReadiness = (showHeading: boolean) => (
    <ListingReadinessPanel
      fixture={currentFixture}
      blockerCount={decision.blockerCount}
      warningCount={decision.warningCount}
      suggestionCount={decision.suggestionCount}
      onGoToSection={goToSection}
      showHeading={showHeading}
    />
  );

  // What the storefront will actually render, mirroring
  // `storefront/read-model.ts`'s `mediaVisibleToBuyers`: a seller's own upload
  // always shows, the supplier's original shows while the switch is on, and the
  // switch off hides it **only once a gallery seller upload exists** - an empty
  // gallery falls back to the supplier photo rather than rendering a blank the
  // buyer would never see (owner decision 2026-08-20).
  //
  // This used to be `[...media, ...fixture.supplierMedia]`, which was right
  // while `media` held seller uploads alone. It is not right now: `media` is the
  // whole gallery and already contains the supplier's rows, so concatenating
  // `supplierMedia` on top rendered every supplier photo **twice**. The fixture
  // fallback below is the one case that still needs it - the illustrative
  // fixtures carry no `assignableMedia`, so their gallery is empty while their
  // supplier evidence is not.
  const effectivePreviewMedia = previewMedia(
    media,
    fixture.supplierMedia,
    showSupplierPhoto,
  );

  const renderPreview = (showHeading: boolean) => (
    <DraftStorefrontPreview
      productName={productName}
      // The preview card shows a one-line summary, not the section itself,
      // so the flattened projection is the right input here — the block
      // structure it would ignore is what the storefront renders.
      description={descriptionBlocksToPlainText(
        descriptionBlocks.map((entry) => entry.block),
      )}
      variants={variants}
      markets={fixture.markets}
      media={effectivePreviewMedia}
      specifications={specifications}
      previewMarketCode={previewMarketCode}
      onPreviewMarketChange={setPreviewMarketCode}
      previewVariantId={previewVariantId}
      onPreviewVariantChange={setPreviewVariantId}
      showHeading={showHeading}
    />
  );

  /**
   * Mapping needs the same compare-and-set token a publish does, and
   * `publishTarget` is the only place a real `products.version` reaches this
   * screen. Captured in a local so its non-null narrowing survives into the
   * closure below.
   *
   * Absent action or absent target both mean "no save": in design-preview mode
   * the section still pre-fills and explains itself, but offers nothing to press.
   */
  const optionMappingTarget = fixture.publishTarget;
  const handleOptionMappingSave =
    optionMappingAction === undefined || optionMappingTarget === null
      ? undefined
      : async (
          axes: { name: string; values: { raw: string; label: string }[] }[],
        ) => {
          const result = await optionMappingAction({
            productId: optionMappingTarget.productId,
            expectedProductVersion: optionMappingTarget.expectedProductVersion,
            axes,
          });

          // A committed mapping changes what the read-model returns, and the
          // section switches to its report-only state from that data rather
          // than from local state.
          if (result.ok) router.refresh();

          return result.ok
            ? { ok: true }
            : { ok: false, message: result.message };
        };

  /**
   * Renaming the saved matrix. Display words only, so it needs no refresh of
   * the proposal — but it does bump the product version, and the section
   * mirrors the new names locally until the refreshed fixture confirms them.
   */
  const handleOptionMappingRename =
    renameOptionMappingAction === undefined || optionMappingTarget === null
      ? undefined
      : async (
          axes: {
            optionId: string;
            name: string;
            values: { valueId: string; label: string }[];
          }[],
        ) => {
          const result = await renameOptionMappingAction({
            productId: optionMappingTarget.productId,
            expectedProductVersion: optionMappingTarget.expectedProductVersion,
            axes,
          });

          if (result.ok) {
            // Same confirmation shape as `Draft saved.`: the inline message
            // alone sat in a section the seller had usually scrolled past.
            toast('Names saved.');
            router.refresh();
          }

          return result.ok
            ? { ok: true, message: 'Names saved.' }
            : { ok: false, message: result.message };
        };

  /**
   * Saves the description on its own, from its own section.
   *
   * The narrow `saveDescriptionAction` rather than the whole-draft save: this
   * button says "Save description" and must not also commit a retail price the
   * seller was still deciding on. Same single-concern shape as the meta
   * description's own save beside it.
   *
   * `setDraftRevisionVersion` on success is what keeps `Save Draft` working
   * afterwards. That action compare-and-sets the revision version this screen
   * last read, and a description save moves it — so without adopting the new
   * one, the next `Save Draft` would be refused as stale against a change this
   * very screen had just made.
   */
  const handleSaveDescription =
    saveDescriptionAction === undefined ||
    fixture.draftSaveTarget === null ||
    draftRevisionId === null ||
    draftRevisionVersion === null
      ? undefined
      : async () => {
          const target = fixture.draftSaveTarget;

          if (target === null) return { ok: false, message: 'No open draft.' };

          const result = await saveDescriptionAction({
            productId: target.productId,
            revisionId: draftRevisionId,
            expectedRevisionVersion: draftRevisionVersion,
            descriptionDocument: descriptionDocumentFrom(
              descriptionBlocks,
              descriptionMode,
            ),
          });

          if (!result.ok) return { ok: false, message: result.message };

          setDraftRevisionId(result.revisionId);
          setDraftRevisionVersion(result.revisionVersion);
          setSavedDescriptionBlocks(
            descriptionBlocks.map((entry) => entry.block),
          );
          setSavedDescriptionMode(descriptionMode);

          if (fixture.publishedRevision !== null) {
            setHasUnpublishedChanges(true);
          }

          toast('Description saved.');

          return { ok: true, message: 'Description saved.' };
        };

  /**
   * Recovery needs only the product id — no version token, because it fills blank
   * columns rather than replacing a value anyone read. A concurrent write cannot
   * be lost: the `isNull` predicate means whoever writes first wins and the second
   * attempt recovers nothing.
   */
  const handleRecoverLabels =
    recoverLabelsAction === undefined || optionMappingTarget === null
      ? undefined
      : async () => {
          const result = await recoverLabelsAction({
            productId: optionMappingTarget.productId,
          });

          if (!result.ok) return { ok: false, message: result.message };

          // Nothing recovered is a real outcome, not a failure — the labels were
          // already there, or the evidence never carried any. Refreshing on zero
          // would suggest something changed.
          if (result.recoveredCount === 0) {
            return {
              ok: true,
              message:
                'No labels needed recovering. Every variant already had one.',
            };
          }

          // The section re-derives its proposal from the read-model, so the
          // recovered labels have to come back through the server, not local
          // state.
          router.refresh();

          return {
            ok: true,
            message: `Recovered ${result.recoveredCount} supplier label${result.recoveredCount === 1 ? '' : 's'}. The Variant Matrix can now be named.`,
          };
        };

  /**
   * Same compare-and-set token as option mapping — a category decision is
   * also a real, versioned write, not local draft state.
   */
  const handleDecideCategory =
    decideCategoryAction === undefined || optionMappingTarget === null
      ? undefined
      : async (sals3CategoryCode: string) => {
          const result = await decideCategoryAction({
            productId: optionMappingTarget.productId,
            expectedProductVersion: optionMappingTarget.expectedProductVersion,
            sals3CategoryCode,
          });

          // The resolved category, pricing, and publish gates all re-derive
          // from the read-model, not from local state.
          if (result.ok) router.refresh();

          return result.ok
            ? { ok: true as const, categoryPath: result.categoryPath }
            : { ok: false as const, message: result.message };
        };

  const updateCategoryAttribute = useCallback(
    (attributeName: string, values: string[], isCustomValue: boolean) => {
      setCategoryAttributes((current) =>
        current.map((field) =>
          field.attributeName === attributeName
            ? { ...field, values, isCustomValue }
            : field,
        ),
      );
      touch();
    },
    [touch],
  );

  /**
   * Same compare-and-set token as option mapping and category decisions —
   * this is a real, versioned write, not local draft state. The section's
   * own `unresolved` state re-derives from the read-model on refresh, same
   * reasoning as `handleOptionMappingSave`.
   */
  const handleSaveCategoryAttributes =
    flushCategoryAttributes === undefined
      ? undefined
      : async () => {
          const result = await flushCategoryAttributes();

          if (result.ok) router.refresh();

          return result.ok
            ? { ok: true }
            : { ok: false, message: result.message };
        };

  /**
   * Points one stored photo at one variant, or clears it.
   *
   * Not a compare-and-set: `assignVariantMediaAction` explains why one nullable
   * column on one media row needs no version token. The variant row is updated
   * locally so the thumbnail appears immediately, and `router.refresh()` re-reads
   * the authoritative projection behind it — the local write is what the seller
   * sees, never what anything else trusts.
   */
  const imagePickerVariant =
    imagePickerVariantId === null
      ? null
      : (variants.find((item) => item.id === imagePickerVariantId) ?? null);

  /**
   * Derived from `variants`, not from `fixture`, so a photo assigned in the
   * picker shows on the matrix chip immediately - `updateVariant` has already
   * moved it in local state by the time `router.refresh()` lands.
   */
  const valuePhotos = resolveVariantValuePhotos(fixture.mappedAxes, variants);

  const handleAssignVariantMedia =
    assignVariantMediaAction === undefined ||
    attributeSaveTarget === null ||
    imagePickerVariant === null
      ? undefined
      : async (mediaId: string | null) => {
          const result = await assignVariantMediaAction({
            productId: attributeSaveTarget.productId,
            mediaId:
              mediaId ??
              imagePickerVariant.imageMediaId ??
              // Clearing needs a row to clear; the picker only offers the
              // control when the variant holds one, so this is unreachable.
              '',
            variantId: mediaId === null ? null : imagePickerVariant.id,
          });

          if (!result.ok) {
            return { ok: false, message: result.message };
          }

          const assigned =
            mediaId === null
              ? null
              : (fixture.assignableMedia?.find(
                  (item) => item.mediaId === mediaId,
                ) ?? null);

          updateVariant(imagePickerVariant.id, {
            hasImage: assigned !== null,
            imageUrl: assigned?.url ?? null,
            imageMediaId: assigned?.mediaId ?? null,
          });
          router.refresh();

          return { ok: true };
        };

  /**
   * The whole product-level ordering the server must be given, composed from
   * the two panels that each arrange half of it.
   *
   * `reorderProductMedia` refuses anything that is not exactly this product's
   * gallery, and it is right to: positions are only meaningful relative to each
   * other, so writing one panel's rows would interleave them with rows still
   * ordered by observation time and produce an order nobody chose. So the two
   * panels are concatenated here rather than each writing its own slice.
   *
   * **Seller photos lead.** That is what makes the cover well defined with the
   * arranging split across two places: position 0 is the seller's first photo
   * whenever they have one, and the supplier's first otherwise — the same
   * answer the storefront's own `sellerUploadsFirst` gives, so the editor and
   * the buyer cannot disagree about which photograph leads.
   */
  const composeGalleryOrder = (
    ownOrder: string[],
    supplierOrder: string[],
  ): string[] => [...ownOrder, ...supplierOrder];

  const supplierMediaIds = fixture.supplierMedia.map((item) => item.id);

  /**
   * Commits a new gallery order, optimistically and then for real.
   *
   * The local `setMedia` is what makes a drag feel like a drag; the action is
   * what makes it survive a reload. On refusal the server's own message is
   * shown and `router.refresh()` pulls the true order back, because the
   * optimistic list is now known to be wrong and leaving it on screen would be
   * the editor asserting an arrangement the database rejected.
   *
   * `isCover` is recomputed from the new index rather than carried: the cover is
   * position 0 and deriving it here is what stops a stale flag surviving a move.
   */
  const handleReorderMedia =
    reorderMediaAction === undefined || optionMappingTarget === null
      ? undefined
      : (mediaIds: string[]) => {
          setMedia((current) => {
            const byId = new Map(current.map((item) => [item.id, item]));

            return mediaIds.flatMap((mediaId, index) => {
              const item = byId.get(mediaId);

              return item === undefined
                ? []
                : [{ ...item, isCover: index === 0 }];
            });
          });

          reorderMediaAction({
            productId: optionMappingTarget.productId,
            mediaIds,
          })
            .then((result) => {
              if (result.ok) return;

              toast.error(result.message);
              router.refresh();
            })
            // Deliberately not awaited by the caller: a drag fires this per tile
            // crossed and blocking the pointer on a round trip would make the
            // grid stutter. A rejected promise still has to be reported rather
            // than left unhandled, and refreshing is what puts the true order
            // back on screen.
            .catch(() => {
              toast.error('That new order could not be saved.');
              router.refresh();
            });
        };

  /**
   * Uploads one file directly onto the variant the picker is open for.
   *
   * `variantId` goes to the server, which writes it on the inserted row, so the
   * photo is a variation photo from the moment it exists — it never occupies a
   * gallery slot and never has to be assigned afterwards. `router.refresh()`
   * is what brings it back as an `assignableMedia` row and as the variant's own
   * thumbnail; the local `updateVariant` below is what makes it visible before
   * that round trip lands, the same optimistic pattern as `handleAssignVariantMedia`.
   *
   * It deliberately does **not** append to `media`: that state is Product
   * media's gallery grid, and a variation photo is not one of those.
   */
  const handleUploadVariantMedia =
    uploadMediaAction === undefined ||
    optionMappingTarget === null ||
    imagePickerVariant === null
      ? undefined
      : async (file: File) => {
          const formData = new FormData();

          formData.set('productId', optionMappingTarget.productId);
          formData.set('variantId', imagePickerVariant.id);
          formData.set('file', file);

          const result = await uploadMediaAction(formData);

          if (!result.ok) {
            return { ok: false, message: result.message };
          }

          updateVariant(imagePickerVariant.id, {
            hasImage: true,
            imageUrl: result.media.sourceUrl,
            imageMediaId: result.media.id,
          });
          router.refresh();

          return { ok: true };
        };

  /**
   * Same compare-and-set token as the other product-level saves above —
   * `products.metaDescription` is a plain column, not part of the
   * revisioned draft body `saveDraftAction` writes.
   */
  const handleSaveMetaDescription =
    saveMetaDescriptionAction === undefined || optionMappingTarget === null
      ? undefined
      : async () => {
          const result = await saveMetaDescriptionAction({
            productId: optionMappingTarget.productId,
            expectedProductVersion: optionMappingTarget.expectedProductVersion,
            metaDescription,
          });

          if (result.ok) router.refresh();

          return result.ok
            ? { ok: true }
            : { ok: false, message: result.message };
        };

  /**
   * Auto-saves the moment the switch flips rather than behind a separate
   * Save button - a toggle is already the confirmation. Optimistic with a
   * rollback: the seller sees the new state immediately, and a failed write
   * puts it back and says why, so the switch never shows a state the
   * database does not hold.
   */
  const handleToggleShowSupplierPhoto =
    saveShowSupplierPhotoAction === undefined || optionMappingTarget === null
      ? undefined
      : async (next: boolean) => {
          const previous = showSupplierPhoto;

          setShowSupplierPhoto(next);
          setIsTogglingSupplierPhoto(true);

          const result = await saveShowSupplierPhotoAction({
            productId: optionMappingTarget.productId,
            expectedProductVersion: optionMappingTarget.expectedProductVersion,
            showSupplierPhoto: next,
          });

          setIsTogglingSupplierPhoto(false);

          if (!result.ok) {
            setShowSupplierPhoto(previous);
            toast.error(result.message);

            return;
          }

          router.refresh();
        };

  /**
   * Only the product id, same reasoning as `handleRecoverLabels` — a photo
   * upload is additive, so there is no prior value to compare-and-set
   * against. Each file is its own request and its own DB row, so one
   * rejected file (too large, wrong type) does not block the rest.
   */
  /**
   * One file, one request, and the URL handed straight back to the block —
   * nothing is persisted until Save Draft writes the document that
   * references it.
   */
  /**
   * Anchored to the draft, not the publish target: a description image is
   * written while the draft is being written, which is well before a product
   * has anything to publish.
   */
  const descriptionImageProductId =
    fixture.draftSaveTarget?.productId ?? fixture.publishTarget?.productId;

  const handleUploadDescriptionImage =
    uploadDescriptionImageAction === undefined ||
    descriptionImageProductId === undefined
      ? undefined
      : async (file: File) => {
          const formData = new FormData();

          formData.set('productId', descriptionImageProductId);
          formData.set('file', file);

          const result = await uploadDescriptionImageAction(formData);

          return result.ok
            ? ({ ok: true, url: result.url } as const)
            : ({ ok: false, message: result.message } as const);
        };

  /**
   * Uploads a chosen batch and reports, once, what did not land.
   *
   * ## Why one summary instead of a toast per file
   *
   * This loop used to call `toast.error` per refused file. That looks like
   * reporting and is not: handing it 21 files against 12 free slots produced
   * nine identical "maximum number of photos" toasts into a stack that shows
   * three at a time and expires them, while successful uploads kept arriving
   * behind them. The reported symptom was that the run "said nothing" and the
   * only evidence was the counter reading `12 of 12` — a silent partial
   * success, which is how the 21-design beanie looked finished when nine of its
   * designs had no photo.
   *
   * So: outcomes are collected, and the failures are named at the end, with the
   * file names, and with `duration: Infinity` so the one message that says what
   * the seller lost is the one message that does not disappear while they read
   * it. Identical refusals are grouped, because nine copies of one sentence is
   * the noise this is replacing.
   */
  const handleUploadMedia =
    uploadMediaAction === undefined || optionMappingTarget === null
      ? undefined
      : async (files: FileList) => {
          setIsUploadingMedia(true);

          const chosen = Array.from(files);
          const refused: { name: string; message: string }[] = [];
          let accepted = 0;

          try {
            // eslint-disable-next-line no-restricted-syntax -- sequential: each upload is its own request and DB write against the same product row.
            for (const file of chosen) {
              const formData = new FormData();

              formData.set('productId', optionMappingTarget.productId);
              formData.set('file', file);

              // eslint-disable-next-line no-await-in-loop
              const result = await uploadMediaAction(formData);

              if (!result.ok) {
                refused.push({ name: file.name, message: result.message });
                // eslint-disable-next-line no-continue
                continue;
              }

              accepted += 1;

              setMedia((current) => [
                ...current,
                {
                  id: result.media.id,
                  label: `Photo ${current.length + 1}`,
                  sourceUrl: result.media.sourceUrl,
                  altText: `Seller-uploaded photo for ${productName}`,
                  rightsCheck: 'VERIFIED',
                  storageState: 'SALS3_STORED',
                  sourceType: 'SELLER_UPLOAD',
                  pixelWidth: result.media.widthPixels,
                  pixelHeight: result.media.heightPixels,
                  note: null,
                  isCover: current.length === 0,
                },
              ]);
            }
          } finally {
            setIsUploadingMedia(false);
          }

          if (refused.length > 0) {
            toast.error(describeRefusedUploads(refused, accepted), {
              duration: Infinity,
              closeButton: true,
            });
          }
        };

  /**
   * Only the product id and the target row - a delete is not a value
   * anyone needs to compare-and-set against, and the domain module's own
   * `WHERE sourceType = 'SELLER_UPLOAD'` is what actually protects a
   * supplier's photo from this path, not anything client-side.
   */
  const handleDeleteMedia =
    deleteMediaAction === undefined || optionMappingTarget === null
      ? undefined
      : async (mediaId: string) => {
          setDeletingMediaId(mediaId);

          try {
            const result = await deleteMediaAction({
              productId: optionMappingTarget.productId,
              mediaId,
            });

            if (!result.ok) {
              toast.error(result.message);

              return;
            }

            setMedia((current) => {
              const wasCover =
                current.find((item) => item.id === mediaId)?.isCover ?? false;
              const remaining = current.filter((item) => item.id !== mediaId);

              // A deleted cover hands the role to whatever is now first,
              // rather than leaving the product with no cover at all.
              return wasCover && remaining.length > 0
                ? remaining.map((item, index) => ({
                    ...item,
                    isCover: index === 0,
                  }))
                : remaining;
            });
          } finally {
            setDeletingMediaId(null);
          }
        };

  return (
    <div className="@container flex flex-col gap-4">
      <ProductEditorHeader
        fixture={currentFixture}
        productName={productName}
        isDirty={isDirty}
        onOpenReadiness={() => setReadinessOpen(true)}
        onOpenPreview={() => setPreviewOpen(true)}
        onOpenSourceDrawer={() => setSourceDrawerOpen(true)}
      />

      <EditorStateBanners
        banner={currentFixture.banner}
        lifecycle={lifecycle}
        onRetry={() => setLifecycle('IDLE')}
      />

      <UnpublishedChangesNotice
        isPublished={fixture.publishedRevision !== null}
        hasUnpublishedChanges={hasUnpublishedChanges}
        onDiscard={
          canDiscardDraft ? () => setDiscardDialogOpen(true) : undefined
        }
        isDiscarding={isDiscarding}
      />

      {/* 86.5rem (1384px) is 272px Readiness + 760px main + 320px Preview +
          two 16px gaps - the exact point at which the main editor still
          gets its guaranteed 760px. `minmax(47.5rem,1fr)` enforces that
          floor: below the breakpoint the grid does not squeeze three
          columns together, it drops straight to one and moves Readiness
          and Preview into sheets instead of shrinking the column the
          seller is actually typing in. */}
      <div className="grid grid-cols-1 items-start gap-4 @min-[86.5rem]:grid-cols-[17rem_minmax(47.5rem,1fr)_20rem]">
        <aside className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-x-hidden overflow-y-auto @min-[86.5rem]:block">
          <ListingReadinessPanel
            fixture={currentFixture}
            blockerCount={decision.blockerCount}
            warningCount={decision.warningCount}
            suggestionCount={decision.suggestionCount}
            onGoToSection={goToSection}
            showHeading
            compact
            onViewAll={() => setReadinessOpen(true)}
          />
        </aside>

        <div className="@container flex min-w-0 flex-col gap-4">
          <EditorSectionNavigation
            issues={currentIssues}
            activeSection={activeSection}
            onGoToSection={goToSection}
          />

          <EditorSectionCard
            id="basic"
            title="Basic Information"
            severity={sectionSeverity(currentIssues, 'basic')}
          >
            <BasicInformationSection
              fixture={fixture}
              media={media}
              productName={productName}
              onProductNameChange={(value) => {
                setProductName(value);
                touch();
              }}
              sellerSku={sellerSku}
              onSellerSkuChange={(value) => {
                setSellerSku(value);
                touch();
              }}
              brandDeclaration={brandDeclaration}
              onBrandDeclarationChange={(value) => {
                setBrandDeclaration(value);
                touch();
              }}
              onUploadPhoto={handleUploadMedia}
              onDeletePhoto={handleDeleteMedia}
              // Making a photo the cover *is* moving it to the front: one
              // ordering, one write, nothing that can disagree with itself. It
              // stays a button because native drag fires from neither keyboard
              // nor touch, so this is the only path to the arrangement decision
              // that matters most.
              onMakeCoverPhoto={(id) => {
                const reordered = [
                  id,
                  ...media
                    .filter((item) => item.id !== id)
                    .map((item) => item.id),
                ];

                if (handleReorderMedia === undefined) {
                  setMedia((current) =>
                    current.map((item) => ({
                      ...item,
                      isCover: item.id === id,
                    })),
                  );
                  touch();

                  return;
                }

                handleReorderMedia(reordered);
              }}
              onReorderPhotos={
                handleReorderMedia === undefined
                  ? undefined
                  : (ownOrder) =>
                      handleReorderMedia(
                        composeGalleryOrder(ownOrder, supplierMediaIds),
                      )
              }
              isUploadingPhoto={isUploadingMedia}
              deletingPhotoId={deletingMediaId}
              showSupplierPhoto={showSupplierPhoto}
              onToggleSupplierPhoto={handleToggleShowSupplierPhoto}
              isTogglingSupplierPhoto={isTogglingSupplierPhoto}
              sals3CategoryOptions={sals3CategoryOptions}
              onDecideSals3Category={handleDecideCategory}
            />
          </EditorSectionCard>

          <EditorSectionCard
            id="specification"
            title="Specification"
            severity={sectionSeverity(currentIssues, 'specification')}
          >
            <CategoryAttributesSection
              fields={categoryAttributes}
              controlsVersion={fixture.categoryAttributesControlsVersion}
              onFieldChange={updateCategoryAttribute}
              onSave={handleSaveCategoryAttributes}
            />
          </EditorSectionCard>

          <EditorSectionCard
            id="description"
            title="Description"
            severity={sectionSeverity(currentIssues, 'description')}
          >
            <DescriptionSection
              blocks={descriptionBlocks}
              onBlocksChange={(next) => {
                setDescriptionBlocks(next);
                touch();
              }}
              isUnchanged={descriptionIsUnchanged}
              onRevert={() => {
                setDescriptionBlocks(
                  keyDescriptionBlocks(savedDescriptionBlocks),
                );
                setDescriptionMode(savedDescriptionMode);
                touch();
              }}
              productName={productName}
              metaDescription={metaDescription}
              onMetaDescriptionChange={(value) => {
                setMetaDescription(value);
                setMetaDescriptionIsSuggested(false);
                touch();
              }}
              isMetaDescriptionSuggested={metaDescriptionIsSuggested}
              onSaveMetaDescription={handleSaveMetaDescription}
              uploadImage={handleUploadDescriptionImage}
              uploadDisabledReason={
                handleUploadDescriptionImage === undefined
                  ? 'Images can be uploaded once this draft is saved against a real product.'
                  : null
              }
              /*
               * Only a database-backed draft can open the full editor: that
               * screen saves through its own compare-and-set on a real revision,
               * so a fixture preview has nothing for it to write to. Absent
               * rather than disabled — a button that cannot work in this mode is
               * not a feature the seller is missing.
               */
              mode={descriptionMode}
              onModeChange={(next) => {
                setDescriptionMode(next);
                // Stored on the document, so switching is an unsaved change
                // like any other edit in this section.
                touch();
              }}
              onSave={handleSaveDescription}
              fullEditorHref={
                fixture.draftSaveTarget === null
                  ? null
                  : `/listings/${fixture.draftSaveTarget.productId}/description`
              }
            />
          </EditorSectionCard>

          <EditorSectionCard
            id="variants"
            title="Variants & Pricing"
            severity={sectionSeverity(currentIssues, 'variants')}
            meta={
              <span className="text-xs text-muted-foreground">
                {variants.filter((variant) => variant.enabled).length} of{' '}
                {variants.length} will list
              </span>
            }
          >
            {/*
              Naming the Variant Matrix is what makes the variant rows below
              readable, so it renders as a presentational subsection here
              rather than its own `EditorSectionCard` - a card inside a card
              would read as a subsection of pricing, which this is not.
            */}
            <div className="flex flex-col gap-5">
              <VariantOptionMappingSection
                proposal={fixture.optionMapping.proposal}
                mappedAxisNames={fixture.optionMapping.mappedAxisNames}
                suggestedAxisNames={fixture.optionMapping.suggestedAxisNames}
                variantCount={fixture.optionMapping.variantCount}
                mappingBlocksPublish={
                  fixture.optionMapping.mappingBlocksPublish
                }
                unlabelledVariantCount={
                  fixture.optionMapping.unlabelledVariantCount
                }
                onSave={handleOptionMappingSave}
                onRecoverLabels={handleRecoverLabels}
                mappedAxes={fixture.mappedAxes}
                onRename={handleOptionMappingRename}
                valuePhotos={valuePhotos}
                // Same picker the variant table opens, and the same single
                // `UPDATE product_media_sources SET variant_id` behind it.
                // Withheld where that action does not exist, so a chip is
                // never a control that cannot write.
                onPickValuePhoto={
                  assignVariantMediaAction === undefined
                    ? undefined
                    : setImagePickerVariantId
                }
              />

              <VariantPricingTable
                variants={variants}
                expandedVariantId={expandedVariantId}
                onToggleExpanded={(variantId) =>
                  setExpandedVariantId((current) =>
                    current === variantId ? null : variantId,
                  )
                }
                onToggleEnabled={(variantId) => {
                  const target = variants.find((item) => item.id === variantId);

                  if (target === undefined) return;

                  updateVariant(variantId, { enabled: !target.enabled });
                }}
                onRetailChange={(variantId, amountMinor) => {
                  const target = variants.find((item) => item.id === variantId);

                  if (target === undefined) return;

                  updateVariant(variantId, {
                    retailPrice: {
                      amountMinor: retailAmountAboveSupplierCost(
                        amountMinor,
                        target.retailPrice.currency,
                        target.supplierCost,
                      ),
                      currency: target.retailPrice.currency,
                    },
                    attention:
                      amountMinor <= 0 ? 'Retail price required' : null,
                  });
                }}
                onSellerSkuChange={(variantId, value) =>
                  updateVariant(variantId, { sellerSku: value })
                }
                onBulkSetPrice={() => setBulkPricingMode('SET_PRICE')}
                onPickImage={
                  assignVariantMediaAction === undefined
                    ? undefined
                    : setImagePickerVariantId
                }
              />
            </div>
          </EditorSectionCard>

          {marketsSection}

          {/*
            Moved here, and collapsible (owner decision 2026-08-17): this is
            supplier evidence a seller checks occasionally, not something
            edited on every visit, so it no longer sits between Basic
            Information and Description competing for the same attention.
            The upload/delete/cover controls that used to live in a separate
            Media section moved to Basic Information's own "Product media" -
            there is no standalone Media section any more.
          */}
          <EditorSectionCard
            id="specs"
            title="Supplier Details"
            severity={sectionSeverity(currentIssues, 'specs')}
            collapsible
            open={specsOpen}
            onOpenChange={setSpecsOpen}
            meta={
              <span className="text-xs text-muted-foreground">
                {filledSpecificationCount(specifications)} of{' '}
                {specifications.length} attributes filled
              </span>
            }
          >
            <SpecificationsSection
              source={fixture.source}
              supplierProductName={fixture.supplierProductName}
              supplierCategoryPath={fixture.supplierCategoryPath}
              supplierMedia={fixture.supplierMedia}
              // Only when every tile carries a real row id. A product whose
              // supplier photo exists as the feed's bare `imageUrl` has no row
              // to position, and offering a grip there would save nothing.
              onReorderSupplierMedia={
                handleReorderMedia === undefined ||
                !fixture.supplierMedia.every((item) => UUID.test(item.id))
                  ? undefined
                  : (supplierOrder) =>
                      handleReorderMedia(
                        composeGalleryOrder(
                          media.map((item) => item.id),
                          supplierOrder,
                        ),
                      )
              }
              onOpenSourceDrawer={() => setSourceDrawerOpen(true)}
              specifications={specifications}
              onSpecificationChange={(key, value) => {
                // Never called for a locked field — `SpecificationField`
                // only wires `onChange` to a genuinely seller-fillable one
                // (SpecificationsSection.tsx). `source: 'SELLER'` records
                // that this specific value came from the seller, not from
                // re-deriving it as `SUPPLIER` on every keystroke.
                setSpecifications((current) =>
                  current.map((spec) =>
                    spec.key === key
                      ? {
                          ...spec,
                          value,
                          source: 'SELLER',
                          // A filled field is no longer unresolved — leaving
                          // the flag stale kept the "hard blocker until a
                          // value is entered" message under a field that
                          // plainly had one. Clearing the value brings the
                          // message back.
                          unresolved: value.trim() === '',
                        }
                      : spec,
                  ),
                );
                touch();
              }}
            />
          </EditorSectionCard>

          <EditorSectionCard
            id="review"
            title="Review & Publish"
            severity={sectionSeverity(currentIssues, 'review')}
          >
            <ReviewPublishSection
              fixture={currentFixture}
              variants={variants}
              decision={decision}
              onGoToSection={goToSection}
            />
          </EditorSectionCard>
        </div>

        <aside className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-x-hidden overflow-y-auto @min-[76rem]:block">
          {renderPreview(true)}
        </aside>
      </div>

      <EditorActionBar
        decision={decision}
        lifecycle={lifecycle}
        isDirty={isDirty}
        warnings={warnings}
        onSaveDraft={onSaveDraft}
        onPublish={onPublish}
        onExit={onExit}
        canRequestPublication={
          publishAction !== undefined && fixture.publishTarget !== null
        }
      />

      <EditorSheet
        open={readinessOpen}
        onOpenChange={setReadinessOpen}
        title="Listing Readiness"
      >
        {renderReadiness(false)}
      </EditorSheet>

      <EditorSheet
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title="Draft Storefront Preview"
      >
        {renderPreview(false)}
      </EditorSheet>

      <SupplierSourceDrawer
        fixture={fixture}
        open={sourceDrawerOpen}
        onOpenChange={setSourceDrawerOpen}
      />

      <BulkPricingDialog
        mode={bulkPricingMode}
        currency={fixture.source.sourceCurrency}
        affectedCount={bulkAffected.length}
        skippedCount={variants.length - bulkAffected.length}
        minimumRetailPrice={bulkMinimumRetailPrice}
        onCancel={() => setBulkPricingMode(null)}
        onApply={applyBulkPricing}
      />

      <AlertDialog
        open={discardDialogOpen}
        onOpenChange={(open) => {
          // A discard in flight must not be dismissed out from under itself:
          // the write would still land while the screen stopped waiting for it.
          if (!open && !isDiscarding) setDiscardDialogOpen(false);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This listing goes back to the version your storefront is already
              showing, and the edits saved to this draft stop being part of the
              next Publish Update. Buyers see no change — they are on the
              published version now.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDiscarding}>
              Keep the draft
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={isDiscarding}
              onClick={(event) => {
                // The dialog must stay open until the write answers, so the
                // seller is not shown a closed dialog over an unfinished
                // action — closing is `handleDiscardDraft`'s job on success.
                event.preventDefault();
                handleDiscardDraft().catch(() => {
                  // `handleDiscardDraft` already reports every failure it can
                  // describe and always clears its pending flag; this is the
                  // unhandled-rejection guard, not a second error path.
                });
              }}
            >
              {isDiscarding ? 'Discarding…' : 'Discard draft'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={exitDialogOpen} onOpenChange={setExitDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave with unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              This draft has changes that are only in this tab. Leaving now
              discards them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay on this page</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => router.push(EXIT_HREF)}
            >
              Discard and leave
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {imagePickerVariant === null ||
      handleAssignVariantMedia === undefined ? null : (
        <VariantImagePicker
          open
          onOpenChange={(open) => {
            if (!open) setImagePickerVariantId(null);
          }}
          variantLabel={imagePickerVariant.optionLabel}
          variantId={imagePickerVariant.id}
          media={fixture.assignableMedia ?? []}
          currentMediaId={imagePickerVariant.imageMediaId ?? null}
          onAssign={handleAssignVariantMedia}
          onUpload={handleUploadVariantMedia}
        />
      )}

      {published === null ? null : (
        <PublishSuccessDialog
          open
          onOpenChange={(open) => {
            if (!open) setPublished(null);
          }}
          productName={productName}
          slug={published.slug}
          offerCount={published.offerCount}
          catalogueHref={EXIT_HREF}
        />
      )}
    </div>
  );
}
