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
  canBulkEnable,
  filledSpecificationCount,
  issuesOfSeverity,
  publishDecision,
  sectionSeverity,
} from '@/lib/seller-center/product-editor/derive';
import {
  EDITOR_SECTIONS,
  type EditorLifecycle,
  type EditorSectionId,
  type MediaItemFixture,
  type ProductEditorFixture,
  type ReadinessIssue,
  type SpecificationFixture,
  type VariantFixture,
} from '@/lib/seller-center/product-editor/types';
import BasicInformationSection from './BasicInformationSection';
import BulkPricingDialog, { type BulkPricingMode } from './BulkPricingDialog';
import DescriptionSection from './DescriptionSection';
import DraftStorefrontPreview from './DraftStorefrontPreview';
import EditorActionBar from './EditorActionBar';
import EditorSectionCard from './EditorSectionCard';
import EditorSectionNavigation from './EditorSectionNavigation';
import EditorSheet from './EditorSheet';
import EditorStateBanners from './EditorStateBanners';
import ListingReadinessPanel from './ListingReadinessPanel';
import MediaSection from './MediaSection';
import ProductEditorHeader from './ProductEditorHeader';
import ReviewPublishSection from './ReviewPublishSection';
import SpecificationsSection from './SpecificationsSection';
import SupplierSourceDrawer from './SupplierSourceDrawer';
import VariantPricingTable from './VariantPricingTable';

type ProductEditorWorkspaceProps = {
  fixture: ProductEditorFixture;
  /**
   * Server-rendered evidence, passed in as a slot. Markets needs
   * no client state, so rendering it on the server keeps it out of the
   * client bundle while the interactive shell still positions it.
   */
  marketsSection: React.ReactNode;
  /** Server-resolved pricing guidance, same reasoning as `marketsSection`. */
  pricingBasisSection: React.ReactNode;
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
          | 'failed';
      }
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
};

const EXIT_HREF = '/products/pipeline?tab=ready';
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

function descriptionDocumentFromText(description: string) {
  const blocks = description
    .split(/\n{2,}/)
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text) => ({ type: 'paragraph' as const, text }));

  return { version: 1 as const, blocks };
}

