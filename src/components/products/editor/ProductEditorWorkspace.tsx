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
import { PUBLISH_GATES } from '@/lib/products/publish-gates';
import predictPublishBlockers from '@/lib/seller-center/product-editor/publish-blockers';
import {
  initialDescriptionMode,
  type DescriptionMode,
} from '@/lib/products/simple-description';
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
import ReviewPublishSection from './ReviewPublishSection';
import SpecificationsSection from './SpecificationsSection';
import SupplierSourceDrawer from './SupplierSourceDrawer';
import VariantOptionMappingSection from './VariantOptionMappingSection';
import VariantPricingTable from './VariantPricingTable';

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
    | { ok: true; revisionVersion: number }
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
          | 'image_not_stored'
          | 'failed';
      }
  >;
  /**
   * The narrow description save, so its own section can save without committing
   * a retail price the seller was still deciding on.
   */
  saveDescriptionAction?: (
    input: unknown,
  ) => Promise<
    | { ok: true; revisionVersion: number; contentChecksum: string }
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
  /** Seller-photo delete boundary. Omitted for fixture/design-preview mode. */
  deleteMediaAction?: (
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
  saveDescriptionAction,
  publishAction,
  optionMappingAction,
  recoverLabelsAction,
  sals3CategoryOptions = [],
  decideCategoryAction,
  uploadMediaAction,
  deleteMediaAction,
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

  if (fixture.sals3CategoryCode !== prevCategoryCode) {
    setPrevCategoryCode(fixture.sals3CategoryCode);
    setCategoryAttributes(fixture.categoryAttributes);
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
  const [bulkPricingMode, setBulkPricingMode] =
    useState<BulkPricingMode | null>(null);
  const [previewMarketCode, setPreviewMarketCode] = useState(
    fixture.markets[0]?.code ?? '',
  );
  const [previewVariantId, setPreviewVariantId] = useState(
    fixture.variants[0]?.id ?? '',
  );
  const [draftRevisionVersion, setDraftRevisionVersion] = useState(
    fixture.draftSaveTarget?.expectedRevisionVersion ?? null,
  );

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

  const onSaveDraft = async () => {
    setLifecycle('SAVING');

    if (
      saveDraftAction !== undefined &&
      fixture.draftSaveTarget !== null &&
      draftRevisionVersion !== null
    ) {
      const result = await saveDraftAction({
        productId: fixture.draftSaveTarget.productId,
        revisionId: fixture.draftSaveTarget.revisionId,
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
          .filter((variant) => UUID_PATTERN.test(variant.id))
          .map((variant) => ({
            variantId: variant.id,
            amountMinor: variant.retailPrice.amountMinor,
            currency: variant.retailPrice.currency,
          })),
      });

      if (result.ok) {
        setDraftRevisionVersion(result.revisionVersion);
        setSavedDescriptionBlocks(
          descriptionBlocks.map((entry) => entry.block),
        );
        setSavedDescriptionMode(descriptionMode);
        setLifecycle('SAVED');
        setIsDirty(false);
        toast('Draft saved.');

        return;
      }

      setLifecycle('SAVE_FAILED');
      toast('Draft save failed.', {
        description:
          result.reason === 'version_conflict'
            ? 'This draft changed elsewhere. Refresh before saving again.'
            : 'No database change was made.',
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

    if (publishAction !== undefined && fixture.publishTarget !== null) {
      const result = await publishAction({
        productId: fixture.publishTarget.productId,
        expectedProductVersion: fixture.publishTarget.expectedProductVersion,
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
        router.refresh();
        toast('Product published to storefront.', {
          description: `/p/${result.slug} · ${result.offerCount} offer${result.offerCount === 1 ? '' : 's'}`,
        });

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

  // What the storefront will actually render: the seller's own uploads,
  // plus the supplier's original photos unless the seller has explicitly
  // turned that off (Basic Information's "Show supplier photo" switch).
  // Never either/or - a seller upload must not silently hide the
  // supplier's photo; only the toggle should. And the toggle only starts
  // hiding once a seller photo exists to show instead - the storefront read
  // model falls back to the supplier photo for an empty gallery, so the
  // preview must too rather than showing a blank the buyer would never see.
  const effectivePreviewMedia =
    showSupplierPhoto || media.length === 0
      ? [...media, ...fixture.supplierMedia]
      : media;

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
    draftRevisionVersion === null
      ? undefined
      : async () => {
          const target = fixture.draftSaveTarget;

          if (target === null) return { ok: false, message: 'No open draft.' };

          const result = await saveDescriptionAction({
            productId: target.productId,
            revisionId: target.revisionId,
            expectedRevisionVersion: draftRevisionVersion,
            descriptionDocument: descriptionDocumentFrom(
              descriptionBlocks,
              descriptionMode,
            ),
          });

          if (!result.ok) return { ok: false, message: result.message };

          setDraftRevisionVersion(result.revisionVersion);
          setSavedDescriptionBlocks(
            descriptionBlocks.map((entry) => entry.block),
          );
          setSavedDescriptionMode(descriptionMode);
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
    saveCategoryAttributesAction === undefined || optionMappingTarget === null
      ? undefined
      : async () => {
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
            productId: optionMappingTarget.productId,
            expectedProductVersion: optionMappingTarget.expectedProductVersion,
            attributes,
          });

          if (result.ok) router.refresh();

          return result.ok
            ? { ok: true }
            : { ok: false, message: result.message };
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

  const handleUploadMedia =
    uploadMediaAction === undefined || optionMappingTarget === null
      ? undefined
      : async (files: FileList) => {
          setIsUploadingMedia(true);

          try {
            // eslint-disable-next-line no-restricted-syntax -- sequential: each upload is its own request and DB write against the same product row.
            for (const file of Array.from(files)) {
              const formData = new FormData();

              formData.set('productId', optionMappingTarget.productId);
              formData.set('file', file);

              // eslint-disable-next-line no-await-in-loop
              const result = await uploadMediaAction(formData);

              if (!result.ok) {
                toast.error(result.message);
                // eslint-disable-next-line no-continue
                continue;
              }

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
              onMakeCoverPhoto={(id) => {
                setMedia((current) =>
                  current.map((item) => ({
                    ...item,
                    isCover: item.id === id,
                  })),
                );
                touch();
              }}
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
    </div>
  );
}
