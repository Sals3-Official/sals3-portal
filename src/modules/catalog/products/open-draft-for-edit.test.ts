import { beforeEach, describe, expect, it, vi } from 'vitest';

// Reached through `description-document.ts`, which is `server-only`.
vi.mock('server-only', () => ({}));

vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: vi.fn(),
}));

vi.mock('./repository', () => ({
  findRevisionOfProduct: vi.fn(),
  findOpenDraftRevision: vi.fn(),
  findHighestRevisionNumber: vi.fn(),
  insertDraftRevision: vi.fn(),
  setCurrentRevision: vi.fn(),
}));

/* eslint-disable import/first */
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';

import openDraftForEdit from './open-draft-for-edit';
import { checksumOfDescriptionDocument } from './description-document';
import {
  findHighestRevisionNumber,
  findOpenDraftRevision,
  findRevisionOfProduct,
  insertDraftRevision,
  setCurrentRevision,
} from './repository';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
const SETTLED_ID = '22222222-2222-4222-8222-222222222222';
const FORKED_ID = '33333333-3333-4333-8333-333333333333';

const PUBLISHED_DOCUMENT = {
  version: 1 as const,
  blocks: [{ type: 'paragraph' as const, text: 'The copy buyers can see.' }],
};

/** What was in `content_document` before the freeze copied it across. */
const OLDER_DOCUMENT = {
  version: 1 as const,
  blocks: [{ type: 'paragraph' as const, text: 'Not what was published.' }],
};

const EXECUTOR = { marker: 'tx' } as never;

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    version: 7,
    currentRevisionId: SETTLED_ID,
    ...overrides,
  } as never;
}

