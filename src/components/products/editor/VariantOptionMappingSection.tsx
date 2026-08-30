'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Pencil } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { MappedOptionAxis } from '@/lib/seller-center/product-catalogue/types';
import type {
  IssueSeverity,
  VariantMatrixValuePhoto,
} from '@/lib/seller-center/product-editor/types';
import { assignmentsFromMappedAxes } from '@/lib/seller-center/product-editor/manual-mapping-assist';
import EditorStatusPill from './EditorStatusPill';
import VariantMatrixAxisCard from './VariantMatrixAxisCard';
import VariantMatrixValueRow from './VariantMatrixValueRow';
import ManualOptionMappingPanel from './ManualOptionMappingPanel';
import VariantValuePhotoStrip from './VariantValuePhotoStrip';
import useVariantValueDrag from './use-variant-value-drag';
import { sectionBadge } from './presentation';

/**
 * Naming the Variant Matrix — the buyer-facing options a supplier encoded in
 * one string.
 *
 * CJ sends `Black-1XL` and nothing else — no structured attributes anywhere in
 * its payload. `deriveOptionSplit` proves how many positions there are and which
 * values sit at each, but it cannot know that position 0 is a *Colour*: on a
 * phone the same two slots could be plug type and storage. So the split is
 * pre-filled and a person supplies the two things only a person can — the
 * option names, and the order values should appear in.
 *
 * ## Two fields per value, and why the left one is locked
 *
 * The supplier token is the join key. Sals3's field-ownership rule is that
 * supplier content is never overwritten, so the raw token stays read-only and the
 * seller edits a display label beside it. That is also what makes re-sync safe: a
 * CJ label change is matched on the token, and renaming the display label can
 * never silently repoint a variant at another variant's price — and never
 * changes what CJ fulfillment matches on.
 *
 * The token is rendered as text rather than a disabled `Input`. It is data, not a
 * field: an input-shaped box that can never be typed into invites the click
 * anyway, doubles the row's visual weight against the one column that *is*
 * editable, and makes a screen reader announce five more textboxes that lead
 * nowhere.
 *
 * ## A suggestion, not a default
 *
 * The taxonomy workbook says what a *category* varies by, so it can suggest
 * `Colour` and `Size`. It cannot know which supplier position holds which
 * attribute — `deriveOptionSplit` proves there are two positions, but nothing in
 * CJ's payload says position 0 is a colour, and on a lamp the same slot could be
 * plug type. So the suggestion is offered as a button next to an empty field
 * instead of pre-filling a saveable value: the seller sees the actual supplier
 * values beside it and confirms in one press, and a suggestion that does not fit
 * this product costs a glance rather than becoming a wrong buyer-facing
 * attribute. For a concatenated label the publish blocker stays until a person
 * has named the axis, which is what makes that confirmation real; a single-axis
 * product shows a warning instead, because publication is not gated on it.
 *
 * ## Order is a human decision too
 *
 * `S, M, L, XL, XXL` is not alphabetical — alphabetically it is `L, M, S, XL,
 * XXL`. No algorithm recovers the intended order, which is why the rows move by
 * hand. Up/down buttons rather than drag: drag alone is unreachable by keyboard,
 * and this needs no new dependency.
 *
 * ## A presentational subsection, not its own section
 *
 * This renders no `EditorSectionCard` of its own. `ProductEditorWorkspace`
 * mounts it as the first child inside the `variants` card, directly above
 * `VariantPricingTable` — naming the matrix is what makes the pricing rows
 * below it readable, and a card inside a card would read as a subsection of
 * pricing, which this is not. Its own header row and severity pill carry
 * the same information a full section card would have shown.
 */

export type OptionMappingProposalAxis = {
  index: number;
  /** Supplier tokens at this position, in first-seen order. */
  values: string[];
};

