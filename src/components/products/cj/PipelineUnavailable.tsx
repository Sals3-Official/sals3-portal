import PageHeader from '@/components/portal/PageHeader';
import {
  PIPELINE_TAB_LABELS,
  type PipelineTab,
} from '@/lib/portal/pipeline-tabs';
import SourcingEmptyState from './SourcingEmptyState';

/**
 * The two ways Product Sourcing can render nothing through no fault of the
 * seller's. Kept apart because they need different actions:
 *
 * - `not-configured` — this environment has no `DATABASE_URL` at all. Expected
 *   in a preview or a fresh clone; nothing is wrong.
 * - `unreachable` — a database is configured but did not answer. Something IS
 *   wrong, and the copy has to say that nothing was changed, so nobody goes
 *   looking for a half-applied write.
 */
type PipelineUnavailableReason = 'not-configured' | 'unreachable';

const COPY: Record<
  PipelineUnavailableReason,
  { title: string; description: string }
> = {
  'not-configured': {
    title: 'No database configured in this environment',
    description:
      'DATABASE_URL is not set here, so evaluated candidates cannot be read. This page works against a configured Postgres database - see the README.',
  },
  unreachable: {
    title: 'Cannot reach the database right now',
    description:
      'Evaluated candidates could not be loaded because the database did not respond. No candidate, decision, or evidence has been changed. Check that Postgres is running and that DATABASE_URL points at an existing database, then reload.',
  },
};

export default function PipelineUnavailable({
  reason,
  tab,
}: {
  reason: PipelineUnavailableReason;
  tab: PipelineTab;
}) {
  const copy = COPY[reason];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Product Sourcing"
        description={PIPELINE_TAB_LABELS[tab]}
      />
      <SourcingEmptyState title={copy.title} description={copy.description} />
    </div>
  );
}
