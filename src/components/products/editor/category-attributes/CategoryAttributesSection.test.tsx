import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CategoryAttributeFieldFixture } from '@/lib/seller-center/product-editor/types';
import CategoryAttributesSection from './CategoryAttributesSection';

function field(
  overrides: Partial<CategoryAttributeFieldFixture>,
): CategoryAttributeFieldFixture {
  return {
    attributeName: 'Brand',
    requirement: 'REQUIRED',
    inputControlType: 'TEXT_INPUT',
    allowedValues: [],
    allowCustomValue: true,
    allowMultipleValues: false,
    sellerHelpText: null,
    values: [],
    isCustomValue: false,
    unresolved: false,
    ...overrides,
  };
}

describe('CategoryAttributesSection', () => {
  it('renders nothing but an honest empty state when the category has no controls yet', () => {
    render(
      <CategoryAttributesSection
        fields={[]}
        controlsVersion={null}
        onFieldChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(
        'No category-specific specifications are available for this product yet.',
      ),
    ).toBeInTheDocument();
  });

  it('marks a REQUIRED field with an asterisk and shows the blocker message when unresolved', () => {
    render(
      <CategoryAttributesSection
        fields={[field({ attributeName: 'Brand', requirement: 'REQUIRED' })]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Brand *')).toBeInTheDocument();
    expect(
      screen.getByText(/Publication requires this\. It is a hard blocker/),
    ).toBeInTheDocument();
  });

  it('shows a non-blocking warning, not a blocker, for an unresolved RECOMMENDED field', () => {
    render(
      <CategoryAttributesSection
        fields={[
          field({
            attributeName: 'Life Stage',
            requirement: 'RECOMMENDED',
          }),
        ]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Life Stage')).toBeInTheDocument();
    expect(screen.queryByText('Life Stage *')).not.toBeInTheDocument();
    expect(
      screen.getByText(/Recommended for this category/),
    ).toBeInTheDocument();
  });

  it('shows no message at all for an unresolved OPTIONAL field', () => {
    render(
      <CategoryAttributesSection
        fields={[
          field({
            attributeName: 'Care Instructions',
            requirement: 'OPTIONAL',
          }),
        ]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByText('Care Instructions')).toBeInTheDocument();
    expect(
      screen.queryByText(/Publication requires this/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Recommended for this category/),
    ).not.toBeInTheDocument();
  });

  it('shows no unresolved message once a value is present', () => {
    render(
      <CategoryAttributesSection
        fields={[
          field({
            attributeName: 'Brand',
            requirement: 'REQUIRED',
            values: ['Royal Canin'],
          }),
        ]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(/Publication requires this/),
    ).not.toBeInTheDocument();
  });

  /**
   * Regression: choosing "Other (type your own)" on a required single-select
   * emits `['']` while the seller has not typed anything yet - a real array
   * entry, just blank. `values.length === 0` alone would read that as
   * already resolved; the server trims and rejects it as missing, so the
   * blocker must stay up until the custom text is non-blank.
   */
  it('keeps a required custom single-select blocking while its typed value is blank', () => {
    render(
      <CategoryAttributesSection
        fields={[
          field({
            attributeName: 'Brand',
            requirement: 'REQUIRED',
            inputControlType: 'SINGLE_SELECT_DROPDOWN',
            allowedValues: ['UNBRANDED', 'Royal Canin'],
            allowCustomValue: true,
            values: [''],
            isCustomValue: true,
          }),
        ]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Publication requires this\. It is a hard blocker/),
    ).toBeInTheDocument();
  });

  it('clears the blocker once the custom value is non-blank', () => {
    render(
      <CategoryAttributesSection
        fields={[
          field({
            attributeName: 'Brand',
            requirement: 'REQUIRED',
            inputControlType: 'SINGLE_SELECT_DROPDOWN',
            allowedValues: ['UNBRANDED', 'Royal Canin'],
            allowCustomValue: true,
            values: ['Local Artisan Brand'],
            isCustomValue: true,
          }),
        ]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByText(/Publication requires this/),
    ).not.toBeInTheDocument();
  });

  it('renders a text input for TEXT_INPUT and reports a typed value', () => {
    const onFieldChange = vi.fn();

    render(
      <CategoryAttributesSection
        fields={[
          field({
            attributeName: 'Fabric Material',
            inputControlType: 'TEXT_INPUT',
            requirement: 'OPTIONAL',
          }),
        ]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={onFieldChange}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText('Enter a value'), {
      target: { value: 'Cotton' },
    });

    expect(onFieldChange).toHaveBeenCalledWith(
      'Fabric Material',
      ['Cotton'],
      false,
    );
  });

  it('renders a number input for NUMBER_INPUT', () => {
    render(
      <CategoryAttributesSection
        fields={[
          field({
            attributeName: 'Pack Count',
            inputControlType: 'NUMBER_INPUT',
            requirement: 'OPTIONAL',
          }),
        ]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByPlaceholderText('Enter a number')).toHaveAttribute(
      'type',
      'number',
    );
  });

  it('renders a date input for DATE_PICKER', () => {
    render(
      <CategoryAttributesSection
        fields={[
          field({
            attributeName: 'Expiry Date',
            inputControlType: 'DATE_PICKER',
            requirement: 'OPTIONAL',
          }),
        ]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    const input = document.querySelector('input[type="date"]');

    expect(input).not.toBeNull();
  });

  it('renders a switch for BOOLEAN_TOGGLE', () => {
    render(
      <CategoryAttributesSection
        fields={[
          field({
            attributeName: 'Contains Batteries',
            inputControlType: 'BOOLEAN_TOGGLE',
            requirement: 'OPTIONAL',
          }),
        ]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('switch')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
  });

  it('renders a checkbox per allowed value for MULTI_SELECT_DROPDOWN', () => {
    render(
      <CategoryAttributesSection
        fields={[
          field({
            attributeName: 'Life Stage Compatibility',
            inputControlType: 'MULTI_SELECT_DROPDOWN',
            requirement: 'RECOMMENDED',
            allowedValues: ['Puppy', 'Adult', 'Senior'],
            allowMultipleValues: true,
          }),
        ]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByText('Adult')).toBeInTheDocument();
  });

  it('offers no save button when no onSave is wired (fixture/design-preview mode)', () => {
    render(
      <CategoryAttributesSection
        fields={[field({})]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: /Save Specifications/ }),
    ).not.toBeInTheDocument();
  });

  it('calls onSave and shows the returned message', async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true, message: 'Saved.' });

    render(
      <CategoryAttributesSection
        fields={[field({ values: ['Royal Canin'] })]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
        onSave={onSave}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Save Specifications' }),
    );

    expect(await screen.findByText('Saved.')).toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});
