import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { MappedOptionAxis } from '@/lib/seller-center/product-catalogue/types';
import type { VariantMatrixValuePhoto } from '@/lib/seller-center/product-editor/types';
import VariantValuePhotoStrip from './VariantValuePhotoStrip';

const AXES: MappedOptionAxis[] = [
  {
    optionId: 'opt-1',
    name: 'Colour',
    values: [
      { valueId: 'val-black', label: 'Black', supplierValue: 'black' },
      { valueId: 'val-pink', label: 'Pink', supplierValue: 'pink' },
    ],
  },
];

function photo(
  overrides: Partial<VariantMatrixValuePhoto> = {},
): VariantMatrixValuePhoto {
  return {
    variantId: 'v1',
    variantLabel: 'Colour: Black',
    imageUrl: null,
    mediaId: null,
    variantCount: 1,
    ...overrides,
  };
}

describe('VariantValuePhotoStrip', () => {
  it('offers a control for a value carried by exactly one variant', () => {
    const onPick = vi.fn();

    render(
      <VariantValuePhotoStrip
        axes={AXES}
        photos={{ 'val-black': photo() }}
        onPick={onPick}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Choose photo for Black' }),
    );

    expect(onPick).toHaveBeenCalledWith('v1');
  });

  it('says Change rather than Choose once the value has a photo', () => {
    render(
      <VariantValuePhotoStrip
        axes={AXES}
        photos={{
          'val-black': photo({ imageUrl: 'https://cdn.example/b.webp' }),
        }}
        onPick={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Change photo for Black' }),
    ).toBeInTheDocument();
  });

  it('makes a shared value a control, and names the variant it lands on', () => {
    const onPick = vi.fn();

    render(
      <VariantValuePhotoStrip
        axes={AXES}
        photos={{
          'val-pink': photo({ variantId: 'v9' }),
          'val-black': photo({
            variantId: 'v-black-m',
            variantCount: 4,
            variantLabel: 'Colour: Black, Size: M',
          }),
        }}
        onPick={onPick}
      />,
    );

    /**
     * The lock this replaces existed because a shared value's photo would leave
     * the group's other variants photoless on the storefront. It does not any
     * more - `shareFirstAxisPhotos` resolves a variant's photo across its first
     * axis - so refusing here would forbid from this panel exactly what the
     * Variants & Pricing rail has always allowed.
     */
    fireEvent.click(
      screen.getByRole('button', { name: 'Choose photo for Black' }),
    );

    // The write still lands on one row, and the chip says which.
    expect(onPick).toHaveBeenCalledWith('v-black-m');
    expect(
      screen.getByText(/stored against variant Colour: Black, Size: M/),
    ).toBeInTheDocument();
  });

  it('renders a Colour x Size product rather than hiding the whole strip', () => {
    render(
      <VariantValuePhotoStrip
        axes={AXES}
        photos={{
          'val-black': photo({ variantId: 'v-black', variantCount: 4 }),
          'val-pink': photo({ variantId: 'v-pink', variantCount: 4 }),
        }}
        onPick={vi.fn()}
      />,
    );

    // Previously every value here was shared, so no chip could be a control and
    // the axis was dropped - which hid the panel on the commonest shape there
    // is. Both are controls now.
    expect(screen.getByText('Colour photos')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose photo for Black' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose photo for Pink' }),
    ).toBeInTheDocument();
  });

  it('offers no control at all when no assignment is possible', () => {
    render(
      <VariantValuePhotoStrip axes={AXES} photos={{ 'val-black': photo() }} />,
    );

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Black')).toBeInTheDocument();
  });

  it('renders nothing for an axis whose values resolved to no variant', () => {
    const { container } = render(
      <VariantValuePhotoStrip axes={AXES} photos={{}} onPick={vi.fn()} />,
    );

    // An empty row of placeholders reads as a broken feature rather than an
    // absent one.
    expect(container).toBeEmptyDOMElement();
  });

  it('treats a blank photo address as no photo, rather than rendering an image', () => {
    render(
      <VariantValuePhotoStrip
        axes={AXES}
        photos={{ 'val-black': photo({ imageUrl: '   ' }) }}
        onPick={vi.fn()}
      />,
    );

    // `next/image` throws at render on an empty `src`, and this value comes
    // from a database column through a projection.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose photo for Black' }),
    ).toBeInTheDocument();
  });

  it('titles each row with the axis name', () => {
    render(
      <VariantValuePhotoStrip
        axes={AXES}
        photos={{ 'val-black': photo() }}
        onPick={vi.fn()}
      />,
    );

    expect(screen.getByText('Colour photos')).toBeInTheDocument();
  });
});
