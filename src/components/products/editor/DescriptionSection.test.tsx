import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import uploadDescriptionImageAction from '@/app/(portal)/listings/description-image-actions';
import { renameOptionMappingAction } from '@/app/(portal)/listings/option-mapping-actions';
import { saveProductDraftAction } from '@/app/(portal)/listings/product-draft-actions';
import { resolveProductEditorFixture } from '@/lib/seller-center/mock-data/product-editor';
import type { ProductEditorFixture } from '@/lib/seller-center/product-editor/types';
import { descriptionDocumentSchema } from '@/modules/catalog/products/description-document';
import ProductEditor from './ProductEditor';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@/app/(portal)/listings/product-draft-actions', () => ({
  saveProductDraftAction: vi.fn(),
}));

// The remaining mocks all exist for one reason: each action module reaches
// the server-only db client, which throws the moment `ProductEditor` imports
// it under jsdom.
vi.mock('@/app/(portal)/listings/publish-actions', () => ({
  publishProductAction: vi.fn(),
}));

vi.mock('@/app/(portal)/listings/option-mapping-actions', () => ({
  default: vi.fn(),
  recoverSupplierLabelsAction: vi.fn(),
  renameOptionMappingAction: vi.fn(),
}));

vi.mock('@/app/(portal)/listings/category-mapping-actions', () => ({
  decideCategoryMappingAction: vi.fn(),
}));

vi.mock('@/app/(portal)/listings/media-actions', () => ({
  uploadSellerMediaAction: vi.fn(),
  deleteSellerMediaAction: vi.fn(),
}));

vi.mock('@/app/(portal)/listings/category-attributes-actions', () => ({
  default: vi.fn(),
}));

vi.mock('@/app/(portal)/listings/meta-description-actions', () => ({
  default: vi.fn(),
}));

vi.mock('@/app/(portal)/listings/show-supplier-photo-actions', () => ({
  default: vi.fn(),
}));

vi.mock('@/app/(portal)/listings/description-image-actions', () => ({
  default: vi.fn(),
}));

const DRAFT_TARGET = {
  productId: '11111111-1111-4111-8111-111111111111',
  revisionId: '22222222-2222-4222-8222-222222222222',
  expectedRevisionVersion: 3,
};

function databaseBackedFixture(): ProductEditorFixture {
  const resolved = resolveProductEditorFixture('pass');

  if (resolved === null) throw new Error('missing fixture');

  return { ...resolved, draftSaveTarget: DRAFT_TARGET };
}

function renderEditor(fixture: ProductEditorFixture) {
  return render(
    <ProductEditor
      fixture={fixture}
      initialLifecycle="IDLE"
      dataMode="database"
    />,
  );
}

async function saveDraft() {
  fireEvent.click(screen.getByRole('button', { name: /Save Draft/i }));

  await waitFor(() => expect(saveProductDraftAction).toHaveBeenCalled());

  const [input] = vi.mocked(saveProductDraftAction).mock.calls.at(-1) ?? [];

  return descriptionDocumentSchema.parse(
    (input as { descriptionDocument: unknown }).descriptionDocument,
  );
}

