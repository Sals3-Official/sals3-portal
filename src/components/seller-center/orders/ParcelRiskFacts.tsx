import { cn } from '@/lib/utils';
import type { FulfilmentRiskFact } from '@/modules/orders/contracts';

type ParcelRiskFactsProps = {
  facts: FulfilmentRiskFact[];
};

const TONE_STYLES: Record<FulfilmentRiskFact['tone'], string> = {
  neutral: 'text-ink',
  warning: 'text-amber-600',
  danger: 'text-red-700',
};

/**
 * Fulfilment risk, as counted facts.
 *
 * Deliberately no dial, ring, percentage or score. Two reasons, and the copy
 * says both out loud: one parcel is far too small a sample for a rate, and a
 * percentage implies a target the seller never agreed to.
 *
 * It also answers a different question from the reference design that prompted
 * it. That one scores the *buyer* - a delivery-success rate, which is really
 * cash-on-delivery risk. Sals3 is prepaid, so the money is captured before the
 * parcel exists and buyer trust is not the seller's problem. What is their
 * problem is whether this parcel can be fulfilled at all.
 */
export default function ParcelRiskFacts({ facts }: ParcelRiskFactsProps) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 className="font-display text-[15px] font-semibold">
        Fulfilment risk on this parcel
      </h2>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-6 gap-y-3">
        {facts.map((fact) => (
          <div key={fact.id} className="flex flex-col gap-0.5">
            <span className="text-[12px] text-ink-subtle">{fact.label}</span>
            <span
              className={cn('text-[13px] font-medium', TONE_STYLES[fact.tone])}
            >
              {fact.value}
            </span>
          </div>
        ))}
      </div>

      <p className="max-w-[72ch] text-[12px] leading-normal text-ink-faint">
        These are counts, not performance scores. A single parcel is too small a
        sample to express as a rate.
      </p>
    </section>
  );
}