export type VariantOptionMappingSectionProps = {
  proposal: OptionMappingProposalAxis[];
  /**
   * The saved matrix, for renaming what buyers read. Empty until mapped.
   */
  mappedAxes?: MappedOptionAxis[];
  /**
   * Rename boundary. Omitted in fixture mode, where the summary has nothing
   * real behind it to correct.
   */
  onRename?: (
    axes: {
      optionId: string;
      name: string;
      values: { valueId: string; label: string }[];
    }[],
  ) => Promise<{ ok: boolean; message: string }>;
  /** Present once mapped — the section then reports rather than edits. */
  mappedAxisNames?: string[];
  /**
   * Category-derived names aligned index-for-index with `proposal`, `null` where
   * the category offers none. Offered as a one-press suggestion, never pre-filled
   * — see the "A suggestion, not a default" note above.
   */
  /** Every name the workbook offers for each axis, in the sheet's own order. */
  suggestedAxisNames?: string[][];
  variantCount: number;
  /**
   * Whether leaving this unmapped actually blocks publication — true only for a
   * concatenated supplier label. A single-axis product is nameable but publishes
   * either way, and a pill claiming otherwise would be a blocker the server never
   * raises.
   */
  mappingBlocksPublish?: boolean;
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
  /**
   * Every variant carrying a supplier label, for the by-hand mapper.
   *
   * Only the by-hand path needs these: the derived path submits names alone
   * because the server re-derives the structure from the same column, while a
   * manual mapping is a per-variant decision and the seller has to read the
   * string they are reinterpreting.
   */
  labelledVariants?: { variantId: string; label: string }[];
  /**
   * Boundary for a mapping a person builds. Withheld in fixture mode and wherever
   * the action does not exist, so the button is never a control that cannot
   * write.
   */
  onSaveManual?: (
    axes: { name: string; values: string[] }[],
    assignments: { variantId: string; values: string[] }[],
  ) => Promise<{ ok: boolean; message?: string }>;
  /**
   * The photo standing against each saved option value, keyed by `valueId`.
   *
   * Present only for a mapped product: option values are written by
   * `saveOptionMapping`, so before that there is no row for a photo to hang
   * from. See `VariantValuePhotoStrip` for why this is derived from variant
   * media rather than stored per value.
   */
  valuePhotos?: Record<string, VariantMatrixValuePhoto>;
  /** Opens the photo picker for one variant. Omitted in fixture mode. */
  onPickValuePhoto?: (variantId: string) => void;
  /**
   * Removal boundary for a saved matrix.
   *
   * A separate capability from every other write here — `product:publish` rather
   * than `product:edit` — because it degrades a live PDP with no publish step,
   * which is the same shape as Pause. Withheld in fixture mode and wherever the
   * action is absent, so the control is never one that cannot write.
   */
  onUnmap?: () => Promise<{ ok: boolean; message: string }>;
  /**
   * Replacement boundary — the same payload the by-hand save takes, applied over
   * an existing mapping in one transaction.
   *
   * `product:edit` server-side rather than `product:publish`: a replacement leaves
   * the page with a named matrix either way, so no buyer ends up reading raw
   * supplier tokens. Removal is the one that degrades, and takes the stronger
   * capability.
   */
  onRemap?: (
    axes: { name: string; values: string[] }[],
    assignments: { variantId: string; values: string[] }[],
  ) => Promise<{ ok: boolean; message?: string }>;
  /** Whether a previous matrix is on record, so the offer is never empty. */
  hasRestorableMapping?: boolean;
  /** Puts back the last recorded matrix. Withheld with no action or no record. */
  onRestore?: () => Promise<{ ok: boolean; message: string }>;
};

type ValueDraft = { raw: string; label: string };
type AxisDraft = { name: string; values: ValueDraft[] };

function initialDrafts(proposal: OptionMappingProposalAxis[]): AxisDraft[] {
  return proposal.map((axis) => ({
    // Always empty. A category suggestion is offered beside the field, never
    // written into it — see "A suggestion, not a default" above.
    name: '',
    // Display label defaults to the supplier's own token: the honest starting
    // point, and often already correct.
    values: axis.values.map((raw) => ({ raw, label: raw })),
  }));
}

/**
 * Identity of the proposal currently held in `axes`, used to notice that the
 * server sent a different one.
 *
 * Includes each axis's position index, not just its values: a product whose
 * constant position becomes varied changes which positions are offered without
 * necessarily changing any token set.
 */
function proposalIdentity(proposal: OptionMappingProposalAxis[]): string {
  // JSON, not a delimiter string: a token could contain any character, and a
  // collision here would silently skip a resync.
  return JSON.stringify(proposal.map((axis) => [axis.index, axis.values]));
}

/**
 * The buyer-facing label ceiling, matching `option-mapping-actions`' own
 * `max(120)` on both the mapping save and the rename. Enforced in the field so a
 * seller is stopped at the limit rather than refused after typing past it.
 */
const MAX_VALUE_LABEL_LENGTH = 120;

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;

  const next = [...items];
  const [lifted] = next.splice(from, 1);

  if (lifted !== undefined) next.splice(to, 0, lifted);

  return next;
}

/**
 * One value moved one place inside one axis, for either editing mode.
 *
 * Generic over the value shape because the two modes hold different ones — a
 * proposal keyed by supplier token, a saved axis keyed by value id — while the
 * move itself is the same operation on the same array. `position` is never a
 * field here: array order is what both save paths read.
 */
