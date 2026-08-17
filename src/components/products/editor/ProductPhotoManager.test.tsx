import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaItemFixture } from '@/lib/seller-center/product-editor/types';
import ProductPhotoManager from './ProductPhotoManager';

function photo(
  overrides: Partial<MediaItemFixture> & { id: string },
): MediaItemFixture {
  return {
    label: 'Photo',
    sourceUrl: null,
    altText: 'Seller-uploaded photo',
    rightsCheck: 'VERIFIED',
    storageState: 'SALS3_STORED',
    sourceType: 'SELLER_UPLOAD',
    pixelWidth: 1200,
    pixelHeight: 1200,
    note: null,
    isCover: false,
    ...overrides,
  };
}

describe('ProductPhotoManager', () => {
  it('shows only the upload tile when there are no photos yet', () => {
    render(
      <ProductPhotoManager
        media={[]}
        onUpload={vi.fn()}
        onDelete={vi.fn()}
        onMakeCover={vi.fn()}
        isUploading={false}
        deletingId={null}
        maxPhotos={12}
      />,
    );

    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Delete/ }),
    ).not.toBeInTheDocument();
  });

  it('renders the cover photo without a "set as cover" control, since it already is one', () => {
    render(
      <ProductPhotoManager
        media={[photo({ id: 'p1', label: 'Cover shot', isCover: true })]}
        onUpload={vi.fn()}
        onDelete={vi.fn()}
        onMakeCover={vi.fn()}
        isUploading={false}
        deletingId={null}
        maxPhotos={12}
      />,
    );

    expect(screen.getByText('Cover')).toBeInTheDocument();
    fireEvent.mouseEnter(screen.getByText('Cover').closest('li') as Element);

    expect(
      screen.queryByRole('button', { name: /Set Cover shot as cover/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Delete Cover shot' }),
    ).toBeInTheDocument();
  });

  it('lets the seller pick a new cover from a non-cover tile', () => {
    const onMakeCover = vi.fn();

    render(
      <ProductPhotoManager
        media={[
          photo({ id: 'p1', label: 'Cover shot', isCover: true }),
          photo({ id: 'p2', label: 'Second shot' }),
        ]}
        onUpload={vi.fn()}
        onDelete={vi.fn()}
        onMakeCover={onMakeCover}
        isUploading={false}
        deletingId={null}
        maxPhotos={12}
      />,
    );

    const secondTile = screen.getByText('Second shot').closest('li') as Element;

    fireEvent.mouseEnter(secondTile);
    fireEvent.click(
      screen.getByRole('button', { name: 'Set Second shot as cover' }),
    );

    expect(onMakeCover).toHaveBeenCalledWith('p2');
  });

  it('deletes a photo through onDelete', () => {
    const onDelete = vi.fn();

    render(
      <ProductPhotoManager
        media={[photo({ id: 'p1', label: 'Only shot', isCover: true })]}
        onUpload={vi.fn()}
        onDelete={onDelete}
        onMakeCover={vi.fn()}
        isUploading={false}
        deletingId={null}
        maxPhotos={12}
      />,
    );

    fireEvent.mouseEnter(
      screen.getByText('Only shot').closest('li') as Element,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete Only shot' }));

    expect(onDelete).toHaveBeenCalledWith('p1');
  });

  it('hides the upload tile once the product is at the photo cap', () => {
    const media = Array.from({ length: 3 }, (_, index) =>
      photo({ id: `p${index}`, label: `Shot ${index}`, isCover: index === 0 }),
    );

    render(
      <ProductPhotoManager
        media={media}
        onUpload={vi.fn()}
        onDelete={vi.fn()}
        onMakeCover={vi.fn()}
        isUploading={false}
        deletingId={null}
        maxPhotos={3}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Upload' }),
    ).not.toBeInTheDocument();
  });

  it('disables Upload with an honest reason when there is no real product to attach a photo to', () => {
    render(
      <ProductPhotoManager
        media={[]}
        onDelete={vi.fn()}
        onMakeCover={vi.fn()}
        isUploading={false}
        deletingId={null}
        maxPhotos={12}
      />,
    );

    const uploadButton = screen.getByRole('button', { name: 'Upload' });

    expect(uploadButton).toBeDisabled();
    expect(uploadButton).toHaveAttribute(
      'title',
      expect.stringContaining('real product'),
    );
  });
});
