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

const PHOTO_URL = 'https://media.example.com/description-media/p/a.webp';

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

  it('opens an empty description in the simple box, ready to type', () => {
    // A new product should not need a click before the first keystroke. The mode
    // is derived from content, and an empty document is simple-representable.
    renderEditor({ ...databaseBackedFixture(), descriptionBlocks: [] });

    expect(screen.getByLabelText('Product description')).toBeInTheDocument();
    expect(screen.getByText(/Empty description/)).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /full editor/i }),
    ).not.toBeInTheDocument();
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

/**
 * Two editors over one stored document.
 *
 * The mode is derived from the content rather than stored, so these cases are
 * about which surface a given document opens in — and about the one conversion
 * that can change content, which must never happen without being named first.
 */
describe('Description section - simple text and designed layout', () => {
  const RICH = [
    { type: 'heading' as const, level: 2 as const, text: 'Fit and sizing' },
    { type: 'bulletList' as const, items: ['Six pockets'] },
  ];

  it('opens a plain-paragraph document in simple text', () => {
    renderEditor({
      ...databaseBackedFixture(),
      descriptionBlocks: [{ type: 'paragraph', text: 'Soft cotton twill.' }],
    });

    expect(screen.getByLabelText('Product description')).toHaveValue(
      'Soft cotton twill.',
    );
    expect(screen.getByRole('button', { name: /Simple text/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('opens a document with structure in the designed layout', () => {
    renderEditor({ ...databaseBackedFixture(), descriptionBlocks: RICH });

    expect(
      screen.getByRole('button', { name: /Designed layout/ }),
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('link', { name: /Open full editor/i }),
    ).toBeInTheDocument();
  });

  it('saves what was typed in the simple box as paragraph blocks', async () => {
    vi.mocked(saveProductDraftAction).mockResolvedValue({
      ok: true,
      revisionVersion: 4,
    });

    renderEditor({ ...databaseBackedFixture(), descriptionBlocks: [] });

    fireEvent.change(screen.getByLabelText('Product description'), {
      target: { value: 'Features:\nSix pockets\n\nCare:\nCold wash' },
    });

    // A blank line starts a paragraph; a single newline stays inside one.
    expect((await saveDraft()).blocks).toEqual([
      { type: 'paragraph', text: 'Features:\nSix pockets' },
      { type: 'paragraph', text: 'Care:\nCold wash' },
    ]);
  });

  it('switching to the designed layout needs no warning and loses nothing', () => {
    renderEditor({
      ...databaseBackedFixture(),
      descriptionBlocks: [{ type: 'paragraph', text: 'Soft cotton twill.' }],
    });

    fireEvent.click(screen.getByRole('button', { name: /Designed layout/ }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Open full editor/i }),
    ).toBeInTheDocument();
  });

  it('refuses to flatten a designed document without naming what it costs', () => {
    renderEditor({ ...databaseBackedFixture(), descriptionBlocks: RICH });

    fireEvent.click(screen.getByRole('button', { name: /Simple text/ }));

    const dialog = screen.getByRole('alertdialog');

    expect(dialog).toHaveTextContent('1 heading');
    expect(dialog).toHaveTextContent('1 bullet list');
    // The modal correctly takes the background out of the accessibility tree,
    // so "still designed" is asserted by the cancel case below rather than by
    // reaching for a control the dialog is deliberately hiding.
  });

  it('cancelling the warning keeps the designed layout untouched', async () => {
    vi.mocked(saveProductDraftAction).mockResolvedValue({
      ok: true,
      revisionVersion: 4,
    });

    renderEditor({ ...databaseBackedFixture(), descriptionBlocks: RICH });

    fireEvent.click(screen.getByRole('button', { name: /Simple text/ }));
    fireEvent.click(
      screen.getByRole('button', { name: /Keep the designed layout/ }),
    );

    expect((await saveDraft()).blocks).toEqual(RICH);
  });

  it('confirming keeps every word and drops only the structure', async () => {
    vi.mocked(saveProductDraftAction).mockResolvedValue({
      ok: true,
      revisionVersion: 4,
    });

    renderEditor({ ...databaseBackedFixture(), descriptionBlocks: RICH });

    fireEvent.click(screen.getByRole('button', { name: /Simple text/ }));
    fireEvent.click(screen.getByRole('button', { name: /Switch and flatten/ }));

    expect((await saveDraft()).blocks).toEqual([
      { type: 'paragraph', text: 'Fit and sizing' },
      { type: 'paragraph', text: 'Six pockets' },
    ]);
  });

  it('lets a trailing space be typed, and keeps it', () => {
    // Storing trims each paragraph, so deriving the field's value from the
    // document made a trailing space impossible to type — it round-tripped away
    // in the same keystroke that produced it. The field holds its own text and
    // reconciles against its projection instead.
    renderEditor({
      ...databaseBackedFixture(),
      descriptionBlocks: [{ type: 'paragraph', text: 'Soft cotton' }],
    });

    const field = screen.getByLabelText('Product description');

    fireEvent.change(field, { target: { value: 'Soft cotton ' } });

    expect(field).toHaveValue('Soft cotton ');
  });

  it('saves the trimmed text even though the field keeps the space', async () => {
    vi.mocked(saveProductDraftAction).mockResolvedValue({
      ok: true,
      revisionVersion: 4,
    });

    renderEditor({ ...databaseBackedFixture(), descriptionBlocks: [] });

    fireEvent.change(screen.getByLabelText('Product description'), {
      target: { value: '  Soft cotton  ' },
    });

    expect((await saveDraft()).blocks).toEqual([
      { type: 'paragraph', text: 'Soft cotton' },
    ]);
  });

  it('opens a legacy photo-bearing document in the designed layout', () => {
    // No stored mode means it predates the field, so its photo was published.
    // Designed is where that photo is visible, and nothing it publishes changes.
    renderEditor({
      ...databaseBackedFixture(),
      descriptionMode: undefined,
      descriptionBlocks: [
        { type: 'paragraph', text: 'Soft cotton twill.' },
        { type: 'image', url: PHOTO_URL, alt: 'Pocket detail' },
      ],
    });

    expect(
      screen.getByRole('button', { name: /Designed layout/ }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  it('says a retained photo is kept and not published, rather than showing nothing', () => {
    // The seller chose simple text. The photo stays in the document so switching
    // layout again restores it, and simple text does not publish it — so it has
    // to be *mentioned*, or it reads as a photo that was thrown away.
    renderEditor({
      ...databaseBackedFixture(),
      descriptionMode: 'simple',
      descriptionBlocks: [
        { type: 'paragraph', text: 'Soft cotton twill.' },
        { type: 'image', url: PHOTO_URL, alt: 'Pocket detail' },
      ],
    });

    expect(screen.getByLabelText('Product description')).toHaveValue(
      'Soft cotton twill.',
    );
    expect(
      screen.getByText(/One photo from the designed layout is saved/),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('simple-description-file'),
    ).not.toBeInTheDocument();
  });

  it('keeps a retained photo through an edit and a save', async () => {
    vi.mocked(saveProductDraftAction).mockResolvedValue({
      ok: true,
      revisionVersion: 4,
    });

    renderEditor({
      ...databaseBackedFixture(),
      descriptionMode: 'simple',
      descriptionBlocks: [
        { type: 'paragraph', text: 'Soft cotton twill.' },
        { type: 'image', url: PHOTO_URL, alt: 'Pocket detail' },
      ],
    });

    fireEvent.change(screen.getByLabelText('Product description'), {
      target: { value: 'Rewritten entirely.' },
    });

    const document = await saveDraft();

    // Typing in the box must never be the thing that drops an upload.
    expect(document.blocks).toEqual([
      { type: 'paragraph', text: 'Rewritten entirely.' },
      { type: 'image', url: PHOTO_URL, alt: 'Pocket detail' },
    ]);
    expect(document.mode).toBe('simple');
  });

  it('keeps the simple box free of an upload button and prompt chips', () => {
    // Both were removed on purpose. A toolbar here could only produce a worse
    // version of what the designed layout does properly, and a row of
    // suggestions around an empty box is furniture rather than help.
    renderEditor({ ...databaseBackedFixture(), descriptionBlocks: [] });

    expect(
      screen.queryByRole('button', { name: /Add images/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Recommended input/i)).not.toBeInTheDocument();
  });
});
