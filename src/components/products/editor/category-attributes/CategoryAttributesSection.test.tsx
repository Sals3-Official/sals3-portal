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

  it('shows a non-blocking note for an unresolved REQUIRED field', () => {
    render(
      <CategoryAttributesSection
        fields={[field({ attributeName: 'Brand', requirement: 'REQUIRED' })]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Brand')).toBeInTheDocument();
    expect(
      screen.getByText(
        /Required for this category\. Publishing is not blocked/,
      ),
    ).toBeInTheDocument();
  });

  /**
   * These fields stopped gating publish, so dressing them as failed inputs
   * lies twice: the red destructive outline to sighted users, and
   * `aria-invalid` to assistive technology, which reserves that for a value
   * that must be corrected. An empty attribute is permitted.
   */
  it('never marks an unresolved field invalid, however the workbook labels it', () => {
    render(
      <CategoryAttributesSection
        fields={[
          field({ attributeName: 'Brand', requirement: 'REQUIRED' }),
          field({ attributeName: 'Life Stage', requirement: 'RECOMMENDED' }),
        ]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Brand')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Life Stage')).not.toHaveAttribute(
      'aria-invalid',
    );
  });

  /** The section's own group headings already say which are which. */
  it('marks no field with an asterisk, since nothing here is mandatory', () => {
    render(
      <CategoryAttributesSection
        fields={[field({ attributeName: 'Brand', requirement: 'REQUIRED' })]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.queryByText('Brand *')).not.toBeInTheDocument();
    expect(screen.getByText('Required specifications')).toBeInTheDocument();
  });

  /** Ambient guidance, not an interruption — `alert` is for something urgent. */
  it('announces the hint as status, never as an alert', () => {
    render(
      <CategoryAttributesSection
        fields={[field({ attributeName: 'Brand', requirement: 'REQUIRED' })]}
        controlsVersion="sals3-attribute-controls-v1"
        onFieldChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      /Publishing is not blocked/,
    );
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

    expect(screen.getByLabelText('Life Stage')).toBeInTheDocument();
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
  it('keeps a required custom single-select marked unresolved while its typed value is blank', () => {
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
      screen.getByText(
        /Required for this category\. Publishing is not blocked/,
      ),
    ).toBeInTheDocument();
  });

  it('clears the required message once the custom value is non-blank', () => {
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
      screen.queryByText(
        /Required for this category\. Publishing is not blocked/,
      ),
    ).not.toBeInTheDocument();
  });

  describe('buyer-facing display defaults', () => {
    it('shows Generic, never the raw UNBRANDED token, for an already-selected no-brand value', () => {
      render(
        <CategoryAttributesSection
          fields={[
            field({
              attributeName: 'Brand',
              inputControlType: 'SINGLE_SELECT_DROPDOWN',
              allowedValues: ['UNBRANDED', 'Royal Canin'],
              values: ['UNBRANDED'],
            }),
          ]}
          controlsVersion="sals3-attribute-controls-v1"
          onFieldChange={vi.fn()}
        />,
      );

      expect(screen.getByText('Generic')).toBeInTheDocument();
      expect(screen.queryByText('UNBRANDED')).not.toBeInTheDocument();
    });

    it('still submits the raw UNBRANDED token when the seller picks the no-brand option', () => {
      const onFieldChange = vi.fn();

      render(
        <CategoryAttributesSection
          fields={[
            field({
              attributeName: 'Brand',
              inputControlType: 'SINGLE_SELECT_DROPDOWN',
              allowedValues: ['UNBRANDED', 'Royal Canin'],
              values: [],
            }),
          ]}
          controlsVersion="sals3-attribute-controls-v1"
          onFieldChange={onFieldChange}
        />,
      );

      fireEvent.click(screen.getByRole('combobox'));
      fireEvent.click(screen.getByRole('option', { name: 'Generic' }));

      expect(onFieldChange).toHaveBeenCalledWith('Brand', ['UNBRANDED'], false);
    });

    it('defaults an unresolved Brand dropdown to a Generic placeholder, not a blank one', () => {
      render(
        <CategoryAttributesSection
          fields={[
            field({
              attributeName: 'Brand',
              inputControlType: 'SINGLE_SELECT_DROPDOWN',
              allowedValues: ['UNBRANDED', 'Royal Canin'],
              values: [],
            }),
          ]}
          controlsVersion="sals3-attribute-controls-v1"
          onFieldChange={vi.fn()}
        />,
      );

      expect(screen.getByText('Generic')).toBeInTheDocument();
    });

    it('defaults an unresolved Country of Origin dropdown to an Others placeholder', () => {
      render(
        <CategoryAttributesSection
          fields={[
            field({
              attributeName: 'Country of Origin',
              inputControlType: 'SINGLE_SELECT_DROPDOWN',
              allowedValues: ['Vietnam', 'China'],
              values: [],
            }),
          ]}
          controlsVersion="sals3-attribute-controls-v1"
          onFieldChange={vi.fn()}
        />,
      );

      expect(screen.getByText('Others')).toBeInTheDocument();
    });

    it('leaves a real Country of Origin selection exactly as the supplier/seller value reads', () => {
      render(
        <CategoryAttributesSection
          fields={[
            field({
              attributeName: 'Country of Origin',
              inputControlType: 'SINGLE_SELECT_DROPDOWN',
              allowedValues: ['Vietnam', 'China'],
              values: ['Vietnam'],
            }),
          ]}
          controlsVersion="sals3-attribute-controls-v1"
          onFieldChange={vi.fn()}
        />,
      );

      expect(screen.getByText('Vietnam')).toBeInTheDocument();
      expect(screen.queryByText('Others')).not.toBeInTheDocument();
    });
  });

  /**
   * Regression: the trigger's `SelectValue` used to render its own render
   * function's `value` argument verbatim - which, while a custom value is
   * showing, is the Select's *controlled* value, permanently the literal
   * `__custom__` sentinel (so the "Other" list item stays highlighted). The
   * seller's actually-typed text lived only in `field.values`, never in what
   * the trigger displayed. This never lost data - a save round-trip really
   * did persist the typed text (confirmed against the live product this was
   * first reported against) - but every load after the first rendered the
   * raw sentinel string back at the seller instead of what they typed,
   * indistinguishable from actual data loss.
   */
  describe('custom value display', () => {
    it('shows the previously typed custom value on load, not the __custom__ sentinel', () => {
      render(
        <CategoryAttributesSection
          fields={[
            field({
              attributeName: 'Pants Type',
              inputControlType: 'SINGLE_SELECT_DROPDOWN',
              allowedValues: ['Jeans', 'Chinos'],
              allowCustomValue: true,
              values: ['Corduroy Pants'],
              isCustomValue: true,
            }),
          ]}
          controlsVersion="sals3-attribute-controls-v1"
          onFieldChange={vi.fn()}
        />,
      );

      expect(screen.getByText('Corduroy Pants')).toBeInTheDocument();
      expect(screen.queryByText('__custom__')).not.toBeInTheDocument();
    });

    it('shows the typed text in the trigger as the seller types it, not the sentinel', () => {
      render(
        <CategoryAttributesSection
          fields={[
            field({
              attributeName: 'Pants Type',
              inputControlType: 'SINGLE_SELECT_DROPDOWN',
              allowedValues: ['Jeans', 'Chinos'],
              allowCustomValue: true,
              values: [''],
              isCustomValue: true,
            }),
          ]}
          controlsVersion="sals3-attribute-controls-v1"
          onFieldChange={vi.fn()}
        />,
      );

      expect(screen.queryByText('__custom__')).not.toBeInTheDocument();
    });
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

  it('renders a closed dropdown that opens to a checkbox per allowed value for MULTI_SELECT_DROPDOWN', async () => {
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

    // Closed by default - same footprint as a single-select dropdown, not an
    // always-expanded checklist.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('Select values')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Select values'));

    expect(await screen.findAllByRole('checkbox')).toHaveLength(3);
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