/**
 * The same move, to an arbitrary position rather than one step.
 *
 * What a drop produces: the dragged value takes the index of the row it landed
 * on. `move` handles that already — it lifts before it inserts, so the
 * post-removal shift is accounted for — which is why dragging needed no second
 * reorder implementation, only a second way to say where.
 */
function moveValueTo<V, A extends { values: V[] }>(
  axes: readonly A[],
  axisIndex: number,
  from: number,
  to: number,
): A[] {
  return axes.map((axis, index) =>
    index === axisIndex
      ? { ...axis, values: move(axis.values, from, to) }
      : axis,
  );
}

function moveValue<V, A extends { values: V[] }>(
  axes: readonly A[],
  axisIndex: number,
  from: number,
  delta: -1 | 1,
): A[] {
  return moveValueTo(axes, axisIndex, from, from + delta);
}

/**
 * The subsection's own header row: a title plus the same status-pill
 * language every full `EditorSectionCard` uses, so a blocker here reads
 * exactly like a blocker anywhere else in the editor even though this is
 * not a section of its own.
 */
function VariantMatrixHeader({
  meta,
  severity,
}: {
  meta: ReactNode;
  severity: IssueSeverity | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 font-display text-sm font-semibold">
        {/* Brand accent, not a status color - a status is the pill on the
            right, this dot only says "this is the Variant Matrix." */}
        <span
          aria-hidden="true"
          className="size-2 rounded-full bg-gradient-to-br from-[#018CC9] to-[#002B53]"
        />
        Variant Matrix
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted-foreground">{meta}</span>
        <EditorStatusPill presentation={sectionBadge(severity)} />
      </div>
    </div>
  );
}

/**
 * The saved matrix, and the one edit it accepts.
 *
 * Structure is fixed once mapped — the axis count and which supplier token
 * sits where are what variants, carts, and accepted orders depend on. The
 * words are not: `option_combination_key` is built from the supplier's own
 * token, so a display name carries no identity. Offering the rename and
 * naming the limit in the same place is what keeps "cannot edit" from
 * reading as "we lost it".
 */
