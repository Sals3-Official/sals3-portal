'use client';

import { useRef, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import bulkCreateProductDraftsAction from '@/app/(portal)/listings/bulk-draft-action';
import type { BulkDraftRowOutcome } from '@/modules/catalog/products/contracts';
import { usePipelineSelection } from './PipelineSelectionProvider';

/**
 * Sends the page's selection to `bulkCreateProductDraftsAction`.
 *
 * The idempotency key base lives in a ref and is regenerated only after a
 * response arrives: a retry of a timed-out submit therefore replays the SAME
 * per-candidate keys, so everything the first attempt managed to create
 * replays from its stored result instead of being written twice.
 *
 * After a response, created and already-there ids leave the selection; failed
 * ids STAY selected, so retrying the failures is one click. The durable
 * per-row truth (highlight, "In catalogue" pill, disabled checkbox) arrives
 * with the server render that `revalidatePath` triggers.
 */

function summarize(outcomes: BulkDraftRowOutcome[]): string {
  const created = outcomes.filter((o) => o.status === 'created').length;
  const existing = outcomes.filter(
    (o) => o.status === 'already_in_catalogue',
  ).length;
  const failed = outcomes.filter((o) => o.status === 'failed').length;
  const parts: string[] = [];

  if (created > 0) parts.push(`${created} added to your catalogue`);
  if (existing > 0) parts.push(`${existing} already there`);
  if (failed > 0) parts.push(`${failed} failed`);

  return parts.join(' · ');
}

const FAILURE_COPY: Record<string, string> = {
  invalid_input: 'The selection was not valid. Reload and try again.',
  denied: 'Your account cannot add products to the catalogue.',
  rate_limited: 'Too many batches in a row - wait a minute and try again.',
  not_configured: 'No database is configured in this environment.',
};

export default function AddToCatalogueButton() {
  const { selected, remove } = usePipelineSelection();
  const [pending, startTransition] = useTransition();
  const keyBase = useRef(`bulk-${crypto.randomUUID()}`);

  const submit = () => {
    const candidateIds = [...selected];

    startTransition(async () => {
      const result = await bulkCreateProductDraftsAction({
        candidateIds,
        idempotencyKeyBase: keyBase.current,
      });

      if (!result.ok) {
        toast.error(FAILURE_COPY[result.reason] ?? 'The batch failed.');

        return;
      }

      // Only now is the key base spent - a timeout above replays it instead.
      keyBase.current = `bulk-${crypto.randomUUID()}`;
      remove(
        result.outcomes
          .filter((outcome) => outcome.status !== 'failed')
          .map((outcome) => outcome.candidateId),
      );
      toast(summarize(result.outcomes), {
        description:
          'Candidates stay listed here as sourcing records - added rows are marked "In catalogue". Failed rows stay selected for a retry.',
      });
    });
  };

  const idleLabel =
    selected.size === 0
      ? 'Add to Product Catalogue'
      : `Add ${selected.size} to Product Catalogue`;

  return (
    <Button
      onClick={submit}
      disabled={pending || selected.size === 0}
      aria-busy={pending}
    >
      {pending ? 'Adding…' : idleLabel}
    </Button>
  );
}
