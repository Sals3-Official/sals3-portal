import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MediaItemFixture } from '@/lib/seller-center/product-editor/types';
import SupplierMediaGallery from './SupplierMediaGallery';

/**
 * The supplier's photographs became arrangeable on 2026-08-28, and only
 * arrangeable. ADR-011 §3 called the set read-only; the amendment relaxed
 * exactly one of the three things that meant — order — and left "never
 * deleted, never replaced" standing.
 *
 * On 2026-08-30 the owner reported the panel unusable: 44px tiles and a native
 * drag grip. The grip is gone. Its replacement is a `Set as cover` button and
 * two chevrons, which is the same single write reached from keyboard and touch
 * as well as a mouse — native HTML5 drag fires from neither of the first two.
 *
 * `Set as cover` is not new authority. The cover is position 0 of the whole
 * gallery, and this panel already wrote position 0 whenever the seller had
 * uploaded nothing; the drag was choosing a cover without saying so. What the
 * button adds is the name and the keyboard.
 */

function supplierPhoto(id: string, label: string): MediaItemFixture {
  return {
    id,
    label,
    sourceUrl: `https://media.example-r2.dev/supplier-media/p/${id}.webp`,
    altText: label,
    rightsCheck: 'VERIFIED',
    storageState: 'SUPPLIER_HOSTED_SOURCE',
    sourceType: 'SUPPLIER_ORIGINAL',
    pixelWidth: 800,
    pixelHeight: 800,
    note: null,
    isCover: false,
  };
}

const A = supplierPhoto(
  '11111111-1111-4111-8111-111111111111',
  'Supplier photo 1',
);
const B = supplierPhoto(
  '22222222-2222-4222-8222-222222222222',
  'Supplier photo 2',
);
const C = supplierPhoto(
  '33333333-3333-4333-8333-333333333333',
  'Supplier photo 3',
);

