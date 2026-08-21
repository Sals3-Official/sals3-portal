import type { PublishActionFailureReason } from '@/app/(portal)/listings/publish-actions';

/**
 * Seller-facing words for every way publishing a listing can be refused.
 *
 * Every refusal names the missing fact, because "publish failed" gives an
 * operator nowhere to go. These are stable codes from the domain module, not
 * database messages. Kept out of the component so the copy is one import for
 * any surface that offers the action, and so it stays plain data — the row's
 * action menu is the only caller today.
 */
const FAILURE_MESSAGES: Record<PublishActionFailureReason, string> = {
  invalid_input: 'That product reference was not in an expected format.',
  denied: 'Your role cannot publish products.',
  rate_limited: 'Too many publish requests. Wait a moment and try again.',
  not_configured: 'No database is configured in this environment.',
  not_found: 'That product is no longer in your catalogue.',
  version_conflict:
    'This product changed while you were looking at it. Reload and try again.',
  failed: 'Publishing failed. Try again in a moment.',
  NO_ACTIVE_VARIANT:
    'No active variant yet. Fetch supplier evidence for this product first.',
  SALS3_CATEGORY_REQUIRED:
    'Choose a Sals3 category for this product before publishing. The supplier’s own category is only a draft placeholder.',
  OPTIONS_UNMAPPED:
    'Name this product’s Variant Matrix in Variants & Pricing before publishing.',
  NO_APPROVED_MEDIA: 'No approved product image is on file yet.',
  PRICING_UNRESOLVED: 'A price could not be resolved.',
  RETAIL_BELOW_SUPPLIER_COST:
    'A retail price is below the required supplier-cost floor. Raise it to at least 2.5% above supplier cost before publishing.',
  NO_ACTIVE_MARKET_PROFILE:
    'Activate a market profile in Market Rules before publishing.',
  CURRENCY_NOT_AUTHORIZED:
    'That destination has no authorized selling currency.',
  NO_SUPPLIER_COST:
    'No supplier cost has been observed, so no price can be resolved.',
  NO_ACTIVE_SUPPLIER_BINDING:
    'No active supplier binding, so an order could not be fulfilled.',
  NO_PUBLISHABLE_REVISION: 'This product has no draft or approved revision.',
  SLUG_UNAVAILABLE: 'Every candidate web address for this title is taken.',
};

/** The resolver's own reasons, so "a price could not be resolved" says why. */
const PRICING_DETAIL_MESSAGES: Record<string, string> = {
  CATEGORY_NOT_FOUND: 'the category is not in the Sals3 taxonomy',
  CATEGORY_MAPPING_REQUIRES_REVIEW: 'the category mapping needs review',
  CATEGORY_POLICY_REQUIRED: 'this category has no margin policy yet',
  SUPPLIER_COST_UNAVAILABLE: 'no supplier cost has been observed',
  REFERENCE_FX_UNAVAILABLE: 'no reference exchange rate is available',
  FUNDING_BUFFER_REQUIRED: 'no funding buffer policy is set',
  FUNDING_BUFFER_EXPIRED: 'the funding buffer policy has expired',
  INVALID_MARGIN_RATE: 'the margin rate on the policy is invalid',
};

/**
 * One sentence for a refusal, with the resolver's reason appended when it
 * supplied one. An unrecognised `detail` is dropped rather than shown raw —
 * it is a domain code, not seller-facing copy.
 */
export default function describePublishFailure(
  reason: PublishActionFailureReason,
  detail?: string,
): string {
  const because =
    detail === undefined ? undefined : PRICING_DETAIL_MESSAGES[detail];

  return because === undefined
    ? FAILURE_MESSAGES[reason]
    : `${FAILURE_MESSAGES[reason]} Reason: ${because}.`;
}
