import type { SellerMarketProfileRow } from '@/lib/db/schema';
import type { MarketDestinationCapability } from '@/modules/market-config/capabilities';
import {
  capabilityLabel,
  describeProfileStatus,
  describeSellingCurrency,
} from '@/lib/seller-center/market-profile-view';
import MarketProfileTransitionDialog from './MarketProfileTransitionDialog';

type MarketProfileCardProps = {
  profile: SellerMarketProfileRow;
  /** `null` when the destination is no longer in the approved pilot list. */
  capability: MarketDestinationCapability | null;
  canManage: boolean;
};

const TONE_CLASSES: Record<string, string> = {
  neutral: 'bg-muted text-muted-foreground',
  progress: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  positive: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  warning: 'bg-destructive/10 text-destructive',
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  );
}

export default function MarketProfileCard({
  profile,
  capability,
  canManage,
}: MarketProfileCardProps) {
  const pending = capability?.pendingCapabilities ?? [];
  const status = describeProfileStatus(profile.status, pending.length);
  const currency = describeSellingCurrency(profile);
  const destinationName =
    capability?.destinationName ?? profile.destinationCountryCode;

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">
            {destinationName}{' '}
            <span className="font-mono text-xs text-muted-foreground">
              {profile.destinationCountryCode}
            </span>
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{status.detail}</p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-medium ${TONE_CLASSES[status.tone]}`}
        >
          {status.label}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <DetailRow
          label="Selling currency"
          value={currency ?? 'Not yet authorized'}
        />
        <DetailRow label="Locale" value={profile.locale ?? 'Not set'} />
        <DetailRow label="Time zone" value={profile.timeZone ?? 'Not set'} />
        <DetailRow label="Configuration" value={`v${profile.version}`} />
      </dl>

      {pending.length > 0 ? (
        <div className="rounded-md border border-dashed border-border-strong bg-muted/40 px-3 py-2">
          <p className="text-xs font-medium">Not yet in place</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {pending.map(capabilityLabel).join(' · ')}
          </p>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Policy {profile.capabilityVersion} · last change{' '}
        {new Date(profile.updatedAt).toLocaleDateString()}
      </p>

      {canManage ? (
        <div className="flex justify-end gap-1.5">
          {profile.status === 'DRAFT' ? (
            <MarketProfileTransitionDialog
              kind="activate"
              profileId={profile.id}
              expectedVersion={profile.version}
              destinationName={destinationName}
            />
          ) : null}
          {profile.status === 'ACTIVE' ? (
            <MarketProfileTransitionDialog
              kind="suspend"
              profileId={profile.id}
              expectedVersion={profile.version}
              destinationName={destinationName}
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
