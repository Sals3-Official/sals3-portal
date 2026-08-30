'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  MANUAL_MAPPING_MAX_VARIANTS,
  countUnassigned,
  parseAxisValues,
  suggestAssignments,
  type SuggestedAssignments,
} from '@/lib/seller-center/product-editor/manual-mapping-assist';
import ManualAssignmentTable from './ManualAssignmentTable';

/**
 * Building a Variant Matrix by hand, for the products no arithmetic can split.
 *
 * ## Why this screen exists
 *
 * `deriveOptionSplit` refuses a ragged token count, a duplicate label, and a
 * sparse grid too thin to compress. Until this panel, the editor said so in one
 * paragraph and offered nothing — the seller could read that their product would
 * show 52 raw supplier strings to buyers and had no way to change it, while
 * `option-split.ts` had promised "the seller must map it by hand" since the day
 * it was written.
 *
 * It also answers the case no derivation can reach at all: **one token carrying
 * two attributes.** `Black Female` is a colour and a fit in one string, and CJ
 * spells the second half four ways across a single product (`Male`, `Men`,
 * `Female`, `Women`) with the word order reversed on `Female, Gray`. No delimiter
 * split produces a `Colour` axis from that. A person can.
 *
 * ## Values as a text box, not a row of fields
 *
 * A seller adding eight sizes should type eight lines, not press `Add value`
 * eight times. `parseAxisValues` takes newlines or commas, drops blanks, and
 * drops case-insensitive repeats — which the server would otherwise refuse
 * against `product_option_values_option_normalized_key`, turning a value typed
 * twice by accident into a failed save with no obvious cause.
 *
 * ## Suggesting, and refusing to guess
 *
 * `Fill from labels` matches each axis's values against the supplier string,
 * longest candidate first so `Women` beats the `Men` inside it. What it cannot
 * find it leaves empty, and the save stays blocked until a person closes every
 * gap. Filling a gap with a default would put a wrong colour on a live listing,
 * which is the exact failure the never-split rule exists to prevent — so the
 * count of remaining decisions is shown, prominently, rather than a cheerful
 * "ready".
 */

export type ManualOptionMappingPanelProps = {
  variants: { variantId: string; label: string }[];
  /** Names the taxonomy offers, flattened — the same source the derived matrix uses. */
  suggestedAxisNames?: string[];
  onSave: (
    axes: { name: string; values: string[] }[],
    assignments: { variantId: string; values: string[] }[],
  ) => Promise<{ ok: boolean; message?: string }>;
  onCancel: () => void;
  /**
   * The current mapping, when this panel is replacing one rather than building a
   * first.
   *
   * Pre-filling is right here where pre-filling axis *names* was refused for the
   * derived matrix: there, a name would have been Sals3's guess at what a supplier
   * position means. These are the seller's own previous decisions, and starting a
   * replacement from a blank form would mean retyping 52 assignments to change
   * one.
   */
  initialAxes?: { name: string; valuesText: string }[];
  initialAssignments?: SuggestedAssignments;
  /** `Save` for a first mapping, `Replace` for one that overwrites. */
  submitLabel?: string;
};

/**
 * `id` exists only to key the rendered rows.
 *
 * The array index cannot do it: removing the middle axis shifts every index
 * below, so React reuses the removed row's DOM for its successor and the values
 * textarea keeps the caret and scroll position of an axis that no longer exists.
 * The name cannot do it either — it is empty on a fresh axis and may legitimately
 * be a duplicate while someone is still typing.
 */
type AxisDraft = { id: string; name: string; valuesText: string };

const MAX_AXES = 4;