describe('Description section - block authoring', () => {
  it('saves a loaded document unchanged when nothing was edited', async () => {
    // The regression this section was rebuilt for. The editor used to be
    // handed a flattened string and re-parse it into paragraphs on save, so
    // opening a product and pressing Save Draft rewrote every heading,
    // bullet list, and detail list it held as prose.
    const fixture = databaseBackedFixture();

    vi.mocked(saveProductDraftAction).mockResolvedValue({
      ok: true,
      revisionVersion: 4,
    });

    renderEditor(fixture);

    const document = await saveDraft();

    expect(document.blocks).toEqual(fixture.descriptionBlocks);
    expect(document.blocks.map((block) => block.type)).toContain('heading');
    expect(document.blocks.map((block) => block.type)).toContain('bulletList');
    expect(document.blocks.map((block) => block.type)).toContain(
      'keyValueList',
    );
  });

  it('adds a heading the seller typed as a heading block, not a paragraph', async () => {
    vi.mocked(saveProductDraftAction).mockResolvedValue({
      ok: true,
      revisionVersion: 4,
    });

    renderEditor({ ...databaseBackedFixture(), descriptionBlocks: [] });

    fireEvent.click(screen.getByRole('button', { name: 'Heading' }));
    fireEvent.change(screen.getByLabelText('Heading text'), {
      target: { value: 'Fit and sizing' },
    });

    const document = await saveDraft();

    expect(document.blocks).toEqual([
      { type: 'heading', level: 3, text: 'Fit and sizing' },
    ]);
  });

  it('reorders blocks into the order the storefront will render', async () => {
    vi.mocked(saveProductDraftAction).mockResolvedValue({
      ok: true,
      revisionVersion: 4,
    });

    renderEditor({
      ...databaseBackedFixture(),
      descriptionBlocks: [
        { type: 'paragraph', text: 'First.' },
        { type: 'paragraph', text: 'Second.' },
      ],
    });

    fireEvent.click(
      screen.getAllByRole('button', { name: /Move paragraph up/ })[1],
    );

    const document = await saveDraft();

    expect(document.blocks).toEqual([
      { type: 'paragraph', text: 'Second.' },
      { type: 'paragraph', text: 'First.' },
    ]);
  });

  it('warns about markup in the block rather than failing the save later', () => {
    renderEditor({
      ...databaseBackedFixture(),
      descriptionBlocks: [{ type: 'paragraph', text: 'Placeholder.' }],
    });

    fireEvent.change(screen.getByLabelText('Paragraph text'), {
      target: { value: 'Wear <b>this</b>.' },
    });

    expect(screen.getByText(/Markup is not allowed/)).toBeInTheDocument();
  });

  it('never tells the seller supplier HTML is sanitised', () => {
    // There is no sanitiser. The copy that claimed one shipped for months
    // beside a field sellers were being asked to trust.
    renderEditor(databaseBackedFixture());

    expect(screen.queryByText(/are sanitised before/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/never copied into a Sals3 listing/),
    ).toBeInTheDocument();
  });

  it('adds two consecutive image blocks for the side-by-side preset', async () => {
    vi.mocked(saveProductDraftAction).mockResolvedValue({
      ok: true,
      revisionVersion: 4,
    });
    vi.mocked(uploadDescriptionImageAction).mockResolvedValue({
      ok: true,
      url: 'https://media.example.com/description-media/p/a.webp',
      widthPixels: 1200,
      heightPixels: 900,
    });

    renderEditor({ ...databaseBackedFixture(), descriptionBlocks: [] });

    fireEvent.click(
      screen.getByRole('button', { name: 'Two images, side by side' }),
    );

    // The layout is adjacency, not a stored group: two plain image blocks,
    // and the editor says what the storefront will do with them.
    expect(screen.getAllByLabelText('Alt text')).toHaveLength(2);
    expect(screen.getByText('1 of 2 side by side')).toBeInTheDocument();
    expect(screen.getByText('2 of 2 side by side')).toBeInTheDocument();
  });

  it('uploads a file and saves the returned address in the block', async () => {
    vi.mocked(saveProductDraftAction).mockResolvedValue({
      ok: true,
      revisionVersion: 4,
    });
    vi.mocked(uploadDescriptionImageAction).mockResolvedValue({
      ok: true,
      url: 'https://media.example.com/description-media/p/a.webp',
      widthPixels: 1200,
      heightPixels: 900,
    });

    renderEditor({ ...databaseBackedFixture(), descriptionBlocks: [] });

    fireEvent.click(screen.getByRole('button', { name: 'Image, full width' }));

    const file = new File(['bytes'], 'chart.png', { type: 'image/png' });

    // The file input is hidden from the accessibility tree — the Upload
    // button is the control — so it is reached by test id rather than role.
    fireEvent.change(screen.getByTestId(/-file$/), {
      target: { files: [file] },
    });

    await waitFor(() =>
      expect(uploadDescriptionImageAction).toHaveBeenCalled(),
    );

    fireEvent.change(screen.getByLabelText('Alt text'), {
      target: { value: 'Size chart' },
    });

    const saved = await saveDraft();

    expect(saved.blocks).toEqual([
      {
        type: 'image',
        url: 'https://media.example.com/description-media/p/a.webp',
        alt: 'Size chart',
      },
    ]);
  });

  it('asks for alt text before the image is publishable', () => {
    renderEditor({
      ...databaseBackedFixture(),
      descriptionBlocks: [
        {
          type: 'image',
          url: 'https://media.example.com/description-media/p/a.webp',
          alt: '',
        },
      ],
    });

    expect(screen.getByText(/Alt text is required/)).toBeInTheDocument();
  });
});

