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

  it('refuses to make a shared value a control, and names the variant it borrowed from', () => {
    const onPick = vi.fn();

    render(
      <VariantValuePhotoStrip
        axes={AXES}
        photos={{
          // Pink is exact, so the axis renders; Black is shared, so its own
          // chip must not become a control inside it.
          'val-pink': photo({ variantId: 'v9' }),
          'val-black': photo({
            variantCount: 4,
            variantLabel: 'Colour: Black, Size: M',
          }),
        }}
        onPick={onPick}
      />,
    );

    // A picker on Black would set the photo on `Black / M` under a label
    // reading `Black`, leaving three Black variants photoless.
    expect(
      screen.queryByRole('button', { name: /photo for Black/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Choose photo for Pink' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Photo shown from variant Colour: Black, Size: M/),
    ).toBeInTheDocument();
  });

  it('drops an axis in which nothing is exact, and says where photos live instead', () => {
    render(
      <VariantValuePhotoStrip
        axes={AXES}
        photos={{
          'val-black': photo({ variantCount: 4 }),
          'val-pink': photo({ variantCount: 4 }),
        }}
        onPick={vi.fn()}
      />,
    );

    // A `Size photos` row on a Colour × Size product is noise: nothing about a
    // size has a picture.
    expect(screen.queryByText('Colour photos')).toBeNull();
    expect(screen.getByText(/shared by several variants/)).toBeInTheDocument();
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
