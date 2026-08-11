import type {
  SellerMarketProfileRow,
  SellerMarketProfileStatus,
} from '@/lib/db/schema';
import type { MarketDestinationCapability } from '@/modules/market-config/capabilities';

/**
 * Pure view-model helpers for the Market Rules profile section.
 *
 * Kept out of the components so the wording of each lifecycle state — the
 * part most likely to over-promise — is directly testable. Every label here
 * is deliberately conservative: an `ACTIVE` profile is described as set up
 * for a bounded pilot with outstanding capabilities, never as a launched or
 * fully configured market.
 */

export type ProfileStatusTone = 'neutral' | 'progress' | 'positive' | 'warning';

export type ProfileStatusDescription = {
  label: string;
  tone: ProfileStatusTone;
  detail: string;
};

export function describeProfileStatus(
  status: SellerMarketProfileStatus,
  pendingCapabilityCount: number,
): ProfileStatusDescription {
  if (status === 'DRAFT') {
    return {
      label: 'Pending setup',
      tone: 'progress',
      detail:
        'This destination has been started but is not active. Activate it to record that this account is configured for it.',
    };
  }

  if (status === 'SUSPENDED') {
    return {
      label: 'Suspended',
      tone: 'warning',
      detail:
        'This destination is not in use. You can set it up again from the approved list.',
    };
  }

  if (pendingCapabilityCount > 0) {
    return {
      label: 'Active — pilot, capabilities incomplete',
      tone: 'progress',
      detail:
        'This account is set up for the destination, but the operational capabilities below are not yet in place. It is not a launched market.',
    };
  }

  return {
    label: 'Active',
    tone: 'positive',
    detail: 'This account is set up for this destination.',
  };
}

export const CAPABILITY_LABELS: Record<string, string> = {
  PAYMENTS: 'Payments',
  LOGISTICS: 'Logistics & freight',
  TAX: 'Tax treatment',
  PAYOUT: 'Payouts',
};

export function capabilityLabel(capability: string): string {
  return CAPABILITY_LABELS[capability] ?? capability;
}

/**
 * Destinations the seller may still begin setting up: authorized by the
 * capability boundary and not already held as a `DRAFT` or `ACTIVE` profile.
 * A `SUSPENDED` destination becomes available again, matching the partial
 * unique index that only reserves live rows.
 */
export function listSetupCandidates(
  profiles: readonly SellerMarketProfileRow[],
  destinations: readonly MarketDestinationCapability[],
): MarketDestinationCapability[] {
  const live = new Set(
    profiles
      .filter(
        (profile) => profile.status === 'DRAFT' || profile.status === 'ACTIVE',
      )
      .map((profile) => profile.destinationCountryCode),
  );

  return destinations.filter(
    (destination) => !live.has(destination.destinationCountryCode),
  );
}

/** `null` when the platform has authorized no currency — never a guess. */
export function describeSellingCurrency(
  profile: Pick<SellerMarketProfileRow, 'sellingCurrencyCode'>,
): string | null {
  return profile.sellingCurrencyCode;
}
