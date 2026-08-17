'use client';

import { useState } from 'react';
import { OctagonAlert, TriangleAlert } from 'lucide-react';
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

/** Never presented as a value, and never blocked, until a value is entered — same rule `severityForUnresolvedSpecification` already holds for Supplier Details. */
function FieldRow({ field, onChange }: FieldRowProps) {
  const fieldId = `category-attr-${field.attributeName.replace(/\s+/g, '-').toLowerCase()}`;
  const errorId = `${fieldId}-message`;
  const unresolved = isCategoryAttributeUnresolved(field);
  const isBlocker = unresolved && field.requirement === 'REQUIRED';

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={fieldId}>
        {field.attributeName}
        {field.requirement === 'REQUIRED' ? ' *' : ''}
      </Label>
      {field.sellerHelpText !== null ? (
        <p className="text-xs text-ink-muted">{field.sellerHelpText}</p>
      ) : null}
      <CategoryAttributeControlRenderer
        id={fieldId}
        field={field}
        onChange={onChange}
        aria-invalid={unresolved ? true : undefined}
        aria-describedby={unresolved ? errorId : undefined}
      />
      {unresolved ? (
        <p
          id={errorId}
          role="alert"
          className={`flex gap-1.5 text-xs ${isBlocker ? 'text-red-600' : 'text-amber-600'}`}
        >
          {isBlocker ? (
            <OctagonAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
          ) : (
            <TriangleAlert
              aria-hidden="true"
              className="mt-0.5 size-3.5 shrink-0"
            />
          )}
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
