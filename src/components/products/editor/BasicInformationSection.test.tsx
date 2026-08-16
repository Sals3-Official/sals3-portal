import { fireEvent, render, screen } from '@testing-library/react';
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

function renderSection(
  overrides: Partial<ProductEditorFixture> = {},
  onGoToSection = vi.fn(),
) {
  const fixture = { ...loadFixture('pass'), ...overrides };

  const result = render(
    <BasicInformationSection
      fixture={fixture}
      productName={fixture.productName}
      onProductNameChange={vi.fn()}
      sellerSku=""
      onSellerSkuChange={vi.fn()}
      brandDeclaration="No brand / generic"
      onBrandDeclarationChange={vi.fn()}
      onGoToSection={onGoToSection}
    />,
  );

  return { ...result, onGoToSection };
}

describe('BasicInformationSection - Product media summary', () => {
  it('falls back to the supplier photos when the seller has uploaded none', () => {
    renderSection();

    // BASE_MEDIA has 5 items; with no seller upload, the summary must show
    // the supplier's photos rather than claim zero images exist.
    expect(screen.getByText(/5 images/)).toBeInTheDocument();
  });

  it('prefers the seller-uploaded count once the seller has their own photos', () => {
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

    expect(screen.getByText(/1 images/)).toBeInTheDocument();
  });

  it('jumps to Media section when "Upload your own photos" is pressed', () => {
    const { onGoToSection } = renderSection();

    fireEvent.click(
      screen.getByRole('button', { name: 'Upload your own photos' }),
    );

    expect(onGoToSection).toHaveBeenCalledWith('media');
  });
});
