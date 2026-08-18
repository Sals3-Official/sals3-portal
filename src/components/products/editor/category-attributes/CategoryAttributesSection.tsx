'use client';

import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { isCategoryAttributeUnresolved } from '@/lib/seller-center/product-editor/derive';
import type { CategoryAttributeFieldFixture } from '@/lib/seller-center/product-editor/types';
import CategoryAttributeControlRenderer from './CategoryAttributeControlRenderer';
import {
  CATEGORY_ATTRIBUTE_GROUP_ORDER,
  CATEGORY_ATTRIBUTE_GROUP_TITLES,
  CATEGORY_ATTRIBUTE_UNRESOLVED_COPY,
} from './presentation';

export type CategoryAttributesSectionProps = {
  fields: CategoryAttributeFieldFixture[];
  controlsVersion: string | null;
  onFieldChange: (
    attributeName: string,
    values: string[],
    isCustomValue: boolean,
  ) => void;
  /** Omitted for fixture/design-preview mode, so the section still renders and explains itself but saves nothing. */
  onSave?: () => Promise<{ ok: boolean; message?: string }>;
};

type FieldRowProps = {
  field: CategoryAttributeFieldFixture;
  onChange: (values: string[], isCustomValue: boolean) => void;
};

/**
 * An empty category attribute is a hint, not an error.
 *
 * Nothing here blocks publishing (`publish.ts` stopped gating on these, and
 * both issue derivations report them as `WARNING`), so the field must not be
 * dressed as a failed one. Three things follow from that:
 *
 * - **No `aria-invalid`.** It means "this value is invalid and must be
 *   corrected". An empty attribute is permitted, so the attribute was both
 *   telling screen-reader users the field was in error and painting the
 *   control with the destructive red outline. Neither was true.
 * - **No `*`.** The section already groups fields under "Required
 *   specifications" / "Recommended specifications" headings, so the asterisk
 *   restated the grouping while reading as a hard obligation.
 * - **`role="status"`, not `role="alert"`.** An alert interrupts a screen
 *   reader for something urgent; this is ambient guidance about how complete
 *   the listing looks to buyers.
 *
 * What stays is the amber note naming the attribute and saying plainly that
 * publishing is not blocked — the seller still learns which fields buyers
 * expect, without being told they have done something wrong.
 */
function FieldRow({ field, onChange }: FieldRowProps) {
  const fieldId = `category-attr-${field.attributeName.replace(/\s+/g, '-').toLowerCase()}`;
  const hintId = `${fieldId}-message`;
  const unresolved = isCategoryAttributeUnresolved(field);

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId}>{field.attributeName}</Label>
      {field.sellerHelpText !== null ? (
        <p className="text-xs text-ink-muted">{field.sellerHelpText}</p>
      ) : null}
      <CategoryAttributeControlRenderer
        id={fieldId}
        field={field}
        onChange={onChange}
        aria-describedby={unresolved ? hintId : undefined}
      />
      {unresolved ? (
        <p
          id={hintId}
          role="status"
          className="flex gap-1.5 text-xs text-amber-600"
        >
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
          />
          {CATEGORY_ATTRIBUTE_UNRESOLVED_COPY[field.requirement]}
        </p>
      ) : null}
    </div>
  );
}

export default function CategoryAttributesSection({
  fields,
  controlsVersion,
  onFieldChange,
  onSave,
}: CategoryAttributesSectionProps) {
  const [state, setState] = useState<'IDLE' | 'SAVING' | 'SAVED' | 'FAILED'>(
    'IDLE',
  );
  const [message, setMessage] = useState<string | null>(null);

  if (controlsVersion === null || fields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No category-specific specifications are available for this product yet.
      </p>
    );
  }

  async function handleSave() {
    if (onSave === undefined) return;

    setState('SAVING');
    setMessage(null);

    const result = await onSave();

    setState(result.ok ? 'SAVED' : 'FAILED');
    setMessage(result.message ?? null);
  }

  return (
    <div className="flex flex-col gap-4">
      {CATEGORY_ATTRIBUTE_GROUP_ORDER.map((requirement) => {
        const group = fields.filter(
          (field) => field.requirement === requirement,
        );

        if (group.length === 0) return null;

        return (
          <div key={requirement}>
            <h3 className="mb-2.5 text-[13px] font-semibold">
              {CATEGORY_ATTRIBUTE_GROUP_TITLES[requirement]}
            </h3>
            <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
              {group.map((field) => (
                <FieldRow
                  key={field.attributeName}
                  field={field}
                  onChange={(values, isCustomValue) =>
                    onFieldChange(field.attributeName, values, isCustomValue)
                  }
                />
              ))}
            </div>
          </div>
        );
      })}

      {onSave !== undefined ? (
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={state === 'SAVING'}
            onClick={() => handleSave()}
          >
            {state === 'SAVING' ? 'Saving…' : 'Save Specifications'}
          </Button>
          {message !== null ? (
            <p
              className={`text-sm ${state === 'FAILED' ? 'text-red-600' : 'text-ink-muted'}`}
            >
              {message}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
