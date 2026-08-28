type OrdersBulkActionBarProps = {
  selectedCount: number;
  /**
   * What the buyer paid for the selected parcels, already formatted.
   *
   * Named for what it is. It used to read "est. proceeds", which is a
   * different number: proceeds are what the seller earns after Sals3
   * commission, and no commission ledger exists to compute that.
   */
  buyerPaymentLabel: string;
  onClear: () => void;
  onPrint: () => void;
};

/**
 * Sticky bulk-action bar. Only rendered by the parent while at least one row
 * is selected.
 */
export default function OrdersBulkActionBar({
  selectedCount,
  buyerPaymentLabel,
  onClear,
  onPrint,
}: OrdersBulkActionBarProps) {
  return (
    <div className="sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-sidebar px-4 py-3 text-sidebar-foreground shadow-lg">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm font-semibold">{selectedCount} selected</p>
        <p className="text-xs text-sidebar-foreground/70">
          buyer payment {buyerPaymentLabel}
        </p>
        <button
          type="button"
          onClick={onClear}
          className="cursor-pointer text-xs text-sidebar-foreground/70 underline-offset-2 hover:text-sidebar-foreground hover:underline"
        >
          Clear
        </button>
      </div>
      <button
        type="button"
        onClick={onPrint}
        className="h-9 cursor-pointer rounded-md bg-sidebar-primary px-4 text-sm font-semibold text-sidebar-primary-foreground transition-colors hover:opacity-90"
      >
        Print {selectedCount} label{selectedCount === 1 ? '' : 's'}
      </button>
    </div>
  );
}
