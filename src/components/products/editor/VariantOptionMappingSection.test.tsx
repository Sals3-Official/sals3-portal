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
/** The tactical pants' size, so the copy under test names a real number. */
const FIFTY_TWO_LABELLED = Array.from({ length: 52 }, (_row, index) => ({
  variantId: `v${index}`,
  label: `Colour${index}-XL`,
}));

describe('VariantOptionMappingSection', () => {
  it('shows the supplier token as text, not a field, and defaults each buyer label to it', () => {
    render(
      <VariantOptionMappingSection proposal={PROPOSAL} variantCount={6} />,
    );

    // Rendered as data. A disabled input-shaped box invites a click that can
    // never do anything and announces a textbox that leads nowhere.
    expect(screen.getByText('Army Green')).toBeInTheDocument();
    expect(
      screen.queryByRole('textbox', { name: /^Supplier value/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText('Label shown to buyers for Army Green'),
    ).toHaveValue('Army Green');
  });

  it('names the combinations the supplier does not stock, rather than leaving the gap unexplained', () => {
    // 2 x 3 = 6 combinations against 4 real variants: the sparse shape the
    // tactical pants made reachable. The matrix visibly claims more rows than
    // the pricing table below lists, so the gap has to be stated.
    render(
      <VariantOptionMappingSection proposal={PROPOSAL} variantCount={4} />,
    );

    expect(
      screen.getByText(/describe 6 combinations and the supplier stocks 4/),
    ).toBeInTheDocument();
    expect(screen.getByText(/The 2 it does not stock/)).toBeInTheDocument();
  });

  it('stays silent about missing combinations when the grid is complete', () => {
    render(
      <VariantOptionMappingSection proposal={PROPOSAL} variantCount={6} />,
    );

    // A sentence true of every complete grid is noise under a number that
    // changes — the same reason the reserve explanation was dropped.
    expect(screen.queryByText(/does not stock/)).not.toBeInTheDocument();
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

  /**
   * Removal is the answer to the one thing renaming never covered: a wrong
   * *assignment*. Both save paths are insert-only, so before this a variant given
   * the wrong colour was wrong permanently.
   */
  it('offers removal on a mapped product and names every consequence before the press', async () => {
    const onUnmap = vi
      .fn()
      .mockResolvedValue({ ok: true, message: 'Removed.' });

    render(
      <VariantOptionMappingSection
        proposal={PROPOSAL}
        mappedAxisNames={['Colour', 'Size']}
        variantCount={6}
        onUnmap={onUnmap}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove matrix' }));

    // Buyer-facing and immediate, because there is no publish step in between.
    expect(
      await screen.findByText(/supplier’s own labels on 6 variants/),
    ).toBeInTheDocument();
    // The reassurance that matters most, and the one a seller would not assume.
    expect(
      screen.getByText(/Orders already placed keep the option names/),
    ).toBeInTheDocument();
    // The consequence they would otherwise meet only when an update is refused.
    expect(
      screen.getByText(/publishing an update will be blocked/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/recorded, so it can be rebuilt by hand/),
    ).toBeInTheDocument();

    // Nothing has happened yet — the dialog is a gate, not a notice.
    expect(onUnmap).not.toHaveBeenCalled();
  });

  it('removes only on the confirming press, and reports what happened', async () => {
    const onUnmap = vi.fn().mockResolvedValue({
      ok: true,
      message: "Removed. Buyers now read the supplier's own labels.",
    });

    render(
      <VariantOptionMappingSection
        proposal={PROPOSAL}
        mappedAxisNames={['Colour', 'Size']}
        variantCount={6}
        onUnmap={onUnmap}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Remove matrix' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'Remove matrix' }),
    );

    await waitFor(() => expect(onUnmap).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(/Buyers now read the supplier's own labels/),
    ).toBeInTheDocument();
  });

  it('stops promising the matrix cannot change, now that it can', () => {
    render(
      <VariantOptionMappingSection
        proposal={PROPOSAL}
        mappedAxes={[
          {
            optionId: 'o1',
            name: 'Colour',
            values: [{ valueId: 'v1', label: 'Black', supplierValue: 'Black' }],
          },
        ]}
        mappedAxisNames={['Colour']}
        variantCount={6}
        onRename={async () => ({ ok: true, message: 'Saved.' })}
      />,
    );

    // The old sentence said the number of options "cannot change once variants
    // exist". Removal made that false, and copy contradicting a control beside
    // it is worse than either alone.
    expect(screen.queryByText(/cannot change once variants exist/)).toBeNull();
    expect(
      screen.getByText(/remove the matrix and build it again/),
    ).toBeInTheDocument();
  });

  it('withholds removal where the action is absent', () => {
    render(
      <VariantOptionMappingSection
        proposal={PROPOSAL}
        mappedAxisNames={['Colour', 'Size']}
        variantCount={6}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Remove matrix' }),
    ).not.toBeInTheDocument();
  });

  const MAPPED_AXES = [
    {
      optionId: 'o1',
      name: 'Colour & fit',
      values: [
        {
          valueId: 'v1',
          label: 'Black Men',
          supplierValue: 'black men',
          variantIds: ['var-1'],
        },
        {
          valueId: 'v2',
          label: 'Black Women',
          supplierValue: 'black women',
          variantIds: ['var-2'],
        },
      ],
    },
  ];

  const TWO_LABELLED = [
    { variantId: 'var-1', label: 'Black Men-L' },
    { variantId: 'var-2', label: 'Black Women-L' },
  ];

  /**
   * The gap renaming never covered. Removing then rebuilding leaves the live PDP
   * on raw supplier labels for as long as the rebuild takes, so a replacement is
   * one transaction and the seller starts from what they already decided.
   */
  it('offers changing the options on a mapped product, pre-filled from the current mapping', () => {
    render(
      <VariantOptionMappingSection
        proposal={[]}
        mappedAxes={MAPPED_AXES}
        mappedAxisNames={['Colour & fit']}
        labelledVariants={TWO_LABELLED}
        variantCount={2}
        onRename={async () => ({ ok: true, message: 'Saved.' })}
        onRemap={async () => ({ ok: true })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Change options' }));

    // The existing axis name and values arrive filled in — a replacement should
    // not mean retyping what is already decided.
    expect(screen.getByLabelText('Option 1 name')).toHaveValue('Colour & fit');
    expect(
      screen.getByText('2 values: Black Men · Black Women'),
    ).toBeInTheDocument();
    // And every variant already carries its current value, inverted out of the
    // stored `variantIds` links rather than fetched again.
    expect(screen.getByLabelText('Colour & fit for Black Men-L')).toHaveValue(
      'Black Men',
    );
    // The button says what it does. This one overwrites.
    expect(
      screen.getByRole('button', { name: 'Replace Variant Matrix' }),
    ).toBeEnabled();
  });

  it('explains that names and options are different edits', () => {
    render(
      <VariantOptionMappingSection
        proposal={[]}
        mappedAxes={MAPPED_AXES}
        mappedAxisNames={['Colour & fit']}
        labelledVariants={TWO_LABELLED}
        variantCount={2}
        onRename={async () => ({ ok: true, message: 'Saved.' })}
        onRemap={async () => ({ ok: true })}
      />,
    );

    // The old copy said the structure could not change at all. It can now, so the
    // sentence names both edits rather than denying one.
    expect(
      screen.getByText(
        /Changing options rebuilds which supplier value sits where/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/remove the matrix and build it again/),
    ).toBeNull();
  });

  it('withholds changing the options when some variant carries no label', () => {
    render(
      <VariantOptionMappingSection
        proposal={[]}
        mappedAxes={MAPPED_AXES}
        mappedAxisNames={['Colour & fit']}
        // Two of three: the server refuses a partial assignment, so the panel
        // must not be opened onto one.
        labelledVariants={TWO_LABELLED}
        variantCount={3}
        onRemap={async () => ({ ok: true })}
        onRename={async () => ({ ok: true, message: 'Saved.' })}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Change options' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/remove the matrix and build it again/),
    ).toBeInTheDocument();
  });

  it('offers putting the previous options back, only where one is on record', async () => {
    const onRestore = vi
      .fn()
      .mockResolvedValue({ ok: true, message: 'Put back 2 options.' });

    render(
      <VariantOptionMappingSection
        proposal={[]}
        variantCount={52}
        labelledVariants={FIFTY_TWO_LABELLED}
        hasRestorableMapping
        onRestore={onRestore}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Put back the previous options' }),
    );

    await waitFor(() => expect(onRestore).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Put back 2 options.')).toBeInTheDocument();
  });

  it('withholds the restore where nothing was recorded', () => {
    render(
      <VariantOptionMappingSection
        proposal={[]}
        variantCount={52}
        labelledVariants={FIFTY_TWO_LABELLED}
        hasRestorableMapping={false}
        onRestore={async () => ({ ok: true, message: 'Put back.' })}
      />,
    );

    // A control that would refuse for having nothing to do is not offered — the
    // flag is what makes that knowable before the press.
    expect(
      screen.queryByRole('button', { name: 'Put back the previous options' }),
    ).not.toBeInTheDocument();
  });

  it('says nothing was guessed when the labels form no clean grid', () => {
    render(<VariantOptionMappingSection proposal={[]} variantCount={1} />);

    expect(
      screen.getByText(/don’t form a grid Sals3 can read/),
    ).toBeInTheDocument();
    // No recovery is offered for a product whose labels are present and simply
    // do not form a grid — there is nothing to recover.
    expect(
      screen.queryByRole('button', { name: 'Recover supplier labels' }),
    ).not.toBeInTheDocument();
  });

  /**
   * The dead end this branch used to be. A seller could read that buyers would
   * see 52 raw supplier strings and had nothing to press, while
   * `option-split.ts` had promised a by-hand path since the day it was written.
   */
  it('offers a by-hand mapping where the labels cannot be split', () => {
    render(
      <VariantOptionMappingSection
        proposal={[]}
        variantCount={52}
        // All 52, because the panel may only open where every variant carries a
        // label — see the mixed-state case below.
        labelledVariants={FIFTY_TWO_LABELLED}
        onSaveManual={async () => ({ ok: true })}
      />,
    );

    // The consequence is stated in the seller's terms before the offer.
    expect(
      screen.getByText(/buyers see all 52 supplier labels whole/),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('button', { name: 'Map these options by hand' }),
    );

    expect(screen.getByLabelText('Option 1 name')).toBeInTheDocument();
  });

  it('withholds the by-hand offer when there is no action to write through', () => {
    render(
      <VariantOptionMappingSection
        proposal={[]}
        variantCount={52}
        labelledVariants={FIFTY_TWO_LABELLED}
      />,
    );

    // Same rule the photo chips follow: a control that cannot write is not
    // rendered at all.
    expect(
      screen.queryByRole('button', { name: 'Map these options by hand' }),
    ).not.toBeInTheDocument();
  });

  it('withholds it when only some variants carry a label, which the server would refuse', () => {
    render(
      <VariantOptionMappingSection
        proposal={[]}
        variantCount={3}
        // Two of three. The panel would show two rows, the seller would fill
        // both, and `saveManualOptionMapping` would refuse the whole thing for
        // covering 2 of 3 variants — a dead end with nothing on screen to fix.
        labelledVariants={[
          { variantId: 'v1', label: 'Black-L' },
          { variantId: 'v2', label: 'Black-XL' },
        ]}
        onSaveManual={async () => ({ ok: true })}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Map these options by hand' }),
    ).not.toBeInTheDocument();
  });

  it('withholds it when no variant carries a label, where recovery is the answer', () => {
    render(
      <VariantOptionMappingSection
        proposal={[]}
        variantCount={52}
        labelledVariants={[]}
        onSaveManual={async () => ({ ok: true })}
      />,
    );

    // Nothing to read means nothing to reinterpret; a mapper listing blank rows
    // would ask for a decision with no basis.
    expect(
      screen.queryByRole('button', { name: 'Map these options by hand' }),
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

  /**
   * The workbook knows the category, not which supplier position holds which
   * attribute, so a category suggestion must never arrive as a saveable value.
   * It is offered; the seller commits it.
   */
  it('offers category suggestions without pre-filling them, leaving save blocked', () => {
    const onSave = vi.fn();

    render(
      <VariantOptionMappingSection
        proposal={PROPOSAL}
        suggestedAxisNames={[['Colour'], ['Size']]}
        variantCount={6}
        onSave={onSave}
      />,
    );

    expect(screen.getByLabelText('Option 1 name')).toHaveValue('');
    expect(screen.getByLabelText('Option 2 name')).toHaveValue('');

    fireEvent.click(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    );

    expect(onSave).not.toHaveBeenCalled();
  });

  it('applies a suggestion when the seller accepts it, and then stops offering it', async () => {
    const onSave = vi.fn(async () => ({ ok: true }));

    render(
      <VariantOptionMappingSection
        proposal={PROPOSAL}
        suggestedAxisNames={[['Colour'], ['Size']]}
        variantCount={6}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use “Colour”' }));

    expect(screen.getByLabelText('Option 1 name')).toHaveValue('Colour');
    // Repeating it beside a filled field would read as correcting the seller.
    expect(
      screen.queryByRole('button', { name: 'Use “Colour”' }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Use “Size”' }));
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    );

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'Colour' }),
      expect.objectContaining({ name: 'Size' }),
    ]);
  });

  /**
   * Regression: `axes` came from a `useState` initializer, which reads its
   * argument on mount only, and this component is not keyed. "Recover supplier
   * labels" calls `router.refresh()`, so the refreshed fixture arrives with a
   * real proposal where there was none — and the form rendered from an `axes`
   * array that was still empty. Zero option cards, and because `[].every()` is
   * vacuously `true`, Save was *enabled* and submitted nothing, which the action
   * refuses as `invalid_input`. The seller saw "could not be read" straight after
   * a recovery that had worked.
   */
  it('rebuilds its drafts when the server sends a proposal it did not have before', () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <VariantOptionMappingSection
        proposal={[]}
        variantCount={6}
        unlabelledVariantCount={6}
        onSave={onSave}
      />,
    );

    expect(screen.getByText('Labels missing')).toBeInTheDocument();

    // What `router.refresh()` produces once the labels are recovered.
    rerender(
      <VariantOptionMappingSection
        proposal={PROPOSAL}
        variantCount={6}
        unlabelledVariantCount={0}
        onSave={onSave}
      />,
    );

    expect(screen.getByLabelText('Option 1 name')).toBeInTheDocument();
    expect(screen.getByLabelText('Option 2 name')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Label shown to buyers for Army Green'),
    ).toBeInTheDocument();

    // Never enabled while nothing is named - the old bug made this clickable.
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Variant Matrix' }),
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("keeps the seller's typed names when the proposal itself has not changed", () => {
    const { rerender } = render(
      <VariantOptionMappingSection proposal={PROPOSAL} variantCount={6} />,
    );

    fireEvent.change(screen.getByLabelText('Option 1 name'), {
      target: { value: 'Shade' },
    });
    rerender(
      <VariantOptionMappingSection proposal={PROPOSAL} variantCount={7} />,
    );

    expect(screen.getByLabelText('Option 1 name')).toHaveValue('Shade');
  });

  it('calls an unnamed concatenated label a blocker, because publish refuses it', () => {
    render(
      <VariantOptionMappingSection proposal={PROPOSAL} variantCount={6} />,
    );

    expect(screen.getByText('Blocker')).toBeInTheDocument();
  });

  /**
   * A single-axis product is nameable but publishes either way (owner decision
   * 2026-08-18), so the pill must not borrow a word the server never acts on.
   */
  it('calls an unnamed single-axis product a warning, not a blocker', () => {
    render(
      <VariantOptionMappingSection
        proposal={[{ index: 0, values: ['Black', 'Blue', 'Green'] }]}
        variantCount={3}
        mappingBlocksPublish={false}
      />,
    );

    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.queryByText('Blocker')).not.toBeInTheDocument();
  });

  it('offers nothing for an axis the category has no family for', () => {
    render(
      <VariantOptionMappingSection
        proposal={PROPOSAL}
        suggestedAxisNames={[['Colour'], []]}
        variantCount={6}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Use “Colour”' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Suggested for this category:')).toHaveLength(1);
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
   * What replaced the arrow pair, and why the regression this file used to guard
   * cannot recur.
   *
   * The old up/down `Button`s disabled at their end of the list, and `disabled`
   * on the focused element makes a real browser drop focus to `<body>` — so a
   * keyboard seller lost their place at the exact moment the move succeeded.
   * `keepFocusOffDisabledArrow` handed focus to the opposite arrow to cover it.
   *
   * By owner decision on 2026-08-22 the row carries one grip and nothing else.
   * It is never disabled — a move off either end is ignored — so the failure
   * mode is removed rather than handled, and the arrow keys on the grip carry
   * what the arrow buttons used to.
   */
  it('reorders a value with the arrow keys on its grip', () => {
    render(
      <VariantOptionMappingSection proposal={PROPOSAL} variantCount={6} />,
    );

    // Only the value fields: `getAllByRole('textbox')` would also pick up the
    // two axis-name inputs, which are empty and are not what is reordering.
    const labels = () =>
      screen
        .getAllByLabelText(/^Label shown to buyers for/)
        .map((node) => (node as HTMLInputElement).value);

    expect(labels()).toEqual(['Black', 'Army Green', 'S', 'M', 'L']);

    fireEvent.keyDown(
      screen.getByRole('button', { name: /^Reposition Army Green/ }),
      { key: 'ArrowUp' },
    );

    expect(labels()).toEqual(['Army Green', 'Black', 'S', 'M', 'L']);
  });

  it('keeps the grip focusable after a move that lands at an end', () => {
    render(
      <VariantOptionMappingSection proposal={PROPOSAL} variantCount={6} />,
    );

    fireEvent.keyDown(
      screen.getByRole('button', { name: /^Reposition Army Green/ }),
      { key: 'ArrowUp' },
    );

    // Landed at index 0. The old `Move up` arrow would now be disabled and
    // could not hold focus; the grip is never disabled.
    const grip = screen.getByRole('button', {
      name: /^Reposition Army Green/,
    });

    expect(grip).not.toBeDisabled();

    grip.focus();

    expect(grip).toHaveFocus();
  });

  it('offers one grip per value, and no arrows anywhere', () => {
    render(
      <VariantOptionMappingSection proposal={PROPOSAL} variantCount={6} />,
    );

    expect(
      screen.getAllByRole('button', { name: /^Reposition / }),
    ).toHaveLength(5);
    expect(screen.queryByRole('button', { name: /^Move / })).toBeNull();
  });
});

describe('Variant Matrix copy for a single variant', () => {
  it('says variant, not variants, and drops the ordering instruction', () => {
    // Both became reachable when a one-variant product started getting a matrix.
    // `1 variants` reads as carelessness, and there is nothing to order when
    // every axis holds exactly one value.
    render(
      <VariantOptionMappingSection
        proposal={[{ index: 0, values: ['Storage box'] }]}
        variantCount={1}
      />,
    );

    // The sentence is split across elements by JSX spacing, so it is read off
    // the paragraph rather than matched node by node.
    const intro = screen.getByText(/Found 1 buyer option/).textContent ?? '';

    expect(intro).toContain('across 1 variant in');
    expect(intro).not.toContain('order its values');
  });

  it('keeps both when there is a real choice', () => {
    render(
      <VariantOptionMappingSection
        proposal={[{ index: 0, values: ['Black', 'Army Green'] }]}
        variantCount={2}
      />,
    );

    const intro = screen.getByText(/Found 1 buyer option/).textContent ?? '';

    expect(intro).toContain('across 2 variants');
    expect(intro).toContain('order its values');
  });
});

describe('every workbook suggestion is offered', () => {
  it('renders one button per name and applies the one clicked', () => {
    // The workbook says this category varies by colour or material. Showing only
    // the first was a half-report, and it put "Colour" beside a bamboo organizer.
    render(
      <VariantOptionMappingSection
        proposal={[{ index: 0, values: ['Storage box'] }]}
        suggestedAxisNames={[['Colour', 'Material']]}
        variantCount={1}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Use “Colour”' }),
    ).toBeInTheDocument();

    const material = screen.getByRole('button', {
      name: 'Use “Material”',
    });

    fireEvent.click(material);

    expect(screen.getByLabelText('Option 1 name')).toHaveValue('Material');
  });

  it('says pick one only when there is more than one to pick', () => {
    render(
      <VariantOptionMappingSection
        proposal={[{ index: 0, values: ['Black', 'Army Green'] }]}
        suggestedAxisNames={[['Colour']]}
        variantCount={2}
      />,
    );

    expect(
      screen.getByText('Suggested for this category:'),
    ).toBeInTheDocument();
  });
});