export default function ManualOptionMappingPanel({
  variants,
  suggestedAxisNames = [],
  onSave,
  onCancel,
  initialAxes,
  initialAssignments,
  submitLabel = 'Save Variant Matrix',
}: ManualOptionMappingPanelProps) {
  const nextAxisId = useRef(initialAxes?.length ?? 2);
  const [drafts, setDrafts] = useState<AxisDraft[]>(() =>
    initialAxes === undefined
      ? [
          { id: 'axis-0', name: '', valuesText: '' },
          { id: 'axis-1', name: '', valuesText: '' },
        ]
      : initialAxes.map((axis, index) => ({ id: `axis-${index}`, ...axis })),
  );
  const [assignments, setAssignments] = useState<SuggestedAssignments>(
    initialAssignments ?? {},
  );
  const [state, setState] = useState<'IDLE' | 'SAVING' | 'FAILED'>('IDLE');
  const [message, setMessage] = useState<string | null>(null);

  const axes = useMemo(
    () =>
      drafts.map((draft) => ({
        id: draft.id,
        name: draft.name,
        values: parseAxisValues(draft.valuesText),
      })),
    [drafts],
  );

  /**
   * Supplier labels that repeat, which nobody can map honestly.
   *
   * `deriveOptionSplit` refuses a duplicate label because two variants would
   * collapse onto one combination, so such a product lands here — as two rows
   * reading exactly the same string. The seller cannot tell them apart, and
   * neither can anyone: the supplier gave no information distinguishing them.
   * Offering the choice anyway would record a coin flip as a decision, and the
   * two variants can carry different prices.
   *
   * So it is stated and the save is blocked, rather than shown as a solvable
   * form. Naming the repeated string is what makes it actionable at the supplier
   * or by re-sourcing the product.
   */
  const duplicateLabels = useMemo(() => {
    const seen = new Set<string>();

    return [
      ...new Set(
        variants
          .filter((variant) => {
            if (seen.has(variant.label)) return true;

            seen.add(variant.label);

            return false;
          })
          .map((variant) => variant.label),
      ),
    ];
  }, [variants]);

  // Checked here as well as in the action's schema, so the panel can give the
  // real reason. The action's `invalid_input` message names option groups and
  // would be wrong about what happened.
  const tooManyVariants = variants.length > MANUAL_MAPPING_MAX_VARIANTS;

  const namedAndValued = axes.every(
    (axis) => axis.name.trim() !== '' && axis.values.length > 0,
  );
  const unassigned = countUnassigned(variants, assignments, axes.length);
  const complete =
    namedAndValued &&
    unassigned === 0 &&
    duplicateLabels.length === 0 &&
    !tooManyVariants;

  function setAxis(index: number, patch: Partial<AxisDraft>): void {
    setDrafts((current) =>
      current.map((draft, at) =>
        at === index ? { ...draft, ...patch } : draft,
      ),
    );
    /*
      Editing an axis can remove a value a row already holds, which would submit
      a value the server refuses as UNKNOWN_VALUE. Rather than reconcile every
      row on every keystroke, the assignments are dropped: silently keeping a
      stale pick is the shape that produces an unexplained refusal later.

      Cleared to empty even when replacing. Falling back to `initialAssignments`
      would restore values the edited axis may no longer offer, which is the same
      defect one step removed — and `Fill from labels` is one press away.
    */
    setAssignments({});
  }

  // Memoized because it is passed as a prop to a table that can hold 52 rows of
  // controls; a fresh identity on every keystroke re-renders all of them.
  const assign = useCallback(
    (variantId: string, axisIndex: number, value: string): void => {
      setAssignments((current) => {
        const row = [...(current[variantId] ?? [])];

        row[axisIndex] = value === '' ? undefined : value;

        return { ...current, [variantId]: row };
      });
    },
    [],
  );

  async function save(): Promise<void> {
    if (!complete) return;

    setState('SAVING');
    setMessage(null);

    const result = await onSave(
      axes.map((axis) => ({ name: axis.name.trim(), values: axis.values })),
      variants.map((variant) => ({
        variantId: variant.variantId,
        // Complete by the guard above, so every cell is a string here.
        values: (assignments[variant.variantId] ?? []).map(
          (value) => value ?? '',
        ),
      })),
    );

    setState(result.ok ? 'IDLE' : 'FAILED');
    setMessage(result.message ?? null);
  }

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border p-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Map these options by hand</p>
        <p className="text-sm text-muted-foreground">
          Name each option a buyer will choose, list its values, then say which
          value each supplier label carries. Nothing is guessed: what you set
          here is what buyers read, and the supplier&rsquo;s own labels stay
          untouched for fulfilment.
        </p>
      </div>

      {tooManyVariants ? (
        <p className="text-sm text-destructive">
          This product has {variants.length} variants, and a by-hand mapping can
          carry {MANUAL_MAPPING_MAX_VARIANTS}. Mapping it here would be refused,
          so the save is closed rather than offered.
        </p>
      ) : null}

      {duplicateLabels.length > 0 ? (
        <p className="text-sm text-destructive">
          {duplicateLabels.length === 1
            ? `The supplier uses the label "${duplicateLabels[0]}" for more than one variant, so those variants cannot be told apart here.`
            : `The supplier reuses ${duplicateLabels.length} labels across more than one variant each, so those variants cannot be told apart here.`}{' '}
          Mapping is blocked because the choice would be arbitrary and the
          variants can carry different prices. This has to be fixed at the
          supplier, or by sourcing the product again.
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        {drafts.map((draft, index) => {
          const nameId = `manual-axis-name-${index}`;
          const valuesId = `manual-axis-values-${index}`;
          const parsed = axes[index]?.values ?? [];

          return (
            <div
              key={draft.id}
              className="flex flex-col gap-3 rounded-md border border-border p-3"
            >
              <div className="flex items-end justify-between gap-3">
                <div className="flex-1">
                  <Label htmlFor={nameId}>Option {index + 1} name</Label>
                  <Input
                    id={nameId}
                    value={draft.name}
                    placeholder={index === 0 ? 'e.g. Colour' : 'e.g. Size'}
                    className="mt-1 h-9 max-w-xs"
                    onChange={(event) =>
                      setAxis(index, { name: event.target.value })
                    }
                  />
                </div>
                {/*
                  Only where more than one axis remains: removing the last one
                  would leave a panel that cannot describe anything.
                */}
                {drafts.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    /*
                      Every axis card carries a `Remove`, so the visible word
                      alone leaves several controls with one accessible name and
                      nothing saying which axis each destroys. The name is
                      qualified; the label stays short.
                    */
                    aria-label={
                      draft.name.trim() === ''
                        ? `Remove option ${index + 1}`
                        : `Remove ${draft.name.trim()}`
                    }
                    onClick={() => {
                      setDrafts((current) =>
                        current.filter((_axis, at) => at !== index),
                      );
                      setAssignments({});
                    }}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>

              {/*
                Offered, never pre-filled — the workbook knows what a category
                varies by and cannot know which of these axes holds it.
              */}
              {suggestedAxisNames.length > 0 && draft.name.trim() === '' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Suggested:
                  </span>
                  {suggestedAxisNames.map((suggestion) => (
                    <Button
                      key={suggestion}
                      type="button"
                      variant="outline"
                      className="h-7 px-2 text-xs"
                      onClick={() => setAxis(index, { name: suggestion })}
                    >
                      Use &ldquo;{suggestion}&rdquo;
                    </Button>
                  ))}
                </div>
              ) : null}

              <div>
                <Label htmlFor={valuesId}>
                  Values, one per line or separated by commas
                </Label>
                <Textarea
                  id={valuesId}
                  value={draft.valuesText}
                  rows={3}
                  placeholder={index === 0 ? 'Black\nGray\nKhaki' : 'M\nL\nXL'}
                  className="mt-1"
                  onChange={(event) =>
                    setAxis(index, { valuesText: event.target.value })
                  }
                />
                <p className="mt-1 text-sm text-muted-foreground">
                  {parsed.length === 0
                    ? 'No values yet.'
                    : `${parsed.length} ${parsed.length === 1 ? 'value' : 'values'}: ${parsed.join(' · ')}`}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {drafts.length < MAX_AXES ? (
        <div>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDrafts((current) => {
                nextAxisId.current += 1;

                return [
                  ...current,
                  {
                    id: `axis-${nextAxisId.current}`,
                    name: '',
                    valuesText: '',
                  },
                ];
              });
              setAssignments({});
            }}
          >
            Add another option
          </Button>
        </div>
      ) : null}

      {namedAndValued ? (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setAssignments(suggestAssignments(variants, axes))}
            >
              Fill from labels
            </Button>
            {/*
              The number of decisions left, not a readiness claim. `aria-live` so
              it is announced as cells are filled rather than silently changing.
            */}
            <p aria-live="polite" className="text-sm text-muted-foreground">
              {unassigned === 0
                ? `All ${variants.length} variants are assigned.`
                : `${unassigned} ${unassigned === 1 ? 'choice' : 'choices'} still to make.`}
            </p>
          </div>

          <ManualAssignmentTable
            variants={variants}
            axes={axes}
            assignments={assignments}
            onChange={assign}
          />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Name every option and give it at least one value to start assigning
          variants.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={!complete || state === 'SAVING'}
          onClick={() => save()}
        >
          {state === 'SAVING' ? 'Saving…' : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {/*
          Always mounted so an outcome is announced when it appears, rather than
          the live region arriving with the text already inside it.
        */}
        <p
          aria-live="polite"
          className={
            state === 'FAILED'
              ? 'text-sm text-destructive'
              : 'text-sm text-muted-foreground'
          }
        >
          {message}
        </p>
      </div>
    </div>
  );
}
