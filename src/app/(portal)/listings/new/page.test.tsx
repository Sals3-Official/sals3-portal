import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalSession } from '@/lib/auth/session';

// The page reads `.sellerId` off the resolved session to resolve pricing
// guidance, so the mock has to look like a real `PortalSession`.
const requirePermission = vi.fn<(permission: string) => Promise<PortalSession>>(
  async () => ({
    userId: 'user-1',
    displayName: 'Test seller',
    role: 'seller_manager',
    sellerId: 'seller-1',
    sellerBusinessModel: 'DROPSHIPPER',
  }),
);

class NotFoundError extends Error {}

const notFound = vi.fn(() => {
  throw new NotFoundError('NEXT_NOT_FOUND');
});

const requireDropshipperAccount = vi.fn(async () => ({
  sellerAccount: { id: 'seller-1' },
}));
const findProductEditorFixtureForSeller = vi.fn<
  (sellerId: string, productId: string) => Promise<null>
>(async () => null);

vi.mock('@/lib/auth/session', () => ({
  requirePermission: (permission: string) => requirePermission(permission),
}));

vi.mock('@/lib/auth/seller-guard', () => ({
  requireDropshipperAccount: () => requireDropshipperAccount(),
}));

vi.mock('@/modules/catalog/products/read-model', () => ({
  findProductEditorFixtureForSeller: (sellerId: string, productId: string) =>
    findProductEditorFixtureForSeller(sellerId, productId),
}));

vi.mock('next/navigation', () => ({
  notFound: () => notFound(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/app/(portal)/listings/product-draft-actions', () => ({
  saveProductDraftAction: vi.fn(),
}));

vi.mock('@/app/(portal)/listings/publish-actions', () => ({
  publishProductAction: vi.fn(),
}));

// Default export: the module reaches the server-only db client, which throws
// under jsdom the moment `ProductEditor` imports it.
vi.mock('@/app/(portal)/listings/option-mapping-actions', () => ({
  default: vi.fn(),
  // Named alongside the default: `ProductEditor` passes both down, and a missing
  // one arrives as `undefined` and fails the render rather than the assertion.
  recoverSupplierLabelsAction: vi.fn(),
}));

// Same reasoning: `decide-category.ts` reaches the server-only db client too.
vi.mock('@/app/(portal)/listings/category-mapping-actions', () => ({
  decideCategoryMappingAction: vi.fn(),
}));

// The page reads `getDb()` directly for the category picker's reference
// data — mocked at this boundary rather than reaching for a real database
// in a component test.
vi.mock('@/lib/db/client', () => ({ default: vi.fn(() => ({})) }));

vi.mock('@/modules/catalog/taxonomy/v1-reference', () => ({
  listSals3CategoryV1Options: vi.fn(async () => []),
}));

// eslint-disable-next-line import/first
import AddProductPage, { generateMetadata } from './page';

function searchParams(params: Record<string, string> = {}) {
  return Promise.resolve(params);
}

beforeEach(() => {
  requirePermission.mockClear();
  requireDropshipperAccount.mockClear();
  findProductEditorFixtureForSeller.mockClear();
  notFound.mockClear();
});

describe('Add Product route', () => {
  it('authorizes on the server before rendering anything', async () => {
    await AddProductPage({ searchParams: searchParams() });

    expect(requirePermission).toHaveBeenCalledWith('product:create');
  });

  it('renders the blank wizard when no mode is requested', async () => {
    render(await AddProductPage({ searchParams: searchParams() }));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Add Product' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Completeness')).toBeInTheDocument();
  });

  it('renders the editor for an allow-listed fixture', async () => {
    render(
      await AddProductPage({ searchParams: searchParams({ fixture: 'pass' }) }),
    );

    expect(
      screen.getAllByText(/UI preview using fictional product data/i).length,
    ).toBeGreaterThan(0);
    expect(notFound).not.toHaveBeenCalled();
  });

  it('404s on an unknown fixture instead of showing a default product', async () => {
    await expect(
      AddProductPage({ searchParams: searchParams({ fixture: 'nope' }) }),
    ).rejects.toBeInstanceOf(NotFoundError);

    expect(notFound).toHaveBeenCalled();
  });

  it('404s on a real-looking candidate id passed as a fixture', async () => {
    await expect(
      AddProductPage({
        searchParams: searchParams({
          fixture: '8f2c1a7e-6f0b-4a1d-9d3e-77e2c0b41a55',
        }),
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('never answers a real supplier candidate id with fixture data', async () => {
    render(
      await AddProductPage({
        searchParams: searchParams({
          supplierCandidateId: '8f2c1a7e-6f0b-4a1d-9d3e-77e2c0b41a55',
        }),
      }),
    );

    expect(screen.getByText(/is not wired up yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/Aurelis/)).toBeNull();
  });

  /**
   * Fictional and placeholder content sits on a real production route, so
   * both preview modes have to be de-indexed. The blank form is the real
   * screen and stays indexable.
   */
  it('keeps the fixture and reserved-integration modes out of search', async () => {
    const preview = await generateMetadata({
      searchParams: searchParams({ fixture: 'pass' }),
    });
    const reserved = await generateMetadata({
      searchParams: searchParams({ supplierCandidateId: 'abc' }),
    });
    const blank = await generateMetadata({ searchParams: searchParams() });

    expect(preview.robots).toEqual({ index: false, follow: false });
    expect(reserved.robots).toEqual({ index: false, follow: false });
    expect(blank.robots).toBeUndefined();
  });

  it('enters a save/validation state from the development state parameter', async () => {
    render(
      await AddProductPage({
        searchParams: searchParams({
          fixture: 'pass',
          state: 'connection-unavailable',
        }),
      }),
    );

    expect(
      screen.getByText('Supplier connection unavailable'),
    ).toBeInTheDocument();
  });

  it('ignores an unrecognised state instead of failing the page', async () => {
    render(
      await AddProductPage({
        searchParams: searchParams({ fixture: 'pass', state: 'nonsense' }),
      }),
    );

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Aurelis',
    );
    expect(screen.queryByText(/session expired/i)).toBeNull();
  });
});
