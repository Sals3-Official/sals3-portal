import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import OverviewGrowthSuggestions from '@/components/seller-center/overview/OverviewGrowthSuggestions';
import OverviewMoneyPosition from '@/components/seller-center/overview/OverviewMoneyPosition';
import OverviewTaskCards from '@/components/seller-center/overview/OverviewTaskCards';
import OverviewTodayAtAGlance from '@/components/seller-center/overview/OverviewTodayAtAGlance';
import { requirePermission } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Overview · Seller Center' };

/**
 * The Seller Center dashboard: what needs a seller now, and what the money
 * looks like. A Server Component that composes independently-built cards -
 * no logic of its own lives here.
 */
export default async function OverviewPage() {
  await requirePermission('overview:read');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Overview"
        description="What needs you now, and what the money looks like"
      />
      <OverviewTaskCards />
      <OverviewMoneyPosition />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.35fr_1fr]">
        <OverviewTodayAtAGlance />
        <OverviewGrowthSuggestions />
      </div>
    </div>
  );
}
