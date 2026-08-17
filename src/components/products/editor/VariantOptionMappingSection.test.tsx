import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VariantOptionMappingSection from './VariantOptionMappingSection';

const PROPOSAL = [
  { index: 0, values: ['Black', 'Army Green'] },
  { index: 1, values: ['S', 'M', 'L'] },
];

/**
 * The seller-facing half of option mapping: naming axes the supplier never
 * named, and ordering values no algorithm can order. Focus behaviour is asserted
 * because reordering is the one flow here that must work without a mouse.
 */
describe('VariantOptionMappingSection', () => {
  it('pre-fills the supplier tokens read-only and defaults each buyer label to the token', () => {
    render(
      <VariantOptionMappingSection proposal={PROPOSAL} variantCount={6} />,
    );

    const supplier = screen.getByLabelText('Supplier value Army Green');

    expect(supplier).toHaveAttribute('readonly');
    expect(supplier).toHaveValue('Army Green');
    expect(
      screen.getByLabelText('Label shown to buyers for Army Green'),
    ).toHaveValue('Army Green');
  });

  it('reports rather than edits once the axes are already named', () => {
    render(
      <VariantOptionMappingSection
        proposal={PROPOSAL}
        mappedAxisNames={['Colour', 'Size']}
        variantCount={6}
      />,
    );

    expect(screen.getByText(/Mapped as Colour × Size/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save Variant Matrix' }),
    ).not.toBeInTheDocument();
  });

  it('says nothing was guessed when the labels form no clean grid', () => {
    render(<VariantOptionMappingSection proposal={[]} variantCount={1} />);

    expect(screen.getByText(/do not form a complete grid/)).toBeInTheDocument();
    // No recovery is offered for a product whose labels are present and simply
    // do not form a grid — there is nothing to recover.
    expect(
      screen.queryByRole('button', { name: 'Recover supplier labels' }),
    ).not.toBeInTheDocument();
  });

  /**
   * The two empty-proposal states are different problems wearing the same face.
   * Labels present but non-grid cannot be repaired; labels never recorded can.
   */
  it('offers recovery instead when the labels were never recorded', () => {
    render(
      <VariantOptionMappingSection
        proposal={[]}
        variantCount={10}
        unlabelledVariantCount={10}
        onRecoverLabels={vi.fn()}
      />,
    );

    expect(screen.getByText(/10 of 10 variants/)).toBeInTheDocument();
    expect(
      screen.getByText(/without contacting the supplier/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/do not form a complete grid/)).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Recover supplier labels' }),
    ).toBeEnabled();
  });

  it('reports what recovery actually did, in the seller’s terms', async () => {
    const onRecoverLabels = vi.fn(async () => ({
      ok: true,
      message:
        'Recovered 10 supplier labels. The Variant Matrix can now be named.',
    }));

    render(
      <VariantOptionMappingSection
        proposal={[]}
        variantCount={10}
        unlabelledVariantCount={10}
        onRecoverLabels={onRecoverLabels}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Recover supplier labels' }),
    );

    await waitFor(() => expect(onRecoverLabels).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/Recovered 10 supplier labels/),
    ).toBeVisible();
  });

  it('shows a refusal from recovery without claiming anything changed', async () => {
    const onRecoverLabels = vi.fn(async () => ({
      ok: false,
      message: 'The stored supplier evidence carries no variant labels.',
    }));

    render(
      <VariantOptionMappingSection
        proposal={[]}
        variantCount={4}
        unlabelledVariantCount={4}
        onRecoverLabels={onRecoverLabels}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Recover supplier labels' }),
    );

    expect(
      await screen.findByText(/carries no variant labels/),
    ).toBeInTheDocument();
  });

  it('offers no button in design-preview mode, where there is no evidence to read', () => {
    render(
      <VariantOptionMappingSection
        proposal={[]}
        variantCount={10}
        unlabelledVariantCount={10}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Recover supplier labels' }),
    ).toBeDisabled();
  });

  it('refuses to save until every group has a name', () => {
    const onSave = vi.fn();

    render(
      <VariantOptionMappingSection
        proposal={PROPOSAL}
        variantCount={6}
        onSave={onSave}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    );

    expect(onSave).not.toHaveBeenCalled();
  });

  it('pre-fills group names from aligned taxonomy preset suggestions', async () => {
    const onSave = vi.fn(async () => ({ ok: true }));

    render(
      <VariantOptionMappingSection
        proposal={PROPOSAL}
        suggestedAxisNames={['Color / Camo Pattern', 'Garment Size (S/M/L/XL)']}
        variantCount={6}
        onSave={onSave}
      />,
    );

    expect(screen.getByLabelText('Option 1 name')).toHaveValue(
      'Color / Camo Pattern',
    );
    expect(screen.getByLabelText('Option 2 name')).toHaveValue(
      'Garment Size (S/M/L/XL)',
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    );

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'Color / Camo Pattern' }),
      expect.objectContaining({ name: 'Garment Size (S/M/L/XL)' }),
    ]);
  });

  it('ignores preset suggestions that do not align with the proposed groups', () => {
    render(
      <VariantOptionMappingSection
        proposal={PROPOSAL}
        suggestedAxisNames={['Color only']}
        variantCount={6}
      />,
    );

    expect(screen.getByLabelText('Option 1 name')).toHaveValue('');
    expect(screen.getByLabelText('Option 2 name')).toHaveValue('');
  });

  /**
   * The `mappedAxisNames` prop only moves once `router.refresh()`
   * round-trips through the server and the read-model re-derives it from
   * the DB — this simulates the window between "save resolved" and that
   * refresh landing, where the prop passed in has not changed at all.
   * Without an optimistic local update, the summary card would not appear
   * until a page the seller cannot see refreshes underneath them.
   */
  it('shows the mapped summary immediately after a successful save, before the parent has re-rendered with new props', async () => {
    const onSave = vi.fn(async () => ({ ok: true }));

    render(
      <VariantOptionMappingSection
        proposal={PROPOSAL}
        variantCount={6}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText('Option 1 name'), {
      target: { value: 'Colour' },
    });
    fireEvent.change(screen.getByLabelText('Option 2 name'), {
      target: { value: 'Size' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    );

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    expect(
      await screen.findByText(/Mapped as Colour × Size/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Save Variant Matrix' }),
    ).not.toBeInTheDocument();
  });

  it('sends the names and labels a person supplied, and never a position', async () => {
    const onSave = vi.fn(async () => ({ ok: true }));

    render(
      <VariantOptionMappingSection
        proposal={PROPOSAL}
        variantCount={6}
        onSave={onSave}
      />,
    );

    fireEvent.change(screen.getByLabelText('Option 1 name'), {
      target: { value: 'Colour' },
    });
    fireEvent.change(screen.getByLabelText('Option 2 name'), {
      target: { value: 'Size' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    );

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      {
        name: 'Colour',
        values: [
          { raw: 'Black', label: 'Black' },
          { raw: 'Army Green', label: 'Army Green' },
        ],
      },
      {
        name: 'Size',
        values: [
          { raw: 'S', label: 'S' },
          { raw: 'M', label: 'M' },
          { raw: 'L', label: 'L' },
        ],
      },
    ]);
  });

  /**
   * The regression this file exists for. Moving a value to the top disables the
   * arrow that was just pressed, and `disabled` on the focused element makes the
   * browser drop focus to `<body>` — so a keyboard seller loses their place at
   * the exact moment the move succeeds.
   */
  it('keeps focus on a usable arrow when the pressed one disables at the top', () => {
    render(
      <VariantOptionMappingSection proposal={PROPOSAL} variantCount={6} />,
    );

    const up = screen.getByRole('button', { name: 'Move Army Green up' });

    up.focus();
    expect(up).toHaveFocus();

    fireEvent.click(up);

    // Landed at index 0, so "up" is now disabled and must not hold focus.
    //
    // Asserted as "the disabled arrow does not have focus" rather than "focus is
    // not on `<body>`": a real browser drops focus to `<body>` when the focused
    // element is disabled, but jsdom leaves it on the disabled element, so the
    // body check would pass here while the bug shipped.
    const disabledUp = screen.getByRole('button', {
      name: 'Move Army Green up',
    });

    expect(disabledUp).toBeDisabled();
    expect(disabledUp).not.toHaveFocus();
    expect(
      screen.getByRole('button', { name: 'Move Army Green down' }),
    ).toHaveFocus();
  });

  it('keeps focus on a usable arrow when the pressed one disables at the bottom', () => {
    render(
      <VariantOptionMappingSection proposal={PROPOSAL} variantCount={6} />,
    );

    const down = screen.getByRole('button', { name: 'Move M down' });

    down.focus();
    fireEvent.click(down);

    const disabledDown = screen.getByRole('button', { name: 'Move M down' });

    expect(disabledDown).toBeDisabled();
    expect(disabledDown).not.toHaveFocus();
    expect(screen.getByRole('button', { name: 'Move M up' })).toHaveFocus();
  });

  it('leaves focus alone on a move that lands nowhere near an end', () => {
    render(
      <VariantOptionMappingSection proposal={PROPOSAL} variantCount={6} />,
    );

    const down = screen.getByRole('button', { name: 'Move S down' });

    down.focus();
    fireEvent.click(down);

    // S moved 0 -> 1 of three, so its own arrow stays enabled and keeps focus.
    expect(screen.getByRole('button', { name: 'Move S down' })).toHaveFocus();
  });
});
