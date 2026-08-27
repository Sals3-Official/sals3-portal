import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AssignableMediaFixture } from '@/lib/seller-center/product-catalogue/types';
import VariantImagePicker from './VariantImagePicker';

/**
 * The picker gained an upload control on 2026-08-28, when gallery photos and
 * variation photos stopped sharing one budget. Its own doc comment used to
 * argue against carrying one; these tests pin the behaviour that made that
 * reasoning obsolete — uploading here attaches to the variation directly, so it
 * is a different write, not the Product media control in a second place.
 */

const STORED: AssignableMediaFixture[] = [
  {
    mediaId: 'media-1',
    url: 'https://media.example-r2.dev/seller-media/p/one.webp',
    sourceType: 'SELLER_UPLOAD',
    variantId: null,
  },
];

function renderPicker(
  overrides: Partial<React.ComponentProps<typeof VariantImagePicker>> = {},
) {
  const props: React.ComponentProps<typeof VariantImagePicker> = {
    open: true,
    onOpenChange: vi.fn(),
    variantLabel: 'National Flag 013',
    variantId: 'variant-13',
    media: STORED,
    currentMediaId: null,
    onAssign: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };

  render(
    <VariantImagePicker
      open={props.open}
      onOpenChange={props.onOpenChange}
      variantLabel={props.variantLabel}
      variantId={props.variantId}
      media={props.media}
      currentMediaId={props.currentMediaId}
      onAssign={props.onAssign}
      onUpload={props.onUpload}
    />,
  );

  // The dialog renders in a portal, so the input is looked up from the
  // document rather than the render container.
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');

  return { ...props, input };
}

function pick(input: HTMLInputElement | null): File {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'flag-013.jpg', {
    type: 'image/jpeg',
  });

  fireEvent.change(input as HTMLInputElement, { target: { files: [file] } });

  return file;
}

describe('VariantImagePicker upload', () => {
  it('offers no upload control when the caller cannot upload', () => {
    const { input } = renderPicker({ onUpload: undefined });

    expect(
      screen.queryByRole('button', { name: /upload a photo/iu }),
    ).toBeNull();
    expect(input).toBeNull();
  });

  it('says that a variation photo does not spend a Product media slot', () => {
    renderPicker({ onUpload: vi.fn(async () => ({ ok: true })) });

    expect(
      screen.getByText(/does not use a Product media slot/u),
    ).toBeInTheDocument();
    expect(screen.getByText(/one photo per variation/u)).toBeInTheDocument();
  });

  it('hands the chosen file straight to the caller', async () => {
    // Typed parameter, not inferred: `vi.fn(async () => …)` infers a
    // zero-argument mock, and reading `mock.calls[0][0]` off that is a tuple
    // index error rather than a runtime one.
    const onUpload = vi.fn(async (file: File) => ({ ok: file.size > 0 }));
    const { input, onOpenChange } = renderPicker({ onUpload });

    const file = pick(input);

    await waitFor(() => expect(onUpload).toHaveBeenCalledTimes(1));
    expect(onUpload).toHaveBeenCalledWith(file);
    // A successful upload closes the dialog, the same as a successful pick.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('shows the server’s own refusal and keeps the dialog open', async () => {
    const onUpload = vi.fn(async () => ({
      ok: false,
      message:
        'That variation already has a photo. Delete it first, then upload the replacement.',
    }));
    const { input, onOpenChange } = renderPicker({ onUpload });

    pick(input);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /already has a photo/u,
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('still offers picking a stored photo, which stays the shorter path', () => {
    renderPicker({ onUpload: vi.fn(async () => ({ ok: true })) });

    expect(screen.getByText('Your photo')).toBeInTheDocument();
  });
});
