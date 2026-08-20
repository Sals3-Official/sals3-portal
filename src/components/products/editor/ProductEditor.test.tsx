import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import saveCategoryAttributesAction from '@/app/(portal)/listings/category-attributes-actions';
import saveMetaDescriptionAction from '@/app/(portal)/listings/meta-description-actions';
import { publishProductAction } from '@/app/(portal)/listings/publish-actions';
import { resolveProductEditorFixture } from '@/lib/seller-center/mock-data/product-editor';
import type {
  CategoryAttributeFieldFixture,
  EditorLifecycle,
  MediaItemFixture,
  ProductEditorFixture,
} from '@/lib/seller-center/product-editor/types';
import ProductEditor from './ProductEditor';

vi.mock('next/navigation', () => ({
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
  renameOptionMappingAction: vi.fn(),
}));

// Same reasoning: `decide-category.ts` reaches the server-only db client too.
vi.mock('@/app/(portal)/listings/category-mapping-actions', () => ({
  decideCategoryMappingAction: vi.fn(),
}));

// Same reasoning: `upload-seller-media.ts` reaches the server-only db client
// and `@aws-sdk/client-s3` too.
vi.mock('@/app/(portal)/listings/description-image-actions', () => ({
  default: vi.fn(),
}));

vi.mock('@/app/(portal)/listings/media-actions', () => ({
  uploadSellerMediaAction: vi.fn(),
  deleteSellerMediaAction: vi.fn(),
}));

// Same reasoning: `save-category-attributes.ts` reaches the server-only db client too.
vi.mock('@/app/(portal)/listings/category-attributes-actions', () => ({
  default: vi.fn(),
}));

// Same reasoning: `save-meta-description.ts` reaches the server-only db client too.
vi.mock('@/app/(portal)/listings/meta-description-actions', () => ({
  default: vi.fn(),
}));

// Same reasoning: `save-show-supplier-photo.ts` reaches the server-only db client too.
vi.mock('@/app/(portal)/listings/show-supplier-photo-actions', () => ({
  default: vi.fn(),
}));

function fixture(key: string): ProductEditorFixture {
  const resolved = resolveProductEditorFixture(key);

  if (resolved === null) throw new Error(`missing fixture ${key}`);

  return resolved;
}

function renderEditor(key: string, lifecycle: EditorLifecycle = 'IDLE') {
  const resolved = fixture(key);

  return render(
    <ProductEditor fixture={resolved} initialLifecycle={lifecycle} />,
  );
}

function openSourceChangesTab() {
  fireEvent.click(screen.getByRole('tab', { name: /Source Changes/ }));
}

function sellerUploadItem(
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

function publishButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: /^Publish/ }) as HTMLButtonElement;
}

describe('Product Editor - publication outcomes', () => {
  it('sends a real publish action for a database-backed publish-with-attention product', async () => {
    const resolved = fixture('attention');
    vi.mocked(publishProductAction).mockResolvedValue({
      ok: true,
      slug: 'aurelis-daypack',
      offerCount: 2,
      availability: 'AVAILABLE',
    });

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          publishTarget: {
            productId: '11111111-1111-4111-8111-111111111111',
            expectedProductVersion: 7,
          },
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Publish with Attention' }),
    );
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Publish with Attention' }),
    );

    await waitFor(() =>
      expect(publishProductAction).toHaveBeenCalledWith({
        productId: '11111111-1111-4111-8111-111111111111',
        expectedProductVersion: 7,
        variantRetailPrices: [],
      }),
    );
  });

  it('offers Publish Product on a clean pass', () => {
    renderEditor('pass');

    const button = publishButton();

    expect(button).toHaveTextContent('Publish Product');
    expect(button).toBeEnabled();
    expect(
      screen.getByText(/No blockers and no warnings/i),
    ).toBeInTheDocument();
  });

  it('offers Publish with Attention and says the warnings survive publication', () => {
    renderEditor('attention');

    expect(publishButton()).toHaveTextContent('Publish with Attention');
    expect(publishButton()).toBeEnabled();
    expect(
      screen.getByText(/will remain after\s+publication/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No item-by-item approval is required/i),
    ).toBeInTheDocument();
  });

  it('never lets a blocked product look publishable, and states why', () => {
    renderEditor('blocked');

    const button = publishButton();

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('title', '3 hard blockers must clear first');
    // The reason is on screen too, not only in a tooltip.
    expect(
      screen.getAllByText('3 hard blockers must clear first').length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Publishing is disabled')).toBeInTheDocument();
  });
});

