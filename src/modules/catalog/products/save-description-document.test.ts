import { beforeEach, describe, expect, it, vi } from 'vitest';

// `description-image-storage.ts`, reached through this path's own allow-list
// check, is `server-only`.
vi.mock('server-only', () => ({}));

vi.mock('@/lib/db/client', () => ({
  default: () => ({ marker: 'db' }),
  isDatabaseConfigured: () => true,
}));

vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: vi.fn(),
}));

vi.mock('./repository', () => ({
  findProductForSteward: vi.fn(),
  saveDraftRevisionContent: vi.fn(),
}));

// The fork rule is `open-draft-for-edit.test.ts`. These tests are about what
// the description save does with its answer.
vi.mock('./open-draft-for-edit', () => ({ default: vi.fn() }));

/* eslint-disable import/first */
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';

import saveDescriptionDocument from './save-description-document';
import openDraftForEdit from './open-draft-for-edit';
import { findProductForSteward, saveDraftRevisionContent } from './repository';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SETTLED_ID = '22222222-2222-4222-8222-222222222222';
const FORKED_ID = '33333333-3333-4333-8333-333333333333';

const DATABASE = {
  transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
    fn({ marker: 'tx' }),
  ),
} as never;

function run() {
  return saveDescriptionDocument({
    productId: PRODUCT_ID,
    revisionId: SETTLED_ID,
    expectedRevisionVersion: 3,
    descriptionDocument: {
      version: 1,
      blocks: [{ type: 'paragraph', text: 'Newly written copy.' }],
    },
    sellerAccountId: 'seller-a',
    actorId: 'actor-1',
    database: DATABASE,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(appendAuditEvent).mockResolvedValue(undefined);
  asMock(findProductForSteward).mockResolvedValue({
    id: PRODUCT_ID,
    stewardSellerAccountId: 'seller-a',
  });
  asMock(openDraftForEdit).mockResolvedValue({
    ok: true,
    revisionId: SETTLED_ID,
    expectedVersion: 3,
    forked: false,
  });
  asMock(saveDraftRevisionContent).mockResolvedValue({
    id: SETTLED_ID,
    version: 4,
  });
});

describe('saveDescriptionDocument', () => {
  it('saves onto the open draft and returns the advanced version', async () => {
    await expect(run()).resolves.toEqual({
      ok: true,
      revisionId: SETTLED_ID,
      revisionVersion: 4,
      contentChecksum: expect.any(String),
      forked: false,
    });
  });

  it('writes to the forked draft when the product is already published', async () => {
    // The reported defect: `Save description` on a Live product wrote to the
    // APPROVED revision, matched zero rows, and answered `version_conflict`.
    asMock(openDraftForEdit).mockResolvedValue({
      ok: true,
      revisionId: FORKED_ID,
      expectedVersion: 1,
      forked: true,
    });
    asMock(saveDraftRevisionContent).mockResolvedValue({
      id: FORKED_ID,
      version: 2,
    });

    await expect(run()).resolves.toEqual({
      ok: true,
      revisionId: FORKED_ID,
      revisionVersion: 2,
      contentChecksum: expect.any(String),
      forked: true,
    });

    const [, args] = asMock(saveDraftRevisionContent).mock.calls[0];

    expect(args.revisionId).toBe(FORKED_ID);
    expect(args.expectedVersion).toBe(1);
  });

  it('names the revision the editor came from when the save forked', async () => {
    asMock(openDraftForEdit).mockResolvedValue({
      ok: true,
      revisionId: FORKED_ID,
      expectedVersion: 1,
      forked: true,
    });
    asMock(saveDraftRevisionContent).mockResolvedValue({
      id: FORKED_ID,
      version: 2,
    });

    await run();

    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'catalog_product_revision.saved',
        payload: expect.objectContaining({
          scope: 'DESCRIPTION_ONLY',
          forkedFromRevisionId: SETTLED_ID,
        }),
      }),
    );
  });

  it('refuses a product this account does not steward, writing nothing', async () => {
    asMock(findProductForSteward).mockResolvedValue(null);

    await expect(run()).resolves.toEqual({ ok: false, reason: 'not_found' });
    expect(openDraftForEdit).not.toHaveBeenCalled();
    expect(saveDraftRevisionContent).not.toHaveBeenCalled();
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });

  it('passes a refused fork straight through, and audits why', async () => {
    asMock(openDraftForEdit).mockResolvedValue({
      ok: false,
      reason: 'revision_in_review',
    });

    await expect(run()).resolves.toEqual({
      ok: false,
      reason: 'revision_in_review',
    });
    expect(saveDraftRevisionContent).not.toHaveBeenCalled();
    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'catalog_product_revision.save_rejected_stale',
        payload: expect.objectContaining({
          scope: 'DESCRIPTION_ONLY',
          outcome: 'REVISION_UNDER_REVIEW',
        }),
      }),
    );
  });

  it('still reports a stale write against the draft it resolved', async () => {
    asMock(saveDraftRevisionContent).mockResolvedValue(null);

    await expect(run()).resolves.toEqual({
      ok: false,
      reason: 'version_conflict',
    });
    expect(appendAuditEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        payload: expect.objectContaining({ outcome: 'STALE_OR_NOT_EDITABLE' }),
      }),
    );
  });

  it('refuses an image that is not stored in Sals3 before opening a draft', async () => {
    await expect(
      saveDescriptionDocument({
        productId: PRODUCT_ID,
        revisionId: SETTLED_ID,
        expectedRevisionVersion: 3,
        descriptionDocument: {
          version: 1,
          blocks: [
            {
              type: 'image',
              url: 'https://cdn.example.com/not-ours.jpg',
              alt: 'Borrowed',
            },
          ],
        },
        sellerAccountId: 'seller-a',
        actorId: 'actor-1',
        database: DATABASE,
      }),
    ).resolves.toEqual({ ok: false, reason: 'image_not_stored' });

    // No fork for a document that was never going to be stored: the draft row
    // would outlive the failed save and block the next one.
    expect(openDraftForEdit).not.toHaveBeenCalled();
  });
});
