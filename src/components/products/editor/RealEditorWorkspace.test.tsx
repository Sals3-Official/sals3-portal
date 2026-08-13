import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const saveMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));

vi.mock('@/app/(portal)/listings/product-draft-actions', () => ({
  saveProductDraftAction: saveMock,
}));
vi.mock('sonner', () => ({ toast: toastMock }));

/* eslint-disable import/first */
import toReadinessIssues, {
  deriveMissingRequirements,
} from '@/lib/seller-center/product-editor/draft-readiness';
import RealEditorWorkspace from './RealEditorWorkspace';
/* eslint-enable import/first */

/**
 * The save assertions moved here from `RealProductEditor.test.tsx` when the lean
 * editor became the seven-section one: the write surface is unchanged, so the
 * contract it protects - version in, new version out, structured documents
 * never flattened - has to keep being protected.
 */

const STRUCTURED_DOC = {
  version: 1 as const,
  blocks: [{ type: 'heading' as const, level: 2 as const, text: 'Specs' }],
};

const ISSUES = toReadinessIssues(
  deriveMissingRequirements({
    categoryMappingConfidence: 'UNMAPPED',
    variantCount: 0,
    descriptionDocument: { version: 1, blocks: [] },
  }),
);

type WorkspaceProps = Parameters<typeof RealEditorWorkspace>[0];

function renderWorkspace(overrides: Partial<WorkspaceProps> = {}) {
  const props: WorkspaceProps = {
    productId: 'product-1',
    revisionId: 'revision-1',
    revisionVersion: 3,
    initialTitle: 'Blue mug',
    initialDescriptionText: 'A mug.',
    descriptionEditable: true,
    storedDocument: { version: 1, blocks: [] },
    issues: ISSUES,
    basicFacts: <p>Category facts</p>,
    specsSection: <p>Specifications section</p>,
    variantsSection: <p>Variants section</p>,
    marketsSection: <p>Markets section</p>,
    mediaSection: <p>Media section</p>,
    ...overrides,
  };

  return render(
    <RealEditorWorkspace
      productId={props.productId}
      revisionId={props.revisionId}
      revisionVersion={props.revisionVersion}
      initialTitle={props.initialTitle}
      initialDescriptionText={props.initialDescriptionText}
      descriptionEditable={props.descriptionEditable}
      storedDocument={props.storedDocument}
      issues={props.issues}
      basicFacts={props.basicFacts}
      specsSection={props.specsSection}
      variantsSection={props.variantsSection}
      marketsSection={props.marketsSection}
      mediaSection={props.mediaSection}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RealEditorWorkspace saving', () => {
  it('saves with the rendered revision version and bumps it on success', async () => {
    saveMock.mockResolvedValue({ ok: true, revisionVersion: 4 });
    renderWorkspace();

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
    renderWorkspace();

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
    renderWorkspace({
      descriptionEditable: false,
      storedDocument: STRUCTURED_DOC,
      initialDescriptionText: '',
    });

    // The section itself is labelled "Description"; the TEXTAREA must be gone.
    expect(screen.queryByRole('textbox', { name: 'Description' })).toBeNull();
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
    renderWorkspace();

    expect(screen.getByRole('button', { name: 'Save Draft' })).toBeDisabled();
  });
});

describe('RealEditorWorkspace layout', () => {
  it('renders all seven sections, with the five server slots in place', () => {
    renderWorkspace();

    expect(screen.getByLabelText('Product name')).toBeInTheDocument();
    ['Specifications', 'Variants', 'Markets', 'Media'].forEach((slot) => {
      expect(screen.getByText(`${slot} section`)).toBeInTheDocument();
    });
    expect(screen.getByText('Category facts')).toBeInTheDocument();
    expect(screen.getByText('Before this can publish')).toBeInTheDocument();
  });

  /**
   * There must be no Publish control at all - not even disabled. A greyed
   * button implies the flow exists elsewhere; it does not exist anywhere.
   */
  it('offers no Publish control', () => {
    renderWorkspace();

    // "Review & Publish" is the section-nav label, not an action - anything
    // that would actually publish is what must not exist.
    ['Publish', 'Publish listing', 'Publish draft'].forEach((name) => {
      expect(screen.queryByRole('button', { name })).toBeNull();
    });
  });

  it('shows the derived requirements as real readiness issues', () => {
    renderWorkspace();

    expect(screen.getByText('Description is empty')).toBeInTheDocument();
    expect(screen.getByText('No Sals3 category mapped')).toBeInTheDocument();
    expect(
      screen.getByText('No media provenance recorded'),
    ).toBeInTheDocument();
  });

  /** No stored validation timestamp exists, so none may be printed. */
  it('says the check ran on load rather than dating it', () => {
    renderWorkspace();

    expect(screen.getByText(/Checked as this page loaded/)).toBeInTheDocument();
  });
});