describe('Product Editor - required vs recommended attributes', () => {
  it('renders a missing required attribute as a hard blocker', () => {
    renderEditor('blocked');

    expect(
      screen.getByText(/Publication requires this\. It is a hard blocker/i),
    ).toBeInTheDocument();
    expect(publishButton()).toBeDisabled();
  });

  it('clears the hard-blocker message once a value is entered, and restores it on clearing', () => {
    renderEditor('blocked');

    const input = screen.getByLabelText(/Country of origin/i);

    fireEvent.change(input, { target: { value: 'Philippines' } });

    // A field that plainly has a value must not keep claiming "until a value
    // is entered" — the stale message is the exact defect this covers.
    expect(
      screen.queryByText(/Publication requires this\. It is a hard blocker/i),
    ).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: '   ' } });

    expect(
      screen.getByText(/Publication requires this\. It is a hard blocker/i),
    ).toBeInTheDocument();
  });

  it('renders a missing recommended attribute as a still-publishable warning', () => {
    renderEditor('attention');

    expect(
      screen.getByText(/Publishing is not blocked, and the attribute stays/i),
    ).toBeInTheDocument();
    expect(publishButton()).toBeEnabled();
  });
});

function categoryAttributeField(
  overrides: Partial<CategoryAttributeFieldFixture>,
): CategoryAttributeFieldFixture {
  return {
    attributeName: 'Brand',
    requirement: 'REQUIRED',
    inputControlType: 'TEXT_INPUT',
    allowedValues: [],
    allowCustomValue: true,
    allowMultipleValues: false,
    sellerHelpText: null,
    values: ['Royal Canin'],
    isCustomValue: false,
    unresolved: false,
    ...overrides,
  };
}

