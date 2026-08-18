import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
});
