import getDb from '@/lib/db/client';
import { findStoreDefaultForScope } from '@/modules/pricing/repository';
import type { PricingScope } from '@/modules/pricing/pricing-scope-destinations';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import StoreDefaultsTable from './StoreDefaultsTable';
import type { StoreDefaultViewModel } from './store-default-model';

type StoreDefaultSectionProps = {
  sellerAccountId: string;
  canManage: boolean;
  /** One row each, in the order they are shown — the six, then Global. */
  scopes: PricingScope[];
};

/**
 * `null` at the top level means the backend could not answer (unmigrated
 * schema, database down) — distinct from a successful read that finds no active
 * default for a scope, which is the ordinary first-run state the table renders
 * honestly as "—". Same discipline as `CategoryPricingSection`.
 *
 * One read per scope, issued together. `findStoreDefaultForScope` is the
 * **exact** read, not the resolving one: this screen is an editor, and an editor
 * that showed Australia's rule under Fiji's heading would let a seller revise a
 * rule they never opened. Global is read the same way — `scope.marketCode` is
 * `null` there, which the query takes as `market_code IS NULL`, not as a wildcard.
 */
async function readStoreDefaults(
  sellerAccountId: string,
  scopes: PricingScope[],
): Promise<Record<string, StoreDefaultViewModel | null> | null> {
  try {
    const db = getDb();
    const rows = await Promise.all(
      scopes.map(async (scope) => {
        const row = await findStoreDefaultForScope(
          db,
          sellerAccountId,
          scope.marketCode,
        );

        return [
          scope.key,
          row === null
            ? null
            : {
                id: row.id,
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
 * ADR-015 §3's base layer, per scope: the margin every unpriced category falls
 * back to, and the minimum that margin may never fall below.
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
  scopes,
}: StoreDefaultSectionProps) {
  const storeDefaults = await readStoreDefaults(sellerAccountId, scopes);

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
            Reserve
          </h2>
          <p className="max-w-[78ch] text-sm text-muted-foreground">
            The markup on a sale must never drop below this, because this is
            what pays your operating expenses. Set it as a percentage or as a
            fixed amount — one or the other. Categories set the markup; this
            only ever lifts a price, never lowers one.
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
          {/*
            No "nothing set yet" warning any more. It used to say a scope with
            no row could not price at all, which was true while this row also
            carried the base markup. It no longer does: an absent reserve means
            prices are simply not floored, which is a choice rather than a
            fault, and warning about every unset scope trained the eye to skip
            the banner.
          */}
          <StoreDefaultsTable
            scopes={scopes}
            storeDefaults={storeDefaults}
            canManage={canManage}
          />
        </>
      )}
    </section>
  );
}