describe('SupplierMediaGallery', () => {
  it('offers no controls when the caller cannot save an arrangement', () => {
    render(<SupplierMediaGallery media={[A, B]} sellerGalleryCount={0} />);

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('offers no controls for a single photo, which has nowhere to move', () => {
    render(
      <SupplierMediaGallery
        media={[A]}
        onReorder={vi.fn()}
        sellerGalleryCount={0}
      />,
    );

    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  /**
   * The owner's actual complaint, as a guard. A grip that fires only from a
   * mouse made the supplier's order unchangeable on a tablet, and made the one
   * decision that matters most — which photograph a buyer meets first —
   * mouse-only. Nothing here may go back to being drag-only.
   */
  it('carries no drag grip anywhere', () => {
    const { container } = render(
      <SupplierMediaGallery
        media={[A, B, C]}
        onReorder={vi.fn()}
        sellerGalleryCount={0}
      />,
    );

    expect(container.querySelectorAll('[draggable]')).toHaveLength(0);
    expect(document.querySelectorAll('[title="Drag to reorder"]')).toHaveLength(
      0,
    );
  });

  it('sends a photo to the front when it is set as the cover', () => {
    const onReorder = vi.fn();

    render(
      <SupplierMediaGallery
        media={[A, B, C]}
        onReorder={onReorder}
        sellerGalleryCount={0}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Set Supplier photo 3 as cover' }),
    );

    expect(onReorder).toHaveBeenCalledWith([C.id, A.id, B.id]);
  });

  it('moves a photo one place with the chevrons', () => {
    const onReorder = vi.fn();

    render(
      <SupplierMediaGallery
        media={[A, B, C]}
        onReorder={onReorder}
        sellerGalleryCount={0}
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Move Supplier photo 3 earlier' }),
    );

    expect(onReorder).toHaveBeenCalledWith([A.id, C.id, B.id]);
  });

  /**
   * A control that cannot do anything is worse than no control: it reads as a
   * broken panel rather than as an edge of the list.
   */
  it('disables the chevron that would move a photo off either end', () => {
    render(
      <SupplierMediaGallery
        media={[A, B, C]}
        onReorder={vi.fn()}
        sellerGalleryCount={0}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Move Supplier photo 1 earlier' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move Supplier photo 3 later' }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'Move Supplier photo 2 earlier' }),
    ).not.toBeDisabled();
  });

  /**
   * The load-bearing half of the amendment. Arranging a supplier photograph is
   * an editorial fact about the evidence; removing or swapping one would be a
   * change to it. `delete-seller-media.ts` enforces the same rule in its
   * `WHERE`, so this is the courtesy and the query is the guarantee — but a
   * delete control appearing here would still be a promise the server refuses.
   */
  it('offers no delete and no replace, ever', () => {
    render(
      <SupplierMediaGallery
        media={[A, B]}
        onReorder={vi.fn()}
        sellerGalleryCount={0}
      />,
    );

    expect(screen.queryByRole('button', { name: /delete/iu })).toBeNull();
    expect(screen.queryByRole('button', { name: /replace/iu })).toBeNull();
    expect(screen.queryByRole('button', { name: /remove/iu })).toBeNull();
  });

  describe('when the seller has uploaded nothing', () => {
    it('names the supplier’s first photo as the cover', () => {
      render(
        <SupplierMediaGallery
          media={[A, B]}
          onReorder={vi.fn()}
          sellerGalleryCount={0}
        />,
      );

      expect(screen.getByText('Cover')).toBeInTheDocument();
      expect(screen.getByText('Buyers see this first')).toBeInTheDocument();
      expect(screen.getByText(/the thumbnail buyers see/u)).toBeInTheDocument();
    });
  });

  /**
   * The composed order is `[...seller uploads, ...supplier photos]`
   * (`ProductEditorWorkspace`'s `composeGalleryOrder`), so once a seller upload
   * exists nothing in this panel can reach position 0. A `Cover` badge or a
   * `Set as cover` button here would then be asserting something the storefront
   * contradicts — the panel overruling the ordering it just wrote.
   */
  describe('when a seller upload already holds the cover', () => {
    it('claims no cover, and says who has it', () => {
      render(
        <SupplierMediaGallery
          media={[A, B]}
          onReorder={vi.fn()}
          sellerGalleryCount={2}
        />,
      );

      expect(screen.queryByText('Cover')).toBeNull();
      expect(screen.getByText('1st supplier')).toBeInTheDocument();
      expect(
        screen.getByText(/Your own photo is the cover/u),
      ).toBeInTheDocument();
    });

    it('offers Move to front instead of Set as cover', () => {
      const onReorder = vi.fn();

      render(
        <SupplierMediaGallery
          media={[A, B]}
          onReorder={onReorder}
          sellerGalleryCount={1}
        />,
      );

      expect(screen.queryByRole('button', { name: /as cover/iu })).toBeNull();

      fireEvent.click(
        screen.getByRole('button', {
          name: 'Move Supplier photo 2 to the front of the supplier photos',
        }),
      );

      expect(onReorder).toHaveBeenCalledWith([B.id, A.id]);
    });
  });

  /**
   * Arranging evidence does not make it more or less verified, so the rights
   * and dimension detail each tile carries has to survive the change.
   */
  it('keeps the rights and dimension evidence on every tile', () => {
    render(
      <SupplierMediaGallery
        media={[A, B]}
        onReorder={vi.fn()}
        sellerGalleryCount={0}
      />,
    );

    expect(
      screen.getAllByText(/Supplier photo 1 — Verified — 800 × 800/u).length,
    ).toBeGreaterThan(0);
  });

  it('still explains itself when the product has no supplier photo at all', () => {
    render(
      <SupplierMediaGallery
        media={[]}
        onReorder={vi.fn()}
        sellerGalleryCount={0}
      />,
    );

    expect(
      screen.getByText(/No supplier photo address is recorded/u),
    ).toBeInTheDocument();
  });
});
