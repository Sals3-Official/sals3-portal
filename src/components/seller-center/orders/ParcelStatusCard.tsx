import type { ReactNode } from 'react';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import type { ParcelStatus } from '@/modules/orders/contracts';

type ParcelStatusCardProps = {
  status: ParcelStatus;
  actionsSlot: ReactNode;
};

/**
 * The status header on a parcel's detail page.
 *
 * The actions sit under a literal "What you can do next" heading rather than
 * floating as bare buttons. Shopee labels its own action strip the same way,
 * and the label does real work: on a page with several controls it names which
 * ones are this parcel's next step, instead of leaving the seller to infer it
 * from position.
 */
export default function ParcelStatusCard({
  status,
  actionsSlot,
}: ParcelStatusCardProps) {
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="flex flex-col gap-2 p-4">
        <StatusPill label={status.label} tone={status.tone} />
        <p className="text-sm text-ink-muted">{status.detail}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-b-lg border-t border-border bg-muted/40 px-4 py-3">
        <p className="text-xs font-medium tracking-wide text-ink-subtle uppercase">
          What you can do next
        </p>
        {actionsSlot}
      </div>
    </section>
  );
}
