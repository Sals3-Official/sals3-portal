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
        buyerVisibleCount={12}
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
        buyerVisibleCount={12}
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
        buyerVisibleCount={12}
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
        buyerVisibleCount={12}
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
        buyerVisibleCount={12}
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
        buyerVisibleCount={12}
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

/**
 * The gallery became arrangeable, and supplier originals became tiles in it
 * (ADR-011 amendment 2026-08-28). These pin the four things that amendment
 * makes true and the one thing it deliberately leaves false.
 */
describe('ProductPhotoManager — arranging the gallery', () => {
  const SELLER = photo({ id: 'own-1', label: 'My shot' });
  const SUPPLIER = photo({
    id: 'sup-1',
    label: 'Supplier shot',
    sourceType: 'SUPPLIER_ORIGINAL',
    altText: 'Supplier photo',
  });

  function renderGrid(
    overrides: Partial<React.ComponentProps<typeof ProductPhotoManager>> = {},
  ) {
    const props: React.ComponentProps<typeof ProductPhotoManager> = {
      media: [SELLER, SUPPLIER],
      onUpload: vi.fn(),
      onDelete: vi.fn(),
      onMakeCover: vi.fn(),
      isUploading: false,
      deletingId: null,
      maxPhotos: 12,
      buyerVisibleCount: 12,
      ...overrides,
    };

    render(
      <ProductPhotoManager
        media={props.media}
        onUpload={props.onUpload}
        onDelete={props.onDelete}
        onMakeCover={props.onMakeCover}
        onReorder={props.onReorder}
        isUploading={props.isUploading}
        deletingId={props.deletingId}
        maxPhotos={props.maxPhotos}
        buyerVisibleCount={props.buyerVisibleCount}
      />,
    );

    return props;
  }

  /**
   * The cover is the first entry, not a tile carrying `isCover`. Passing media
   * whose flags all say `false` must still badge the leader — otherwise the
   * order and the flag are two facts that can disagree.
   */
  it('badges the first tile as the cover, reading order rather than a flag', () => {
    renderGrid({ media: [SUPPLIER, SELLER] });

    expect(screen.getByText('Cover')).toBeInTheDocument();
    expect(screen.getByText('Cover').closest('li')).toContainElement(
      screen.getByText('Supplier shot'),
    );
  });

  it("offers no delete on a supplier tile, and does on the seller's own", () => {
    renderGrid({ media: [SELLER, SUPPLIER] });

    fireEvent.mouseEnter(
      screen.getByText('Supplier shot').closest('li') as Element,
    );
    expect(
      screen.queryByRole('button', { name: /Delete Supplier shot/u }),
    ).toBeNull();

    fireEvent.mouseEnter(screen.getByText('My shot').closest('li') as Element);
    expect(
      screen.getByRole('button', { name: /Delete My shot/u }),
    ).toBeInTheDocument();
  });

  it('renders no drag grip when the caller cannot save an arrangement', () => {
    renderGrid({ onReorder: undefined });

    expect(document.querySelector('[title="Drag to reorder"]')).toBeNull();
  });

  it('moves the dragged tile to the position of the tile it enters', () => {
    const onReorder = vi.fn();

    renderGrid({ media: [SELLER, SUPPLIER], onReorder });

    const grips = document.querySelectorAll('[title="Drag to reorder"]');

    expect(grips).toHaveLength(2);

    // Drag the supplier tile (index 1) onto the cover tile (index 0).
    fireEvent.dragStart(grips[1] as Element);
    fireEvent.dragEnter(screen.getByText('My shot').closest('li') as Element);

    expect(onReorder).toHaveBeenCalledWith([SUPPLIER.id, SELLER.id]);
  });

  /**
   * A supplier photo was never uploaded, so it cannot consume the upload
   * budget. Twelve of the seller's own closes Upload even though the grid is
   * longer than twelve.
   */
  it('counts only the seller’s own uploads against the upload budget', () => {
    const owned = Array.from({ length: 12 }, (_, index) =>
      photo({ id: `own-${index}` }),
    );

    renderGrid({ media: [...owned, SUPPLIER], maxPhotos: 12 });

    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
  });

  it('still offers Upload when supplier tiles make the grid long but the budget is free', () => {
    renderGrid({ media: [SELLER, SUPPLIER], maxPhotos: 2 });

    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
  });

  /**
   * The grid can hold more rows than the storefront serves, so the seller has
   * to be told where the line is — that is the whole reason arranging matters.
   */
  it('names how many photos are stored but never shown', () => {
    renderGrid({
      media: [SELLER, SUPPLIER, photo({ id: 'own-2' })],
      buyerVisibleCount: 2,
    });

    expect(screen.getByText(/Buyers see the first 2/u)).toBeInTheDocument();
    expect(screen.getByText(/faded photo is/u)).toBeInTheDocument();
  });

  it('says nothing about a limit the gallery has not reached', () => {
    renderGrid({ media: [SELLER, SUPPLIER], buyerVisibleCount: 12 });

    expect(screen.queryByText(/Buyers see the first/u)).toBeNull();
  });
});
