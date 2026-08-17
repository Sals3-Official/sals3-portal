import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resolveProductEditorFixture } from '@/lib/seller-center/mock-data/product-editor';
import type { ProductEditorFixture } from '@/lib/seller-center/product-editor/types';
import BasicInformationSection from './BasicInformationSection';

/** Same accessor `ProductEditor.test.tsx` uses - narrows the nullable read. */
function loadFixture(key: string): ProductEditorFixture {
  const resolved = resolveProductEditorFixture(key);

  if (resolved === null) throw new Error(`missing fixture ${key}`);

  return resolved;
}

function renderSection(overrides: Partial<ProductEditorFixture> = {}) {
  const fixture = { ...loadFixture('pass'), ...overrides };

  return render(
    <BasicInformationSection
      fixture={fixture}
      productName={fixture.productName}
      onProductNameChange={vi.fn()}
      sellerSku=""
      onSellerSkuChange={vi.fn()}
      brandDeclaration="No brand / generic"
      onBrandDeclarationChange={vi.fn()}
      onUploadPhoto={vi.fn()}
      onDeletePhoto={vi.fn()}
      onMakeCoverPhoto={vi.fn()}
      isUploadingPhoto={false}
      deletingPhotoId={null}
    />,
  );
}

describe('BasicInformationSection - Product media', () => {
  it('shows the seller-uploaded photo count against the 12-photo cap', () => {
    renderSection({ media: [] });

    expect(screen.getByText('0 of 12 photos')).toBeInTheDocument();
  });

  it('tells the seller the storefront falls back to the supplier photo until they upload one', () => {
    renderSection({ media: [] });

    expect(
      screen.getByText(/shown from the supplier's own photo/i),
    ).toBeInTheDocument();
  });

  it('states the size/format/resolution guidance the upload pipeline actually enforces', () => {
    renderSection({ media: [] });

    expect(screen.getByText(/2000 × 2000 px/)).toBeInTheDocument();
    expect(screen.getByText(/up to 5 MB/)).toBeInTheDocument();
    expect(screen.getByText(/JPG, PNG, or WebP/)).toBeInTheDocument();
  });

  it('switches to the cover-photo hint once the seller has uploaded their own', () => {
    renderSection({
      media: [
        {
          id: 's1',
          label: 'Photo 1',
          sourceUrl: null,
          altText: 'Seller-uploaded photo',
          rightsCheck: 'VERIFIED',
          storageState: 'SALS3_STORED',
          sourceType: 'SELLER_UPLOAD',
          pixelWidth: 1200,
          pixelHeight: 1200,
          note: null,
          isCover: true,
        },
      ],
    });

    expect(screen.getByText('1 of 12 photos')).toBeInTheDocument();
    expect(
      screen.getByText(/star sets a photo as the storefront cover/i),
    ).toBeInTheDocument();
  });
});
