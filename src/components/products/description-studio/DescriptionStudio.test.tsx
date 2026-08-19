import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DescriptionBlock } from '@/lib/products/description-blocks';
import { descriptionDocumentSchema } from '@/modules/catalog/products/description-document';
import DescriptionStudio from './DescriptionStudio';

/**
 * Block authoring, on the screen that now owns it.
 *
 * These cases moved here from `DescriptionSection.test.tsx` when the listing
 * page's Description section became a read-only summary. The behaviour did not
 * change — where it is exercised did — so the assertions are the same ones,
 * against the same save payload, and every document a case produces is parsed
 * by the real server schema rather than merely inspected.
 */

const IMAGE_URL = 'https://media.example.com/description-media/p/a.webp';

function renderStudio(initialBlocks: DescriptionBlock[] = []) {
  const onSave = vi.fn().mockResolvedValue({ ok: true, revisionVersion: 4 });
  const uploadImage = vi.fn().mockResolvedValue({ ok: true, url: IMAGE_URL });

  render(
    <DescriptionStudio
      productName="Men Cargo Shorts 6 pockets"
      backHref="/listings/new?productId=p1"
      initialBlocks={initialBlocks}
      onSave={onSave}
      uploadImage={uploadImage}
    />,
  );

  return { onSave, uploadImage };
}

async function save(onSave: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole('button', { name: /Save description/i }));

  await waitFor(() => expect(onSave).toHaveBeenCalled());

  const [input] = onSave.mock.calls.at(-1) ?? [];

  // Parsed by the server's own schema: a case that produces a document the
  // boundary would refuse must fail here, not pass on a shape-only assertion.
  return descriptionDocumentSchema.parse(
    (input as { descriptionDocument: unknown }).descriptionDocument,
  );
}

describe('Description studio - block authoring', () => {
  it('saves a loaded document unchanged when nothing was edited', async () => {
    const loaded: DescriptionBlock[] = [
      { type: 'paragraph', text: 'A packable 20L daypack.' },
      { type: 'heading', level: 3, text: 'Key features' },
      { type: 'bulletList', items: ['Recycled shell'] },
      { type: 'keyValueList', entries: [{ label: 'Fit', value: 'Regular' }] },
    ];
    const { onSave } = renderStudio(loaded);

    expect((await save(onSave)).blocks).toEqual(loaded);
  });

  it('adds a heading the seller typed as a heading block, not a paragraph', async () => {
    const { onSave } = renderStudio();

    fireEvent.click(screen.getByRole('button', { name: 'Heading' }));
    fireEvent.change(screen.getByLabelText('Heading'), {
      target: { value: 'Fit and sizing' },
    });

    expect((await save(onSave)).blocks).toEqual([
      { type: 'heading', level: 3, text: 'Fit and sizing' },
    ]);
  });

  it('reorders blocks into the order the page will render', async () => {
    const { onSave } = renderStudio([
      { type: 'paragraph', text: 'First.' },
      { type: 'paragraph', text: 'Second.' },
    ]);

    // Handles appear on the selected block only, so the second one is selected
    // before it is moved.
    fireEvent.click(screen.getByText('Second.'));
    fireEvent.click(screen.getByRole('button', { name: /Move paragraph up/ }));

    expect((await save(onSave)).blocks).toEqual([
      { type: 'paragraph', text: 'Second.' },
      { type: 'paragraph', text: 'First.' },
    ]);
  });

  it('warns about markup in the block rather than failing the save later', () => {
    renderStudio([{ type: 'paragraph', text: 'Placeholder.' }]);

    fireEvent.click(screen.getByText('Placeholder.'));
    fireEvent.change(screen.getByLabelText('Paragraph'), {
      target: { value: 'Wear <b>this</b>.' },
    });

    expect(screen.getByText(/Markup is not allowed/)).toBeInTheDocument();
  });

  it('never tells the seller supplier HTML is sanitised', () => {
    // There is no sanitiser. The copy that claimed one shipped for months
    // beside a field sellers were being asked to trust.
    renderStudio();

    expect(screen.queryByText(/are sanitised before/)).not.toBeInTheDocument();
    expect(
      screen.getByText(/never copied into a Sals3 listing/),
    ).toBeInTheDocument();
  });

  it('adds two consecutive image blocks for the side-by-side preset', async () => {
    const { onSave } = renderStudio();

    fireEvent.click(screen.getByRole('button', { name: /Two images/ }));

    // The layout is adjacency, not a stored group: two plain image blocks, which
    // is what makes a delete unable to leave a half-empty container behind.
    expect(screen.getAllByRole('figure')).toHaveLength(2);
    expect(
      screen.getByText(/Images run wider than the text measure/),
    ).toBeInTheDocument();

    // Neither is publishable yet, so an empty pair saves as nothing at all
    // rather than as two blocks the schema would refuse.
    expect((await save(onSave)).blocks).toEqual([]);
  });

  it('uploads a file and saves the returned address in the block', async () => {
    const { onSave, uploadImage } = renderStudio();

    fireEvent.click(screen.getByRole('button', { name: /^Image/ }));
    fireEvent.change(screen.getByTestId('description-image-file'), {
      target: {
        files: [new File(['bytes'], 'chart.png', { type: 'image/png' })],
      },
    });

    await waitFor(() => expect(uploadImage).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Alt text'), {
      target: { value: 'Size chart' },
    });

    expect((await save(onSave)).blocks).toEqual([
      { type: 'image', url: IMAGE_URL, alt: 'Size chart' },
    ]);
  });

  it('asks for alt text before the image is publishable', () => {
    renderStudio([{ type: 'image', url: IMAGE_URL, alt: '' }]);

    fireEvent.click(screen.getByRole('figure'));

    expect(screen.getByText(/Alt text is required/)).toBeInTheDocument();
  });
});

