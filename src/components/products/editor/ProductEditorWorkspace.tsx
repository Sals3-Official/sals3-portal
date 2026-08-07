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
  landedCost,
  publishDecision,
  sectionSeverity,
} from '@/lib/seller-center/product-editor/derive';
import {
  EDITOR_SECTIONS,
  type EditorLifecycle,
  type EditorSectionId,
  type MediaItemFixture,
  type ProductEditorFixture,
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
   * Server-rendered evidence, passed in as a slot. Markets & Shipping needs
   * no client state, so rendering it on the server keeps it out of the
   * client bundle while the interactive shell still positions it.
   */
  marketsSection: React.ReactNode;
  /** Entry state from `?state=`. Development only - see `query.ts`. */
  initialLifecycle: EditorLifecycle;
};

const EXIT_HREF = '/products/qualified/ready';

/** A bulk price change must never touch a variant policy has ruled out. */
function isBulkPriceable(variant: VariantFixture): boolean {
  return (
    variant.listingState !== 'BLOCKED' && variant.listingState !== 'PAUSED'
  );
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
}: ProductEditorWorkspaceProps) {
  const router = useRouter();

  const [productName, setProductName] = useState(fixture.productName);
  const [sals3Category, setSals3Category] = useState(fixture.sals3CategoryPath);
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

  const decision = useMemo(
    () => publishDecision(fixture, lifecycle),
    [fixture, lifecycle],
  );
  const warnings = useMemo(
    () => issuesOfSeverity(fixture.issues, 'WARNING'),
    [fixture.issues],
  );

  const bulkPriceable = useMemo(
    () => variants.filter(isBulkPriceable),
    [variants],
  );
  const bulkAffected = useMemo(() => {
    if (bulkPricingMode === 'APPLY_MARKUP') {
      return bulkPriceable.filter((variant) => landedCost(variant) !== null);
    }

    return bulkPriceable;
  }, [bulkPricingMode, bulkPriceable]);

  const applyBulkPricing = (value: number) => {
    const affectedIds = new Set(bulkAffected.map((variant) => variant.id));

    setVariants((current) =>
      current.map((variant) => {
        if (!affectedIds.has(variant.id)) return variant;

        if (bulkPricingMode === 'SET_PRICE') {
          return {
            ...variant,
            retailPrice: {
              amountMinor: Math.round(value * 100),
              currency: variant.retailPrice.currency,
            },
          };
        }

        const landed = landedCost(variant);

        if (landed === null) return variant;

        return {
          ...variant,
          retailPrice: {
            amountMinor: Math.round(landed.amountMinor * (1 + value / 100)),
            currency: variant.retailPrice.currency,
          },
        };
      }),
    );

    const skipped = variants.length - affectedIds.size;

    setBulkPricingMode(null);
    touch();

    if (skipped > 0) {
      toast(`${skipped} variant${skipped === 1 ? '' : 's'} were skipped.`, {
        description:
          'A bulk price change never touches a blocked or paused variant, or one with no route evidence to price from.',
      });
    }
  };

  const onSaveDraft = () => {
    setLifecycle('SAVING');
    timerRef.current = setTimeout(() => {
      setLifecycle('SAVED');
      setIsDirty(false);
    }, 500);
  };

  const onPublish = () => {
    setLifecycle('VALIDATING');
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
      fixture={fixture}
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
        fixture={fixture}
        productName={productName}
        isDirty={isDirty}
        onOpenReadiness={() => setReadinessOpen(true)}
        onOpenPreview={() => setPreviewOpen(true)}
        onOpenSourceDrawer={() => setSourceDrawerOpen(true)}
      />

      <EditorStateBanners
        banner={fixture.banner}
        lifecycle={lifecycle}
        onRetry={() => setLifecycle('IDLE')}
      />

      {/* 76rem is the point at which 240px + 288px of side panels still
          leave the centre editor a usable ~780px. Below it the panels move
          into drawers instead of squeezing the column the seller is
          actually typing in. */}
      <div className="grid grid-cols-1 items-start gap-4 @min-[76rem]:grid-cols-[15rem_minmax(0,1fr)_18rem]">
        <aside className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto @min-[76rem]:block">
          {renderReadiness(true)}
        </aside>

        <div className="@container flex min-w-0 flex-col gap-4">
          <EditorSectionNavigation
            issues={fixture.issues}
            activeSection={activeSection}
            onGoToSection={goToSection}
          />

          <EditorSectionCard
            id="basic"
            title="Basic Information"
            severity={sectionSeverity(fixture.issues, 'basic')}
          >
            <BasicInformationSection
              fixture={fixture}
              productName={productName}
              onProductNameChange={(value) => {
                setProductName(value);
                touch();
              }}
              sals3Category={sals3Category}
              onSals3CategoryChange={(value) => {
                setSals3Category(value);
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
            severity={sectionSeverity(fixture.issues, 'specs')}
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
                      ? { ...spec, value, source: 'SELLER' }
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
            severity={sectionSeverity(fixture.issues, 'description')}
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
            severity={sectionSeverity(fixture.issues, 'variants')}
            meta={
              <span className="text-xs text-muted-foreground">
                {variants.filter((variant) => variant.enabled).length} of{' '}
                {variants.length} will list
              </span>
            }
          >
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
                });
              }}
              onSellerSkuChange={(variantId, value) =>
                updateVariant(variantId, { sellerSku: value })
              }
              onBulkSetPrice={() => setBulkPricingMode('SET_PRICE')}
              onBulkApplyMarkup={() => setBulkPricingMode('APPLY_MARKUP')}
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
            severity={sectionSeverity(fixture.issues, 'media')}
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
            severity={sectionSeverity(fixture.issues, 'review')}
          >
            <ReviewPublishSection
              fixture={fixture}
              variants={variants}
              decision={decision}
              onGoToSection={goToSection}
            />
          </EditorSectionCard>
        </div>

        <aside className="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto @min-[76rem]:block">
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
