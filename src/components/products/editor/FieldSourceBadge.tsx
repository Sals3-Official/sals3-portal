import { cn } from '@/lib/utils';
import type { FieldSource } from '@/lib/seller-center/product-editor/types';
import { FIELD_SOURCE_LABELS } from './presentation';

type FieldSourceBadgeProps = {
  source: FieldSource;
  className?: string;
};

const SOURCE_STYLES: Record<FieldSource, string> = {
  SUPPLIER: 'bg-brand-100 text-brand-900',
  SELLER: 'bg-muted text-ink-muted',
  INFERRED: 'bg-muted text-ink-muted',
  NOT_PROVIDED: 'bg-muted text-ink-muted',
};

/**
 * Where one field's current value came from. Small on purpose: it sits
 * beside a label on every specification row, and the seller needs to tell
 * "the supplier said this" from "we guessed" from "nobody has said yet"
 * without the badge competing with the value itself.
 */
export default function FieldSourceBadge({
  source,
  className,
}: FieldSourceBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex w-fit shrink-0 items-center rounded-[4px] px-1.5 py-px text-xs font-semibold whitespace-nowrap',
        SOURCE_STYLES[source],
        className,
      )}
    >
      {FIELD_SOURCE_LABELS[source]}
    </span>
  );
}
