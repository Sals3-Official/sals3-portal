import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Pencil } from 'lucide-react';
import LinkButton from '@/components/portal/LinkButton';
import PageHeader from '@/components/portal/PageHeader';
import AnalyticsPanel from '@/components/products/detail/AnalyticsPanel';
import HistoryPanel from '@/components/products/detail/HistoryPanel';
import OverviewPanel from '@/components/products/detail/OverviewPanel';
import ReviewsPanel from '@/components/products/detail/ReviewsPanel';
import StatusActions from '@/components/products/detail/StatusActions';
import VariantsPanel from '@/components/products/detail/VariantsPanel';
import ProductStatusBadge from '@/components/products/ProductStatusBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { can } from '@/lib/auth/permissions';
import { getSession } from '@/lib/auth/session';
import {
  TRANSITION_RULES,
  transitionsFrom,
} from '@/lib/products/status-workflow';
import { getProduct } from '@/services/products';

export const metadata: Metadata = { title: 'Product · Sals3 Portal' };

type ProductDetailPageProps = {
  params: Promise<{ id: string }>;
};

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'variants', label: 'Variants' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'reviews', label: 'Reviews' },
  { value: 'history', label: 'History' },
] as const;

/** Product detail. Composition only: each tab is its own component. */
export default async function ProductDetailPage({
  params,
}: ProductDetailPageProps) {
  const { id } = await params;
  const [session, product] = await Promise.all([getSession(), getProduct(id)]);

  if (product === null) {
    notFound();
  }

  const available = transitionsFrom(product.status).filter((transition) =>
    can(session.role, TRANSITION_RULES[transition].permission),
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={product.name}
        description={`${product.identifiers.sku} · updated ${product.updatedAt}`}
        actions={
          can(session.role, 'product:edit') ? (
            <LinkButton href={`/products/${product.id}/edit`} variant="outline">
              <Pencil aria-hidden="true" />
              Edit
            </LinkButton>
          ) : null
        }
      />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3">
        <ProductStatusBadge status={product.status} />
        <StatusActions productId={product.id} transitions={available} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex-wrap">
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="cursor-pointer"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <div className="rounded-lg border border-border bg-card p-4">
          <TabsContent value="overview">
            <OverviewPanel product={product} />
          </TabsContent>
          <TabsContent value="variants">
            <VariantsPanel variants={product.variants} />
          </TabsContent>
          <TabsContent value="analytics">
            <AnalyticsPanel analytics={product.analytics} />
          </TabsContent>
          <TabsContent value="reviews">
            <ReviewsPanel
              reviews={product.reviews}
              canReply={can(session.role, 'review:reply')}
              canModerate={can(session.role, 'review:moderate')}
            />
          </TabsContent>
          <TabsContent value="history">
            <HistoryPanel entries={product.auditTrail} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