function MappedMatrixSummary({
  axisNames,
  mappedAxes,
  valuePhotos,
  onPickValuePhoto,
  onRename,
  onRenamed,
  onUnmap,
  onRemap,
  labelledVariants,
  suggestedAxisNames,
  variantCount,
}: {
  axisNames: string[];
  mappedAxes: MappedOptionAxis[];
  valuePhotos: Record<string, VariantMatrixValuePhoto>;
  onPickValuePhoto?: (variantId: string) => void;
  onRename?: (
    axes: {
      optionId: string;
      name: string;
      values: { valueId: string; label: string }[];
    }[],
  ) => Promise<{ ok: boolean; message: string }>;
  onRenamed: (axisNames: string[]) => void;
  /** Removal boundary. Withheld where the action does not exist. */
  onUnmap?: () => Promise<{ ok: boolean; message: string }>;
  /** Replacement boundary. Withheld where the action does not exist. */
  onRemap?: (
    axes: { name: string; values: string[] }[],
    assignments: { variantId: string; values: string[] }[],
  ) => Promise<{ ok: boolean; message?: string }>;
  labelledVariants: { variantId: string; label: string }[];
  suggestedAxisNames: string[];
  variantCount: number;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [unmapOpen, setUnmapOpen] = useState(false);
  const [unmapState, setUnmapState] = useState<'IDLE' | 'REMOVING'>('IDLE');
  const [unmapMessage, setUnmapMessage] = useState<string | null>(null);
  const [remapOpen, setRemapOpen] = useState(false);

  /**
   * Replacing needs the current mapping as a starting point and the variants to
   * assign, so it is offered only where both exist. `variantIds` on each stored
   * value is what makes the pre-fill possible with no extra query.
   */
  const canRemap =
    onRemap !== undefined &&
    mappedAxes.length > 0 &&
    labelledVariants.length === variantCount &&
    labelledVariants.length > 0;
  const [drafts, setDrafts] = useState<MappedOptionAxis[]>(mappedAxes);
  const [state, setState] = useState<'IDLE' | 'SAVING' | 'FAILED'>('IDLE');
  const [message, setMessage] = useState<string | null>(null);
  const drag = useVariantValueDrag((axisIndex, from, to) =>
    setDrafts((current) => moveValueTo(current, axisIndex, from, to)),
  );

  const canEdit = onRename !== undefined && mappedAxes.length > 0;
  const isComplete =
    drafts.length > 0 &&
    drafts.every(
      (axis) =>
        axis.name.trim() !== '' &&
        axis.values.every((value) => value.label.trim() !== ''),
    );

  async function submit() {
    if (onRename === undefined) return;

    setState('SAVING');
    setMessage(null);

    const result = await onRename(
      drafts.map((axis) => ({
        optionId: axis.optionId,
        name: axis.name.trim(),
        values: axis.values.map((value) => ({
          valueId: value.valueId,
          label: value.label.trim(),
        })),
      })),
    );

    if (!result.ok) {
      setState('FAILED');
      setMessage(result.message);

      return;
    }

    setState('IDLE');
    setMessage(result.message);
    setIsEditing(false);
    onRenamed(drafts.map((axis) => axis.name.trim()));
  }

  if (!isEditing) {
    return (
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <VariantMatrixHeader
          meta={`${axisNames.length} options mapped`}
          severity={null}
        />
        <p className="text-sm text-muted-foreground">
          Mapped as {axisNames.join(' × ')}. Supplier labels stay as received
          and are what CJ fulfillment still matches on; the display names above
          are only what buyers see on the storefront.
        </p>
        {/*
          Photos sit here rather than only behind `Edit names`: a mapped product
          spends its life in this view, and a seller looking for a colour's
          picture should not have to open a rename form to find it.
        */}
        <VariantValuePhotoStrip
          axes={mappedAxes}
          photos={valuePhotos}
          onPick={onPickValuePhoto}
        />
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setDrafts(mappedAxes);
                setMessage(null);
                setIsEditing(true);
              }}
            >
              <Pencil aria-hidden="true" />
              Edit names
            </Button>
            {canRemap ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRemapOpen(true)}
              >
                Change options
              </Button>
            ) : null}
            <span className="text-xs text-muted-foreground">
              {canRemap
                ? 'Editing names changes only the words. Changing options rebuilds which supplier value sits where.'
                : 'Names and order only. To change the number of options, or which supplier value sits where, remove the matrix and build it again.'}
            </span>
          </div>
        ) : null}
        {/*
          One transaction, so the live page never falls back to raw supplier
          labels in between — which is the whole reason this exists beside the
          remove-and-rebuild it replaces.
        */}
        {canRemap && remapOpen && onRemap !== undefined ? (
          <ManualOptionMappingPanel
            variants={labelledVariants}
            suggestedAxisNames={suggestedAxisNames}
            initialAxes={mappedAxes.map((axis) => ({
              name: axis.name,
              valuesText: axis.values.map((value) => value.label).join('\n'),
            }))}
            initialAssignments={assignmentsFromMappedAxes(
              labelledVariants.map((variant) => variant.variantId),
              mappedAxes,
            )}
            submitLabel="Replace Variant Matrix"
            onSave={onRemap}
            onCancel={() => setRemapOpen(false)}
          />
        ) : null}
        {/*
          The sentence above used to end "cannot change once variants exist",
          which stopped being true the moment removal shipped. A control that
          contradicts the copy beside it is worse than either alone.
        */}
        {onUnmap !== undefined ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={unmapState === 'REMOVING'}
              onClick={() => {
                setUnmapMessage(null);
                setUnmapOpen(true);
              }}
            >
              {unmapState === 'REMOVING' ? 'Removing…' : 'Remove matrix'}
            </Button>
            <p aria-live="polite" className="text-xs text-muted-foreground">
              {unmapMessage}
            </p>
          </div>
        ) : null}
        <AlertDialog open={unmapOpen} onOpenChange={setUnmapOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Remove the Variant Matrix from this product?
              </AlertDialogTitle>
              {/*
                Every consequence, stated before the press. The first is
                buyer-facing and immediate — there is no publish step between
                this and the live page — and the third is the one a seller would
                otherwise discover only when a later update is refused.
              */}
              <AlertDialogDescription>
                Buyers go back to reading the supplier&rsquo;s own labels on{' '}
                {variantCount} {variantCount === 1 ? 'variant' : 'variants'},
                right away, on the live page.
              </AlertDialogDescription>
              {/*
                A list rather than more sentences inside the description:
                `AlertDialogDescription` renders a `<p>`, so the block elements
                this needs cannot legally live inside it.
              */}
              <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
                <li>
                  Orders already placed keep the option names they were bought
                  with. Nothing in a customer&rsquo;s history changes.
                </li>
                <li>
                  If these labels form a grid Sals3 can read, publishing an
                  update will be blocked until the matrix is built again.
                </li>
                <li>
                  What is removed is recorded, so it can be rebuilt by hand.
                </li>
              </ul>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  if (onUnmap === undefined) return;

                  setUnmapState('REMOVING');
                  setUnmapMessage(null);

                  const result = await onUnmap();

                  setUnmapState('IDLE');
                  setUnmapMessage(result.message);
                }}
              >
                Remove matrix
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {message === null ? null : (
          <p className="text-sm text-ink-muted">{message}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 border-b border-border pb-5">
      <VariantMatrixHeader meta="Editing names" severity={null} />
      <p className="text-sm text-muted-foreground">
        Change what buyers read, and the order they read it in. Each supplier
        value stays as received beside the name you give it.
      </p>

      <div className="flex flex-col gap-4">
        {drafts.map((axis, axisIndex) => (
          /* Same card as the first-time mapping, from the same component: two
             screens editing one matrix should not look like two features. No
             required marker here — a mapped matrix already publishes. */
          <VariantMatrixAxisCard
            key={axis.optionId}
            ordinal={axisIndex + 1}
            axisName={axis.name}
            nameField={
              <div className="flex flex-col gap-1">
                <Label htmlFor={`rename-${axis.optionId}`} className="text-xs">
                  Option {axisIndex + 1} name
                </Label>
                <Input
                  id={`rename-${axis.optionId}`}
                  value={axis.name}
                  maxLength={60}
                  className="h-9 max-w-xs"
                  onChange={(event) =>
                    setDrafts((current) =>
                      current.map((item, index) =>
                        index === axisIndex
                          ? { ...item, name: event.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </div>
            }
            valueRows={axis.values.map((value, valueIndex) => (
              <VariantMatrixValueRow
                key={value.valueId}
                supplierValue={value.supplierValue}
                label={value.label}
                maxLength={MAX_VALUE_LABEL_LENGTH}
                index={valueIndex}
                count={axis.values.length}
                drag={drag.rowHandlers(axisIndex, valueIndex)}
                onLabelChange={(label) =>
                  setDrafts((current) =>
                    current.map((item, index) =>
                      index === axisIndex
                        ? {
                            ...item,
                            values: item.values.map((existing, position) =>
                              position === valueIndex
                                ? { ...existing, label }
                                : existing,
                            ),
                          }
                        : item,
                    ),
                  )
                }
                onMoveUp={() =>
                  setDrafts((current) =>
                    moveValue(current, axisIndex, valueIndex, -1),
                  )
                }
                onMoveDown={() =>
                  setDrafts((current) =>
                    moveValue(current, axisIndex, valueIndex, 1),
                  )
                }
              />
            ))}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={!isComplete || state === 'SAVING'}
          onClick={() => {
            submit().catch(() => {
              setState('FAILED');
              setMessage('The names could not be saved.');
            });
          }}
        >
          {state === 'SAVING' ? 'Saving…' : 'Save names'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={state === 'SAVING'}
          onClick={() => {
            setDrafts(mappedAxes);
            setIsEditing(false);
            setMessage(null);
          }}
        >
          Cancel
        </Button>
        {message === null ? null : (
          <span
            role="status"
            className={
              state === 'FAILED'
                ? 'text-sm text-destructive'
                : 'text-sm text-ink-muted'
            }
          >
            {message}
          </span>
        )}
      </div>
    </div>
  );
}

export default function VariantOptionMappingSection({
  proposal,
  mappedAxisNames,
  suggestedAxisNames = [],
  variantCount,
  mappingBlocksPublish = true,
  onSave,
  unlabelledVariantCount = 0,
  onRecoverLabels,
  labelledVariants = [],
  onSaveManual,
  onUnmap,
  onRemap,
  hasRestorableMapping = false,
  onRestore,
  mappedAxes = [],
  onRename,
  valuePhotos = {},
  onPickValuePhoto,
}: VariantOptionMappingSectionProps) {
  const [axes, setAxes] = useState<AxisDraft[]>(() => initialDrafts(proposal));
  /**
   * Resync when the server sends a different proposal.
   *
   * `useState`'s initializer reads its argument on mount only, and this component
   * is not keyed, so without this the drafts stay frozen at whatever the first
   * render saw. "Recover supplier labels" makes that visible and costly: it calls
   * `router.refresh()`, the refreshed `fixture` arrives with a real proposal where
   * there was none, the `proposal.length === 0` branch below stops matching — and
   * the form renders from an `axes` array that is still empty. Zero option cards,
   * and because `[].every()` is vacuously `true` the Save button is *enabled* and
   * submits nothing, which the action correctly refuses as `invalid_input`. The
   * seller sees "Those variant options could not be read" right after a recovery
   * that actually worked.
   *
   * Adjusted during render rather than in an effect — React's documented pattern
   * for state derived from props. It re-renders immediately without committing the
   * intermediate frame, so no flash of the stale form.
   */
  const identity = proposalIdentity(proposal);
  const [syncedIdentity, setSyncedIdentity] = useState(identity);

  if (syncedIdentity !== identity) {
    setSyncedIdentity(identity);
    setAxes(initialDrafts(proposal));
  }

  const [touched, setTouched] = useState<Record<number, boolean>>({});
  const [state, setState] = useState<'IDLE' | 'SAVING' | 'SAVED' | 'FAILED'>(
    'IDLE',
  );
  const [message, setMessage] = useState<string | null>(null);
  /**
   * A committed mapping changes what the read-model returns, and this
   * section is meant to switch to its report-only state from that data —
   * but that data only arrives once `router.refresh()` round-trips through
   * the server. Between "save succeeded" and "refresh landed," `mappedAxisNames`
   * hasn't moved yet, so without this the editing form stays on screen —
   * which reads as the summary card never showing up. This mirrors what was
   * just submitted the instant the save resolves; the eventual `fixture`
   * refresh still lands and either confirms it or (on a concurrent edit
   * elsewhere) replaces it with the server's own answer.
   */
  const [savedAxisNames, setSavedAxisNames] = useState<string[] | null>(null);
  const valueDrag = useVariantValueDrag((axisIndex, from, to) =>
    setAxes((current) => moveValueTo(current, axisIndex, from, to)),
  );
  const [recoverState, setRecoverState] = useState<
    'IDLE' | 'RECOVERING' | 'DONE'
  >('IDLE');
  const [recoverMessage, setRecoverMessage] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [restoreState, setRestoreState] = useState<'IDLE' | 'RESTORING'>(
    'IDLE',
  );
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null);

  /**
   * Whether a by-hand mapping is offerable at all.
   *
   * Needs both halves: an action to write through, and at least one supplier
   * label for a person to read. With no labels the recovery branch is the right
   * answer instead — a mapper listing blank rows would ask for a decision with
   * nothing to base it on.
   */
  const manualMappingAvailable =
    onSaveManual !== undefined &&
    labelledVariants.length > 0 &&
    /**
     * Every variant, not merely one.
     *
     * `saveManualOptionMapping` requires the assignment to cover **exactly** the
     * variants the product has, because a partial mapping is the shape that
     * produces colliding combination keys. The panel is fed `labelledVariants`,
     * which omits any variant with no supplier string — so on a product with a
     * mix, the seller would fill every row it showed them, press save, and be
     * told some variants have no values, with nothing on screen to fix. That is
     * the dead end this whole panel exists to remove, rebuilt one layer up.
     *
     * Unreachable today: the enclosing branch only renders this where
     * `unlabelledVariantCount === 0`, so the two counts already agree. That is an
     * *incidental* guard in another expression, and this file has been bitten
     * before by a rule that held only because of where it happened to sit.
     * Stated here so the panel cannot be mounted into the broken state by a later
     * edit, with a test holding it.
     */
    labelledVariants.length === variantCount;

  async function recover() {
    if (onRecoverLabels === undefined) return;

    setRecoverState('RECOVERING');
    setRecoverMessage(null);

    const result = await onRecoverLabels();

    setRecoverState('DONE');
    setRecoverMessage(result.message);
  }

  const effectiveMappedAxisNames = savedAxisNames ?? mappedAxisNames;

  if (
    effectiveMappedAxisNames !== undefined &&
    effectiveMappedAxisNames.length > 0
  ) {
    return (
      <MappedMatrixSummary
        onUnmap={onUnmap}
        onRemap={onRemap}
        labelledVariants={labelledVariants}
        suggestedAxisNames={[...new Set(suggestedAxisNames.flat())]}
        variantCount={variantCount}
        axisNames={effectiveMappedAxisNames}
        mappedAxes={mappedAxes}
        valuePhotos={valuePhotos}
        onPickValuePhoto={onPickValuePhoto}
        onRename={onRename}
        onRenamed={(names) => setSavedAxisNames(names)}
      />
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
      <div className="flex flex-col gap-3 border-b border-border pb-5">
        <VariantMatrixHeader
          meta={recoverable ? 'Labels missing' : 'Not detected'}
          severity={null}
        />
        {recoverable ? (
          <>
            <p className="text-sm text-muted-foreground">
              {unlabelledVariantCount} of {variantCount} variants have no
              supplier label recorded, which is why a Variant Matrix can&rsquo;t
              be proposed yet. This product was drafted before Sals3 started
              storing those labels; they are still in the supplier evidence
              already held for it and can be recovered without contacting the
              supplier.
            </p>
            <div className="flex items-center gap-3">
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
          <>
            <p className="text-sm text-muted-foreground">
              The supplier labels on this product don&rsquo;t form a grid Sals3
              can read, so nothing was proposed &mdash; nothing here is guessed.
              Until these options are named, buyers see all {variantCount}{' '}
              supplier labels whole instead of choosing an option at a time.
            </p>
            {/*
              The escape hatch `option-split.ts` has promised since it was
              written. Offered only where a person actually has something to read:
              with no labels, the recovery branch above is the answer instead.
            */}
            {/*
              Offered before the by-hand mapper, because putting back a matrix
              that already existed is less work than building one — and the
              flag means this never appears with nothing behind it.
            */}
            {hasRestorableMapping && onRestore !== undefined && !manualOpen ? (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={restoreState === 'RESTORING'}
                  onClick={async () => {
                    setRestoreState('RESTORING');
                    setRestoreMessage(null);

                    const result = await onRestore();

                    setRestoreState('IDLE');
                    setRestoreMessage(result.message);
                  }}
                >
                  {restoreState === 'RESTORING'
                    ? 'Putting it back…'
                    : 'Put back the previous options'}
                </Button>
                <p aria-live="polite" className="text-sm text-muted-foreground">
                  {restoreMessage ??
                    'This product had a Variant Matrix before. It was recorded when it was removed.'}
                </p>
              </div>
            ) : null}
            {manualMappingAvailable && !manualOpen ? (
              <div>
                <Button type="button" onClick={() => setManualOpen(true)}>
                  Map these options by hand
                </Button>
              </div>
            ) : null}
            {manualMappingAvailable && manualOpen && onSaveManual ? (
              <ManualOptionMappingPanel
                variants={labelledVariants}
                /*
                  Flattened and deduped: the derived matrix aligns suggestions to
                  proposal positions, and here there are no positions — a person
                  is inventing the axes, so every name the workbook offers for
                  this category is offered for any of them.
                */
                suggestedAxisNames={[...new Set(suggestedAxisNames.flat())]}
                onSave={onSaveManual}
                onCancel={() => setManualOpen(false)}
              />
            ) : null}
          </>
        )}
      </div>
    );
  }

  const named =
    axes.length > 0 && axes.every((axis) => axis.name.trim().length > 0);

  /**
   * Unmapped blocks publication for a concatenated label, so the badge says so
   * rather than reading as an optional nicety. A single-axis product is a real
   * improvement but not a gate, and must not borrow the word.
   */
  const unnamedBadge: IssueSeverity = mappingBlocksPublish
    ? 'BLOCKER'
    : 'WARNING';
  const unnamedSeverity = named ? null : unnamedBadge;

  function applyAxisName(axisIndex: number, name: string): void {
    setAxes((current) =>
      current.map((item, index) =>
        index === axisIndex ? { ...item, name } : item,
      ),
    );
    // Accepting a suggestion is a decision about this axis, so the field counts
    // as visited - otherwise clearing it afterwards would show no error.
    setTouched((current) => ({ ...current, [axisIndex]: true }));
  }

  async function save() {
    if (!named || onSave === undefined) return;

    setState('SAVING');
    setMessage(null);

    const submittedAxes = axes.map((axis) => ({
      name: axis.name.trim(),
      values: axis.values.map((value) => ({
        raw: value.raw,
        label: value.label.trim() === '' ? value.raw : value.label.trim(),
      })),
    }));

    const result = await onSave(submittedAxes);

    if (result.ok) {
      setSavedAxisNames(submittedAxes.map((axis) => axis.name));
    }
    setState(result.ok ? 'SAVED' : 'FAILED');
    setMessage(result.message ?? null);
  }

  /** Ordering is only an instruction when some axis has more than one value. */
  const hasValuesToOrder = axes.some((axis) => axis.values.length > 1);

  /**
   * How many combinations these axes describe, against how many the supplier
   * actually stocks.
   *
   * Sparse grids are proposed now, so the two numbers can differ — 8 × 8 = 64
   * against 52 real variants on the tactical pants. Saying so is what stops the
   * seller reading the gap as data loss: the missing combinations were never
   * stocked, and a buyer meets them as disabled chips rather than as choices that
   * fail. Silent is the wrong default here, because the matrix visibly claims
   * more than the pricing table below it lists.
   */
  const combinationCount = proposal.reduce(
    (total, axis) => total * axis.values.length,
    1,
  );
  const missingCombinations = combinationCount - variantCount;

  return (
    <div className="flex flex-col gap-4 border-b border-border pb-5">
      <VariantMatrixHeader
        meta={`${proposal.length} ${proposal.length === 1 ? 'option' : 'options'} detected`}
        severity={unnamedSeverity}
      />

      {/*
        Both plurals and the ordering clause became reachable when a
        single-variant product started getting a matrix. `1 variants` reads as
        carelessness, and telling a seller to order values makes no sense when
        every axis holds exactly one.
      */}
      <p className="text-sm text-muted-foreground">
        Found {proposal.length} buyer{' '}
        {proposal.length === 1 ? 'option' : 'options'} across {variantCount}{' '}
        {variantCount === 1 ? 'variant' : 'variants'} in the supplier&rsquo;s
        own labels. Name each option
        {hasValuesToOrder
          ? ', then order its values the way buyers should see them'
          : ''}
        . Supplier values are locked: renaming a buyer label changes the
        storefront only, and CJ still fulfils by its own value.
      </p>

      {missingCombinations > 0 ? (
        <p className="text-sm text-muted-foreground">
          These options describe {combinationCount} combinations and the
          supplier stocks {variantCount}. The {missingCombinations} it does not
          stock stay out of the pricing table below, and buyers see them greyed
          out as unavailable rather than as choices.
        </p>
      ) : null}

      <div className="flex flex-col gap-4">
        {axes.map((axis, axisIndex) => {
          const nameId = `variant-matrix-option-${axisIndex}`;
          const missingName =
            touched[axisIndex] === true && axis.name.trim() === '';
          const suggestions = suggestedAxisNames[axisIndex] ?? [];

          return (
            <VariantMatrixAxisCard
              key={proposal[axisIndex]?.values.join('|') ?? axisIndex}
              ordinal={axisIndex + 1}
              axisName={axis.name}
              // The marker only appears where the server really refuses: a
              // single-axis product is nameable but publishes either way, and a
              // required dot on it would promise a gate that does not exist.
              required={mappingBlocksPublish}
              nameField={
                <div>
                  <Label htmlFor={nameId}>Option {axisIndex + 1} name</Label>
                  <Input
                    id={nameId}
                    value={axis.name}
                    placeholder={axisIndex === 0 ? 'e.g. Colour' : 'e.g. Size'}
                    aria-invalid={missingName}
                    aria-describedby={
                      missingName ? `${nameId}-error` : undefined
                    }
                    className="mt-1 h-9 max-w-xs"
                    onBlur={() =>
                      setTouched((current) => ({
                        ...current,
                        [axisIndex]: true,
                      }))
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
                      Give this option a name before saving.
                    </p>
                  ) : null}

                  {/*
                    Offered only while the field is empty. Once a name exists —
                    typed or accepted — repeating the suggestion beside it would
                    read as a correction of the seller's own choice.
                  */}
                  {suggestions.length > 0 && axis.name.trim() === '' ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {suggestions.length === 1
                          ? 'Suggested for this category:'
                          : 'Suggested for this category — pick one:'}
                      </span>
                      {suggestions.map((suggestion) => (
                        <Button
                          key={suggestion}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => applyAxisName(axisIndex, suggestion)}
                        >
                          Use &ldquo;{suggestion}&rdquo;
                        </Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              }
              valueRows={axis.values.map((value, valueIndex) => (
                <VariantMatrixValueRow
                  key={value.raw}
                  supplierValue={value.raw}
                  label={value.label}
                  maxLength={MAX_VALUE_LABEL_LENGTH}
                  index={valueIndex}
                  count={axis.values.length}
                  drag={valueDrag.rowHandlers(axisIndex, valueIndex)}
                  onLabelChange={(label) =>
                    setAxes((current) =>
                      current.map((item, index) =>
                        index === axisIndex
                          ? {
                              ...item,
                              values: item.values.map((existing, i) =>
                                i === valueIndex
                                  ? { ...existing, label }
                                  : existing,
                              ),
                            }
                          : item,
                      ),
                    )
                  }
                  onMoveUp={() =>
                    setAxes((current) =>
                      moveValue(current, axisIndex, valueIndex, -1),
                    )
                  }
                  onMoveDown={() =>
                    setAxes((current) =>
                      moveValue(current, axisIndex, valueIndex, 1),
                    )
                  }
                />
              ))}
            />
          );
        })}
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          disabled={!named || state === 'SAVING'}
          onClick={() => save()}
          className="bg-gradient-to-r from-[#018CC9] to-[#002B53] text-white hover:brightness-110 disabled:from-muted disabled:to-muted disabled:text-muted-foreground"
        >
          {state === 'SAVING' ? 'Saving…' : 'Save Variant Matrix'}
        </Button>
        {/*
          Always mounted so the outcome is announced when it appears, rather than
          the live region itself being inserted at the same moment.
        */}
        <p aria-live="polite" className="text-sm">
          {state === 'SAVED' ? (
            <span className="text-muted-foreground">Variant Matrix saved.</span>
          ) : null}
          {state === 'FAILED' ? (
            <span className="text-destructive">
              {message ?? 'Could not save. Nothing was changed.'}
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}
