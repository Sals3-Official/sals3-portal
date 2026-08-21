import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import VariantMatrixAxisCard from './VariantMatrixAxisCard';

function valueRows(labels: string[]) {
  return labels.map((label) => <span key={label}>{label}</span>);
}

function renderCard(labels: string[], required = false, axisName?: string) {
  return render(
    <VariantMatrixAxisCard
      ordinal={1}
      required={required}
      axisName={axisName}
      nameField={<span>name field</span>}
      valueRows={valueRows(labels)}
    />,
  );
}

/** The rendered order of the value rows, as the DOM actually holds them. */
function renderedOrder(container: HTMLElement, labels: string[]): string[] {
  return Array.from(container.querySelectorAll('span'))
    .map((node) => node.textContent ?? '')
    .filter((text) => labels.includes(text));
}

describe('VariantMatrixAxisCard', () => {
  it('keeps three or fewer values in one column, so none is stranded beside a gap', () => {
    renderCard(['black', 'camel', 'pink']);

    expect(screen.getAllByText('Supplier value')).toHaveLength(1);
  });

  it('splits more than three values into two columns', () => {
    renderCard(['black', 'camel', 'pink', 'white']);

    // One header per column, so each label sits over the alignment it describes.
    expect(screen.getAllByText('Supplier value')).toHaveLength(2);
  });

  it('announces the column header once, whatever the column count', () => {
    renderCard(['black', 'camel', 'pink', 'white']);

    const announced = screen
      .getAllByText('Supplier value')
      .filter((node) => node.closest('[aria-hidden="true"]') === null);

    expect(announced).toHaveLength(1);
  });

  it('chunks column-major, so the reorder arrows still move a value vertically', () => {
    /**
     * The guard on the whole two-column layout. Values are sliced
     * `[0..h)` / `[h..n)` and laid out as two `flex-col` columns, so array
     * order — the order `moveValue` walks — runs downwards inside each visible
     * column. A row-major grid would put position 1 to the *right* of position
     * 0, and the ▲ button would then move a value left while showing an up
     * arrow.
     */
    const labels = ['black', 'camel', 'pink', 'white', 'grey'];
    const { container } = renderCard(labels);

    expect(renderedOrder(container, labels)).toEqual(labels);
  });

  it('marks the axis required only when it was told the axis is required', () => {
    const { container: optional } = renderCard(['black', 'camel'], false);

    expect(optional.querySelector('.text-destructive')).toBeNull();

    const { container: gated } = renderCard(['black', 'camel'], true);

    expect(gated.querySelector('.text-destructive')).not.toBeNull();
  });

  it('reports how many values the axis holds, in the right plural', () => {
    renderCard(['black']);

    expect(screen.getByText('1 value')).toBeInTheDocument();
  });

  it('titles an unnamed axis by its ordinal', () => {
    renderCard(['black', 'camel']);

    expect(screen.getByText('Option 1')).toBeInTheDocument();
  });

  it('titles a named axis by its name, not by a generic label', () => {
    renderCard(['black', 'camel'], false, 'Colour');

    expect(screen.getByText('Colour')).toBeInTheDocument();
    // The field below already carries `Option 1 name`; repeating it in the
    // header once the seller has answered teaches nothing.
    expect(screen.queryByText('Option 1')).toBeNull();
  });

  it('treats a whitespace-only name as unnamed', () => {
    renderCard(['black', 'camel'], false, '   ');

    expect(screen.getByText('Option 1')).toBeInTheDocument();
  });
});
