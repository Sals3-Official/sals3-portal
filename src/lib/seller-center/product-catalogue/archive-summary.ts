import type { ArchiveOutcome } from '@/modules/catalog/products/archive-product';

/**
 * Turns per-product Archive outcomes into one honest sentence.
 *
 * Pure, and separate from the workspace, because this is where the temptation
 * to say "Archived!" after a partial run lives. Every outcome kind gets counted
 * and named: a seller who archived five and lost one race must be told, or the
 * row that is still there looks like a rendering bug.
 */

export type ArchiveSummary = {
  title: string;
  description: string;
  /** Rows that did not archive - kept selected so a retry is one click. */
  retryableIds: string[];
};

export function archiveFailureMessage(
  reason: 'invalid_input' | 'denied' | 'rate_limited' | 'not_configured',
): string {
  if (reason === 'denied')
    return 'Your account is not allowed to archive catalogue products.';
  if (reason === 'rate_limited')
    return 'Too many archive requests. Wait a moment and try again.';
  if (reason === 'not_configured')
    return 'No database is configured in this environment.';

  return 'That selection was not valid. Reload the page and try again.';
}

export default function summarizeArchiveOutcomes(
  outcomes: ArchiveOutcome[],
): ArchiveSummary {
  const of = (kind: ArchiveOutcome['kind']) =>
    outcomes.filter((outcome) => outcome.kind === kind);
  const archived = of('archived');
  const notArchived = outcomes.filter((outcome) => outcome.kind !== 'archived');
  const parts: string[] = [];

  if (of('already-archived').length > 0)
    parts.push(`${of('already-archived').length} already archived`);
  if (of('published').length > 0)
    parts.push(
      `${of('published').length} skipped because published products are archived through the publish flow`,
    );
  if (of('stale').length > 0)
    parts.push(
      `${of('stale').length} changed since this page loaded - reload and retry`,
    );
  if (of('not-found').length > 0)
    parts.push(`${of('not-found').length} could not be found`);

  return {
    title:
      archived.length === 0
        ? 'Nothing was archived.'
        : `Archived ${archived.length} ${archived.length === 1 ? 'product' : 'products'}.`,
    description:
      parts.length === 0
        ? 'Archiving stops new sales. Nothing was deleted.'
        : parts.join('. ').concat('.'),
    retryableIds: notArchived.map((outcome) => outcome.productId),
  };
}
