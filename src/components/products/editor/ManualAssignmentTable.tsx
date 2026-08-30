'use client';

import type { SuggestedAssignments } from '@/lib/seller-center/product-editor/manual-mapping-assist';

/**
 * One row per variant: the supplier's own string, and a value picked per axis.
 *
 * ## A native `<select>`, deliberately
 *
 * The live tactical pants has 52 variants. At three axes that is 156 controls on
 * one screen, and the project's `Select` is a Radix popover — 156 of them is a
 * mount cost and a bundle cost for a control whose entire job is picking one of
 * four short strings. A native `<select>` is keyboard-navigable, works under
 * touch, announces correctly, needs no JavaScript to open, and is what a phone
 * renders as its own wheel.
 *
 * It is also the one control in this editor a browser automation tool can drive
 * reliably, which matters because a Radix trigger has twice defeated
 * verification here.
 *
 * ## The supplier label is text, not a field
 *
 * Same rule the derived matrix follows: supplier content is never edited, so it
 * is rendered as data. An input-shaped box that cannot be typed into invites the
 * click anyway and announces a textbox leading nowhere.
 */

export type ManualAssignmentTableProps = {
  variants: { variantId: string; label: string }[];
  /** `id` keys the columns — an axis's name is empty on a fresh one and may repeat. */
  axes: { id: string; name: string; values: string[] }[];
  assignments: SuggestedAssignments;
  onChange: (variantId: string, axisIndex: number, value: string) => void;
};

export default function ManualAssignmentTable({
  variants,
  axes,
  assignments,
  onChange,
}: ManualAssignmentTableProps) {
  return (
    /*
      Its own scroll container. A 52-row table with four columns must not be what
      makes the editor page scroll sideways.
    */
    <div className="max-h-96 overflow-auto rounded-md border border-border">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 bg-muted">
          <tr>
            <th
              scope="col"
              className="px-3 py-2 text-left font-medium text-muted-foreground"
            >
              Supplier label
            </th>
            {axes.map((axis, axisIndex) => (
              <th
                key={axis.id}
                scope="col"
                className="px-3 py-2 text-left font-medium text-muted-foreground"
              >
                {axis.name.trim() === ''
                  ? `Option ${axisIndex + 1}`
                  : axis.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {variants.map((variant) => {
            const row = assignments[variant.variantId] ?? [];

            return (
              <tr key={variant.variantId} className="border-t border-border">
                {/*
                  A row header, not a cell: it names every control in the row, so
                  a screen reader announces "Colour for Black Men-L" and the row
                  it belongs to rather than a bare dropdown.
                */}
                <th
                  scope="row"
                  className="px-3 py-2 text-left align-middle font-normal"
                >
                  {variant.label}
                </th>
                {axes.map((axis, axisIndex) => {
                  const value = row[axisIndex] ?? '';
                  const label = `${axis.name.trim() === '' ? `Option ${axisIndex + 1}` : axis.name} for ${variant.label}`;

                  return (
                    <td
                      key={`${variant.variantId}-${axis.id}`}
                      className="px-3 py-2 align-middle"
                    >
                      <select
                        aria-label={label}
                        value={value}
                        // Marked invalid while empty so the rows still needing a
                        // decision are findable without reading all 52.
                        aria-invalid={value === ''}
                        className="h-9 w-full min-w-28 rounded-md border border-input bg-background px-2 text-sm aria-invalid:border-destructive"
                        onChange={(event) =>
                          onChange(
                            variant.variantId,
                            axisIndex,
                            event.target.value,
                          )
                        }
                      >
                        {/*
                          A real empty option rather than a disabled placeholder:
                          clearing a cell the seller filled by mistake has to be
                          possible without reloading the editor.
                        */}
                        <option value="">Not set</option>
                        {axis.values.map((candidate) => (
                          <option key={candidate} value={candidate}>
                            {candidate}
                          </option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
