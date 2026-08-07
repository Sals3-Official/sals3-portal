import { PERMANENT_REASON_CODES } from '@/modules/catalog/candidates/rules/contracts';
import type {
  EditorLifecycle,
  EditorSectionId,
  IssueSeverity,
  MarketEvidenceFixture,
  MoneyValue,
  ProductEditorFixture,
  ReadinessIssue,
  SpecificationFixture,
  VariantFixture,
} from './types';

/**
 * Every number the Product Editor shows that is not stored verbatim.
 *
 * The single rule this module exists to enforce: an unknown value stays
 * `null` all the way to the component, which renders it as words. Missing
 * freight must never become a `0` that silently flows into landed cost and
 * margin and makes an unshippable product look profitable.
 */

/**
 * Placeholder margin floor for interface review. Not an approved business
 * rule - `src/modules/catalog/candidates/rules/policy.ts` holds the real
 * thresholds, and none of them is a per-variant retail margin yet.
 */
export const MARGIN_FLOOR_PERCENT = 35;

/**
 * Supplier cost plus current freight estimate. `null` when there is no
 * route evidence, and also when the two values are denominated in
 * different currencies - there is no approved FX source for this screen,
 * so adding them would fabricate a number.
 */
export function landedCost(variant: VariantFixture): MoneyValue | null {
  const freight = variant.freightEstimate;

  if (freight === null) return null;
  if (freight.currency !== variant.supplierCost.currency) return null;

  return {
    amountMinor: variant.supplierCost.amountMinor + freight.amountMinor,
    currency: variant.supplierCost.currency,
  };
}

/**
 * `(retail − supplier cost − current freight estimate) ÷ retail`, as a
 * percentage. Excludes payment fees, taxes, returns, and any market fee -
 * none of which are configured. Provisional until checkout revalidation.
 */
export function marginPercent(variant: VariantFixture): number | null {
  const landed = landedCost(variant);

  if (landed === null) return null;
  if (landed.currency !== variant.retailPrice.currency) return null;
  if (variant.retailPrice.amountMinor <= 0) return null;

  const retail = variant.retailPrice.amountMinor;

  return ((retail - landed.amountMinor) / retail) * 100;
}

export function enabledVariants(variants: VariantFixture[]): VariantFixture[] {
  return variants.filter((variant) => variant.enabled);
}

/**
 * Only variants that will actually be listed are counted. A variant that
 * is switched off cannot earn a thin margin, and counting it would make
 * the readiness warning disagree with the table the seller is looking at.
 */
export function variantsBelowMarginFloor(
  variants: VariantFixture[],
): VariantFixture[] {
  return enabledVariants(variants).filter((variant) => {
    const margin = marginPercent(variant);

    return margin !== null && margin < MARGIN_FLOOR_PERCENT;
  });
}

/**
 * Whether a bulk "enable in-stock variants" action may touch this variant.
 *
 * `BLOCKED` and `PAUSED` are policy or supplier facts, not seller
 * preferences, so no bulk action may quietly switch them back on. This is
 * a rule rather than a UI detail, which is why it lives here and is
 * tested - a bulk action that re-enabled a blocked variant would publish
 * something the pipeline had already ruled out.
 */
export function canBulkEnable(variant: VariantFixture): boolean {
  return (
    variant.supplierStock > 0 &&
    variant.listingState !== 'BLOCKED' &&
    variant.listingState !== 'PAUSED'
  );
}

/**
 * Retail spread across the variants that will actually be listed. `null`
 * when nothing will list, or when the enabled variants do not share one
 * currency - a "$8 – ¥1,200" range would be meaningless.
 */
export function retailRange(
  variants: VariantFixture[],
): { min: MoneyValue; max: MoneyValue } | null {
  const listed = enabledVariants(variants);

  if (listed.length === 0) return null;

  const { currency } = listed[0].retailPrice;

  if (listed.some((variant) => variant.retailPrice.currency !== currency)) {
    return null;
  }

  const amounts = listed.map((variant) => variant.retailPrice.amountMinor);

  return {
    min: { amountMinor: Math.min(...amounts), currency },
    max: { amountMinor: Math.max(...amounts), currency },
  };
}

export function marginRange(
  variants: VariantFixture[],
): { min: number; max: number } | null {
  const margins = enabledVariants(variants)
    .map((variant) => marginPercent(variant))
    .filter((margin): margin is number => margin !== null);

  if (margins.length === 0) return null;

  return { min: Math.min(...margins), max: Math.max(...margins) };
}