/** A bulk price change must never touch a variant policy has ruled out. */
function isBulkPriceable(variant: VariantFixture): boolean {
  return (
    variant.listingState !== 'BLOCKED' && variant.listingState !== 'PAUSED'
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

function sals3CategoryIssue(fixture: ProductEditorFixture): ReadinessIssue {
  return {
    id: `${fixture.fixtureKey}-sals3-category-l1`,
    severity: 'BLOCKER',
    title: 'Sals3 category is required',
    explanation: 'Choose one Sals3 category from the Basic Information list.',
    affectedScope: 'Basic Information',
    source: 'AUTOMATED_VALIDATION',
    section: 'basic',
    reasonCode: null,
    resolution: 'Select a Sals3 category.',
  };
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
  pricingBasisSection,
  initialLifecycle,
  saveDraftAction,
  publishAction,
}: ProductEditorWorkspaceProps) {
  const router = useRouter();

  const [productName, setProductName] = useState(fixture.productName);
  const [sals3CategoryL1, setSals3CategoryL1] = useState(
    fixture.sals3CategoryL1 ?? '',
  );
  const [sellerSku, setSellerSku] = useState(fixture.sellerSku);
  const [brandDeclaration, setBrandDeclaration] = useState(
    fixture.brandDeclaration,
  );
  const [description, setDescription] = useState(fixture.descriptionText);
  const [specifications, setSpecifications] = useState<SpecificationFixture[]>(
    fixture.specifications,
  );
  const [variants, setVariants] = useState<VariantFixture[]>(fixture.variants);
  const [media, setMedia] = useState<MediaItemFixture[]>(fixture.media);

  const [isDirty, setIsDirty] = useState(false);
  const [lifecycle, setLifecycle] = useState<EditorLifecycle>(initialLifecycle);
  const [activeSection, setActiveSection] = useState<EditorSectionId>('basic');
  const [expandedVariantId, setExpandedVariantId] = useState<string | null>(
    null,
  );
  const [readinessOpen, setReadinessOpen] = useState(false);
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
    const hasMissingSals3Category = sals3CategoryL1.trim() === '';
    const withoutLocalIssues = fixture.issues.filter(
      (issue) =>
        issue.title !== 'Selling price is not resolved' &&
        issue.title !== 'Retail price is required' &&
        issue.title !== 'Sals3 category is required',
    );
    const localIssues = [
      ...(hasMissingRetailPrice ? [retailPriceIssue(fixture)] : []),
      ...(hasMissingSals3Category ? [sals3CategoryIssue(fixture)] : []),
    ];

    return [...withoutLocalIssues, ...localIssues];
  }, [fixture, sals3CategoryL1, variants]);

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

  const applyBulkPricing = (value: number) => {
    const affectedIds = new Set(bulkAffected.map((variant) => variant.id));

    setVariants((current) =>
      current.map((variant) => {
        if (!affectedIds.has(variant.id)) return variant;

        return {
          ...variant,
          retailPrice: {
            amountMinor: Math.round(value * 100),
            currency: variant.retailPrice.currency,
          },
          attention:
            Math.round(value * 100) <= 0 ? 'Retail price required' : null,
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
        sals3CategoryL1: sals3CategoryL1 === '' ? null : sals3CategoryL1,
        descriptionDocument: descriptionDocumentFromText(description),
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

  const renderPreview = (showHeading: boolean) => (
    <DraftStorefrontPreview
      productName={productName}
      description={description}
      variants={variants}
      markets={fixture.markets}
      media={media}
      specifications={specifications}
      previewMarketCode={previewMarketCode}
      onPreviewMarketChange={setPreviewMarketCode}
      previewVariantId={previewVariantId}
      onPreviewVariantChange={setPreviewVariantId}
      showHeading={showHeading}
    />
  );

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
              productName={productName}
              onProductNameChange={(value) => {
                setProductName(value);
                touch();
              }}
              sals3CategoryL1={sals3CategoryL1}
              onSals3CategoryL1Change={(value) => {
                setSals3CategoryL1(value);
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
              onOpenSourceDrawer={() => setSourceDrawerOpen(true)}
            />
          </EditorSectionCard>

          <EditorSectionCard
            id="specs"
            title="Category & Specifications"
            severity={sectionSeverity(currentIssues, 'specs')}
            meta={
              <span className="text-xs text-muted-foreground">
                {filledSpecificationCount(specifications)} of{' '}
                {specifications.length} attributes filled
              </span>
            }
          >
            <SpecificationsSection
              specifications={specifications}
              onSpecificationChange={(key, value) => {
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
            id="description"
            title="Description"
            severity={sectionSeverity(currentIssues, 'description')}
          >
            <DescriptionSection
              description={description}
              supplierDescription={fixture.descriptionText}
              onDescriptionChange={(value) => {
                setDescription(value);
                touch();
              }}
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
            {pricingBasisSection}
            <VariantPricingTable
              variants={variants}
              expandedVariantId={expandedVariantId}
              evidenceCapturedAt={fixture.lastValidatedAt}
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
                    amountMinor,
                    currency: target.retailPrice.currency,
                  },
                  attention: amountMinor <= 0 ? 'Retail price required' : null,
                });
              }}
              onSellerSkuChange={(variantId, value) =>
                updateVariant(variantId, { sellerSku: value })
              }
              onBulkSetPrice={() => setBulkPricingMode('SET_PRICE')}
              onBulkEnableInStock={() => {
                setVariants((current) =>
                  current.map((variant) =>
                    canBulkEnable(variant)
                      ? { ...variant, enabled: true }
                      : variant,
                  ),
                );
                touch();
                toast('Blocked and paused variants were skipped.', {
                  description:
                    'A bulk action never re-enables a variant the supplier or policy has ruled out.',
                });
              }}
              onBulkDisableUnavailable={() => {
                setVariants((current) =>
                  current.map((variant) =>
                    variant.supplierStock === 0
                      ? { ...variant, enabled: false }
                      : variant,
                  ),
                );
                touch();
              }}
            />
          </EditorSectionCard>

          {marketsSection}

          <EditorSectionCard
            id="media"
            title="Media"
            severity={sectionSeverity(currentIssues, 'media')}
            meta={
              <span className="text-xs text-muted-foreground">
                {media.length} images · 0 videos
              </span>
            }
          >
            <MediaSection
              media={media}
              onMakeCover={(id) => {
                setMedia((current) =>
                  current.map((item) => ({
                    ...item,
                    isCover: item.id === id,
                  })),
                );
                touch();
              }}
              onMove={(id, direction) => {
                setMedia((current) => {
                  const index = current.findIndex((item) => item.id === id);
                  const target = index + direction;

                  if (index < 0 || target < 0 || target >= current.length) {
                    return current;
                  }

                  const next = [...current];

                  [next[index], next[target]] = [next[target], next[index]];

                  return next;
                });
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
