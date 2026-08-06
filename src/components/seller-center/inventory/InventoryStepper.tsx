type InventoryStepperProps = {
  onHand: number;
  edited: boolean;
  onDecrement: () => void;
  onIncrement: () => void;
};

/**
 * Inline quantity control. Every click is a full, audited change - there is
 * no separate "save" step, so the number shown is always the true value.
 */
export default function InventoryStepper({
  onHand,
  edited,
  onDecrement,
  onIncrement,
}: InventoryStepperProps) {
  return (
    <div className="flex items-center justify-end gap-1.5">
      <button
        type="button"
        onClick={onDecrement}
        disabled={onHand <= 0}
        aria-label="Decrease amount on hand"
        className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-ink-muted transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
      >
        −
      </button>
      <div
        className={`flex h-7 w-13 items-center justify-center rounded-md border text-sm font-semibold tabular-nums ${
          edited ? 'border-primary bg-brand-100' : 'border-border bg-card'
        }`}
      >
        {onHand}
      </div>
      <button
        type="button"
        onClick={onIncrement}
        aria-label="Increase amount on hand"
        className="flex size-7 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-ink-muted transition-colors hover:border-primary hover:text-primary"
      >
        +
      </button>
    </div>
  );
}
