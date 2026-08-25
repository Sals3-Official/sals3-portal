import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/app/(portal)/listings/description-actions', () => ({
  default: vi.fn(),
}));

vi.mock('@/app/(portal)/listings/description-image-actions', () => ({
  default: vi.fn(),
}));

/* eslint-disable import/first */
import saveDescriptionAction from '@/app/(portal)/listings/description-actions';

import DescriptionStudioClient from './DescriptionStudioClient';
/* eslint-enable import/first */

/**
 * The full-viewport canvas is a second screen that holds a revision, so it
 * needs the same repair the listing editor needed: adopt the revision the
 * server actually wrote to.
 *
 * `DescriptionStudio.test.tsx` covers block authoring against plain callbacks.
 * This file is only about the binding — which revision the save names, and
 * what the seller is told about it.
 */

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SETTLED_ID = '22222222-2222-4222-8222-222222222222';
const FORKED_ID = '33333333-3333-4333-8333-333333333333';

const PUBLISHED = { id: SETTLED_ID, isCurrent: true };

function renderClient(
  publishedRevision: { id: string; isCurrent: boolean } | null,
) {
  render(
    <DescriptionStudioClient
      productName="Twisted knitted top coat"
      productId={PRODUCT_ID}
      revisionId={SETTLED_ID}
      expectedRevisionVersion={3}
      backHref={`/listings/new?productId=${PRODUCT_ID}`}
      initialBlocks={[{ type: 'paragraph', text: 'The published copy.' }]}
      publishedRevision={publishedRevision}
    />,
  );
}

async function save(expectedCalls: number) {
  fireEvent.click(screen.getByRole('button', { name: /Save description/i }));

  await waitFor(() =>
    expect(saveDescriptionAction).toHaveBeenCalledTimes(expectedCalls),
  );

  const [input] = vi.mocked(saveDescriptionAction).mock.calls.at(-1) ?? [];

  return input as { revisionId: string; expectedRevisionVersion: number };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DescriptionStudioClient', () => {
  it('saves against the forked draft on every save after the first', async () => {
    vi.mocked(saveDescriptionAction)
      .mockResolvedValueOnce({
        ok: true,
        revisionId: FORKED_ID,
        revisionVersion: 1,
        forked: true,
        contentChecksum: 'abc',
      })
      .mockResolvedValue({
        ok: true,
        revisionId: FORKED_ID,
        revisionVersion: 2,
        forked: false,
        contentChecksum: 'def',
      });

    renderClient(PUBLISHED);

    const first = await save(1);

    expect(first).toMatchObject({
      revisionId: SETTLED_ID,
      expectedRevisionVersion: 3,
    });

    const second = await save(2);

    // Both halves move: the version, as it always did, and now the id. Keeping
    // the id from props would name the settled revision again and be refused.
    expect(second).toMatchObject({
      revisionId: FORKED_ID,
      expectedRevisionVersion: 1,
    });
  });

  it('tells a live listing that the storefront has not changed', async () => {
    vi.mocked(saveDescriptionAction).mockResolvedValue({
      ok: true,
      revisionId: FORKED_ID,
      revisionVersion: 1,
      forked: true,
      contentChecksum: 'abc',
    });

    renderClient(PUBLISHED);
    await save(1);

    expect(
      await screen.findByText(/still shows the published version/i),
    ).toBeInTheDocument();
  });

  it('claims nothing about publication for a product that has none', async () => {
    vi.mocked(saveDescriptionAction).mockResolvedValue({
      ok: true,
      revisionId: SETTLED_ID,
      revisionVersion: 4,
      forked: false,
      contentChecksum: 'abc',
    });

    renderClient(null);
    await save(1);

    expect(await screen.findByText('Description saved.')).toBeInTheDocument();
  });
});
