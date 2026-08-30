import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ManualOptionMappingPanel from './ManualOptionMappingPanel';

/**
 * Four of the real tactical-pants labels. The supplier spells gender two ways
 * across them (`Men`, `Male`), which is what makes the last word a person's and
 * not an algorithm's.
 */
const VARIANTS = [
  { variantId: 'v1', label: 'Black Men-L' },
  { variantId: 'v2', label: 'Gray Male-XL' },
];

function setup(onSave = vi.fn().mockResolvedValue({ ok: true })) {
  const onCancel = vi.fn();

  render(
    <ManualOptionMappingPanel
      variants={VARIANTS}
      onSave={onSave}
      onCancel={onCancel}
    />,
  );

  return { onSave, onCancel };
}

function defineAxes(): void {
  fireEvent.change(screen.getByLabelText('Option 1 name'), {
    target: { value: 'Colour' },
  });
  fireEvent.change(
    screen.getByLabelText(/Values, one per line/, {
      selector: '#manual-axis-values-0',
    }),
    { target: { value: 'Black\nGray' } },
  );
  fireEvent.change(screen.getByLabelText('Option 2 name'), {
    target: { value: 'Size' },
  });
  fireEvent.change(
    screen.getByLabelText(/Values, one per line/, {
      selector: '#manual-axis-values-1',
    }),
    { target: { value: 'L, XL' } },
  );
}

