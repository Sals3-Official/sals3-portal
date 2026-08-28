import { beforeEach, describe, expect, it, vi } from 'vitest';

// Reached through `contracts.ts` -> `description-document.ts`, which is
// `server-only`.
vi.mock('server-only', () => ({}));

vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: vi.fn(),
}));

vi.mock('./repository', () => ({
  findRevisionOfProduct: vi.fn(),
  freezeDraftRevisionAsSuperseded: vi.fn(),
  setCurrentRevision: vi.fn(),
}));

/* eslint-disable import/first */
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';

import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import discardDraftRevision from './discard-draft-revision';
import {
  findRevisionOfProduct,
  freezeDraftRevisionAsSuperseded,
  setCurrentRevision,
} from './repository';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const PRODUCT_ID = '11111111-1111-4111-8111-111111111111';
/** The revision the storefront is serving. */
const PUBLISHED_ID = '22222222-2222-4222-8222-222222222222';
/** The fork the seller is abandoning. */
const DRAFT_ID = '33333333-3333-4333-8333-333333333333';

const EXECUTOR = { marker: 'tx' } as never;
const NOW = new Date('2026-08-28T04:05:06.000Z');

function product(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    version: 9,
    publishedRevisionId: PUBLISHED_ID,
    currentRevisionId: DRAFT_ID,
    ...overrides,
  } as never;
}

function draftRevision(overrides: Record<string, unknown> = {}) {
  return {
    id: DRAFT_ID,
    productId: PRODUCT_ID,
    revisionNumber: 4,
    workflowState: 'DRAFT',
    version: 2,
    contentChecksum: 'checksum-of-the-abandoned-copy',
    ...overrides,
  };
}

/** The settled row the product is published from. */
function publishedRevision(overrides: Record<string, unknown> = {}) {
  return {
    id: PUBLISHED_ID,
    productId: PRODUCT_ID,
    revisionNumber: 3,
    workflowState: 'APPROVED',
    version: 7,
    contentChecksum: 'checksum-of-the-live-copy',
    ...overrides,
  };
}

/**
 * Keyed by revision id, because the module reads two different rows: the draft
 * it is retiring and the published row whose version the editor needs back.
 */
function revisionLookup(published: unknown = publishedRevision()) {
  return async (_executor: unknown, args: { revisionId: string }) =>
    args.revisionId === PUBLISHED_ID ? published : draftRevision();
}

function run(overrides: Record<string, unknown> = {}) {
  return discardDraftRevision(EXECUTOR, {
    product: product(),
    revisionId: DRAFT_ID,
    expectedRevisionVersion: 2,
    actorId: 'actor-1',
    now: NOW,
    ...overrides,
  });
}

/** Nothing may be written on a refusal — that is what makes it a refusal. */
function expectNoWrites() {
  expect(freezeDraftRevisionAsSuperseded).not.toHaveBeenCalled();
  expect(setCurrentRevision).not.toHaveBeenCalled();
  expect(appendAuditEvent).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  asMock(appendAuditEvent).mockResolvedValue(undefined);
  asMock(findRevisionOfProduct).mockImplementation(revisionLookup());
  asMock(freezeDraftRevisionAsSuperseded).mockResolvedValue(
    draftRevision({ workflowState: 'SUPERSEDED', version: 3 }),
  );
  asMock(setCurrentRevision).mockResolvedValue(undefined);
});