describe('Description studio - paragraph emphasis', () => {
  function selectWords(from: number, to: number) {
    const field = screen.getByLabelText('Paragraph') as HTMLTextAreaElement;

    field.setSelectionRange(from, to);
    fireEvent.select(field);

    return field;
  }

  it('stores emphasis as marks over the same text, never as tags', async () => {
    const { onSave } = renderStudio([
      { type: 'paragraph', text: 'Soft cotton twill' },
    ]);

    fireEvent.click(screen.getByText('Soft cotton twill'));
    selectWords(5, 11);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));

    const [block] = (await save(onSave)).blocks;

    expect(block).toEqual({
      type: 'paragraph',
      text: 'Soft cotton twill',
      runs: [
        { text: 'Soft ' },
        { text: 'cotton', marks: ['strong'] },
        { text: ' twill' },
      ],
    });
  });

  it('leaves `runs` off a paragraph nobody emphasised', async () => {
    const { onSave } = renderStudio([
      { type: 'paragraph', text: 'Soft cotton twill' },
    ]);

    const [block] = (await save(onSave)).blocks;

    expect(block).toEqual({ type: 'paragraph', text: 'Soft cotton twill' });
  });

  it('disables the mark buttons for a caret, which has no range to emphasise', () => {
    renderStudio([{ type: 'paragraph', text: 'Soft cotton twill' }]);

    fireEvent.click(screen.getByText('Soft cotton twill'));

    expect(screen.getByRole('button', { name: 'Bold' })).toBeDisabled();
  });

  it('reports a half-emphasised selection as mixed, not as unemphasised', () => {
    renderStudio([{ type: 'paragraph', text: 'Soft cotton twill' }]);

    fireEvent.click(screen.getByText('Soft cotton twill'));
    selectWords(0, 4);
    fireEvent.click(screen.getByRole('button', { name: 'Bold' }));
    selectWords(0, 11);

    expect(screen.getByRole('button', { name: 'Bold' })).toHaveAttribute(
      'aria-pressed',
      'mixed',
    );
  });
});