describe('ManualOptionMappingPanel', () => {
  it('asks for axes before offering any variant rows', () => {
    setup();

    expect(
      screen.getByText(/Name every option and give it at least one value/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    ).toBeDisabled();
  });

  it('echoes the parsed values so a comma list is visibly understood', () => {
    setup();
    defineAxes();

    // `L, XL` typed as one line reads back as two values, before the seller
    // commits to anything.
    expect(screen.getByText('2 values: L · XL')).toBeInTheDocument();
  });

  it('shows the supplier label as text, never as a field', () => {
    setup();
    defineAxes();

    expect(screen.getByText('Black Men-L')).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: /Black Men-L/ }),
    ).not.toBeInTheDocument();
  });

  it('keeps the save disabled while any cell is unset, and counts what is left', () => {
    setup();
    defineAxes();

    // Two variants across two axes is four decisions, and the count names
    // decisions rather than rows.
    expect(screen.getByText('4 choices still to make.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    ).toBeDisabled();
  });

  it('fills what the labels plainly say and leaves the rest for a person', () => {
    setup();
    defineAxes();

    fireEvent.click(screen.getByRole('button', { name: 'Fill from labels' }));

    // Colour and Size are unambiguous in both labels.
    expect(screen.getByLabelText('Colour for Black Men-L')).toHaveValue(
      'Black',
    );
    expect(screen.getByLabelText('Size for Gray Male-XL')).toHaveValue('XL');
    expect(
      screen.getByText('All 2 variants are assigned.'),
    ).toBeInTheDocument();
  });

  it('leaves a gap unset when the supplier used a different word, rather than guessing', () => {
    setup();
    fireEvent.change(screen.getByLabelText('Option 1 name'), {
      target: { value: 'Fit' },
    });
    fireEvent.change(
      screen.getByLabelText(/Values, one per line/, {
        selector: '#manual-axis-values-0',
      }),
      { target: { value: 'Men\nWomen' } },
    );
    // Named, because each axis card carries a Remove and the second one is the
    // axis being dropped here.
    fireEvent.click(screen.getByRole('button', { name: 'Remove option 2' }));

    fireEvent.click(screen.getByRole('button', { name: 'Fill from labels' }));

    // `Black Men-L` matches. `Gray Male-XL` says Male, so it stays unset and the
    // save stays blocked — a wrong fit on a live listing is the failure this
    // whole path is careful about.
    expect(screen.getByLabelText('Fit for Black Men-L')).toHaveValue('Men');
    expect(screen.getByLabelText('Fit for Gray Male-XL')).toHaveValue('');
    expect(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    ).toBeDisabled();
  });

  it('submits the axes and one complete assignment per variant', async () => {
    const { onSave } = setup();

    defineAxes();
    fireEvent.click(screen.getByRole('button', { name: 'Fill from labels' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    );

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    expect(onSave).toHaveBeenCalledWith(
      [
        { name: 'Colour', values: ['Black', 'Gray'] },
        { name: 'Size', values: ['L', 'XL'] },
      ],
      [
        { variantId: 'v1', values: ['Black', 'L'] },
        { variantId: 'v2', values: ['Gray', 'XL'] },
      ],
    );
  });

  it('drops assignments when an axis changes, so a removed value cannot be submitted', () => {
    setup();
    defineAxes();
    fireEvent.click(screen.getByRole('button', { name: 'Fill from labels' }));

    expect(
      screen.getByText('All 2 variants are assigned.'),
    ).toBeInTheDocument();

    // Renaming a colour away would leave `Black` sitting in a row whose axis no
    // longer offers it — which the server refuses as UNKNOWN_VALUE, with the
    // seller given no way to see why.
    fireEvent.change(
      screen.getByLabelText(/Values, one per line/, {
        selector: '#manual-axis-values-0',
      }),
      { target: { value: 'Charcoal\nGray' } },
    );

    expect(screen.getByText('4 choices still to make.')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    ).toBeDisabled();
  });

  it('reports a refusal in the seller’s own words instead of clearing the form', async () => {
    const onSave = vi
      .fn()
      .mockResolvedValue({ ok: false, message: 'That product changed.' });

    setup(onSave);
    defineAxes();
    fireEvent.click(screen.getByRole('button', { name: 'Fill from labels' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    );

    expect(
      await screen.findByText('That product changed.'),
    ).toBeInTheDocument();
    // The work survives the refusal, so it can be retried rather than retyped.
    expect(screen.getByLabelText('Colour for Black Men-L')).toHaveValue(
      'Black',
    );
  });

  it('names each Remove for the axis it destroys, not just "Remove"', () => {
    setup();

    fireEvent.change(screen.getByLabelText('Option 1 name'), {
      target: { value: 'Colour' },
    });

    // Once named, the control says which axis it drops. Before that it falls back
    // to the ordinal, which is still unambiguous.
    expect(
      screen.getByRole('button', { name: 'Remove Colour' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove option 2' }),
    ).toBeInTheDocument();
  });

  /**
   * `deriveOptionSplit` refuses a duplicate label because two variants would
   * collapse onto one combination, so a product carrying one lands in this panel
   * — as two rows reading the same string. Nobody can tell them apart, so being
   * offered the choice would record a coin flip as a decision.
   */
  it('blocks mapping and names the repeated string when a label is reused', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();

    render(
      <ManualOptionMappingPanel
        variants={[
          { variantId: 'v1', label: 'Black Men-L' },
          { variantId: 'v2', label: 'Black Men-L' },
        ]}
        onSave={onSave}
        onCancel={onCancel}
      />,
    );

    expect(screen.getByText(/"Black Men-L"/)).toBeInTheDocument();
    expect(screen.getByText(/cannot be told apart/)).toBeInTheDocument();

    defineAxes();
    fireEvent.click(screen.getByRole('button', { name: 'Fill from labels' }));

    // Even fully assigned, the save stays shut: the assignment would be
    // arbitrary and the two variants can carry different prices.
    expect(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    ).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('says nothing about duplicates when every label is distinct', () => {
    setup();

    // A sentence true of nearly every product is noise, and this one is alarming.
    expect(screen.queryByText(/cannot be told apart/)).not.toBeInTheDocument();
  });

  it('closes the save past the payload cap instead of letting the action misreport it', () => {
    const onSave = vi.fn();

    render(
      <ManualOptionMappingPanel
        variants={Array.from({ length: 401 }, (_row, index) => ({
          variantId: `v${index}`,
          label: `Colour${index}-XL`,
        }))}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    // The action would answer `invalid_input`, whose message names option groups
    // and would be wrong about the reason.
    expect(screen.getByText(/401 variants/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    ).toBeDisabled();
  });

  it('offers a third axis, which is what splits a colour-and-gender token', () => {
    setup();

    fireEvent.click(screen.getByRole('button', { name: 'Add another option' }));

    expect(screen.getByLabelText('Option 3 name')).toBeInTheDocument();
  });
});
