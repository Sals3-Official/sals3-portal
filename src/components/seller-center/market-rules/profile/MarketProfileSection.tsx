import getDb from '@/lib/db/client';
import resolveBuyerDestinationCountryPolicy from '@/lib/country-policy/buyer-destination-country';
import resolvePortalDisplayCurrency from '@/lib/country-policy/currency';
import resolveSellerOperatingCountryPolicy from '@/lib/country-policy/seller-operating-country';
import { listSetupCandidates } from '@/lib/seller-center/market-profile-view';
import type { SellerMarketProfileRow } from '@/lib/db/schema';
import {
  resolveSellerMarketCapabilities,
  type MarketDestinationCapability,
} from '@/modules/market-config/capabilities';
import { listProfilesForSeller } from '@/modules/market-config/repository';
import BeginMarketProfileSetupDialog from './BeginMarketProfileSetupDialog';
import MarketProfileCard from './MarketProfileCard';
import PolicyContextPanel from './PolicyContextPanel';

type MarketProfileSectionProps = {
  sellerAccountId: string;
  canManage: boolean;
};

/**
 * The authenticated seller's real market configuration.
 *
 * Reads are keyed on `sellerAccountId`, which the page takes from
 * `session.sellerId` — there is no route or search param that can point this
 * at another tenant.
 *
 * Six states, deliberately distinguished. `null` from the read means the
 * backend could not answer (unmigrated schema, database down): that renders
 * a notice with NO setup control, because offering a write on a read we
 * could not complete would be inviting a duplicate. A successful empty read
 * is different — it genuinely means "no profile yet" and may offer setup to
 * an authorized role. Forbidden is handled a level up by the page's
 * `requirePermission`; draft, active-incomplete, and suspended are
 * distinguished per profile in `MarketProfileCard`.
 */
async function readProfiles(
  sellerAccountId: string,
): Promise<SellerMarketProfileRow[] | null> {
  try {
    return await listProfilesForSeller(getDb(), sellerAccountId);
  } catch (error) {
    // Same discipline as the pricing sections: an unmigrated or unreachable
    // table is an operational condition, not a 500.
    // eslint-disable-next-line no-console
    console.error('[portal] failed to read seller market profiles', {
      sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return null;
  }
}

const NOTICE_CLASS =
  'rounded-md border border-dashed border-border-strong bg-background px-3 py-4 text-sm text-muted-foreground';

/**
 * The three read outcomes, as early returns rather than nested ternaries so
 * the difference between "we could not read" and "there is nothing" stays
 * obvious to the next reader.
 */
function MarketProfileBody({
  profiles,
  destinations,
  canManage,
}: {
  profiles: SellerMarketProfileRow[] | null;
  destinations: readonly MarketDestinationCapability[];
  canManage: boolean;
}) {
  if (profiles === null) {
    return (
      <p className={NOTICE_CLASS}>
        Market setup is not available right now, so this account&apos;s
        configuration cannot be shown or changed. This is a backend problem, not
        a statement about your account.
      </p>
    );
  }

  if (profiles.length === 0) {
    return (
      <p className={NOTICE_CLASS}>
        This account is not set up for any destination yet. Nothing is enabled
        by default — a destination becomes part of your setup only when someone
        configures it explicitly.
        {canManage
          ? ''
          : ' Ask an account owner to set one up from the approved list.'}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {profiles.map((profile) => (
        <MarketProfileCard
          key={profile.id}
          profile={profile}
          capability={
            destinations.find(
              (destination) =>
                destination.destinationCountryCode ===
                profile.destinationCountryCode,
            ) ?? null
          }
          canManage={canManage}
        />
      ))}
    </div>
  );
}

export default async function MarketProfileSection({
  sellerAccountId,
  canManage,
}: MarketProfileSectionProps) {
  const profiles = await readProfiles(sellerAccountId);
  const capabilities = resolveSellerMarketCapabilities();

  const setupCandidates =
    profiles === null
      ? []
      : listSetupCandidates(profiles, capabilities.destinations);

  return (
    <section
      aria-labelledby="market-profile-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 id="market-profile-heading" className="text-base font-semibold">
            Your market setup
          </h2>
          <p className="text-sm text-muted-foreground">
            Which approved destinations this account is configured to sell to.
            Separate from the global catalogue destination policy below, and
            separate from your pricing rules.
          </p>
        </div>
        {/* No control on a failed read — see the module comment. */}
        {canManage && profiles !== null && setupCandidates.length > 0 ? (
          <BeginMarketProfileSetupDialog
            choices={setupCandidates.map((destination) => ({
              destinationCountryCode: destination.destinationCountryCode,
              destinationName: destination.destinationName,
            }))}
          />
        ) : null}
      </div>

      <MarketProfileBody
        profiles={profiles}
        destinations={capabilities.destinations}
        canManage={canManage}
      />

      <PolicyContextPanel
        buyerDestination={resolveBuyerDestinationCountryPolicy()}
        sellerOperating={resolveSellerOperatingCountryPolicy()}
        displayCurrency={resolvePortalDisplayCurrency()}
        capabilityVersion={capabilities.capabilityVersion}
      />
    </section>
  );
}
