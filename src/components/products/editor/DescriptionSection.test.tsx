import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

  it('shows a read-only summary and hands editing to the full editor', () => {
    // Two editable surfaces over one document, each holding its own copy, is how
    // one quietly reverts the other. The listing page states what exists; the
    // full editor owns the changing of it.
    renderEditor(databaseBackedFixture());

    expect(
      screen.getByRole('link', { name: /Open full editor/i }),
    ).toHaveAttribute(
      'href',
      `/listings/${DRAFT_TARGET.productId}/description`,
    );
    expect(screen.queryByLabelText('Paragraph text')).not.toBeInTheDocument();
  });

  it('names the empty state as writing rather than editing', () => {
    renderEditor({ ...databaseBackedFixture(), descriptionBlocks: [] });

    expect(
      screen.getByRole('link', { name: /Write description/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Empty description/)).toBeInTheDocument();
  });

  it('keeps the blocks inline when there is no draft to save against', () => {
    // A fixture preview has no revision for the full editor to compare-and-set,
    // so the inline fields stay rather than linking to a screen that cannot save.
    renderEditor({ ...databaseBackedFixture(), draftSaveTarget: null });

    expect(screen.getByLabelText('Paragraph text')).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /full editor/i }),
    ).not.toBeInTheDocument();
  });

  it('summarises what the description holds without repeating the whole thing', () => {
    renderEditor({
      ...databaseBackedFixture(),
      descriptionBlocks: [
        { type: 'paragraph', text: 'A packable 20L daypack.' },
        { type: 'heading', level: 3, text: 'Key features' },
        { type: 'image', url: 'https://media.example.com/a.webp', alt: 'Back' },
      ],
    });

    expect(
      screen.getByText('1 paragraph · 1 heading · 1 image'),
    ).toBeInTheDocument();
    // `getAllBy`: the draft storefront preview elsewhere in the editor renders
    // the same first paragraph, which is correct — both are showing one
    // document.
    expect(
      screen.getAllByText(/A packable 20L daypack/).length,
    ).toBeGreaterThan(0);
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