export function issuesOfSeverity(
  issues: ReadinessIssue[],
  severity: IssueSeverity,
): ReadinessIssue[] {
  return issues.filter((issue) => issue.severity === severity);
}

/**
 * Worst severity present in one section, for the section-nav indicator and
 * the section card's own badge. Returning the same value both places is
 * what keeps the readiness panel and the sections from disagreeing.
 */
export function sectionSeverity(
  issues: ReadinessIssue[],
  section: EditorSectionId,
): IssueSeverity | null {
  const inSection = issues.filter((issue) => issue.section === section);

  if (inSection.some((issue) => issue.severity === 'BLOCKER')) return 'BLOCKER';
  if (inSection.some((issue) => issue.severity === 'WARNING')) return 'WARNING';

  return null;
}

export function isPermanentIssue(issue: ReadinessIssue): boolean {
  return (
    issue.reasonCode !== null &&
    PERMANENT_REASON_CODES.includes(issue.reasonCode)
  );
}

/**
 * The rule that keeps a genuinely required attribute from being dressed up
 * as a publishable warning. Fixtures state their issues explicitly; this
 * function is what the tests hold them to.
 */
export function severityForUnresolvedSpecification(
  requirement: SpecificationFixture['requirement'],
): IssueSeverity {
  if (requirement === 'REQUIRED') return 'BLOCKER';

  return requirement === 'RECOMMENDED' ? 'WARNING' : 'SUGGESTION';
}

export function filledSpecificationCount(
  specifications: SpecificationFixture[],
): number {
  return specifications.filter((spec) => spec.value !== '').length;
}

/** Markets that still have usable route evidence, of those the seller enabled. */
export function marketsWithRoute(
  markets: MarketEvidenceFixture[],
): MarketEvidenceFixture[] {
  return markets.filter((market) => market.freightEstimate !== null);
}

export function publishableMediaCount(
  media: ProductEditorFixture['media'],
): number {
  return media.filter((item) => item.rightsCheck !== 'REJECTED').length;
}

export type PublishDecision = {
  /** `false` never means "quietly greyed out" - `blockedReason` says why. */
  canPublish: boolean;
  label: string;
  saveLabel: string;
  blockedReason: string | null;
  blockerCount: number;
  warningCount: number;
  suggestionCount: number;
};

function lifecycleBlockReason(lifecycle: EditorLifecycle): string | null {
  if (lifecycle === 'CONNECTION_UNAVAILABLE') {
    return 'Supplier connection unavailable - validation cannot run';
  }

  if (lifecycle === 'VALIDATION_FAILED') {
    return 'Validation could not complete - run it again before publishing';
  }

  if (lifecycle === 'SESSION_EXPIRED') {
    return 'Session expired - sign in again to publish';
  }

  return null;
}

/**
 * The single source of the publish button's label, its enabled state, and
 * the reason printed beside it. The action bar, the review section and the
 * confirmation dialog all read this one function so they cannot drift into
 * saying different things about the same product.
 */
export function publishDecision(
  fixture: ProductEditorFixture,
  lifecycle: EditorLifecycle = 'IDLE',
): PublishDecision {
  const blockerCount = issuesOfSeverity(fixture.issues, 'BLOCKER').length;
  const warningCount = issuesOfSeverity(fixture.issues, 'WARNING').length;
  const suggestionCount = issuesOfSeverity(fixture.issues, 'SUGGESTION').length;
  const isPublished = fixture.listingState !== 'DRAFT';

  const publishLabel = () => {
    if (isPublished) return 'Publish Update';

    return warningCount > 0 && blockerCount === 0
      ? 'Publish with Attention'
      : 'Publish Product';
  };

  const blockedReason = () => {
    if (blockerCount > 0) {
      const plural = blockerCount === 1 ? 'blocker' : 'blockers';

      return `${blockerCount} hard ${plural} must clear first`;
    }

    return lifecycleBlockReason(lifecycle);
  };

  const reason = blockedReason();

  return {
    canPublish: reason === null,
    label: publishLabel(),
    saveLabel: isPublished ? 'Save New Draft' : 'Save Draft',
    blockedReason: reason,
    blockerCount,
    warningCount,
    suggestionCount,
  };
}
