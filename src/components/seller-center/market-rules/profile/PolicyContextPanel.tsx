import type {
  BuyerDestinationCountryPolicy,
  PortalDisplayCurrencyPolicy,
  SellerOperatingCountryPolicy,
} from '@/lib/country-policy/types';

type PolicyContextPanelProps = {
  buyerDestination: BuyerDestinationCountryPolicy;
  sellerOperating: SellerOperatingCountryPolicy;
  displayCurrency: PortalDisplayCurrencyPolicy;
  capabilityVersion: string;
};

/**
 * The three platform-owned policies that sit around a seller's market setup,
 * stated separately on purpose.
 *
 * Collapsing them is the specific mistake this panel exists to prevent: the
 * global catalogue destination allowlist, Sals3's own business registration
 * country, and the Portal's reference currency are independently resolved and
 * independently versioned. None of them implies that this account is set up
 * for anything — that is the seller's own profile above.
 */
export default function PolicyContextPanel({
  buyerDestination,
  sellerOperating,
  displayCurrency,
  capabilityVersion,
}: PolicyContextPanelProps) {
  const entries = [
    {
      id: 'buyer-destination',
      term: 'Global catalogue destinations',
      value:
        buyerDestination.effective === 'ENABLED'
          ? buyerDestination.countryCodes.join(', ')
          : 'Disabled',
      detail:
        'Where products may be evaluated for sale, platform-wide. Set by Sals3, not editable here, and not a statement that your account sells to them.',
      version: buyerDestination.policyVersion,
    },
    {
      id: 'seller-operating',
      term: 'Sals3 business registration',
      value: sellerOperating.countryCodes.join(', '),
      detail:
        'Where Sals3 itself is registered to operate. It never implies a buyer destination.',
      version: sellerOperating.policyVersion,
    },
    {
      id: 'display-currency',
      term: 'Portal reference currency',
      value: displayCurrency.code,
      detail:
        'A display dimension for this portal only. Not a checkout currency, a settlement contract, or an FX conversion.',
      version: displayCurrency.source,
    },
    {
      id: 'capability',
      term: 'Setup policy version',
      value: capabilityVersion,
      detail:
        'Which approved destinations may currently be offered during setup.',
      version: capabilityVersion,
    },
  ];

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <h3 className="text-sm font-semibold">Platform policy context</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        These are set by Sals3 and resolved independently of each other. None of
        them configures your account on its own.
      </p>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {entries.map((entry) => (
          <div key={entry.id} className="flex flex-col gap-0.5">
            <dt className="text-xs text-muted-foreground">{entry.term}</dt>
            <dd className="text-sm font-medium">{entry.value}</dd>
            <p className="text-xs text-muted-foreground">{entry.detail}</p>
          </div>
        ))}
      </dl>
    </div>
  );
}
