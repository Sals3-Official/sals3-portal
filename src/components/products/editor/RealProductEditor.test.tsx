import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));

vi.mock('@/app/(portal)/listings/product-draft-actions', () => ({
  saveProductDraftAction: saveMock,
}));
vi.mock('sonner', () => ({ toast: toastMock }));

/* eslint-disable import/first */
import RealProductEditor from './RealProductEditor';
/* eslint-enable import/first */

const STRUCTURED_DOC = {
  version: 1 as const,
  blocks: [{ type: 'heading' as const, level: 2 as const, text: 'Specs' }],
};

type EditorProps = Parameters<typeof RealProductEditor>[0];

function renderEditor(overrides: Partial<EditorProps> = {}) {
  const props: EditorProps = {
    productId: 'product-1',
    revisionId: 'revision-1',
    revisionVersion: 3,
    initialTitle: 'Blue mug',
    initialDescriptionText: 'A mug.',
    descriptionEditable: true,
    storedDocument: { version: 1, blocks: [] },
    ...overrides,
  };

  return render(
    <RealProductEditor
      productId={props.productId}
      revisionId={props.revisionId}
      revisionVersion={props.revisionVersion}
      initialTitle={props.initialTitle}
      initialDescriptionText={props.initialDescriptionText}
      descriptionEditable={props.descriptionEditable}
      storedDocument={props.storedDocument}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RealProductEditor', () => {
  it('saves with the rendered revision version and bumps it on success', async () => {
    saveMock.mockResolvedValue({ ok: true, revisionVersion: 4 });
    renderEditor();

    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Blue mug deluxe' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({
          productId: 'product-1',
          revisionId: 'revision-1',
          expectedRevisionVersion: 3,
          title: 'Blue mug deluxe',
        }),
      ),
    );
    // The next save must carry the NEW version, or every second save conflicts.
    saveMock.mockResolvedValue({ ok: true, revisionVersion: 5 });
    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Blue mug deluxe v2' },
    });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save Draft' })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));
    await waitFor(() =>
      expect(saveMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ expectedRevisionVersion: 4 }),
      ),
    );
  });

  it('tells the seller to reload on a version conflict', async () => {
    saveMock.mockResolvedValue({ ok: false, reason: 'version_conflict' });
    renderEditor();

    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Changed' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith(
        'This draft changed in another tab - reload to continue.',
      ),
    );
  });

  /**
   * The verbatim rule: a structured document is never flattened. The textarea
   * is absent, and a title-only save sends the ORIGINAL document unchanged.
   */
  it('sends the stored document verbatim when the description is not editable', async () => {
    saveMock.mockResolvedValue({ ok: true, revisionVersion: 4 });
    renderEditor({
      descriptionEditable: false,
      storedDocument: STRUCTURED_DOC,
      initialDescriptionText: '',
    });

    expect(screen.queryByLabelText('Description')).toBeNull();
    expect(
      screen.getByText(/structured blocks this editor cannot edit/),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Product name'), {
      target: { value: 'Title only change' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Draft' }));

    await waitFor(() =>
      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ descriptionDocument: STRUCTURED_DOC }),
      ),
    );
  });

  it('disables Save until something changes', () => {
    renderEditor();

    expect(screen.getByRole('button', { name: 'Save Draft' })).toBeDisabled();
  });
});