describe('Product Editor - category-driven Specification section', () => {
  it('sits between Basic Information and Description in the section nav', () => {
    renderEditor('pass');

    const nav = screen.getByRole('navigation', { name: 'Editor sections' });
    const labels = within(nav)
      .getAllByRole('button')
      .map((button) => button.textContent);
    const basicIndex = labels.findIndex((text) =>
      text?.includes('Basic Information'),
    );
    const specIndex = labels.findIndex((text) =>
      text?.includes('Specification'),
    );
    const descriptionIndex = labels.findIndex((text) =>
      text?.includes('Description'),
    );

    expect(basicIndex).toBeLessThan(specIndex);
    expect(specIndex).toBeLessThan(descriptionIndex);
  });

  /**
   * Regression: `saveCategoryAttributes` treats an attribute name absent
   * from the submitted payload as "leave whatever is stored alone." Before
   * this fix, `handleSaveCategoryAttributes` only submitted fields with a
   * non-empty local value, so clearing a previously saved field never told
   * the server anything happened — the old value survived the save.
   */
  it('submits a cleared field as an empty array rather than omitting it', async () => {
    const resolved = fixture('pass');

    vi.mocked(saveCategoryAttributesAction).mockResolvedValue({
      ok: true,
      productVersion: 8,
      validation: {
        outcome: 'VALID',
        categoryCode: 'CAT-GGL-1',
        controlsVersion: 'sals3-attribute-controls-v1',
        acceptedAttributes: {},
        missingRequiredAttributes: [],
        missingRecommendedAttributes: [],
        unrecognizedAttributes: [],
        findings: [],
        contractVersion: 'category-attribute-contract-v1',
      },
    });

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          categoryAttributes: [categoryAttributeField({})],
          categoryAttributesControlsVersion: 'sals3-attribute-controls-v1',
          publishTarget: {
            productId: '11111111-1111-4111-8111-111111111111',
            expectedProductVersion: 7,
          },
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    fireEvent.change(screen.getByDisplayValue('Royal Canin'), {
      target: { value: '' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Specifications' }),
    );

    await waitFor(() =>
      expect(saveCategoryAttributesAction).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: '11111111-1111-4111-8111-111111111111',
          expectedProductVersion: 7,
          attributes: { Brand: [] },
        }),
      ),
    );
  });

  it('never touches an attribute the Specification section did not render', async () => {
    const resolved = fixture('pass');

    vi.mocked(saveCategoryAttributesAction).mockResolvedValue({
      ok: true,
      productVersion: 8,
      validation: {
        outcome: 'VALID',
        categoryCode: 'CAT-GGL-1',
        controlsVersion: 'sals3-attribute-controls-v1',
        acceptedAttributes: {},
        missingRequiredAttributes: [],
        missingRecommendedAttributes: [],
        unrecognizedAttributes: [],
        findings: [],
        contractVersion: 'category-attribute-contract-v1',
      },
    });

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          categoryAttributes: [categoryAttributeField({})],
          categoryAttributesControlsVersion: 'sals3-attribute-controls-v1',
          publishTarget: {
            productId: '11111111-1111-4111-8111-111111111111',
            expectedProductVersion: 7,
          },
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Save Specifications' }),
    );

    await waitFor(() =>
      expect(saveCategoryAttributesAction).toHaveBeenCalledWith(
        expect.objectContaining({ attributes: { Brand: ['Royal Canin'] } }),
      ),
    );

    const [call] = vi.mocked(saveCategoryAttributesAction).mock.calls;
    const submitted = call[0] as { attributes: Record<string, string[]> };

    expect(Object.keys(submitted.attributes)).toEqual(['Brand']);
  });

  /**
   * Regression: `categoryAttributes` was `useState(fixture.categoryAttributes)`,
   * which only reads its argument on mount. `handleDecideCategory` calls
   * `router.refresh()` after a category decision, which re-renders this
   * already-mounted client component with a fresh `fixture` prop (a real
   * Next.js refresh never remounts it - there is no `key` on
   * `ProductEditorWorkspace`) - but the old-category fields kept rendering
   * until a full page reload. `rerender` with a changed `sals3CategoryCode`
   * is the jsdom equivalent of that refreshed prop.
   */
  it('replaces the rendered fields when the resolved category changes without a remount', () => {
    const resolved = fixture('pass');
    const { rerender } = render(
      <ProductEditor
        fixture={{
          ...resolved,
          sals3CategoryCode: 'CAT-GGL-100',
          categoryAttributes: [
            categoryAttributeField({ attributeName: 'Brand' }),
          ],
          categoryAttributesControlsVersion: 'sals3-attribute-controls-v1',
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    expect(screen.getByLabelText('Brand')).toBeInTheDocument();
    expect(screen.queryByLabelText('Screen Size')).not.toBeInTheDocument();

    rerender(
      <ProductEditor
        fixture={{
          ...resolved,
          sals3CategoryCode: 'CAT-GGL-200',
          categoryAttributes: [
            categoryAttributeField({
              attributeName: 'Screen Size',
              values: [],
            }),
          ],
          categoryAttributesControlsVersion: 'sals3-attribute-controls-v1',
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    expect(screen.getByLabelText('Screen Size')).toBeInTheDocument();
    expect(screen.queryByLabelText('Brand')).not.toBeInTheDocument();
  });
});

describe('Product Editor - Meta Description', () => {
  it('sits in the same Description section as the product description, directly below it', () => {
    renderEditor('pass');

    const descriptionSection = screen
      .getByRole('heading', { name: 'Description' })
      .closest('section');

    expect(descriptionSection).not.toBeNull();
    expect(
      within(descriptionSection as HTMLElement).getByLabelText(
        'Meta Description',
      ),
    ).toBeInTheDocument();
  });

  it('pre-fills an unsaved field with a local suggestion, never blank', () => {
    renderEditor('pass');

    const field = screen.getByLabelText(
      'Meta Description',
    ) as HTMLTextAreaElement;

    expect(field.value.length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Suggested from your product details/),
    ).toBeInTheDocument();
  });

  it('shows exactly what was saved, not a re-derived suggestion, once a value exists', () => {
    const resolved = fixture('pass');

    render(
      <ProductEditor
        fixture={{ ...resolved, metaDescriptionText: 'Already decided copy.' }}
        initialLifecycle="IDLE"
      />,
    );

    expect(
      screen.getByDisplayValue('Already decided copy.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/Suggested from your product details/),
    ).not.toBeInTheDocument();
  });

  it('saves the edited meta description with the compare-and-set version, not the client-supplied tenant', async () => {
    const resolved = fixture('pass');

    vi.mocked(saveMetaDescriptionAction).mockResolvedValue({
      ok: true,
      productVersion: 8,
    });

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          metaDescriptionText: 'Old copy.',
          publishTarget: {
            productId: '11111111-1111-4111-8111-111111111111',
            expectedProductVersion: 7,
          },
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    fireEvent.change(screen.getByLabelText('Meta Description'), {
      target: { value: 'New copy the seller wrote.' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: 'Save Meta Description' }),
    );

    await waitFor(() =>
      expect(saveMetaDescriptionAction).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: '11111111-1111-4111-8111-111111111111',
          expectedProductVersion: 7,
          metaDescription: 'New copy the seller wrote.',
        }),
      ),
    );
  });

  it('offers no save button in design-preview mode, where there is nothing real to save to', () => {
    renderEditor('pass');

    expect(
      screen.queryByRole('button', { name: 'Save Meta Description' }),
    ).not.toBeInTheDocument();
  });
});

describe('Product Editor - money that is not known', () => {
  it('keeps freight, landed, margin, warehouse, and listing state out of the pricing grid', () => {
    renderEditor('blocked');

    const table = screen.getByRole('table');

    expect(
      within(table).queryByRole('columnheader', { name: 'Freight est.' }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole('columnheader', { name: 'Landed est.' }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole('columnheader', { name: 'Margin est.' }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole('columnheader', { name: 'Warehouse' }),
    ).not.toBeInTheDocument();
    expect(
      within(table).queryByRole('columnheader', { name: 'Listing state' }),
    ).not.toBeInTheDocument();
    expect(
      within(table).getByRole('columnheader', { name: 'Retail price' }),
    ).toBeInTheDocument();
  });

  it('uses retail price as the price blocker', () => {
    const resolved = fixture('pass');

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          variants: resolved.variants.map((variant, index) =>
            index === 0
              ? {
                  ...variant,
                  retailPrice: { ...variant.retailPrice, amountMinor: 0 },
                  attention: 'Retail price required',
                }
              : variant,
          ),
        }}
        initialLifecycle="IDLE"
      />,
    );

    expect(
      screen.getAllByText('Retail price is required').length,
    ).toBeGreaterThan(0);
  });

  it('blocks publication when retail price equals supplier cost', () => {
    const resolved = fixture('pass');

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          variants: resolved.variants.map((variant) => ({
            ...variant,
            retailPrice: {
              ...variant.retailPrice,
              amountMinor: variant.supplierCost.amountMinor,
              currency: variant.supplierCost.currency,
            },
          })),
        }}
        initialLifecycle="IDLE"
      />,
    );

    expect(
      screen.getAllByText('Retail price must be above supplier cost').length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^Publish/ })).toBeDisabled();
    expect(screen.getAllByText(/Must be above .* cost/).length).toBeGreaterThan(
      0,
    );
  });

  it('shows the supplier source currency in the source drawer', () => {
    renderEditor('pass');

    fireEvent.click(
      screen.getByRole('button', { name: 'Supplier Source Details' }),
    );

    expect(screen.getByText('Source currency')).toBeInTheDocument();
    expect(screen.getByText('USD')).toBeInTheDocument();
  });
});

