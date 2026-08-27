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
 * The drag lives in this panel rather than in Product media on the owner's own
 * correction: Product media counts what the seller uploaded, so supplier tiles
 * under a counter reading "0 of 12 photos" was a panel arguing with itself.
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

function grips(): NodeListOf<Element> {
  return document.querySelectorAll('[title="Drag to reorder"]');
}

describe('SupplierMediaGallery', () => {
  it('offers no grip when the caller cannot save an arrangement', () => {
    render(<SupplierMediaGallery media={[A, B]} />);

    expect(grips()).toHaveLength(0);
  });

  it('offers no grip for a single photo, which has nowhere to move', () => {
    render(<SupplierMediaGallery media={[A]} onReorder={vi.fn()} />);

    expect(grips()).toHaveLength(0);
  });

  it('moves the dragged photo to the position of the one it enters', () => {
    const onReorder = vi.fn();

    render(<SupplierMediaGallery media={[A, B]} onReorder={onReorder} />);

    fireEvent.dragStart(grips()[1] as Element);
    fireEvent.dragEnter(
      screen.getByAltText('Supplier photo 1').closest('li') as Element,
    );

    expect(onReorder).toHaveBeenCalledWith([B.id, A.id]);
  });

  /**
   * The load-bearing half of the amendment. Arranging a supplier photograph is
   * an editorial fact about the evidence; removing one would be a change to it.
   * `delete-seller-media.ts` enforces the same rule in its `WHERE`, so this is
   * the courtesy and the query is the guarantee — but a delete control
   * appearing here would still be a promise the server refuses.
   */
  it('offers no delete and no cover control, ever', () => {
    render(<SupplierMediaGallery media={[A, B]} onReorder={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /delete/iu })).toBeNull();
    expect(screen.queryByRole('button', { name: /cover/iu })).toBeNull();
    expect(screen.queryByRole('button', { name: /replace/iu })).toBeNull();
  });

  it('says what dragging does, and what it does not', () => {
    render(<SupplierMediaGallery media={[A, B]} onReorder={vi.fn()} />);

    expect(
      screen.getByText(/reorder how buyers see them/u),
    ).toBeInTheDocument();
    expect(screen.getByText(/never deleted here/u)).toBeInTheDocument();
  });

  /**
   * Arranging evidence does not make it more or less verified, so the rights
   * and dimension detail each tile carries has to survive the change.
   */
  it('keeps the rights and dimension evidence on every tile', () => {
    render(<SupplierMediaGallery media={[A, B]} onReorder={vi.fn()} />);

    expect(
      screen.getAllByText(/Supplier photo 1 — Verified — 800 × 800/u).length,
    ).toBeGreaterThan(0);
  });

  it('still explains itself when the product has no supplier photo at all', () => {
    render(<SupplierMediaGallery media={[]} onReorder={vi.fn()} />);

    expect(
      screen.getByText(/No supplier photo address is recorded/u),
    ).toBeInTheDocument();
  });
});
