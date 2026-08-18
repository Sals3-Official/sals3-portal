'use client';

import {
  categoryAttributeUnresolvedPlaceholder,
  categoryAttributeValueDisplayLabel,
} from '@/lib/seller-center/product-editor/attribute-display-defaults';
import type { CategoryAttributeFieldFixture } from '@/lib/seller-center/product-editor/types';
import BooleanToggleControl from './BooleanToggleControl';
import DatePickerControl from './DatePickerControl';
import MeasurementInputControl from './MeasurementInputControl';
import MultiSelectChipsControl from './MultiSelectChipsControl';
import NumberInputControl from './NumberInputControl';
import SingleSelectControl from './SingleSelectControl';
import TextInputControl from './TextInputControl';

type CategoryAttributeControlRendererProps = {
  id: string;
  field: CategoryAttributeFieldFixture;
  onChange: (values: string[], isCustomValue: boolean) => void;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
};

/** Renders the control type `Input Control Type` names - the one dispatch point, kept tiny and dumb. */
export default function CategoryAttributeControlRenderer({
  id,
  field,
  onChange,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: CategoryAttributeControlRendererProps) {
  const singleValue = field.values[0] ?? '';
  const onSingleValueChange = (value: string) =>
    onChange(value === '' ? [] : [value], false);

  switch (field.inputControlType) {
    case 'SINGLE_SELECT_DROPDOWN':
      return (
        <SingleSelectControl
          id={id}
          values={field.values}
          allowedValues={field.allowedValues}
          allowCustomValue={field.allowCustomValue}
          isCustomValue={field.isCustomValue}
          onChange={onChange}
          getDisplayLabel={(value) =>
            categoryAttributeValueDisplayLabel(field.attributeName, value)
          }
          placeholder={categoryAttributeUnresolvedPlaceholder(
            field.attributeName,
          )}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
        />
      );
    case 'MULTI_SELECT_DROPDOWN':
      return (
        <MultiSelectChipsControl
          id={id}
          values={field.values}
          allowedValues={field.allowedValues}
          allowCustomValue={field.allowCustomValue}
          onChange={onChange}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
        />
      );
    case 'NUMBER_INPUT':
      return (
        <NumberInputControl
          id={id}
          value={singleValue}
          onChange={onSingleValueChange}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
        />
      );
    case 'MEASUREMENT_INPUT':
      return (
        <MeasurementInputControl
          id={id}
          value={singleValue}
          onChange={onSingleValueChange}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
        />
      );
    case 'BOOLEAN_TOGGLE':
      return (
        <BooleanToggleControl
          id={id}
          value={singleValue}
          onChange={(value) => onChange([value], false)}
        />
      );
    case 'DATE_PICKER':
      return (
        <DatePickerControl
          id={id}
          value={singleValue}
          onChange={onSingleValueChange}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
        />
      );
    case 'TEXT_INPUT':
    default:
      return (
        <TextInputControl
          id={id}
          value={singleValue}
          onChange={onSingleValueChange}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
        />
      );
  }
}
