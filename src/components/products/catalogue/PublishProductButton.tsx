'use client';

import { useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  publishProductAction,
  unpublishProductAction,
  type PublishActionFailureReason,
} from '@/app/(portal)/listings/publish-actions';

type PublishProductButtonProps = {
  productId: string;
  /** `products.version` — the compare-and-set token this screen read. */
  productVersion: number;
  /** Live products get the pause control instead. */
  isLive: boolean;
};

/**
 * Every refusal names the missing fact, because "publish failed" gives an
 * operator nowhere to go. These are stable codes from the domain module, not
 * database messages.
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
  CATEGORY_UNMAPPED:
    'No CJ category is on record for this product, so it cannot be categorised or priced.',
  NO_APPROVED_MEDIA: 'No approved product image is on file yet.',
  PRICING_UNRESOLVED: 'A price could not be resolved.',
  RETAIL_BELOW_SUPPLIER_COST:
    'A retail price is below what the supplier charges. Raise it to at least the supplier cost before publishing.',
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

export default function PublishProductButton({
  productId,
  productVersion,
  isLive,
}: PublishProductButtonProps) {
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant={isLive ? 'outline' : 'default'}
      size="sm"
      disabled={isPending}
      onClick={() => {
        startTransition(async () => {
          const payload = {
            productId,
            expectedProductVersion: productVersion,
          };

          if (isLive) {
            const result = await unpublishProductAction(payload);

            toast(
              result.ok
                ? 'Product paused. It is no longer on the storefront.'
                : FAILURE_MESSAGES[result.reason],
            );

            return;
          }

          const result = await publishProductAction(payload);

          if (result.ok) {
            toast(
              `Published at /p/${result.slug} with ${result.offerCount} offer(s).`,
            );
            return;
          }

          const detail =
            result.detail === undefined
              ? undefined
              : PRICING_DETAIL_MESSAGES[result.detail];

          toast(
            detail === undefined
              ? FAILURE_MESSAGES[result.reason]
              : `${FAILURE_MESSAGES[result.reason]} Reason: ${detail}.`,
          );
        });
      }}
    >
      {/* eslint-disable-next-line no-nested-ternary -- three states, one label. */}
      {isPending
        ? 'Working…'
        : isLive
          ? 'Pause listing'
          : 'Publish to storefront'}
    </Button>
  );
}
