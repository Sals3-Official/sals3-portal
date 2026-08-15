'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import EditorSectionCard from '@/components/products/editor/EditorSectionCard';

/**
 * Naming the option groups a supplier encoded in one string.
 *
 * CJ sends `Black-1XL` and nothing else — no structured attributes anywhere in
 * its payload. `deriveOptionSplit` proves how many positions there are and which
 * values sit at each, but it cannot know that position 0 is a *Colour*: on a
 * phone the same two slots could be plug type and storage. So the split is
 * pre-filled and a person supplies the two things only a person can — the axis
 * names, and the order values should appear in.
 *
 * ## Two fields per value, and why the left one is locked
 *
 * The supplier token is the join key. Sals3's field-ownership rule is that
 * supplier content is never overwritten, so the raw token stays read-only and the
 * seller edits a display label beside it. That is also what makes re-sync safe: a
 * CJ label change is matched on the token, and renaming the display label can
 * never silently repoint a variant at another variant's price.
 *
 * ## Order is a human decision too
 *
 * `S, M, L, XL, XXL` is not alphabetical — alphabetically it is `L, M, S, XL,
 * XXL`. No algorithm recovers the intended order, which is why the rows move by
 * hand. Up/down buttons rather than drag: drag alone is unreachable by keyboard,
 * and this needs no new dependency.
 */

export type OptionMappingProposalAxis = {
  index: number;
  /** Supplier tokens at this position, in first-seen order. */
  values: string[];
};

export type VariantOptionMappingSectionProps = {
  proposal: OptionMappingProposalAxis[];
  /** Present once mapped — the section then reports rather than edits. */
  mappedAxisNames?: string[];
  /** Taxonomy preset names aligned to `proposal`; editable, never authoritative. */
  suggestedAxisNames?: string[];
  variantCount: number;
  onSave?: (
    axes: {
      name: string;
      values: { raw: string; label: string }[];
    }[],
  ) => Promise<{ ok: boolean; message?: string }>;
  /**
   * Variants whose supplier label was never recorded at draft time. A single one
   * empties `proposal`, so this is what tells a product that *can* be repaired
   * apart from one whose labels genuinely do not form a grid.
   */
  unlabelledVariantCount?: number;
  /** Offered only where those labels can actually be recovered. */
  onRecoverLabels?: () => Promise<{ ok: boolean; message: string }>;
};

type ValueDraft = { raw: string; label: string };
type AxisDraft = { name: string; values: ValueDraft[] };

function initialDrafts(
  proposal: OptionMappingProposalAxis[],
  suggestedAxisNames: string[],
): AxisDraft[] {
  const usableNames =
    suggestedAxisNames.length === proposal.length ? suggestedAxisNames : [];

  return proposal.map((axis, axisIndex) => ({
    name: usableNames[axisIndex] ?? '',
    // Display label defaults to the supplier's own token: the honest starting
    // point, and often already correct.
    values: axis.values.map((raw) => ({ raw, label: raw })),
  }));
}

/**
 * Reordering with the keyboard must not drop focus.
 *
 * Each arrow disables at its end of the list, and `disabled` on the element that
 * currently holds focus makes the browser drop focus to `<body>`. So the last
 * press of a run — the one that lands the value where the seller wanted it —
 * silently loses their place. That hurts most in exactly the case these buttons
 * exist for: `S, M, L, XL, XXL` is recoverable by no algorithm, so the order is
 * set by hand, and by keyboard for anyone not using a mouse.
 *
 * Focus moves to the opposite arrow in the same row, which is always enabled
 * after a move that lands on a boundary — an axis carries at least two values, so
 * the two ends are never the same row. It is handed over before the state update:
 * the sibling is not unmounted, so React keeps focus on it, and the row carries
 * that focus with it as it moves.
 */
function keepFocusOffDisabledArrow(
  pressed: HTMLButtonElement,
  willDisable: boolean,
): void {
  if (!willDisable) return;

  const sibling = pressed.nextElementSibling ?? pressed.previousElementSibling;

  if (sibling instanceof HTMLButtonElement) sibling.focus();
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;

  const next = [...items];
  const [lifted] = next.splice(from, 1);

  if (lifted !== undefined) next.splice(to, 0, lifted);

  return next;
}

