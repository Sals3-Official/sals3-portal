'use client';

/* eslint-disable react/jsx-no-bind -- handlers close over this control's own local state. */

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import {
  applyRepriceAction,
  previewRepriceAction,
  type RepricePreview,
  type RepricePreviewLine,
} from '@/app/(portal)/market-rules/pricing-actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatMoney } from '@/lib/seller-center/product-editor/format';
import { MAX_REPRICE_OFFERS } from '@/modules/pricing/reprice-limits';

type RepriceControlsProps = {
  canManage: boolean;
  /**
   * The departments a run may be scoped to, in the order the table shows them.
   *
   * Departments only, not the whole 5,595-row taxonomy. A run covers the chosen
   * category **and its subtree**, and every product sits under a department, so
   * the 21 roots already reach everything — offering all of them would be a
   * longer list that can select nothing extra.
   */
  categories: ReadonlyArray<{ code: string; name: string }>;
  /** One entry per column of the Category markups table, Global included. */
  scopes: ReadonlyArray<{
    key: string;
    label: string;
    marketCode: string | null;
  }>;
};

const MIN_REASON_CHARS = 10;

/**
 * The option value for "every category in this destination".
 *
 * Not `''`, which already means nothing has been chosen, and not `null`, which
 * is what it becomes on the wire. A sentinel the `<select>` can carry keeps
 * "unchosen" and "all" apart on a control that only speaks strings.
 */
const ALL_CATEGORIES = 'ALL';

/** One preview row. Its own component so the table body is not rebuilding closures per row per render. */
function RepriceRow({ line }: { line: RepricePreviewLine }) {
  const now =
    line.currentPriceMinor === null || line.currentPriceCurrency === null
      ? '—'
      : formatMoney({
          amountMinor: line.currentPriceMinor,
          currency: line.currentPriceCurrency,
        });

  const becomes = (() => {
    if (line.status === 'CHANGED' && line.newPriceMinor !== null) {
      return formatMoney({
        amountMinor: line.newPriceMinor,
        currency: line.newPriceCurrency ?? 'USD',
      });
    }

    if (line.status === 'MANUAL') return 'Kept — priced by hand';

    // The resolver's own words, so the seller is told what to fix rather than
    // that something went wrong.
    return line.reasonLabel ?? 'Cannot be priced';
  })();

  return (
    <tr className="border-b border-border last:border-b-0">
      <td className="px-3 py-2">
        <span className="font-medium">{line.productTitle}</span>
        <span className="block text-ink-faint">{line.sku}</span>
      </td>
      <td className="px-3 py-2">{line.marketCode}</td>
      <td className="px-3 py-2 tabular-nums">{now}</td>
      <td
        className={
          line.status === 'CHANGED'
            ? 'px-3 py-2 font-medium tabular-nums'
            : 'px-3 py-2 text-ink-faint'
        }
      >
        {becomes}
      </td>
    </tr>
  );
}

/**
 * Applying today's margin rules to prices that are already live.
 *
 * ## Why this is a separate act, and not part of saving a rule
 *
 * Saving a margin changes a rule. This changes what buyers are charged for
 * products already in the shop — a different thing, with a different blast
 * radius, and the reason it is a second click rather than a side effect of the
 * first. A rule can be set, compared against another destination, and thought
 * about; a price that moved the moment it was typed cannot be taken back
 * before somebody has bought at it.
 *
 * ## Look before you write
 *
 * The dialog will not let a price be written until the seller has asked what
 * would change and seen the answer. The list names every product whose price
 * moves, every one the rules cannot price, and every one carrying a price
 * somebody typed by hand — because "nothing happened to these" is exactly the
 * part a summary count hides.
 */