describe('Variant Matrix - renaming a saved mapping', () => {
  const MAPPED_AXES = [
    {
      optionId: '33333333-3333-4333-8333-333333333333',
      name: 'Colr',
      values: [
        {
          valueId: '44444444-4444-4444-8444-444444444444',
          label: 'Army Green',
          supplierValue: 'army green',
        },
      ],
    },
  ];

  function mappedFixture(): ProductEditorFixture {
    const base = databaseBackedFixture();

    return {
      ...base,
      mappedAxes: MAPPED_AXES,
      publishTarget: {
        productId: '11111111-1111-4111-8111-111111111111',
        expectedProductVersion: 7,
      },
      optionMapping: {
        ...base.optionMapping,
        mappedAxisNames: ['Colr'],
      },
    };
  }

  it('offers an edit path instead of leaving a typo permanent', () => {
    // The reported defect: after saving, the matrix could only be read.
    renderEditor(mappedFixture());

    expect(screen.getByRole('button', { name: 'Edit names' })).toBeEnabled();
  });

  it('says plainly what still cannot change', () => {
    renderEditor(mappedFixture());

    expect(
      screen.getByText(
        /number of options, and which supplier value sits where/,
      ),
    ).toBeInTheDocument();
  });

  it('sends only the display words, keyed by the stored ids', async () => {
    vi.mocked(renameOptionMappingAction).mockResolvedValue({
      ok: true,
      axisCount: 1,
      renamedValueCount: 1,
    });

    renderEditor(mappedFixture());

    fireEvent.click(screen.getByRole('button', { name: 'Edit names' }));
    fireEvent.change(screen.getByLabelText('Option 1 name'), {
      target: { value: 'Colour' },
    });
    fireEvent.change(screen.getByLabelText('Buyer label for army green'), {
      target: { value: 'Olive' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save names' }));

    await waitFor(() => expect(renameOptionMappingAction).toHaveBeenCalled());

    expect(renameOptionMappingAction).toHaveBeenCalledWith({
      productId: '11111111-1111-4111-8111-111111111111',
      expectedProductVersion: 7,
      axes: [
        {
          optionId: MAPPED_AXES[0].optionId,
          name: 'Colour',
          values: [
            { valueId: MAPPED_AXES[0].values[0].valueId, label: 'Olive' },
          ],
        },
      ],
    });
  });

  it('shows the supplier value beside the name, read-only', () => {
    renderEditor(mappedFixture());

    fireEvent.click(screen.getByRole('button', { name: 'Edit names' }));

    // The supplier token is what CJ fulfilment matches on. It is shown so the
    // seller knows what they are renaming, and it is not an input.
    expect(screen.getByText('army green')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('army green')).not.toBeInTheDocument();
  });

  it('keeps the new names on screen after the save resolves', async () => {
    vi.mocked(renameOptionMappingAction).mockResolvedValue({
      ok: true,
      axisCount: 1,
      renamedValueCount: 1,
    });

    renderEditor(mappedFixture());

    fireEvent.click(screen.getByRole('button', { name: 'Edit names' }));
    fireEvent.change(screen.getByLabelText('Option 1 name'), {
      target: { value: 'Colour' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save names' }));

    // `router.refresh()` is mocked, so without the local mirror the card
    // would snap back to the old name the moment editing closed.
    await waitFor(() =>
      expect(screen.getByText(/Mapped as Colour/)).toBeInTheDocument(),
    );
  });

  it('reports a refusal instead of pretending the rename landed', async () => {
    vi.mocked(renameOptionMappingAction).mockResolvedValue({
      ok: false,
      reason: 'version_conflict',
      message: 'This product changed in another tab or session.',
    });

    renderEditor(mappedFixture());

    fireEvent.click(screen.getByRole('button', { name: 'Edit names' }));
    fireEvent.change(screen.getByLabelText('Option 1 name'), {
      target: { value: 'Colour' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save names' }));

    await waitFor(() =>
      expect(
        screen.getByText(/changed in another tab or session/),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Mapped as Colour/)).not.toBeInTheDocument();
  });
});