function settledRevision(overrides: Record<string, unknown> = {}) {
  return {
    id: SETTLED_ID,
    productId: PRODUCT_ID,
    revisionNumber: 2,
    workflowState: 'APPROVED',
    version: 3,
    contentDocument: OLDER_DOCUMENT,
    contentSnapshot: PUBLISHED_DOCUMENT,
    contentChecksum: 'checksum-of-the-source-row',
    ...overrides,
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return openDraftForEdit(EXECUTOR, {
    product: product(),
    revisionId: SETTLED_ID,
    expectedRevisionVersion: 3,
    actorId: 'actor-1',
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(appendAuditEvent).mockResolvedValue(undefined);
  asMock(findRevisionOfProduct).mockResolvedValue(settledRevision());
  asMock(findOpenDraftRevision).mockResolvedValue(null);
  asMock(findHighestRevisionNumber).mockResolvedValue(2);
  asMock(insertDraftRevision).mockResolvedValue({
    id: FORKED_ID,
    revisionNumber: 3,
    version: 1,
  });
  asMock(setCurrentRevision).mockResolvedValue(undefined);
});

describe('openDraftForEdit', () => {
  it('returns an existing draft untouched, forking nothing', async () => {
    asMock(findRevisionOfProduct).mockResolvedValue(
      settledRevision({ workflowState: 'DRAFT', contentSnapshot: null }),
    );

    // The version travels back exactly as it came in: this helper does not
    // adjudicate a draft save's concurrency, `saveDraftRevisionContent` does.
    // A mismatch here becoming a reason to fork would be the loosening the
    // whole design refuses.
    await expect(run({ expectedRevisionVersion: 99 })).resolves.toEqual({
      ok: true,
      revisionId: SETTLED_ID,
      expectedVersion: 99,
      forked: false,
    });
    expect(insertDraftRevision).not.toHaveBeenCalled();
  });

  it('forks a draft from the published snapshot, not the working document', async () => {
    await expect(run()).resolves.toEqual({
      ok: true,
      revisionId: FORKED_ID,
      expectedVersion: 1,
      forked: true,
    });

    const [, values] = asMock(insertDraftRevision).mock.calls[0];

    expect(values.contentDocument).toEqual(PUBLISHED_DOCUMENT);
    expect(values.revisionNumber).toBe(3);
    // The column means "which product version this revision was forked from".
    expect(values.expectedProductVersion).toBe(7);
    expect(values.contentChecksum).toBe(
      checksumOfDescriptionDocument(PUBLISHED_DOCUMENT),
    );
  });

  it('points the product at the new draft while leaving the published one alone', async () => {
    await run();

    expect(setCurrentRevision).toHaveBeenCalledWith(
      EXECUTOR,
      expect.objectContaining({
        productId: PRODUCT_ID,
        revisionId: FORKED_ID,
      }),
    );
  });

  it('audits the fork against the bytes it copied', async () => {
    await run();

    expect(appendAuditEvent).toHaveBeenCalledWith(
      EXECUTOR,
      expect.objectContaining({
        action: 'catalog_product_revision.forked',
        entityType: 'ProductRevision',
        // The new revision, source in the payload.
        entityId: FORKED_ID,
        payload: expect.objectContaining({
          forkedFromRevisionId: SETTLED_ID,
          forkedFromRevisionNumber: 2,
          forkedFromWorkflowState: 'APPROVED',
          forkedFromProductVersion: 7,
          contentChecksum: checksumOfDescriptionDocument(PUBLISHED_DOCUMENT),
          forkedFromContentChecksum: 'checksum-of-the-source-row',
        }),
      }),
    );
  });

  it('forks from a superseded revision too, where a snapshot is guaranteed', async () => {
    asMock(findRevisionOfProduct).mockResolvedValue(
      settledRevision({ workflowState: 'SUPERSEDED' }),
    );

    await expect(run()).resolves.toMatchObject({ ok: true, forked: true });
  });

  it('refuses a stale version rather than forking from it', async () => {
    await expect(run({ expectedRevisionVersion: 2 })).resolves.toEqual({
      ok: false,
      reason: 'version_conflict',
    });
    expect(insertDraftRevision).not.toHaveBeenCalled();
  });

  it('refuses a settled revision the product has moved on from', async () => {
    // A tab that loaded before someone else published still holds a matching
    // version. Forking from it would resurrect older copy over newer published
    // copy at the next publish.
    await expect(
      run({ product: product({ currentRevisionId: 'rev-newer' }) }),
    ).resolves.toEqual({ ok: false, reason: 'version_conflict' });
    expect(insertDraftRevision).not.toHaveBeenCalled();
  });

  it('refuses a revision belonging to another product', async () => {
    asMock(findRevisionOfProduct).mockResolvedValue(null);

    await expect(run()).resolves.toEqual({
      ok: false,
      reason: 'version_conflict',
    });
    expect(insertDraftRevision).not.toHaveBeenCalled();
  });

  it.each(['IN_REVIEW', 'CHANGES_REQUESTED'])(
    'refuses to fork around a %s revision',
    async (workflowState) => {
      // Unreachable today — nothing writes either state — and held here for
      // the day a review workflow exists. Forking from the last APPROVED
      // revision instead would let a publish step straight past the revision
      // under review: `publish.ts` selects only from ['DRAFT', 'APPROVED'],
      // and the open-draft index covers DRAFT only, so nothing downstream
      // would catch it.
      asMock(findRevisionOfProduct).mockResolvedValue(
        settledRevision({ workflowState }),
      );

      await expect(run()).resolves.toEqual({
        ok: false,
        reason: 'revision_in_review',
      });
      expect(insertDraftRevision).not.toHaveBeenCalled();
    },
  );

  it('refuses rather than riding along on a draft another tab already forked', async () => {
    asMock(findOpenDraftRevision).mockResolvedValue({ id: 'rev-other' });

    await expect(run()).resolves.toEqual({
      ok: false,
      reason: 'version_conflict',
    });
    expect(insertDraftRevision).not.toHaveBeenCalled();
  });

  it('refuses cleanly when the open-draft index rejects the insert', async () => {
    // The race the pre-check cannot close: the winner's draft appears between
    // the read and the insert. The loser must be told, not redirected.
    asMock(insertDraftRevision).mockResolvedValue(null);

    await expect(run()).resolves.toEqual({
      ok: false,
      reason: 'version_conflict',
    });
    expect(setCurrentRevision).not.toHaveBeenCalled();
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });

  it('raises on a settled revision with no snapshot instead of forking a blank one', async () => {
    // `product_revisions_frozen_when_settled` makes this unrepresentable, so
    // reaching it means the database has been damaged. Seeding an empty
    // document would hand the seller a blank description to publish over their
    // live copy.
    asMock(findRevisionOfProduct).mockResolvedValue(
      settledRevision({ contentSnapshot: null }),
    );

    await expect(run()).rejects.toThrow();
    expect(insertDraftRevision).not.toHaveBeenCalled();
  });
});
