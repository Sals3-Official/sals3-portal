import { Suspense } from 'react';
import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import MarketRolesExplainerPanel from '@/components/seller-center/market-rules/MarketRolesExplainerPanel';
import CategoryPricingSection from '@/components/seller-center/market-rules/pricing/CategoryPricingSection';
import FundingBufferSection from '@/components/seller-center/market-rules/pricing/FundingBufferSection';
import PricingSectionFallback from '@/components/seller-center/market-rules/pricing/PricingSectionFallback';
import StoreDefaultSection from '@/components/seller-center/market-rules/pricing/StoreDefaultSection';
import { can } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { listPricingScopes } from '@/modules/pricing/pricing-scope-destinations';

export const metadata: Metadata = { title: 'Market rules · Seller Center' };

/**
 * The commercial rules this account applies — all resolved for
 * `session.sellerId`, never for a market chosen by an env var or a route
 * param.
 *
 * ## Market setup is deliberately not here (owner decision 2026-08-20)
 *
 * `MarketProfileSection` and its policy-context panel used to open this page.
 * Bogs removed them: a different business model is coming for destination
 * setup, and ADR-014 puts market governance in the Admin Portal rather than
 * inside a tenant screen. The components stay in the tree, unmounted, rather
 * than deleted — the decision is that this was the wrong *place* for them,
 * not that the work was wrong.
 *
 * **Consequence, and what became of it.** This page was the only surface that
 * could create a `seller_market_profiles` row, so since 2026-08-20 no seller has
 * had one. `seller_market_profiles` is untouched — the data and every backend
 * reader still work; only the way in is gone.
 *
 * This comment used to say `publishProduct` "still refuses
 * `NO_ACTIVE_MARKET_PROFILE` when a seller has no destination", and that was
 * already wrong when it was written: `publish.ts` fell back to the platform
 * capability list and published fine. What actually broke was quieter —
 * `create-draft.ts` demanded a profile before creating **any** offer, so every
 * draft was born with zero `product_offers` rows, and `updateSellerRetailPrices`
 * is UPDATE-only. Save Draft matched nothing, threw, and rolled the whole save
 * back: price, specifications and description together. Twenty-five drafts were
 * in that state before `resolveOfferDestinations` made both paths agree
 * (2026-08-28).
 *
 * ## Store default pricing is also unmounted (owner decision 2026-08-20)
 *
 * "Pang gulo lang" — per-category margin is enough for now. The card is
 * unmounted rather than deleted, and the resolver's store-default layer is
 * left in place unread: the seller had already deactivated their own row, so
 * nothing is silently pricing behind the removed screen. Re-mounting one
 * component brings it back if the decision changes.
 *
 * ## What is left, and why the gates differ
 *
 * The roles panel, then pricing (ADR-015 Phase 1). Pricing is gated by
 * `pricing_policy:read` independently of `market_rules:read` — staff and
 * viewer hold the latter but not the former. Having a pricing rule never
 * means a market is active, and vice versa.
 */
export default async function MarketRulesPage() {
  const session = await requirePermission('market_rules:read');
  /**
   * Pricing scope, not the buyer allowlist — owner decision 2026-08-25.
   *
   * `resolveSellerMarketCapabilities()` answers "where may a buyer order
   * from", and widening it requeues every decided candidate because its policy
   * version composes into `candidate_evaluations.policy_version`. Setting a
   * margin costs nothing and prices nothing until a destination is separately
   * approved, so the two lists are deliberately different. See
   * `pricing-scope-destinations.ts`.
   *
   * Scopes rather than destinations since 2026-08-27: the six measured
   * destinations plus Global, which prices every country without a column of
   * its own. Global carries `marketCode: null`, which is what the reads and the
   * writes use; `key` is what the columns and the lookups use.
   */
  const scopes = listPricingScopes();

  const canReadPricing = can(session.role, 'pricing_policy:read');
  const canManagePricing = can(session.role, 'pricing_policy:manage');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Market rules"
        description="What this account is set up to sell, and the commercial rules it applies"
      />
      <MarketRolesExplainerPanel />
      {canReadPricing ? (
        <>
          {/*
            A boundary per section, so one slow read cannot hold the others.

            These were awaited together in a single route render, with the
            category tree — a full taxonomy scan plus a store-default read per
            destination — first in the list. Every save on this page, including
            a one-line funding-buffer change, waited behind that scan before
            anything on screen moved. The write had already committed; the page
            simply could not say so yet, which reads as a failed save and
            invites a manual reload.
          */}
          {/*
            Ahead of the category tree, because it is the layer beneath it: a
            category with no margin of its own falls back to this, and until
            2026-08-26 this section existed but was rendered by no page at all —
            so the floor the resolver already applied could not be set from
            anywhere.
          */}
          <Suspense
            fallback={
              <PricingSectionFallback
                label="Store default pricing"
                rows={scopes.length}
              />
            }
          >
            <StoreDefaultSection
              scopes={scopes}
              sellerAccountId={session.sellerId}
              canManage={canManagePricing}
            />
          </Suspense>
          <Suspense
            fallback={
              <PricingSectionFallback label="Category margins" rows={6} />
            }
          >
            <CategoryPricingSection
              scopes={scopes}
              sellerAccountId={session.sellerId}
              canManage={canManagePricing}
            />
          </Suspense>
          <Suspense
            fallback={
              <PricingSectionFallback label="Funding buffer" rows={1} />
            }
          >
            <FundingBufferSection
              sellerAccountId={session.sellerId}
              canManage={canManagePricing}
            />
          </Suspense>
        </>
      ) : null}
    </div>
  );
}
