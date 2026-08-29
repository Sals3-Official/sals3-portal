import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { resolveProductEditorFixture } from '@/lib/seller-center/mock-data/product-editor';
import type { ProductEditorFixture } from '@/lib/seller-center/product-editor/types';
import SpecificationsSection from './SpecificationsSection';

/** Same accessor `ProductEditor.test.tsx` uses - narrows the nullable read. */
function loadFixture(key: string): ProductEditorFixture {
  const resolved = resolveProductEditorFixture(key);

  if (resolved === null) throw new Error(`missing fixture ${key}`);

  return resolved;
}

function renderSection(overrides: Partial<ProductEditorFixture> = {}) {
  const fixture = { ...loadFixture('pass'), ...overrides };

  return render(
    <SpecificationsSection
      source={fixture.source}
      supplierProductName={fixture.supplierProductName}
      supplierCategoryPath={fixture.supplierCategoryPath}
      supplierMedia={fixture.supplierMedia}
      // Read from the fixture rather than hard-coded, so a fixture that later
      // gains a seller upload flips this section into the state where the
      // supplier panel must stop claiming the cover.
      sellerGalleryCount={fixture.media.length}
      onOpenSourceDrawer={vi.fn()}
      specifications={fixture.specifications}
      onSpecificationChange={vi.fn()}
    />,
  );
}

describe('SpecificationsSection - Supplier Details', () => {
  it('shows the original supplier product name alongside the other read-only supplier evidence', () => {
    renderSection({
      supplierProductName:
        'Aurelis Outdoor 20L 28L Foldable Lightweight Travel Daypack Backpack for Hiking Camping',
    });

    expect(screen.getByText('Original product name')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Aurelis Outdoor 20L 28L Foldable Lightweight Travel Daypack Backpack for Hiking Camping',
      ),
    ).toBeInTheDocument();
  });

  it('is distinct from the editable Product Name field, which does not render here', () => {
    renderSection({
      productName: 'Aurelis 20L Packable Daypack',
      supplierProductName: 'Original Verbose Supplier Title',
    });

    expect(screen.queryByLabelText('Product Name')).not.toBeInTheDocument();
    expect(
      screen.getByText('Original Verbose Supplier Title'),
    ).toBeInTheDocument();
  });

  it('shows the supplier photos as a read-only gallery, with no reorder/cover control', () => {
    renderSection();

    // 'pass' fixture carries 5 illustrative supplier photos (BASE_MEDIA),
    // each rendered by label since illustrative fixtures never carry a real
    // supplier address.
    expect(screen.getByText('Original photos')).toBeInTheDocument();
    expect(screen.getByText('Image 2')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Make cover' }),
    ).not.toBeInTheDocument();
  });
});
