import { Copy } from 'lucide-react';

type PotentialDuplicateIndicatorProps = {
  count: number;
  onOpen: () => void;
};

/**
 * "Potential duplicate from another supplier" (spec section 11) - labelled
 * as probable, never a merge or a guarantee. `onOpen` is provided by the
 * client container that owns the comparison dialog's state; this component
 * stays a plain presentational button.
 */
export default function PotentialDuplicateIndicator({
  count,
  onOpen,
}: PotentialDuplicateIndicatorProps) {
  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-ink-muted hover:bg-accent"
    >
      <Copy aria-hidden="true" className="size-3" />
      Possible duplicate
    </button>
  );
}