describe('Product Editor - supplier identity', () => {
  it('names the provider, the connected account and the external product id', () => {
    renderEditor('pass');

    expect(screen.getAllByText('CJ Dropshipping').length).toBeGreaterThan(0);
    expect(screen.getAllByText('CJPD2291845007').length).toBeGreaterThan(0);
  });

  it('surfaces a degraded connection rather than hiding it', () => {
    renderEditor('stale-evidence');

    expect(screen.getAllByText('Degraded').length).toBeGreaterThan(0);
  });
});

describe('Product Editor - markets', () => {
  it('states that other markets are not evaluated instead of rendering them as evidence', () => {
    renderEditor('pass');

    expect(
      screen.getByText(
        'Other markets are not evaluated because they are not enabled for this seller.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Not enabled for this seller/)).toBeNull();
  });

  it('carries the server-side publication check copy', () => {
    renderEditor('pass');

    expect(
      screen.getByText(/Publication and checkout run server-side checks/i),
    ).toBeInTheDocument();
  });
});

describe('Product Editor - what must not be on screen', () => {
  it('does not leak the internal checkout engineering note', () => {
    const { container } = renderEditor('delisted');

    openSourceChangesTab();

    expect(container.textContent).not.toMatch(/design annotation/i);
    expect(container.textContent).not.toContain('OrderLineSnapshot');
    expect(container.textContent).not.toContain('ADR-007');
  });

  it('keeps accepted-order wording distinct from current-listing impact', () => {
    renderEditor('delisted');

    openSourceChangesTab();

    expect(
      screen.getByText(/Current listing: paused automatically/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Accepted orders are unaffected/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/It never rewrites an accepted order/i),
    ).toBeInTheDocument();
  });

  it('exposes no credential anywhere in the rendered screen', () => {
    const { container } = renderEditor('pass');

    expect(container.textContent).not.toMatch(
      /(api[_-]?key|access[_-]?token|refresh[_-]?token|bearer )/i,
    );
  });
});

describe('Product Editor - preview and panels', () => {
  it('renders a non-functional Add to Cart', () => {
    renderEditor('pass');

    expect(screen.getByRole('button', { name: 'Add to Cart' })).toBeDisabled();
  });

  it('says plainly that the data is fictional and unsaved', () => {
    renderEditor('pass');

    expect(
      screen.getByText(/UI preview using fictional product data/i),
    ).toBeInTheDocument();
  });

  it('always offers the readiness and preview triggers, at any width', () => {
    renderEditor('pass');

    expect(screen.getByRole('button', { name: 'Readiness' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Preview' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Supplier Source Details' }),
    ).toBeVisible();
  });

  it('announces save and validation state politely', () => {
    const { container } = renderEditor('pass');
    const live = container.querySelector('[aria-live="polite"]');

    expect(live).not.toBeNull();
    expect(live?.textContent).toContain('No unsaved changes');
    expect(live?.textContent).toContain('Ready');
  });
});

describe('Product Editor - structure', () => {
  it('has exactly one page heading', () => {
    renderEditor('pass');

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('flags the sections that carry an issue in the jump navigation', () => {
    renderEditor('blocked');

    const nav = screen.getByRole('navigation', { name: 'Editor sections' });

    // The badge is an icon plus an issue count, not the word "Blocker"
    // repeated per section - its accessible name is what to assert on.
    expect(
      within(nav).getAllByLabelText(/blocker issues?/).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('marks each variant evidence row as collapsed until it is opened', () => {
    renderEditor('pass');

    screen
      .getAllByRole('button', { name: /^Supplier evidence for/ })
      .forEach((button) => {
        expect(button).toHaveAttribute('aria-expanded', 'false');
      });
  });

  it('states that a failed save kept the changes in the tab', () => {
    renderEditor('pass', 'SAVE_FAILED');

    expect(
      screen.getByText(/still here in this tab and will not be lost/i),
    ).toBeInTheDocument();
  });

  it('will not publish on an expired session, and says so', () => {
    renderEditor('pass', 'SESSION_EXPIRED');

    expect(screen.getByText('Your session expired')).toBeInTheDocument();
    expect(
      screen.getAllByText(/Session expired - sign in again to publish/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^Publish/ })).toBeDisabled();
  });

  it('names how many variants a bulk retail-price action will skip before it runs', () => {
    renderEditor('blocked');

    fireEvent.click(screen.getByRole('button', { name: 'Set retail price…' }));

    expect(screen.getByText(/Changes 0 variants/)).toBeInTheDocument();
    expect(screen.getByText(/Skips 6/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('lets the seller pick a new cover from their own uploaded photos, in Basic Information', () => {
    const resolved = fixture('pass');
    const media: MediaItemFixture[] = [
      sellerUploadItem({ id: 's1', label: 'Photo 1', isCover: true }),
      sellerUploadItem({ id: 's2', label: 'Photo 2' }),
    ];

    render(
      <ProductEditor
        fixture={{ ...resolved, media }}
        initialLifecycle="IDLE"
      />,
    );

    const basicInfo = screen.getByRole('region', {
      name: 'Basic Information',
    });

    // The cover badge starts on the first tile and only ever sits on one.
    expect(within(basicInfo).getByText('Cover')).toBeInTheDocument();

    fireEvent.mouseEnter(
      within(basicInfo).getByText('Photo 2').closest('li') as Element,
    );
    fireEvent.click(
      within(basicInfo).getByRole('button', { name: 'Set Photo 2 as cover' }),
    );

    expect(within(basicInfo).getAllByText('Cover')).toHaveLength(1);
  });

  it('shows an honest fallback note, with a disabled Upload, when no seller photo is uploaded yet', () => {
    renderEditor('pass');

    const basicInfo = screen.getByRole('region', {
      name: 'Basic Information',
    });

    expect(
      within(basicInfo).getByText(/shown from the supplier's own photo/i),
    ).toBeInTheDocument();
    expect(
      within(basicInfo).getByRole('button', { name: 'Upload' }),
    ).toBeDisabled();
  });

  it('never offers to delete or set a cover from a supplier photo - it is read-only evidence', () => {
    renderEditor('attention');

    const specsSection = document.getElementById('sec-specs') as HTMLElement;

    fireEvent.click(
      within(specsSection).getByRole('button', { name: 'Supplier Details' }),
    );

    // The rejected watermarked image lives in Supplier Details, and nothing
    // in this repo copies a supplier photo into something the seller can
    // edit - there is no "Set as cover"/"Delete" control anywhere on the
    // screen for it, unlike a real seller upload's hover controls.
    expect(
      screen.queryByRole('button', { name: /Set Image 5 as cover/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Delete Image 5' }),
    ).not.toBeInTheDocument();
    expect(screen.getByText('Image 5')).toBeInTheDocument();
  });
});

describe('Product Editor - the photo a real product actually has', () => {
  const ADDRESS =
    'https://cf.cjdropshipping.com/quick/product/697a2372-330c-4a72-8837-6ca100d99fab.jpg';

  function withCoverAddress(): ProductEditorFixture {
    const resolved = fixture('pass');

    return {
      ...resolved,
      supplierMedia: resolved.supplierMedia.map((item, index) =>
        index === 0
          ? {
              ...item,
              sourceUrl: ADDRESS,
              altText: `Supplier listing photo for ${resolved.productName}`,
            }
          : item,
      ),
    };
  }

  function renderWithCover() {
    const resolved = withCoverAddress();
    const result = render(
      <ProductEditor
        fixture={resolved}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    // Supplier Details is collapsed by default (owner decision 2026-08-17);
    // its read-only gallery is not in the accessibility tree until opened.
    // Scoped to the section itself - the jump nav has its own same-named
    // button.
    const specsSection = document.getElementById('sec-specs') as HTMLElement;

    fireEvent.click(
      within(specsSection).getByRole('button', { name: 'Supplier Details' }),
    );

    return result;
  }

  it('renders the recorded address in all three places the editor shows a photo', () => {
    renderWithCover();

    const rendered = screen
      .getAllByRole('img')
      .filter((image) => image.getAttribute('src')?.includes('697a2372'));

    // Three on purpose: header, Supplier Details' read-only gallery, and the
    // Draft Storefront Preview cover. Basic Information's own photo manager
    // shows none - it renders only the seller's own uploads, and this
    // fixture has none, so it falls back to the disabled Upload tile.
    expect(rendered).toHaveLength(3);
    rendered.forEach((image) => {
      expect(image).toHaveAccessibleName(/Supplier listing photo/);
    });
    expect(screen.queryByText('No image')).not.toBeInTheDocument();
  });

  it('keeps the header placeholder when no address is recorded', () => {
    const resolved = fixture('pass');

    render(<ProductEditor fixture={resolved} initialLifecycle="IDLE" />);

    expect(screen.getByText('No image')).toBeInTheDocument();
  });

  it('keeps a fixture tile with no address as a labelled placeholder', () => {
    renderWithCover();

    // Only the one tile given an address renders an image; the rest are the
    // fictional fixtures, which must not borrow a real supplier photo.
    expect(
      screen
        .getAllByRole('img')
        .filter((image) => image.getAttribute('src')?.includes('697a2372')),
    ).toHaveLength(3);
    expect(screen.getByText('Image 3')).toBeInTheDocument();
  });

  it('shows the Basic Information category as the real Sals3 taxonomy picker, not a decorative dropdown', () => {
    const resolved = withCoverAddress();

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          publishTarget: {
            productId: '11111111-1111-4111-8111-111111111111',
            expectedProductVersion: 7,
          },
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    const basic = within(document.getElementById('sec-basic') as HTMLElement);

    expect(basic.getByLabelText(/^Category$/i)).toBeInTheDocument();
    expect(
      basic.queryByRole('combobox', { name: /Sals3 Category/i }),
    ).not.toBeInTheDocument();
    expect(
      basic.queryByRole('combobox', { name: /CJ Category/i }),
    ).not.toBeInTheDocument();
  });

  it('keeps the supplier CJ Category in Supplier Details', () => {
    const resolved = withCoverAddress();

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          specifications: [
            {
              key: 'category',
              label: 'CJ Category',
              value: "Men's Jackets",
              requirement: 'REQUIRED',
              source: 'SUPPLIER',
              unresolved: false,
            },
            ...resolved.specifications,
          ],
        }}
        initialLifecycle="IDLE"
      />,
    );

    const specs = within(document.getElementById('sec-specs') as HTMLElement);

    // A read-only surface, not a form control: CJ order fulfillment relies on
    // this field staying exactly what the supplier sent, so it is shown, not
    // edited, here (see SpecificationsSection.tsx).
    expect(specs.getByText(/CJ Category/i)).toBeInTheDocument();
    expect(specs.getByText("Men's Jackets")).toBeInTheDocument();
    expect(
      specs.queryByRole('textbox', { name: /CJ Category/i }),
    ).not.toBeInTheDocument();
  });

  it('warns, but never blocks publication, when no seller has ever declared a real Sals3 category', () => {
    const resolved = withCoverAddress();

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          // The auto-mirrored/no-category case: `categoryMappingConfidence`
          // is deliberately left at whatever `withCoverAddress()` already
          // carries (typically 'EXACT', matching how the CJ auto-mirror
          // resolves confidence too) — this warning must not be fooled by
          // that. `sals3CategoryDeclaredBySeller: false` is the actual
          // "nobody has decided this yet" signal.
          sals3CategoryDeclaredBySeller: false,
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    expect(
      screen.getAllByText('No Sals3 category has been decided yet').length,
    ).toBeGreaterThan(0);
    // A warning, not a blocker (owner decision 2026-08-15): a missing
    // category is a seller's own business risk, not a technical gate — and a
    // blocker here would have retroactively stopped every already-live
    // product from republishing, since none of them have gone through this
    // picker.
    expect(publishButton()).toBeEnabled();
  });

  it('clears the reminder once a seller has declared a real Sals3 category, however confidence alone reads', () => {
    const resolved = withCoverAddress();

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          sals3CategoryPath: 'Health & Beauty > Personal Care',
          sals3CategoryCode: 'CAT-GGL-200',
          sals3CategoryDeclaredBySeller: true,
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    expect(
      screen.queryByText('No Sals3 category has been decided yet'),
    ).not.toBeInTheDocument();
  });

  it('keeps the reminder even with EXACT confidence and a category path, when the auto-mirror produced them rather than a seller decision', () => {
    const resolved = withCoverAddress();

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          sals3CategoryPath: "CJ's own mirrored category name",
          sals3CategoryCode: 'CJ-1042',
          categoryMappingConfidence: 'EXACT',
          sals3CategoryDeclaredBySeller: false,
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    expect(
      screen.getAllByText('No Sals3 category has been decided yet').length,
    ).toBeGreaterThan(0);
    expect(publishButton()).toBeEnabled();
  });
});