describe('discardDraftRevision', () => {
  it('freezes the abandoned draft and puts the product back on the published revision', async () => {
    const outcome = await run();

    expect(outcome).toEqual({
      ok: true,
      restoredRevisionId: PUBLISHED_ID,
      // Handed back so the editor can retarget its saves without a remount —
      // without this the next save names the revision just retired.
      restoredRevisionVersion: 7,
      discardedRevisionId: DRAFT_ID,
    });

    expect(freezeDraftRevisionAsSuperseded).toHaveBeenCalledWith(EXECUTOR, {
      revisionId: DRAFT_ID,
      productId: PRODUCT_ID,
      // Pinned: the compare-and-set token must be the version the editor
      // rendered, not the row's own value re-read here — re-reading it would
      // make a stale tab win.
      expectedVersion: 2,
      actorId: 'actor-1',
      now: NOW,
    });

    expect(setCurrentRevision).toHaveBeenCalledWith(EXECUTOR, {
      productId: PRODUCT_ID,
      revisionId: PUBLISHED_ID,
      actorId: 'actor-1',
    });
  });

  it('audits the discard with the checksum of what was thrown away', async () => {
    await run();

    expect(appendAuditEvent).toHaveBeenCalledWith(
      EXECUTOR,
      expect.objectContaining({
        action: PRODUCT_AUDIT_ACTIONS.revisionDiscarded,
        entityType: 'ProductRevision',
        entityId: DRAFT_ID,
        payload: expect.objectContaining({
          productId: PRODUCT_ID,
          revisionNumber: 4,
          restoredRevisionId: PUBLISHED_ID,
          discardedContentChecksum: 'checksum-of-the-abandoned-copy',
        }),
      }),
    );
  });

  it('refuses a revision that does not belong to this product', async () => {
    asMock(findRevisionOfProduct).mockResolvedValue(null);

    expect(await run()).toEqual({
      ok: false,
      reason: 'version_conflict',
    });
    expectNoWrites();
  });

  it.each(['APPROVED', 'SUPERSEDED', 'IN_REVIEW', 'CHANGES_REQUESTED'])(
    'refuses a %s revision, so a settled row can never be retired through here',
    async (workflowState) => {
      asMock(findRevisionOfProduct).mockResolvedValue(
        draftRevision({ workflowState }),
      );

      expect(await run()).toEqual({
        ok: false,
        reason: 'version_conflict',
      });
      expectNoWrites();
    },
  );

  it('refuses a stale editor, so it cannot discard an edit made in a newer tab', async () => {
    asMock(findRevisionOfProduct).mockResolvedValue(
      draftRevision({ version: 5 }),
    );

    expect(await run({ expectedRevisionVersion: 2 })).toEqual({
      ok: false,
      reason: 'version_conflict',
    });
    expectNoWrites();
  });

  it.each([null, undefined])(
    'refuses with no_published_revision when published_revision_id is %s',
    async (publishedRevisionId) => {
      // The open draft is the product's only copy. Discarding it would leave
      // the product with no revision to point at, and the seller's screen is
      // not stale — so `version_conflict` would be the wrong answer.
      expect(
        await run({
          product: product({
            publishedRevisionId,
            currentRevisionId: DRAFT_ID,
          }),
        }),
      ).toEqual({ ok: false, reason: 'no_published_revision' });
      expectNoWrites();
    },
  );

  it('refuses when the draft is somehow the published revision', async () => {
    expect(
      await run({
        product: product({
          publishedRevisionId: DRAFT_ID,
          currentRevisionId: DRAFT_ID,
        }),
      }),
    ).toEqual({ ok: false, reason: 'version_conflict' });
    expectNoWrites();
  });

  it('refuses when the draft is not the product’s current revision', async () => {
    // Another tab forked and published since this screen rendered; restoring
    // `published_revision_id` from this view would drop that newer work.
    expect(
      await run({
        product: product({ currentRevisionId: PUBLISHED_ID }),
      }),
    ).toEqual({ ok: false, reason: 'version_conflict' });
    expectNoWrites();
  });

  it('refuses rather than half-discarding when the published revision cannot be read', async () => {
    // A damaged database: `published_revision_id` points at nothing. Caught
    // before the freeze, so the draft is not retired into a product that has
    // no revision to fall back to.
    asMock(findRevisionOfProduct).mockImplementation(revisionLookup(null));

    expect(await run()).toEqual({
      ok: false,
      reason: 'version_conflict',
    });
    expectNoWrites();
  });

  it('leaves the product alone when the compare-and-set loses the race', async () => {
    asMock(freezeDraftRevisionAsSuperseded).mockResolvedValue(null);

    expect(await run()).toEqual({
      ok: false,
      reason: 'version_conflict',
    });

    // The draft was not retired, so the product must still point at it —
    // moving it would publish from a revision that is still an open draft.
    expect(setCurrentRevision).not.toHaveBeenCalled();
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });
});
