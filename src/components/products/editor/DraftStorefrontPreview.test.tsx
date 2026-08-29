import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  MediaItemFixture,
  SpecificationFixture,
  VariantFixture,
} from '@/lib/seller-center/product-editor/types';

const mocks = vi.hoisted(() => ({ pricesByDestinationAction: vi.fn() }));

vi.mock('@/app/(portal)/listings/price-by-destination-actions', () => ({
  default: mocks.pricesByDestinationAction,
}));

const DraftStorefrontPreview = (await import('./DraftStorefrontPreview'))
  .default;

/**
 * The picker used to list one synthetic market coded `DB` and change nothing:
 * `previewMarketCode` was read by the `<Select>` that set it and by nothing
 * else, so the card showed `variant.retailPrice` whichever market was chosen.
 *
 * These tests pin the two halves of the fix — the list is the three
 * checkout destinations, and choosing one actually moves the price.
 */

const VARIANT_ID = '11111111-1111-4111-8111-111111111111';

function variant(): VariantFixture {
  return {
    id: VARIANT_ID,
    optionLabel: 'Black / L',
    sellerSku: 'S3V-1',
    supplierCost: { amountMinor: 500, currency: 'USD' },
    retailPrice: { amountMinor: 2070, currency: 'USD' },
    supplierStock: 12,
    warehouseLabel: 'Not recorded',
    hasImage: false,
    enabled: true,
    listingState: 'WILL_LIST',
    attention: null,
    supplierVariantId: 'CJ-1',
    packedWeightGrams: 300,
    evidenceCapturedAt: '2026-08-29T05:00:00.000Z',
  };
}

const SPECIFICATIONS: SpecificationFixture[] = [];
const MEDIA: MediaItemFixture[] = [];

function renderPreview(marketCode: string) {
  return render(
    <DraftStorefrontPreview
      productName="Men's Camouflage Casual Pants"
      description="High-stretch camouflage trousers."
      variants={[variant()]}
      media={MEDIA}
      specifications={SPECIFICATIONS}
      previewMarketCode={marketCode}
      onPreviewMarketChange={vi.fn()}
      previewVariantId={VARIANT_ID}
      onPreviewVariantChange={vi.fn()}
    />,
  );
}

beforeEach(() => {
  mocks.pricesByDestinationAction.mockReset();
  mocks.pricesByDestinationAction.mockResolvedValue({
    ok: true,
    destinations: [
      {
        marketCode: 'AU',
        label: 'Australia',
        price: { amountMinor: 2070, currency: 'USD' },
        unavailableLabel: null,
      },
      {
        marketCode: 'PH',
        label: 'Philippines',
        price: { amountMinor: 1450, currency: 'USD' },
        unavailableLabel: null,
      },
      {
        marketCode: 'FJ',
        label: 'Fiji',
        price: null,
        unavailableLabel: 'No margin is set for Fiji.',
      },
    ],
  });
});

describe('DraftStorefrontPreview', () => {
  it('lists the three checkout markets, never the synthetic "DB" row', async () => {
    renderPreview('AU');

    await waitFor(() => {
      expect(mocks.pricesByDestinationAction).toHaveBeenCalledWith({
        variantId: VARIANT_ID,
      });
    });

    expect(screen.queryByText('DB')).toBeNull();
    expect(screen.queryByText('Configured offer market')).toBeNull();
  });

  it('shows the selected market’s own resolved price', async () => {
    renderPreview('PH');

    expect(await screen.findByText('$14.50')).toBeInTheDocument();
    // Australia's price must not be what a Philippines preview renders.
    expect(screen.queryByText('$20.70')).toBeNull();
  });

  /**
   * The whole point of the panel: two markets, two prices, from the same
   * variant. Before this, both rendered `variant.retailPrice`.
   */
  it('renders a different price for a different market', async () => {
    const { unmount } = renderPreview('AU');

    expect(await screen.findByText('$20.70')).toBeInTheDocument();
    unmount();

    renderPreview('PH');

    expect(await screen.findByText('$14.50')).toBeInTheDocument();
  });

  /**
   * A refusal is shown, not hidden. A market the rules cannot price is
   * something the seller has to fix, and a blank price reads as a loading
   * state.
   */
  it('names the reason when a market cannot be priced', async () => {
    renderPreview('FJ');

    expect(
      await screen.findByText(/Cannot be priced for Fiji/u),
    ).toBeInTheDocument();
    expect(screen.getByText('No margin is set for Fiji.')).toBeInTheDocument();
  });

  it('says so when the lookup is refused rather than falling silent', async () => {
    mocks.pricesByDestinationAction.mockResolvedValue({
      ok: false,
      reason: 'denied',
    });

    renderPreview('AU');

    expect(
      await screen.findByText(/do not have permission/u),
    ).toBeInTheDocument();
  });

  /**
   * Fixture/design-preview mode carries synthetic ids. Asking the action about
   * one would only ever answer `invalid_input`, so it is not asked — and the
   * draft's own number is named as a draft price rather than dressed up as a
   * resolved per-market one.
   */
  it('never calls the pricing action for a fixture variant', async () => {
    render(
      <DraftStorefrontPreview
        productName="Fixture product"
        description="A fixture."
        variants={[{ ...variant(), id: 'fixture-variant-1' }]}
        media={MEDIA}
        specifications={SPECIFICATIONS}
        previewMarketCode="AU"
        onPreviewMarketChange={vi.fn()}
        previewVariantId="fixture-variant-1"
        onPreviewVariantChange={vi.fn()}
      />,
    );

    expect(await screen.findByText(/Draft price/u)).toBeInTheDocument();
    expect(mocks.pricesByDestinationAction).not.toHaveBeenCalled();
  });
});
