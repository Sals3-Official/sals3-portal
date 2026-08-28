import RepriceControls from './RepriceControls';

type RepriceSectionProps = {
  canManage: boolean;
};

/**
 * Applying every rule above to prices that are already live.
 *
 * ## Why this is its own section
 *
 * It used to sit inside `CategoryPricingSection`, beside the margin
 * spreadsheet, on the reading that the two are "the two halves of one job".
 * That was true of the sheet and untrue of the operation: `planReprice` takes a
 * **seller**, not a category, and every line it produces comes from
 * `resolveProductPricing` — which reads the store default, the category margin,
 * any product or variant override, **and the funding buffer**.
 *
 * So a control that serves every pricing input was presented as belonging to
 * one of them, and the input with no control beside it — the funding buffer —
 * was the one whose effect on live prices was hardest to guess. Placing it
 * last, after the rules rather than inside one of them, is the arrangement that
 * matches what it actually does.
 *
 * ## What it deliberately does not do
 *
 * It does not run on save. Repricing is preview-then-approve with a written
 * reason and a fingerprint that refuses a stale plan; firing it automatically
 * whenever a rule changed would step past the approval those exist for.
 */
export default function RepriceSection({ canManage }: RepriceSectionProps) {
  return (
    <section
      aria-labelledby="reprice-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="reprice-heading" className="text-base font-semibold">
            Apply rules to live prices
          </h2>
          <p className="max-w-[78ch] text-sm text-muted-foreground">
            A published price is worked out once, when the product goes live, so
            a rule saved here changes nothing a buyer is charged until you
            reprice. This covers every rule on this page — store defaults,
            category margins, and the funding buffer. You see exactly what would
            change before anything is written, and prices you typed by hand are
            never touched.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <RepriceControls canManage={canManage} />
        </div>
      </div>
    </section>
  );
}
