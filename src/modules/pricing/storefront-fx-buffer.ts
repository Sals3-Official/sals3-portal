import { and, eq, isNull, or, gt } from 'drizzle-orm';
import type { Executor } from '@/modules/catalog/candidates/repository';
import { pricingFxAdjustmentPolicies, productOffers } from '@/lib/db/schema';

/**
 * The Market Rules funding buffer, resolved for the storefront's approximate
 * local price.
 *
 * ## Why this reads the funding buffer and not a constant
 *
 * The storefront used to apply a hard-coded `2.5` (`lib/storefront/fx.ts`'s
 * old `DEFAULT_BUFFER_PERCENT`). Owner decision 2026-08-28: there is one FX
 * cushion for this business and it is the one a seller can actually see and
 * change, on Market Rules → Funding buffer. A number nobody can find is a
 * number nobody maintains, and this one had drifted from the +1.50% the
 * screen was showing.
 *
 * ## What this is NOT allowed to become
 *
 * `resolver.ts` applies this same policy to the **cost basis** at publish
 * time, and the comment above that step forbids merging the funding buffer
 * into a buyer-settlement conversion (ADR-015 §4). This module does not do
 * that and must not start:
 *
 * - The charged price is USD and still applies the buffer exactly **once**,
 *   inside the resolver, frozen onto `product_offers`. Nothing here changes
 *   what anyone is charged.
 * - What this feeds is the storefront's *approximate local price* — a display
 *   estimate that `sals3-ecommerce` deliberately models as `IndicativePrice`
 *   rather than `Money`, precisely so it can never reach a Stripe session or
 *   an order line.
 *
 * So the same configured rate is used for two different conversions (the
 * seller's own funding conversion, and an estimate of the spread the buyer's
 * bank will take), which is the owner's intent — the seller's stated reason
 * on the active policy is "safety buffer for currency movements", which is
 * the general reading. It is not the same conversion applied twice.
 *
 * ## Why it resolves through published offers
 *
 * The buffer is scoped per seller account (`pricing_fx_adjustment_policies`
 * has at most one ACTIVE row each) and the storefront has no seller context —
 * a product page knows a product, and a cart can hold several sellers' goods.
 *
 * Rather than invent a platform-wide row that nothing writes, this reads the
 * buffer belonging to whoever actually owns published offers. Today that is
 * one seller and the answer is unambiguous. When a second seller publishes
 * with a different buffer this returns `null` and the storefront shows no
 * local price, which is loud and visible — the alternative, quietly charging
 * one seller's cushion against another's goods, is the kind of thing nobody
 * discovers for nine days. `AMBIGUOUS` is reported separately from `NONE` so
 * the log says which of the two happened.
 */

export type StorefrontFxBuffer = {
  /** Percent, e.g. `1.5` for the +1.50% the Market Rules card shows. */
  bufferPercent: number;
  /** `pricing_fx_adjustment_policies.version` — which edit produced it. */
  policyVersion: number;
  policyId: string;
};

export type StorefrontFxBufferResult =
  | { outcome: 'RESOLVED'; buffer: StorefrontFxBuffer }
  | { outcome: 'NONE' }
  | { outcome: 'AMBIGUOUS'; sellerAccountCount: number };

/**
 * A buffer far outside this band is bad data rather than a policy, and a
 * display built from it would be worse than no display. The stored column is
 * a signed `numeric(8,6)`, so nothing in the schema prevents a fat-fingered
 * `15` meaning 1500%.
 *
 * Negative is allowed and deliberate: a seller funding through a rail that
 * pays a rebate (CJ's 2-3% wire/Payoneer top-up bonus) has a genuinely
 * negative cushion, and ADR-015 §4 calls the field a *signed* buffer.
 */
const MIN_BUFFER_PERCENT = -10;
const MAX_BUFFER_PERCENT = 25;

function toBufferPercent(adjustmentRate: string): number | null {
  // Stored as a rate (`0.015` = +1.5%), shown and carried as a percent.
  const rate = Number(adjustmentRate);

  if (!Number.isFinite(rate)) return null;

  const percent = rate * 100;

  return percent >= MIN_BUFFER_PERCENT && percent <= MAX_BUFFER_PERCENT
    ? percent
    : null;
}

/**
 * The "not expired yet" half of the WHERE clause.
 *
 * Its own exported function so a test can inspect what this binds without a
 * database, which is the only way the defect below is catchable here: CI has
 * no Postgres, and a stubbed executor never reaches a driver.
 *
 * `now` goes straight to `gt`, never through a `sql` template. Measured
 * difference, from the two forms' own `toSQL()`:
 *
 * - `gt(column, now)`        binds `"2026-08-28T13:21:28.000Z"` — a **string**
 * - `gt(column, sql`${now}`)` binds a raw **Date**
 *
 * A `sql` template has no column context, so the value never passes through
 * `PgTimestamp.mapToDriverValue` and reaches the driver unmapped. The query
 * then fails outright. This shipped, and the endpoint answered 503 on every
 * call in production while the whole unit suite stayed green — a stubbed
 * executor never reaches a driver, and CI has no Postgres to catch it.
 */
export function stillInEffect(now: Date) {
  return or(
    isNull(pricingFxAdjustmentPolicies.effectiveTo),
    gt(pricingFxAdjustmentPolicies.effectiveTo, now),
  );
}

/**
 * The active funding buffer behind every published offer, or a reason there
 * isn't one.
 *
 * An expired policy (`effectiveTo` in the past) is treated as absent, the
 * same way `resolver.ts` treats it — a temporary buffer that lapsed must stop
 * applying on its own rather than by someone remembering.
 */
export default async function resolveStorefrontFxBuffer(
  executor: Executor,
  now: Date = new Date(),
): Promise<StorefrontFxBufferResult> {
  const rows = await executor
    .selectDistinct({
      id: pricingFxAdjustmentPolicies.id,
      version: pricingFxAdjustmentPolicies.version,
      adjustmentRate: pricingFxAdjustmentPolicies.adjustmentRate,
    })
    .from(pricingFxAdjustmentPolicies)
    .innerJoin(
      productOffers,
      eq(
        productOffers.sellerAccountId,
        pricingFxAdjustmentPolicies.sellerAccountId,
      ),
    )
    .where(
      and(
        eq(pricingFxAdjustmentPolicies.status, 'ACTIVE'),
        eq(productOffers.publishState, 'PUBLISHED'),
        stillInEffect(now),
      ),
    );

  if (rows.length === 0) return { outcome: 'NONE' };

  if (rows.length > 1) {
    return { outcome: 'AMBIGUOUS', sellerAccountCount: rows.length };
  }

  const row = rows[0];

  if (row === undefined) return { outcome: 'NONE' };

  const bufferPercent = toBufferPercent(row.adjustmentRate);

  // An out-of-band stored rate is data this module refuses to render, not a
  // number to clamp: clamping would show a buyer a figure derived from a
  // policy nobody approved and hide the bad row for as long as it survives.
  if (bufferPercent === null) return { outcome: 'NONE' };

  return {
    outcome: 'RESOLVED',
    buffer: {
      bufferPercent,
      policyVersion: row.version,
      policyId: row.id,
    },
  };
}
