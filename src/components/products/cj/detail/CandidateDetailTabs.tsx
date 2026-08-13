import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { CandidateDetail } from '@/modules/catalog/candidates/candidate-detail';
import HistoryTab from './HistoryTab';
import OverviewTab from './OverviewTab';
import ScreeningQueueTab from './ScreeningQueueTab';
import StockTab from './StockTab';
import SupplierEvidenceTab from './SupplierEvidenceTab';

/**
 * The drawer's five sections, grouped by the question a reviewer is asking
 * rather than by the table a field happens to live in.
 *
 * Tabs rather than one long scroll, per `MASTER.md` §6 rule 7 (progressive
 * disclosure). The active tab is NOT in the URL: the page already owns `?tab=`
 * for the pipeline's own tab bar, and a second `tab` param would collide with
 * it. If deep-linking a section is wanted later, use a distinct key such as
 * `?section=`.
 *
 * `Tabs` is uncontrolled (`defaultValue`), so this whole tree stays a Server
 * Component - base-ui's tab primitives accept server-rendered children and need
 * no callback from us.
 */
const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'stock', label: 'Stock' },
  { value: 'evidence', label: 'Supplier evidence' },
  { value: 'screening', label: 'Screening & queue' },
  { value: 'history', label: 'History' },
] as const;

export default function CandidateDetailTabs({
  detail,
}: {
  detail: CandidateDetail;
}) {
  return (
    <Tabs defaultValue="overview" className="flex flex-col gap-4">
      {/*
        `TabsList` is `inline-flex h-8`, so five triggers cannot wrap without
        breaking it. Scroll the bar instead; the triggers already carry
        `whitespace-nowrap`.
      */}
      <div className="-mx-1 overflow-x-auto px-1">
        <TabsList variant="line" className="min-w-max">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      <TabsContent value="overview">
        <OverviewTab detail={detail} />
      </TabsContent>
      <TabsContent value="stock">
        <StockTab detail={detail} />
      </TabsContent>
      <TabsContent value="evidence">
        <SupplierEvidenceTab detail={detail} />
      </TabsContent>
      <TabsContent value="screening">
        <ScreeningQueueTab detail={detail} />
      </TabsContent>
      <TabsContent value="history">
        <HistoryTab detail={detail} />
      </TabsContent>
    </Tabs>
  );
}
