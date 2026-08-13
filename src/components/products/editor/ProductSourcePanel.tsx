import DetailRow from '@/components/portal/DetailRow';
import formatUtcDateTime from '@/lib/portal/format-datetime';
import type { ProductEditorData } from '@/modules/catalog/products/editor-queries';

/**
 * Supplier provenance for one product - observed facts only, matching the
 * candidate drawer's rule: no supplier deep link, no credential, ever.
 */
export default function ProductSourcePanel({
  reference,
}: {
  reference: ProductEditorData['providerReference'];
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
      <h2 className="text-base font-semibold">Supplier source</h2>
      {reference === null ? (
        <p className="text-sm text-ink-muted">
          No supplier reference - this product is not linked to any provider
          listing.
        </p>
      ) : (
        <dl className="m-0">
          <DetailRow
            label="Provider"
            value={reference.providerCode ?? 'Unknown'}
          />
          <DetailRow
            label="Supplier product ID"
            value={reference.externalProductId}
            mono
            hint="Look this up in your own CJ session. No supplier link is offered from here."
          />
          <DetailRow label="Source status" value={reference.sourceStatus} />
          <DetailRow label="Sync state" value={reference.syncState} />
          <DetailRow
            label="Snapshot checksum"
            value={reference.snapshotChecksum ?? 'None'}
            mono
          />
          <DetailRow
            label="Last observed"
            value={formatUtcDateTime(reference.lastObservedAt)}
          />
        </dl>
      )}
    </section>
  );
}
