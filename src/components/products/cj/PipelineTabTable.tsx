import { EMPTY_STATE_COPY } from '@/lib/portal/pipeline-copy';
import {
  PIPELINE_TAB_LABELS,
  type PipelineTab,
} from '@/lib/portal/pipeline-tabs';
import type { EvaluatedCandidateRow } from '@/modules/catalog/candidates/queries';
import AllCandidatesTable from './AllCandidatesTable';
import BlockedCandidatesTable from './BlockedCandidatesTable';
import EvaluatingCandidatesTable from './EvaluatingCandidatesTable';
import ExceptionQueueTable from './ExceptionQueueTable';
import AddToCatalogueButton from './AddToCatalogueButton';
import PipelineSelectionProvider from './PipelineSelectionProvider';
import QualifiedCandidatesTable from './QualifiedCandidatesTable';
import SourcingEmptyState from './SourcingEmptyState';

type PipelineTabTableProps = {
  tab: PipelineTab;
  candidates: EvaluatedCandidateRow[];
  /** True when the whole tab is empty, not merely this search inside it. */
  tabIsEmpty: boolean;
  search: string;
  currentParams: Record<string, string>;
  /** candidateId -> productId for rows already drafted. Populated on ready/needs-attention only. */
  inCatalogue: ReadonlyMap<string, string>;
};

type SelectableQualifiedTableProps = {
  candidates: EvaluatedCandidateRow[];
  currentParams: Record<string, string>;
  showReasons: boolean;
  inCatalogue: ReadonlyMap<string, string>;
};

/**
 * Ready and Needs Attention wrapped in the page-scoped selection: the button
 * sits top-right above the table (owner's placement), and both subscribe to
 * one client provider while the table itself stays a Server Component.
 */
function SelectableQualifiedTable({
  candidates,
  currentParams,
  showReasons,
  inCatalogue,
}: SelectableQualifiedTableProps) {
  return (
    <PipelineSelectionProvider>
      <div className="flex flex-col gap-3">
        <div className="flex justify-end">
          <AddToCatalogueButton />
        </div>
        <QualifiedCandidatesTable
          candidates={candidates}
          currentParams={currentParams}
          showReasons={showReasons}
          inCatalogue={inCatalogue}
        />
      </div>
    </PipelineSelectionProvider>
  );
}

/**
 * Picks the table for one pipeline tab, and renders the right empty state when
 * there is nothing to show.
 *
 * Lifted out of `page.tsx` when the detail drawer landed: every table now needs
 * `currentParams` threaded through so its rows can build a `?candidate=` href,
 * and that is switch-level plumbing rather than page-level orchestration.
 *
 * Five tables for six tabs - `QualifiedCandidatesTable` serves both Ready and
 * Needs Attention, differing only by whether it shows the reasons column.
 */
export default function PipelineTabTable({
  tab,
  candidates,
  tabIsEmpty,
  search,
  currentParams,
  inCatalogue,
}: PipelineTabTableProps) {
  if (candidates.length === 0) {
    if (tabIsEmpty) {
      const copy = EMPTY_STATE_COPY[tab];

      return (
        <SourcingEmptyState title={copy.title} description={copy.description} />
      );
    }

    return (
      <SourcingEmptyState
        title="No matches"
        description={`No candidate in ${PIPELINE_TAB_LABELS[tab]} matches "${search}".`}
      />
    );
  }

  switch (tab) {
    case 'ready':
      return (
        <SelectableQualifiedTable
          candidates={candidates}
          currentParams={currentParams}
          showReasons={false}
          inCatalogue={inCatalogue}
        />
      );
    case 'needs-attention':
      return (
        <SelectableQualifiedTable
          candidates={candidates}
          currentParams={currentParams}
          showReasons
          inCatalogue={inCatalogue}
        />
      );
    case 'evaluating':
      return (
        <EvaluatingCandidatesTable
          candidates={candidates}
          currentParams={currentParams}
        />
      );
    case 'blocked':
      return (
        <BlockedCandidatesTable
          candidates={candidates}
          currentParams={currentParams}
        />
      );
    case 'exception':
      return (
        <ExceptionQueueTable
          candidates={candidates}
          currentParams={currentParams}
        />
      );
    case 'all':
    default:
      return (
        <AllCandidatesTable
          candidates={candidates}
          currentParams={currentParams}
        />
      );
  }
}
