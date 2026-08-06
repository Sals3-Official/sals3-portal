import StatusPill from '@/components/seller-center/shared/StatusPill';
import { cn } from '@/lib/utils';
import type { ListingStage } from '@/lib/seller-center/mock-data/listings';

type ListingWizardStageProps = {
  stage: ListingStage;
  index: number;
  isOpen: boolean;
  onToggle: () => void;
};

export default function ListingWizardStage({
  stage,
  index,
  isOpen,
  onToggle,
}: ListingWizardStageProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border bg-card',
        isOpen ? 'border-primary/40' : 'border-border',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3.5 text-left"
      >
        <span className="flex items-center gap-3">
          <span
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
              isOpen
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-ink-muted',
            )}
          >
            {index + 1}
          </span>
          <span>
            <span className="block text-sm font-semibold">{stage.title}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {stage.subtitle}
            </span>
          </span>
        </span>
        <StatusPill label={stage.status} tone={stage.statusTone} />
      </button>
      {isOpen ? (
        <div className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2">
          {stage.fields.map((field) => (
            <div
              key={field.label}
              className={field.wide ? 'sm:col-span-2' : undefined}
            >
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                {field.label}
              </p>
              <div
                className={cn(
                  'flex h-10 items-center rounded-md border px-3 text-sm',
                  field.needsAttention
                    ? 'border-amber-600/40 bg-warning-surface text-amber-600'
                    : 'border-border bg-muted/30 text-foreground',
                )}
              >
                {field.value}
              </div>
              {field.help === undefined ? null : (
                <p className="mt-1.5 text-xs leading-relaxed text-amber-600">
                  {field.help}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
