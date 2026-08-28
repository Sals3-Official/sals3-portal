import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import assignVariantMediaAction from '@/app/(portal)/listings/variant-media-actions';
import saveCategoryAttributesAction from '@/app/(portal)/listings/category-attributes-actions';
import saveMetaDescriptionAction from '@/app/(portal)/listings/meta-description-actions';
import { publishProductAction } from '@/app/(portal)/listings/publish-actions';
import { resolveProductEditorFixture } from '@/lib/seller-center/mock-data/product-editor';
import { minorToDecimalString } from '@/lib/seller-center/product-editor/format';
import { minimumRetailAmountMinorForSupplierCost } from '@/lib/pricing/retail-price-floor';
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
  discardProductDraftAction: vi.fn(),
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
vi.mock('@/app/(portal)/listings/description-actions', () => ({
  default: vi.fn(),
}));

vi.mock('@/app/(portal)/listings/description-image-actions', () => ({
  default: vi.fn(),
}));

vi.mock('@/app/(portal)/listings/media-actions', () => ({
  uploadSellerMediaAction: vi.fn(),
  deleteSellerMediaAction: vi.fn(),
  reorderProductMediaAction: vi.fn(),
}));

// Same reasoning: `assign-variant-media.ts` reaches the server-only db client too.
vi.mock('@/app/(portal)/listings/variant-media-actions', () => ({
  default: vi.fn(),
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

/** A real UUID, because the editor only sends prices for variants that have one. */
const RULE_PRICED_VARIANT_ID = '33333333-3333-4333-8333-333333333333';

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

  /**
   * Reported from production on 2026-08-28: after choosing the Category, every
   * Retail price cell stayed `0.00` and the readiness panel kept blocking on
   * "Retail price is required", while the line under each cell already read
   * "From 33.33% markup on …". Only a hard reload fixed it.
   *
   * The category decision is what makes a product priceable at all, and it
   * calls `router.refresh()` — which re-renders this already-mounted component
   * with a fresh fixture. The variants state was seeded on mount and never
   * resynced, so it threw the first real prices away. Rerendering with a new
   * fixture is exactly what that refresh does.
   */
  it('takes the rule price the server sends after a category decision, with no reload', () => {
    const resolved = fixture('attention');
    const unpriced = {
      ...resolved,
      variants: resolved.variants.map((variant, index) =>
        index === 0
          ? {
              ...variant,
              id: RULE_PRICED_VARIANT_ID,
              retailPrice: { amountMinor: 0, currency: 'USD' },
              retailPriceIsSellerSet: false,
              attention: 'Retail price required',
            }
          : variant,
      ),
    };
    const label = `Retail price for ${unpriced.variants[0].optionLabel}`;

    const view = render(
      <ProductEditor
        fixture={unpriced}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    expect(screen.getByLabelText(label)).toHaveValue('0.00');

    view.rerender(
      <ProductEditor
        fixture={{
          ...unpriced,
          variants: unpriced.variants.map((variant, index) =>
            index === 0
              ? {
                  ...variant,
                  retailPrice: { amountMinor: 2344, currency: 'USD' },
                  attention: null,
                }
              : variant,
          ),
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    expect(screen.getByLabelText(label)).toHaveValue('23.44');
  });

  it('never overwrites a price the seller decided on that refresh', () => {
    const resolved = fixture('attention');
    const sellerSet = {
      ...resolved,
      variants: resolved.variants.map((variant, index) =>
        index === 0
          ? {
              ...variant,
              id: RULE_PRICED_VARIANT_ID,
              retailPrice: { amountMinor: 999, currency: 'USD' },
              retailPriceIsSellerSet: true,
              attention: null,
            }
          : variant,
      ),
    };
    const label = `Retail price for ${sellerSet.variants[0].optionLabel}`;

    const view = render(
      <ProductEditor
        fixture={sellerSet}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    view.rerender(
      <ProductEditor
        fixture={{
          ...sellerSet,
          variants: sellerSet.variants.map((variant, index) =>
            index === 0
              ? {
                  ...variant,
                  retailPrice: { amountMinor: 2344, currency: 'USD' },
                }
              : variant,
          ),
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    expect(screen.getByLabelText(label)).toHaveValue('9.99');
  });

  /**
   * The guarantee this whole path exists for.
   *
   * Anything sent as a `variantRetailPrice` is stored as `SELLER_RETAIL_PRICE`
   * and is then permanently exempt from margin rules and from repricing. The
   * editor used to send every price it was showing — including the ones the
   * rules had produced — so a category margin only ever reached a product's
   * first publication and every republish froze it again.
   */
  it('publishes a rule-priced variant WITHOUT sending its price back', async () => {
    const resolved = fixture('attention');
    vi.mocked(publishProductAction).mockResolvedValue({
      ok: true,
      slug: 'aurelis-daypack',
      offerCount: 1,
      availability: 'AVAILABLE',
    });

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          variants: resolved.variants.map((variant, index) =>
            index === 0
              ? {
                  ...variant,
                  id: RULE_PRICED_VARIANT_ID,
                  retailPriceIsSellerSet: false,
                }
              : variant,
          ),
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
        // Empty: the resolver runs and writes the same number the cell shows.
        variantRetailPrices: [],
      }),
    );
  });

  it('publishes a price the seller typed AS the seller’s', async () => {
    const resolved = fixture('attention');
    vi.mocked(publishProductAction).mockResolvedValue({
      ok: true,
      slug: 'aurelis-daypack',
      offerCount: 1,
      availability: 'AVAILABLE',
    });

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          variants: resolved.variants.map((variant, index) =>
            index === 0
              ? {
                  ...variant,
                  id: RULE_PRICED_VARIANT_ID,
                  retailPriceIsSellerSet: true,
                }
              : variant,
          ),
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
      expect(publishProductAction).toHaveBeenCalledWith(
        expect.objectContaining({
          variantRetailPrices: [
            expect.objectContaining({ variantId: RULE_PRICED_VARIANT_ID }),
          ],
        }),
      ),
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
    // Four, not three: the shared publish-gate predictor adds `No variant is
    // listed`, which is true of this fixture and which `publish.ts` would have
    // refused on. Asserted by name below so the number is not a magic constant.
    expect(button).toHaveAttribute('title', '4 hard blockers must clear first');
    // The reason is on screen too, not only in a tooltip.
    expect(
      screen.getAllByText('4 hard blockers must clear first').length,
    ).toBeGreaterThan(0);
    expect(screen.getByText('Publishing is disabled')).toBeInTheDocument();
    expect(screen.getAllByText('No variant is listed').length).toBeGreaterThan(
      0,
    );
  });

  it('clears a gate when the seller changes the thing it is about', () => {
    // The bug this exists to catch: the predictor read `fixture`, the page-load
    // snapshot, so switching a variant on left `No variant is listed` standing
    // over a listed variant. It read as a broken toggle. Every other test in this
    // file seeds state and renders once, so none of them exercised *change* —
    // which is why a green suite shipped it.
    const resolved = fixture('pass');
    const first = resolved.variants[0];

    if (first === undefined) throw new Error('fixture has no variants');

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          variants: [
            {
              ...first,
              enabled: false,
              supplierStock: 20_000,
              listingState: 'NOT_LISTED',
            },
          ],
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    // `autoListVariants` switches an in-stock, unblocked variant on at load, so
    // the gate must already be absent.
    expect(screen.queryByText('No variant is listed')).not.toBeInTheDocument();

    const listSwitch = screen
      .getAllByRole('switch')
      .find((element) =>
        /^List /.test(element.getAttribute('aria-label') ?? ''),
      );

    if (listSwitch === undefined) throw new Error('no list switch');

    fireEvent.click(listSwitch);

    // Switched off by hand: the gate has to come back, or the panel is not
    // watching either.
    expect(screen.getAllByText('No variant is listed').length).toBeGreaterThan(
      0,
    );

    fireEvent.click(listSwitch);

    expect(screen.queryByText('No variant is listed')).not.toBeInTheDocument();
  });

  it('predicts no gate for a product publication would accept', () => {
    // The safety property of the predictor. A missing warning costs one refused
    // Publish; a false blocker stops a listing that could have gone live, and no
    // wording makes that acceptable. So the clean fixtures must predict nothing.
    renderEditor('pass');

    expect(publishButton()).toBeEnabled();

    [
      'Sals3 category is required',
      'No variant is listed',
      'No supplier cost on any listable variant',
      'No approved photo is on file',
      'Retail price must include at least 2.5% markup',
      'Variant Matrix needs its option names',
    ].forEach((title) =>
      expect(screen.queryByText(title)).not.toBeInTheDocument(),
    );
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
      screen.getAllByText('Retail price must include at least 2.5% markup')
        .length,
    ).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /^Publish/ })).toBeDisabled();
    expect(screen.getAllByText(/Minimum /).length).toBeGreaterThan(0);
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

  it('will not keep a manually-entered retail price equal to supplier cost', async () => {
    const resolved = fixture('pass');
    const target = resolved.variants[0];

    render(<ProductEditor fixture={resolved} initialLifecycle="IDLE" />);

    const retailInput = screen.getAllByLabelText(
      /^Retail price for/,
    )[0] as HTMLInputElement;
    const supplierCost = minorToDecimalString(
      target.supplierCost.amountMinor,
      target.supplierCost.currency,
    );
    const minimumRetail = minorToDecimalString(
      minimumRetailAmountMinorForSupplierCost(target.supplierCost.amountMinor),
      target.supplierCost.currency,
    );

    fireEvent.focus(retailInput);
    fireEvent.change(retailInput, { target: { value: supplierCost } });
    fireEvent.blur(retailInput);

    await waitFor(() => expect(retailInput).toHaveValue(minimumRetail));
    expect(
      screen.queryByText('Retail price must include at least 2.5% markup'),
    ).not.toBeInTheDocument();
  });

  it('does not apply a bulk retail price equal to the highest affected supplier cost', () => {
    const resolved = fixture('pass');
    const highestSupplierCost = Math.max(
      ...resolved.variants.map((variant) => variant.supplierCost.amountMinor),
    );
    const currency = resolved.source.sourceCurrency;
    const blockedPrice = minorToDecimalString(highestSupplierCost, currency);
    const minimumRetailPrice = {
      amountMinor: minimumRetailAmountMinorForSupplierCost(highestSupplierCost),
      currency,
    };

    render(<ProductEditor fixture={resolved} initialLifecycle="IDLE" />);

    fireEvent.click(screen.getByRole('button', { name: 'Set retail price…' }));
    const bulkPriceInput = screen.getByLabelText(`Retail price (${currency})`);

    expect(bulkPriceInput).toHaveAttribute(
      'min',
      minorToDecimalString(minimumRetailPrice.amountMinor, currency),
    );

    fireEvent.change(bulkPriceInput, {
      target: { value: blockedPrice },
    });

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

  it('blocks publication when the product has no Sals3 category of its own', () => {
    // Owner decision 2026-08-20 replaces the 2026-08-15 one that made this a
    // warning. `publish.ts` already refused `SALS3_CATEGORY_REQUIRED`, so the
    // panel calling it a warning — and saying publishing was allowed — was the
    // screen contradicting the server, discovered only by pressing Publish.
    const resolved = withCoverAddress();

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          sals3CategoryCode: null,
          sals3CategoryDeclaredBySeller: false,
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    expect(
      screen.getAllByText('Sals3 category is required').length,
    ).toBeGreaterThan(0);
    expect(publishButton()).toBeDisabled();
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
      screen.queryByText('Sals3 category is required'),
    ).not.toBeInTheDocument();
  });

  it('blocks a CJ-mirrored category, which resolves EXACT confidence and is not a Sals3 one', () => {
    // The case confidence alone could never catch: `cj-mirror.ts` auto-creates a
    // `CJ-<id>` row for almost every CJ-sourced product and it resolves EXACT.
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
      screen.getAllByText('Sals3 category is required').length,
    ).toBeGreaterThan(0);
    expect(publishButton()).toBeDisabled();
  });

  it('accepts a real v1 category applied by an approved mapping, not only one the seller picked', () => {
    // `publish.ts` accepts it, so the panel must not raise a blocker the server
    // would never raise. Keying off "declared by this seller" did exactly that.
    const resolved = withCoverAddress();

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          sals3CategoryPath: 'Apparel & Accessories > Clothing',
          sals3CategoryCode: 'CAT-GGL-1604',
          categoryMappingConfidence: 'EXACT',
          sals3CategoryDeclaredBySeller: false,
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    expect(
      screen.queryByText('Sals3 category is required'),
    ).not.toBeInTheDocument();
  });
});

/**
 * The reported behaviour: a seller typed a specification, pressed Publish
 * without pressing Save Specifications, and the listing went live without it.
 * The section owns its own versioned write, so the publish request never carried
 * those fields — and nothing on screen said they were unsaved.
 */
describe('Product Editor - Publish carries unsaved specifications', () => {
  const VALIDATION = {
    outcome: 'VALID' as const,
    categoryCode: 'CAT-GGL-1',
    controlsVersion: 'sals3-attribute-controls-v1',
    acceptedAttributes: {},
    missingRequiredAttributes: [],
    missingRecommendedAttributes: [],
    unrecognizedAttributes: [],
    findings: [],
    contractVersion: 'category-attribute-contract-v1',
  };

  function renderWithSpecification() {
    const resolved = fixture('pass');

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
  }

  async function confirmPublish() {
    fireEvent.click(screen.getByRole('button', { name: /^Publish/ }));

    const dialog = await screen.findByRole('alertdialog');

    fireEvent.click(within(dialog).getByRole('button', { name: /^Publish/ }));
  }

  it('saves the edited specification first, then publishes against the new version', async () => {
    vi.mocked(saveCategoryAttributesAction).mockResolvedValue({
      ok: true,
      productVersion: 8,
      validation: VALIDATION,
    });
    vi.mocked(publishProductAction).mockResolvedValue({
      ok: true,
      slug: 'aurelis-daypack',
      offerCount: 2,
      availability: 'AVAILABLE',
    });

    renderWithSpecification();

    fireEvent.change(screen.getByDisplayValue('Royal Canin'), {
      target: { value: 'Generic' },
    });
    await confirmPublish();

    await waitFor(() =>
      expect(saveCategoryAttributesAction).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedProductVersion: 7,
          attributes: { Brand: ['Generic'] },
        }),
      ),
    );

    // 8, not 7: the specification write bumped `products.version`, and a
    // publish that compare-and-sets against 7 would be refused for having done
    // what it was asked to do.
    await waitFor(() =>
      expect(publishProductAction).toHaveBeenCalledWith(
        expect.objectContaining({ expectedProductVersion: 8 }),
      ),
    );
  });

  it('publishes nothing when the specification write is refused', async () => {
    vi.mocked(saveCategoryAttributesAction).mockResolvedValue({
      ok: false,
      reason: 'version_conflict',
      message: 'This product changed in another tab or session.',
    });
    vi.mocked(publishProductAction).mockClear();

    renderWithSpecification();

    fireEvent.change(screen.getByDisplayValue('Royal Canin'), {
      target: { value: 'Generic' },
    });
    await confirmPublish();

    await waitFor(() =>
      expect(saveCategoryAttributesAction).toHaveBeenCalled(),
    );
    // Publishing anyway would put a listing live that contradicts the screen.
    expect(publishProductAction).not.toHaveBeenCalled();
  });

  it('does not write specifications that were never edited', async () => {
    vi.mocked(saveCategoryAttributesAction).mockClear();
    vi.mocked(publishProductAction).mockResolvedValue({
      ok: true,
      slug: 'aurelis-daypack',
      offerCount: 2,
      availability: 'AVAILABLE',
    });

    renderWithSpecification();
    await confirmPublish();

    await waitFor(() => expect(publishProductAction).toHaveBeenCalled());
    expect(saveCategoryAttributesAction).not.toHaveBeenCalled();
  });
});

/**
 * Publication used to report itself in a toast that dismissed itself while the
 * seller was still reading it, and offered nowhere to go.
 */
describe('Product Editor - publish confirmation', () => {
  it('confirms the listing is live and offers the way back to the catalogue', async () => {
    const resolved = fixture('pass');

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

    fireEvent.click(screen.getByRole('button', { name: /^Publish/ }));

    const confirmation = await screen.findByRole('alertdialog');

    fireEvent.click(
      within(confirmation).getByRole('button', { name: /^Publish/ }),
    );

    expect(
      await screen.findByText('Published to the storefront'),
    ).toBeInTheDocument();
    expect(screen.getByText('/p/aurelis-daypack')).toBeInTheDocument();

    const back = screen.getByRole('link', {
      name: 'Go to Product Catalogue',
    });

    expect(back).toHaveAttribute('href', '/products/pipeline?tab=ready');
  });

  it('says nothing about publication in design-preview mode', async () => {
    renderEditor('pass');

    fireEvent.click(screen.getByRole('button', { name: /^Publish/ }));

    const confirmation = await screen.findByRole('alertdialog');

    fireEvent.click(
      within(confirmation).getByRole('button', { name: /^Publish/ }),
    );

    await waitFor(() =>
      expect(
        screen.queryByText('Published to the storefront'),
      ).not.toBeInTheDocument(),
    );
  });
});

/**
 * `product_media_sources.variant_id` existed from the start, the read model
 * always reported `hasImage` from it, and nothing ever wrote it — so every
 * variant of every product showed "No variant image" with no control to press,
 * on products whose photos were already uploaded.
 */
describe('Product Editor - variant photos', () => {
  const PHOTO = 'https://media.example-r2.dev/product-media/p/one.webp';
  const OTHER_PHOTO = 'https://media.example-r2.dev/product-media/p/two.webp';
  const MEDIA_ID = '88888888-8888-4888-8888-888888888888';

  function renderWithMedia(variantOverrides: Record<string, unknown> = {}) {
    const resolved = fixture('pass');
    const [firstVariant, ...restVariants] = resolved.variants;

    if (firstVariant === undefined) throw new Error('fixture has no variants');

    render(
      <ProductEditor
        fixture={{
          ...resolved,
          assignableMedia: [
            {
              mediaId: MEDIA_ID,
              url: PHOTO,
              sourceType: 'SELLER_UPLOAD',
              variantId: null,
            },
            {
              mediaId: '99999999-9999-4999-8999-999999999999',
              url: OTHER_PHOTO,
              sourceType: 'SUPPLIER_ORIGINAL',
              variantId: null,
            },
          ],
          variants: [{ ...firstVariant, ...variantOverrides }, ...restVariants],
          publishTarget: {
            productId: '11111111-1111-4111-8111-111111111111',
            expectedProductVersion: 7,
          },
        }}
        initialLifecycle="IDLE"
        dataMode="database"
      />,
    );

    return { variantLabel: firstVariant.optionLabel };
  }

  it('offers a control on a variant that has no photo', () => {
    const { variantLabel } = renderWithMedia({
      hasImage: false,
      imageUrl: null,
      imageMediaId: null,
    });

    expect(
      screen.getByRole('button', {
        name: `Choose photo for ${variantLabel}`,
      }),
    ).toBeEnabled();
  });

  it('assigns the chosen photo to that variant', async () => {
    vi.mocked(assignVariantMediaAction).mockResolvedValue({
      ok: true,
      mediaId: MEDIA_ID,
      variantId: 'ignored-by-the-local-update',
    });

    const { variantLabel } = renderWithMedia({
      hasImage: false,
      imageUrl: null,
      imageMediaId: null,
    });

    fireEvent.click(
      screen.getByRole('button', { name: `Choose photo for ${variantLabel}` }),
    );

    const picker = await screen.findByRole('dialog');

    fireEvent.click(within(picker).getAllByRole('button')[0] as HTMLElement);

    await waitFor(() =>
      expect(assignVariantMediaAction).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: '11111111-1111-4111-8111-111111111111',
          mediaId: MEDIA_ID,
        }),
      ),
    );
  });

  it('says plainly that unlinking is not a delete', async () => {
    const { variantLabel } = renderWithMedia({
      hasImage: true,
      imageUrl: PHOTO,
      imageMediaId: MEDIA_ID,
    });

    fireEvent.click(
      screen.getByRole('button', { name: `Change photo for ${variantLabel}` }),
    );

    expect(
      await screen.findByText(/stays in Product media/i),
    ).toBeInTheDocument();
  });

  it('reports a refusal instead of showing a photo that was not linked', async () => {
    vi.mocked(assignVariantMediaAction).mockResolvedValue({
      ok: false,
      reason: 'MEDIA_NOT_FOUND',
      message: 'That photo is no longer stored on this product.',
    });

    const { variantLabel } = renderWithMedia({
      hasImage: false,
      imageUrl: null,
      imageMediaId: null,
    });

    fireEvent.click(
      screen.getByRole('button', { name: `Choose photo for ${variantLabel}` }),
    );

    const picker = await screen.findByRole('dialog');

    fireEvent.click(within(picker).getAllByRole('button')[0] as HTMLElement);

    expect(
      await screen.findByText(/no longer stored on this product/i),
    ).toBeInTheDocument();
  });
});
