import getDb from '@/lib/db/client';
import { findStoreDefaultForScope } from '@/modules/pricing/repository';
import type { PricingScopeDestination } from '@/modules/pricing/pricing-scope-destinations';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import StoreDefaultsTable from './StoreDefaultsTable';
import type { StoreDefaultViewModel } from './store-default-model';

type StoreDefaultSectionProps = {
  sellerAccountId: string;
  canManage: boolean;
  /** One row each, in the order they are shown. */
  destinations: PricingScopeDestination[];
};

/**
 * `null` at the top level means the backend could not answer (unmigrated
 * schema, database down) — distinct from a successful read that finds no active
 * default for a destination, which is the ordinary first-run state the table
 * renders honestly as "—". Same discipline as `CategoryPricingSection`.
 *
 * One read per destination, issued together. `findStoreDefaultForScope` is the
 * **exact** read, not the resolving one: this screen is an editor, and an editor
 * that showed Australia's rule under Fiji's heading would let a seller revise a
 * rule they never opened.
 */
async function readStoreDefaults(
  sellerAccountId: string,
  destinations: PricingScopeDestination[],
): Promise<Record<string, StoreDefaultViewModel | null> | null> {
  try {
    const db = getDb();
    const rows = await Promise.all(
      destinations.map(async (destination) => {
        const row = await findStoreDefaultForScope(
          db,
          sellerAccountId,
          destination.code,
        );

        return [
          destination.code,
          row === null
            ? null
            : {
                id: row.id,
                targetMarginRate: row.targetMarginRate,
                // `bigint` cannot cross the server/client boundary, and a
                // per-item floor in cents is nowhere near the safe-integer
                // ceiling. Converted here, once, where the row is read.
                minContributionMinor: Number(row.minContributionMinor),
                minContributionCurrency: row.minContributionCurrency,
                minContributionRate: row.minContributionRate,
                roundingRule: row.roundingRule,
                version: row.version,
              },
        ] as const;
      }),
    );

    return Object.fromEntries(rows);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] failed to read the store defaults', {
      sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

/**
 * ADR-015 §3's base layer, per destination: the margin every unpriced category
 * falls back to, and the minimum that margin may never fall below.
 *
 * The minimum is the seller's operating expense — owner rule 2026-08-26 — and
 * it is expressible either as a percentage or as a fixed amount, never both.
 * The exclusivity is enforced in the form, in the action's schema, and by
 * `pricing_store_defaults_floor_exclusive`; only the last of those is reached
 * by a CSV import or a repair statement.
 *
 * This section had been written months earlier and never rendered by any page,
 * which is why a floor that already existed in the database and in the resolver
 * could not be set from anywhere.
 */
export default async function StoreDefaultSection({
  sellerAccountId,
  canManage,
  destinations,
}: StoreDefaultSectionProps) {
  const storeDefaults = await readStoreDefaults(sellerAccountId, destinations);
  const missing =
    storeDefaults === null
      ? []
      : destinations.filter(
          (destination) => (storeDefaults[destination.code] ?? null) === null,
        );

  return (
    <section
      aria-labelledby="store-default-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex h-7 w-1 shrink-0 rounded-full bg-sals3-gradient"
        />
        <div className="flex flex-col gap-1">
          <h2 id="store-default-heading" className="text-base font-semibold">
            Store default pricing
          </h2>
          <p className="max-w-[78ch] text-sm text-muted-foreground">
            The system starts with the supplier cost and adds your margin. Every
            category with no margin of its own uses the base margin here. The
            minimum is what you will never price below — your operating expenses
            — as a percentage or a fixed amount, one or the other.
          </p>
        </div>
      </div>

      {storeDefaults === null ? (
        <DisclosureBanner tone="warning">
          Store default pricing is not available right now. Your saved defaults,
          if any, are safe. Try again shortly, or contact support if this keeps
          happening.
        </DisclosureBanner>
      ) : (
        <>
          {missing.length > 0 ? (
            <DisclosureBanner tone="warning">
              No base margin yet for{' '}
              {missing.map((destination) => destination.label).join(', ')}. A
              category with no margin of its own cannot price at all in those
              destinations — its products need a manual retail price until a
              default or a parent margin covers them.
            </DisclosureBanner>
          ) : null}
          <StoreDefaultsTable
            destinations={destinations}
            storeDefaults={storeDefaults}
            canManage={canManage}
          />
        </>
      )}
    </section>
  );
}