export default function RepriceControls({
  canManage,
  categories,
  scopes,
}: RepriceControlsProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  /*
    The scope, and there is no "everything" option on purpose.

    An unscoped run used to exist. It selected every published offer this seller
    owned, ordered by title, and took the first 500 — with no cursor, so it
    returned the same 500 forever and everything past the 500th product
    alphabetically was unreachable. Owner decision 2026-08-29, on a catalogue
    heading for millions of listings: one button must never stand between a
    seller and every price they own. Both selections start empty so the first
    choice is deliberate rather than inherited from whatever sorted first.
  */
  const [categoryCode, setCategoryCode] = useState('');
  const [scopeKey, setScopeKey] = useState('');
  /*
    Where the next page starts, carried across an apply.

    `null` is the beginning. It advances only when a page is applied, so a
    seller who reads a page and walks away has moved nothing — and a page that
    was applied is never offered twice.
  */
  const [afterSku, setAfterSku] = useState<string | null>(null);
  const [isChecking, startChecking] = useTransition();
  const [isApplying, startApplying] = useTransition();
  const [preview, setPreview] = useState<RepricePreview | null>(null);
  const [reason, setReason] = useState('');
  /*
    Taking back the prices a person typed.

    Its own state, and the preview is cleared whenever it changes: a plan
    checked with this off does not describe the run this would perform, and the
    fingerprint would refuse it anyway. Clearing says so before the click
    rather than after.
  */
  const [reclaimSellerPriced, setReclaimSellerPriced] = useState(false);
  /** Typed to confirm a reclaim: the count the preview reported. */
  const [confirmCount, setConfirmCount] = useState('');
  const [error, setError] = useState<string | null>(null);

  /*
    A reclaim also has to be typed out.

    The number is the one the preview reported, so it cannot be supplied without
    reading the preview — which is the point. A confirmation that only asks
    "are you sure" is answered by reflex; one that asks "how many" is answered
    by looking. Deliberately not a password: a password proves who is pressing,
    and what needed proving here is that they know what it will do.
  */
  const reclaimConfirmed =
    !reclaimSellerPriced ||
    (preview !== null &&
      confirmCount.trim() === String(preview.counts.changed));

  const selectedScope = scopes.find((scope) => scope.key === scopeKey) ?? null;
  /*
    Resolved to an object rather than carried as two strings. `marketCode` is
    `null` for Global and a country code otherwise, and `null` is a real value
    here rather than "not chosen" — `scopeKey` is what says whether a choice was
    made, which is why the empty string is the unchosen state and not `null`.
  */
  /*
    `''` is "nothing chosen"; `ALL_CATEGORIES` is a choice that happens to mean
    no category filter. Both become `null` downstream, so they cannot be the
    same value here — the difference is what keeps the check button disabled
    until somebody has actually decided.
  */
  const scope =
    categoryCode === '' || selectedScope === null
      ? null
      : {
          categoryCode: categoryCode === ALL_CATEGORIES ? null : categoryCode,
          marketCode: selectedScope.marketCode,
          afterSku,
        };

  const canCheck = scope !== null && !isChecking;

  const canApply =
    scope !== null &&
    preview !== null &&
    preview.counts.changed > 0 &&
    reason.trim().length >= MIN_REASON_CHARS &&
    reclaimConfirmed &&
    !isApplying;

  function reset() {
    setPreview(null);
    setReason('');
    setError(null);
  }

  function handleCheck() {
    if (scope === null) return;

    setError(null);

    startChecking(async () => {
      const result = await previewRepriceAction(scope, reclaimSellerPriced);

      if (!result.ok) {
        setPreview(null);
        setError(
          result.reason === 'denied'
            ? 'You do not have permission to change live prices.'
            : 'The prices could not be worked out right now. Try again shortly.',
        );
        return;
      }

      setPreview(result.data);
    });
  }

  function handleApply() {
    if (preview === null) return;

    setError(null);

    startApplying(async () => {
      const result = await applyRepriceAction({
        fingerprint: preview.fingerprint,
        reason,
        reclaimSellerPriced,
        // Re-sent, and re-checked server-side. Two empty plans share a
        // fingerprint, so without this an apply could name a different category
        // than the preview and still pass the staleness check.
        scope,
      });

      if (!result.ok) {
        if (result.reason === 'stale_preview') {
          // The numbers on screen are no longer the numbers that would be
          // written, so the list is cleared rather than left looking approved.
          setPreview(null);
          setError(
            'Prices moved while this list was open, so nothing was changed. Check again to see the current numbers.',
          );
          return;
        }

        setError(
          result.reason === 'version_conflict'
            ? 'A product was republished while this was applying, so nothing was changed. Check again.'
            : 'The new prices could not be applied. Nothing was changed.',
        );
        return;
      }

      const { written, unpriceable } = result.data;

      /*
        Advance to the next page, or clear the position when this was the last.

        Taken from the preview that was just applied, not from a fresh read:
        this is the row the write actually ended on. Set before the refresh so
        the next `Check what would change` continues rather than restarting.
      */
      setAfterSku(preview.nextAfterSku);

      // Refresh before closing: a transition dispatched after the surface it
      // runs on is torn down is discarded, which is what left a saved margin
      // stale until a manual reload.
      router.refresh();

      const more = preview.nextAfterSku !== null;

      toast.success(
        unpriceable > 0
          ? `${written} repriced. ${unpriceable} could not be priced and still show their old price.`
          : `${written} repriced.`,
      );

      /*
        Held open when there is more of this scope to cover.

        Closing would send the seller back through the trigger and both
        selects, and re-choosing a department is what clears the position — so
        a page would be applied, the dialog would close, and the next run would
        start from the beginning again, covering the same rows forever. That is
        the shape of the bug this whole change exists to end, rebuilt one layer
        up.
      */
      if (!more) {
        setIsOpen(false);
      }

      reset();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setIsOpen(true)}
      >
        <RefreshCw aria-hidden="true" className="size-3.5" />
        Reprice live products
      </Button>

      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (!open) reset();
        }}
      >
        <DialogContent
          className="sm:max-w-3xl"
          overlayClassName="bg-foreground/15 supports-backdrop-filter:backdrop-blur-md"
        >
          <DialogHeader>
            <DialogTitle>Reprice published products</DialogTitle>
            <DialogDescription>
              Your margins price a product when it is published. Changing a
              margin afterwards does not move a price that is already live —
              this does.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-5">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">
                1. Choose what to reprice
              </h3>
              <p className="text-xs text-ink-faint">
                One category, one destination. The run covers every published
                product under that category, including its sub-categories.
              </p>

              <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reprice-category">Category</Label>
                  <select
                    id="reprice-category"
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                    value={categoryCode}
                    onChange={(event) => {
                      setCategoryCode(event.target.value);
                      // A position in one department means nothing in another.
                      setAfterSku(null);
                      // Same discipline as the reclaim checkbox: a preview
                      // describes the scope it was run for, and nothing else.
                      setPreview(null);
                      setConfirmCount('');
                      setError(null);
                    }}
                  >
                    <option value="">Choose a category…</option>
                    <option value={ALL_CATEGORIES}>All categories</option>
                    {categories.map((category) => (
                      <option key={category.code} value={category.code}>
                        {category.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reprice-scope">Destination</Label>
                  <select
                    id="reprice-scope"
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                    value={scopeKey}
                    onChange={(event) => {
                      setScopeKey(event.target.value);
                      setAfterSku(null);
                      setPreview(null);
                      setConfirmCount('');
                      setError(null);
                    }}
                  >
                    <option value="">Choose a destination…</option>
                    {scopes.map((scopeOption) => (
                      <option key={scopeOption.key} value={scopeOption.key}>
                        {scopeOption.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {afterSku === null ? null : (
                /*
                  Said out loud, because the alternative is a seller pressing
                  Check twice and quietly comparing two different pages while
                  believing they are looking at the same one.
                */
                <p className="text-xs font-medium text-sals3-deep">
                  Continuing from where the last run stopped. Change either
                  choice above to start again from the beginning.
                </p>
              )}

              <h3 className="mt-2 text-sm font-semibold">
                2. Check what would change
              </h3>
              <p className="text-xs text-ink-faint">
                Nothing is written by this step. It runs today&apos;s rules
                against the products you chose and shows you the result.
              </p>
              {/*
                Off by default, and clearing the preview when it changes: a plan
                checked with this off does not describe the run this would
                perform. The fingerprint would refuse the mismatch anyway; this
                says so before the click rather than after.
              */}
              <div className="flex items-start gap-2 text-xs">
                <input
                  id="reprice-reclaim"
                  type="checkbox"
                  className="mt-0.5"
                  checked={reclaimSellerPriced}
                  onChange={(event) => {
                    setReclaimSellerPriced(event.target.checked);
                    setPreview(null);
                    setConfirmCount('');
                    setError(null);
                  }}
                />
                <Label htmlFor="reprice-reclaim" className="font-normal">
                  <span className="font-medium">
                    Also take back prices I typed by hand
                  </span>
                  <span className="block font-normal text-ink-faint">
                    Those prices are exempt from your rules today. This ends
                    that and replaces each one with the rule&apos;s number. The
                    old price is kept in this listing&apos;s history, but the
                    listing itself will no longer carry it.
                  </span>
                </Label>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={handleCheck}
                disabled={!canCheck || isApplying}
              >
                <RefreshCw aria-hidden="true" className="size-3.5" />
                {isChecking ? 'Checking…' : 'Check what would change'}
              </Button>
            </section>

            {preview === null ? null : (
              <section className="flex flex-col gap-3 border-t border-border pt-4">
                <h3 className="text-sm font-semibold">
                  {preview.counts.changed === 0
                    ? 'Every live price already matches your rules'
                    : `${preview.counts.changed} ${preview.counts.changed === 1 ? 'price moves' : 'prices move'}`}
                </h3>

                <p className="text-xs text-ink-faint">
                  {preview.counts.unchanged} already correct
                  {preview.counts.manual > 0
                    ? `, ${preview.counts.manual} priced by hand and left alone`
                    : ''}
                  {preview.counts.unpriceable > 0
                    ? `, ${preview.counts.unpriceable} that cannot be priced`
                    : ''}
                  .
                </p>

                {preview.truncated ? (
                  /*
                    The copy this replaces said "run it again afterwards to
                    reach the rest", and that could not work: nothing excluded
                    the rows already seen, so a second run returned the same
                    page forever. It was wrong in a way nobody could catch —
                    the screen reported "every live price already matches your
                    rules" while whatever sat past the first page had never been
                    read. Continuing is a real position now, so this says what
                    the button beside it will actually do.
                  */
                  <p
                    role="alert"
                    className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs"
                  >
                    This selection holds more than {MAX_REPRICE_OFFERS} live
                    prices in this destination. You are looking at the first{' '}
                    {MAX_REPRICE_OFFERS}. Apply these, then continue — the next
                    page starts where this one ends.
                  </p>
                ) : null}

                {preview.lines.length === 0 ? null : (
                  <div className="max-h-72 overflow-y-auto rounded-md border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-card">
                        <tr className="border-b border-border">
                          <th className="px-3 py-2 font-medium">Product</th>
                          <th className="px-3 py-2 font-medium">Destination</th>
                          <th className="px-3 py-2 font-medium">Now</th>
                          <th className="px-3 py-2 font-medium">Becomes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.lines.map((line) => (
                          <RepriceRow key={line.offerId} line={line} />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}

            {canManage && preview !== null && preview.counts.changed > 0 ? (
              <section className="flex flex-col gap-3 border-t border-border pt-4">
                <h3 className="text-sm font-semibold">
                  3. Apply the new prices
                </h3>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="reprice-reason">Reason for change</Label>
                  <Input
                    id="reprice-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Why are you moving these prices?"
                    aria-describedby="reprice-reason-hint"
                  />
                </div>

                {reclaimSellerPriced ? (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="reprice-confirm-count">
                      Type {preview.counts.changed} to confirm
                    </Label>
                    <Input
                      id="reprice-confirm-count"
                      value={confirmCount}
                      onChange={(event) => setConfirmCount(event.target.value)}
                      placeholder={String(preview.counts.changed)}
                      inputMode="numeric"
                      aria-describedby="reprice-confirm-hint"
                    />
                    <span
                      id="reprice-confirm-hint"
                      className="text-xs text-ink-faint"
                    >
                      This run replaces prices a person decided. Typing the
                      count is how the screen knows you have read what it will
                      touch.
                    </span>
                  </div>
                ) : null}

                <div className="flex flex-col gap-1.5">
                  <span
                    id="reprice-reason-hint"
                    className="text-xs text-ink-faint"
                  >
                    {`Use ${MIN_REASON_CHARS} characters or more. You have ${reason.trim().length}. The system records this reason against every product it reprices.`}
                  </span>
                </div>

                <p className="text-xs text-ink-faint">
                  Buyers see the new prices as soon as this finishes.
                </p>
              </section>
            ) : null}

            {error === null ? null : (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsOpen(false)}
            >
              Close
            </Button>
            {canManage ? (
              <Button type="button" onClick={handleApply} disabled={!canApply}>
                {isApplying ? 'Applying…' : 'Apply new prices'}
              </Button>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
