import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MetaDescriptionField from './MetaDescriptionField';

describe('MetaDescriptionField', () => {
  it('shows the search preview using the product name and the current copy', () => {
    render(
      <MetaDescriptionField
        value="A rugged daypack built for everyday carry."
        onChange={vi.fn()}
        isSuggested={false}
        productName="Aurelis 20L Packable Daypack"
        fallbackDescription="Full supplier description text."
      />,
    );

    expect(
      screen.getByText('Aurelis 20L Packable Daypack'),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText('A rugged daypack built for everyday carry.'),
    ).toHaveLength(2);
  });

  it('falls back to the product description in the preview when meta description is empty', () => {
    render(
      <MetaDescriptionField
        value=""
        onChange={vi.fn()}
        isSuggested={false}
        productName="Aurelis 20L Packable Daypack"
        fallbackDescription="Full supplier description text."
      />,
    );

    expect(
      screen.getByText('Full supplier description text.'),
    ).toBeInTheDocument();
  });

  it('warns, but never blocks, when the copy is outside the 140-160 recommended range', () => {
    render(
      <MetaDescriptionField
        value="Too short."
        onChange={vi.fn()}
        isSuggested={false}
        productName="Aurelis 20L Packable Daypack"
        fallbackDescription=""
      />,
    );

    const counter = screen.getByText(/aim for 140-160/);

    expect(counter).toHaveClass('text-amber-600');
  });

  it('reads as on-target once the copy sits inside the recommended range', () => {
    render(
      <MetaDescriptionField
        value={'x'.repeat(150)}
        onChange={vi.fn()}
        isSuggested={false}
        productName="Aurelis 20L Packable Daypack"
        fallbackDescription=""
      />,
    );

    expect(screen.getByText(/aim for 140-160/)).toHaveClass('text-emerald-600');
  });

  it('labels an unedited suggestion, and clears the label once the seller types', () => {
    const onChange = vi.fn();

    const { rerender } = render(
      <MetaDescriptionField
        value="Suggested copy."
        onChange={onChange}
        isSuggested
        productName="Aurelis 20L Packable Daypack"
        fallbackDescription=""
      />,
    );

    expect(
      screen.getByText(/Suggested from your product details/),
    ).toBeInTheDocument();

    rerender(
      <MetaDescriptionField
        value="Suggested copy."
        onChange={onChange}
        isSuggested={false}
        productName="Aurelis 20L Packable Daypack"
        fallbackDescription=""
      />,
    );

    expect(
      screen.queryByText(/Suggested from your product details/),
    ).not.toBeInTheDocument();
  });

  it('offers no save control in design-preview mode, where there is nothing real to save to', () => {
    render(
      <MetaDescriptionField
        value="Some copy."
        onChange={vi.fn()}
        isSuggested={false}
        productName="Aurelis 20L Packable Daypack"
        fallbackDescription=""
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Save Meta Description' }),
    ).not.toBeInTheDocument();
  });

  it('reports a save failure without claiming success', async () => {
    const onSave = vi.fn(async () => ({
      ok: false,
      message: 'This product changed elsewhere.',
    }));

    render(
      <MetaDescriptionField
        value="Some copy."
        onChange={vi.fn()}
        isSuggested={false}
        productName="Aurelis 20L Packable Daypack"
        fallbackDescription=""
        onSave={onSave}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Save Meta Description' }),
    );

    expect(
      await screen.findByText('This product changed elsewhere.'),
    ).toBeInTheDocument();
  });
});
