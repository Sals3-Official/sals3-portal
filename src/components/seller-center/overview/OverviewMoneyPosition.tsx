import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import LinkButton from '@/components/portal/LinkButton';
import DisclosureBanner from '@/components/seller-center/shared/DisclosureBanner';
import StatTile from '@/components/seller-center/shared/StatTile';
import { getActiveMarket } from '@/lib/seller-center/market-config';
import { formatMarketMoney } from '@/lib/seller-center/money';
import {
  OVERVIEW_MONEY_STATES,
  OVERVIEW_VARIANCE_NOTE,
} from '@/lib/seller-center/mock-data/overview';

/**
 * Three money states shown side by side, never collapsed into one number -
 * the Seller Center financial-truth principle.
 */
export default function OverviewMoneyPosition() {
  const market = getActiveMarket();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Money position</CardTitle>
        <CardDescription>
          Three states, never one number. Rule set {market.ruleVersion}.
        </CardDescription>
        <CardAction>
          <LinkButton href="/finances" variant="outline" size="sm">
            Open ledger
          </LinkButton>
        </CardAction>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {OVERVIEW_MONEY_STATES.map((state) => (
          <StatTile
            key={state.id}
            label={state.label}
            tone={state.tone}
            value={formatMarketMoney(state.amountMinor, market)}
            note={state.note}
          />
        ))}
      </CardContent>
      <DisclosureBanner tone="warning" className="mx-4 mb-4 rounded-md border">
        {OVERVIEW_VARIANCE_NOTE}
      </DisclosureBanner>
    </Card>
  );
}