export default function VariantOptionMappingSection({
  proposal,
  mappedAxisNames,
  suggestedAxisNames = [],
  variantCount,
  onSave,
  unlabelledVariantCount = 0,
  onRecoverLabels,
}: VariantOptionMappingSectionProps) {
  const [axes, setAxes] = useState<AxisDraft[]>(() =>
    initialDrafts(proposal, suggestedAxisNames),
  );
  const [touched, setTouched] = useState<Record<number, boolean>>({});
  const [state, setState] = useState<'IDLE' | 'SAVING' | 'SAVED' | 'FAILED'>(
    'IDLE',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [recoverState, setRecoverState] = useState<
    'IDLE' | 'RECOVERING' | 'DONE'
  >('IDLE');
  const [recoverMessage, setRecoverMessage] = useState<string | null>(null);

  async function recover() {
    if (onRecoverLabels === undefined) return;

    setRecoverState('RECOVERING');
    setRecoverMessage(null);

    const result = await onRecoverLabels();

    setRecoverState('DONE');
    setRecoverMessage(result.message);
  }

  if (mappedAxisNames !== undefined && mappedAxisNames.length > 0) {
    return (
      <EditorSectionCard
        id="options"
        title="Option groups"
        severity={null}
        meta={`${mappedAxisNames.length} groups`}
      >
        <p className="text-sm text-muted-foreground">
          Mapped as {mappedAxisNames.join(' × ')}. Supplier labels stay as
          received; the display names above are Sals3&rsquo;s.
        </p>
      </EditorSectionCard>
    );
  }

  if (proposal.length === 0) {
    /**
     * Two states look identical from here and only one can be repaired.
     *
     * A product whose supplier labels genuinely do not form a grid has nothing to
     * fix. A product drafted before `create-draft.ts` recorded
     * `source_option_label` has labels sitting unread in stored evidence, and a
     * single missing one is enough to empty the proposal. Saying "no split could
     * be proposed" to the second is true but useless, so it is only said to the
     * first.
     */
    const recoverable = unlabelledVariantCount > 0;

    return (
      <EditorSectionCard
        id="options"
        title="Option groups"
        severity={null}
        meta={recoverable ? 'Labels missing' : 'Not detected'}
      >
        {recoverable ? (
          <>
            <p className="text-sm text-muted-foreground">
              {unlabelledVariantCount} of {variantCount} variants have no
              supplier label recorded, which is why no option groups can be
              proposed. This product was drafted before Sals3 started storing
              those labels; they are still in the supplier evidence already held
              for it and can be recovered without contacting the supplier.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={
                  onRecoverLabels === undefined || recoverState === 'RECOVERING'
                }
                onClick={() => recover()}
              >
                {recoverState === 'RECOVERING'
                  ? 'Recovering…'
                  : 'Recover supplier labels'}
              </Button>
              {/*
                Always mounted so the outcome is announced when it appears,
                rather than the live region arriving with the text inside it.
              */}
              <p aria-live="polite" className="text-sm text-muted-foreground">
                {recoverMessage}
              </p>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            The supplier labels on this product do not form a complete grid, so
            no split could be proposed. Nothing is guessed here — mapping stays
            empty and the storefront shows each supplier label whole.
          </p>
        )}
      </EditorSectionCard>
    );
  }

  const named = axes.every((axis) => axis.name.trim().length > 0);

  async function save() {
    if (!named || onSave === undefined) return;

    setState('SAVING');
    setMessage(null);

    const result = await onSave(
      axes.map((axis) => ({
        name: axis.name.trim(),
        values: axis.values.map((value) => ({
          raw: value.raw,
          label: value.label.trim() === '' ? value.raw : value.label.trim(),
        })),
      })),
    );

    setState(result.ok ? 'SAVED' : 'FAILED');
    setMessage(result.message ?? null);
  }

  return (
    <EditorSectionCard
      id="options"
      title="Option groups"
      // Unmapped blocks publication by owner decision, so the badge says so
      // rather than reading as an optional nicety.
      severity={named ? null : 'BLOCKER'}
      meta={`${proposal.length} detected`}
    >
      <p className="mb-4 text-sm text-muted-foreground">
        Detected {proposal.length} groups across {variantCount} variants from
        the supplier&rsquo;s own labels. Name each group and put its values in
        the order a buyer should see them. The supplier column is read-only.
      </p>

      <div className="flex flex-col gap-6">
        {axes.map((axis, axisIndex) => {
          const nameId = `option-group-${axisIndex}`;
          const missingName =
            touched[axisIndex] === true && axis.name.trim() === '';

          return (
            <div key={proposal[axisIndex]?.values.join('|') ?? axisIndex}>
              <Label htmlFor={nameId}>Group {axisIndex + 1} name</Label>
              <Input
                id={nameId}
                value={axis.name}
                placeholder="e.g. Colour"
                aria-invalid={missingName}
                aria-describedby={missingName ? `${nameId}-error` : undefined}
                className="mt-1 h-9 max-w-xs"
                onBlur={() =>
                  setTouched((current) => ({ ...current, [axisIndex]: true }))
                }
                onChange={(event) =>
                  setAxes((current) =>
                    current.map((item, index) =>
                      index === axisIndex
                        ? { ...item, name: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              {missingName ? (
                <p
                  id={`${nameId}-error`}
                  className="mt-1 text-xs text-destructive"
                >
                  Give this group a name before saving.
                </p>
              ) : null}

              <div className="mt-3 flex flex-col gap-2">
                <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 text-xs text-muted-foreground">
                  <span>Supplier value</span>
                  <span>Shown to buyers</span>
                  <span className="sr-only">Reorder</span>
                </div>
                {axis.values.map((value, valueIndex) => (
                  <div
                    key={value.raw}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2"
                  >
                    <Input
                      readOnly
                      value={value.raw}
                      aria-label={`Supplier value ${value.raw}`}
                      className="h-9 bg-muted text-muted-foreground"
                    />
                    <Input
                      value={value.label}
                      aria-label={`Label shown to buyers for ${value.raw}`}
                      className="h-9"
                      onChange={(event) =>
                        setAxes((current) =>
                          current.map((item, index) =>
                            index === axisIndex
                              ? {
                                  ...item,
                                  values: item.values.map((existing, i) =>
                                    i === valueIndex
                                      ? {
                                          ...existing,
                                          label: event.target.value,
                                        }
                                      : existing,
                                  ),
                                }
                              : item,
                          ),
                        )
                      }
                    />
                    {/* gap-2, not gap-1: two opposite-action targets 4px apart
                        invite a mis-tap that undoes the move just made. */}
                    <span className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={`Move ${value.raw} up`}
                        disabled={valueIndex === 0}
                        onClick={(event) => {
                          keepFocusOffDisabledArrow(
                            event.currentTarget,
                            valueIndex - 1 === 0,
                          );
                          setAxes((current) =>
                            current.map((item, index) =>
                              index === axisIndex
                                ? {
                                    ...item,
                                    values: move(
                                      item.values,
                                      valueIndex,
                                      valueIndex - 1,
                                    ),
                                  }
                                : item,
                            ),
                          );
                        }}
                      >
                        <ChevronUp aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={`Move ${value.raw} down`}
                        disabled={valueIndex === axis.values.length - 1}
                        onClick={(event) => {
                          keepFocusOffDisabledArrow(
                            event.currentTarget,
                            valueIndex + 1 === axis.values.length - 1,
                          );
                          setAxes((current) =>
                            current.map((item, index) =>
                              index === axisIndex
                                ? {
                                    ...item,
                                    values: move(
                                      item.values,
                                      valueIndex,
                                      valueIndex + 1,
                                    ),
                                  }
                                : item,
                            ),
                          );
                        }}
                      >
                        <ChevronDown aria-hidden="true" />
                      </Button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 flex items-center gap-3">
        <Button
          type="button"
          disabled={!named || state === 'SAVING'}
          onClick={() => save()}
        >
          {state === 'SAVING' ? 'Saving…' : 'Save option groups'}
        </Button>
        {/*
          Always mounted so the outcome is announced when it appears, rather than
          the live region itself being inserted at the same moment.
        */}
        <p aria-live="polite" className="text-sm">
          {state === 'SAVED' ? (
            <span className="text-muted-foreground">Option groups saved.</span>
          ) : null}
          {state === 'FAILED' ? (
            <span className="text-destructive">
              {message ?? 'Could not save. Nothing was changed.'}
            </span>
          ) : null}
        </p>
      </div>
    </EditorSectionCard>
  );
}
