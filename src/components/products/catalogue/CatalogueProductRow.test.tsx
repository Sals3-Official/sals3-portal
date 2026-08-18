import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Table, TableBody } from '@/components/ui/table';
import type { CatalogueProductFixture } from '@/lib/seller-center/product-catalogue/types';
import CatalogueProductRow from './CatalogueProductRow';

vi.mock('@/app/(portal)/listings/publish-actions', () => ({
  publishProductAction: vi.fn(),
  unpublishProductAction: vi.fn(),
}));

const PRODUCT: CatalogueProductFixture = {
  id: '138bee6b-29c6-46ef-9e01-f05b10c53147',
  sals3ProductId: '138bee6b-29c6-46ef-9e01-f05b10c53147',
  name: "Casual Men's Fleece-lined Zip Pocket Jacket",
  descriptionText: '',
  hasImage: true,
  coverImageUrl:
    'https://cf.cjdropshipping.com/quick/product/697a2372-330c-4a72-8837-6ca100d99fab.jpg',
  mediaImageUrls: [
    'https://cf.cjdropshipping.com/quick/product/697a2372-330c-4a72-8837-6ca100d99fab.jpg',
  ],
  status: 'DRAFT',
  categoryPath: "Men's Clothing > Outerwear & Jackets",
  categoryCode: null,
  sals3CategoryL1: null,
  supplierCategoryPath: "Men's Clothing > Outerwear & Jackets",
  supplierCategoryId: '2409230540351618000',
  supplierSku: 'CJMJ2715829',
  supplierWeightLabel: '700.00-770.00 g',
  supplierFromPrice: { amountMinor: 1161, currency: 'USD' },
  supplierShipsFrom: ['CN'],
  supplierListedCount: 17,
  createdAt: '2026-08-14T07:43:00.000Z',
  supplierProviderCode: 'CJ_DROPSHIPPING',
  supplierProviderName: 'CJdropshipping',
  sourceCandidateId: 'd42f28bc-5744-4b09-86ac-45c6de8774a9',
  supplierConnectionHealth: 'CONNECTED',
  cjProductId: '2601061209541605000',
  sellingPrice: null,
  availability: 'UNKNOWN_OR_STALE',
  stockEvidence: 'UNKNOWN_STOCK',
  supplierObservedQuantity: null,
  lastCheckedAt: '2026-08-14T07:43:00.000Z',
  evidenceFreshness: 'UNKNOWN',
  mediaStatus: 'OWN_PICTURES',
  contentReadiness: 'NEEDS_IMPROVEMENT',
  pauseReason: null,
  storefrontUrl: null,
  attentionReasons: [],
  editorFixtureKey: 'pass',
  editorHref: '/listings/new?productId=138bee6b-29c6-46ef-9e01-f05b10c53147',
  variants: [],
};

function renderRow(product: CatalogueProductFixture) {
  return render(
    <Table>
      <TableBody>
        <CatalogueProductRow
          product={product}
          selected={false}
          expanded={false}
          onToggleSelected={vi.fn()}
          onToggleExpanded={vi.fn()}
          onPauseListing={vi.fn()}
          onArchive={vi.fn()}
          onToggleVariantPaused={vi.fn()}
        />
      </TableBody>
    </Table>,
  );
}

describe('CatalogueProductRow', () => {
  it('renders the stored supplier cover image instead of an empty thumbnail', () => {
    renderRow(PRODUCT);

    const image = screen.getByRole('img', { name: PRODUCT.name });

    expect(image.getAttribute('src')).toContain(
      encodeURIComponent(PRODUCT.coverImageUrl ?? ''),
    );
    expect(screen.queryByText('No image')).not.toBeInTheDocument();
  });

  it('keeps the honest placeholder when no image address exists', () => {
    renderRow({ ...PRODUCT, hasImage: false, coverImageUrl: null });

    expect(screen.getByText('No image')).toBeInTheDocument();
  });

  it('shows how finished the listing is, next to what it is missing', () => {
    renderRow({
      ...PRODUCT,
      sellingPrice: { amountMinor: 4500, currency: 'USD' },
      mediaStatus: 'SUPPLIER_FALLBACK',
      contentReadiness: 'GOOD',
      metaDescriptionText: 'A written meta description.',
      categoryCode: 'CAT-GGL-1057',
      optionAxisNames: ['Colour'],
      categoryAttributeControls: [],
      categoryAttributeValues: [],
    });

    // Supplier pictures only, so it cannot read High however complete the
    // text is - and the media column says why in the same row.
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Supplier fallback')).toBeInTheDocument();
  });

  it('reads Low while a listing still cannot sell', () => {
    renderRow({ ...PRODUCT, sellingPrice: null });

    expect(screen.getByText('Low')).toBeInTheDocument();
  });
});
