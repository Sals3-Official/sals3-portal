import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  proposeCategoryMapping,
  reviewCategoryMappingDecision,
} from './governance';

const mocks = vi.hoisted(() => ({
  findActiveMapping: vi.fn(),
  findCategoryByCode: vi.fn(),
  findHighestMappingVersion: vi.fn(),
  findMappingById: vi.fn(),
  findMappingByVersion: vi.fn(),
  insertMappingProposal: vi.fn(),
  insertRemapReviewSummary: vi.fn(),
  reviewMapping: vi.fn(),
  supersedeActiveMapping: vi.fn(),
  appendAuditEvent: vi.fn(),
}));

vi.mock('./repository', () => ({
  findActiveMapping: mocks.findActiveMapping,
  findCategoryByCode: mocks.findCategoryByCode,
  findHighestMappingVersion: mocks.findHighestMappingVersion,
  findMappingById: mocks.findMappingById,
  findMappingByVersion: mocks.findMappingByVersion,
  insertMappingProposal: mocks.insertMappingProposal,
  insertRemapReviewSummary: mocks.insertRemapReviewSummary,
  reviewMapping: mocks.reviewMapping,
  supersedeActiveMapping: mocks.supersedeActiveMapping,
}));

vi.mock('@/modules/catalog/candidates/repository', () => ({
  appendAuditEvent: mocks.appendAuditEvent,
}));

const TX = { tag: 'tx' };
const DB = {
  transaction: async (callback: (tx: unknown) => Promise<unknown>) =>
    callback(TX),
} as never;

const CATEGORY = { id: 'category-1', code: 'CAT-MEN-100564' };

const VALID_PROPOSAL = {
  provider: 'CJ_DROPSHIPPING' as const,
  externalCategoryId: 'cj-cat-1042',
  observedCategoryPath: 'Luggage & Bags > Backpacks',
  taxonomyVersion: 'sals3-taxonomy-v0',
  method: 'EXTERNAL_ID_RULE' as const,
  confidence: 'EXACT' as const,
  sals3CategoryCode: 'CAT-MEN-100564',
  reason: 'CJ category tree export 2026-08-12 maps this id one-to-one.',
  evidenceReference: 'review-ticket-88',
  actorId: 'actor-1',
  expectedCurrentVersion: 0,
};

function mappingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mapping-2',
    provider: 'CJ_DROPSHIPPING',
    externalCategoryId: 'cj-cat-1042',
    sals3CategoryId: 'category-1',
    taxonomyVersion: 'sals3-taxonomy-v0',
    mappingVersion: 2,
    supersedesId: 'mapping-1',
    method: 'EXTERNAL_ID_RULE',
    confidence: 'EXACT',
    reviewStatus: 'PENDING_REVIEW',
    status: 'PROPOSED',
    reason: VALID_PROPOSAL.reason,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findCategoryByCode.mockResolvedValue(CATEGORY);
  mocks.findHighestMappingVersion.mockResolvedValue(0);
  mocks.findActiveMapping.mockResolvedValue(null);
  mocks.insertMappingProposal.mockImplementation(
    async (_tx: unknown, input: Record<string, unknown>) =>
      mappingRow({ id: 'mapping-new', ...input }),
  );
  mocks.insertRemapReviewSummary.mockResolvedValue({ id: 'finding-1' });
});

describe('proposeCategoryMapping', () => {
  it('records a proposal as PROPOSED — never active — and audits it', async () => {
    const result = await proposeCategoryMapping(DB, VALID_PROPOSAL);

    expect(result.outcome).toBe('PROPOSED');
    expect(mocks.insertMappingProposal).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        mappingVersion: 1,
        sals3CategoryId: 'category-1',
        confidence: 'EXACT',
      }),
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: 'category_mapping.proposed' }),
    );
    // Activation is a separate, reviewed decision.
    expect(mocks.reviewMapping).not.toHaveBeenCalled();
    expect(mocks.supersedeActiveMapping).not.toHaveBeenCalled();
  });

  it('rejects a Sals3 category code that is not in the taxonomy instead of creating one', async () => {
    mocks.findCategoryByCode.mockResolvedValue(null);

    const result = await proposeCategoryMapping(DB, {
      ...VALID_PROPOSAL,
      sals3CategoryCode: 'CAT-INVENTED-1',
    });

    expect(result).toEqual({
      outcome: 'INVALID',
      reason: 'SALS3_CATEGORY_NOT_FOUND',
    });
    expect(mocks.insertMappingProposal).not.toHaveBeenCalled();
  });

  it('rejects a confident mapping with no category, and an uncertain one that still names a category', async () => {
    const noCategory = await proposeCategoryMapping(DB, {
      ...VALID_PROPOSAL,
      sals3CategoryCode: null,
    });
    const guessedCategory = await proposeCategoryMapping(DB, {
      ...VALID_PROPOSAL,
      confidence: 'AMBIGUOUS',
      sals3CategoryCode: 'CAT-MEN-100564',
    });

    expect(noCategory).toEqual({
      outcome: 'INVALID',
      reason: 'VALIDATION_FAILED',
    });
    expect(guessedCategory).toEqual({
      outcome: 'INVALID',
      reason: 'VALIDATION_FAILED',
    });
    expect(mocks.insertMappingProposal).not.toHaveBeenCalled();
  });

  it('rejects a stale write when the identity already moved past the version the caller read', async () => {
    mocks.findHighestMappingVersion.mockResolvedValue(4);

    const result = await proposeCategoryMapping(DB, {
      ...VALID_PROPOSAL,
      expectedCurrentVersion: 2,
    });

    expect(result).toEqual({
      outcome: 'STALE_WRITE_REJECTED',
      currentVersion: 4,
    });
    expect(mocks.insertMappingProposal).not.toHaveBeenCalled();
  });

  it('is idempotent: a replayed proposal returns the existing row rather than forking the version', async () => {
    mocks.insertMappingProposal.mockResolvedValue(null);
    mocks.findMappingByVersion.mockResolvedValue(
      mappingRow({ mappingVersion: 1 }),
    );

    const result = await proposeCategoryMapping(DB, VALID_PROPOSAL);

    expect(result.outcome).toBe('ALREADY_PROPOSED');
    expect(mocks.appendAuditEvent).not.toHaveBeenCalled();
  });

  it('accepts an explicit UNMAPPED decision with no category — absence is a real answer', async () => {
    const result = await proposeCategoryMapping(DB, {
      ...VALID_PROPOSAL,
      confidence: 'UNMAPPED',
      sals3CategoryCode: null,
      method: 'REVIEWED_PATH_RULE',
    });

    expect(result.outcome).toBe('PROPOSED');
    expect(mocks.insertMappingProposal).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        confidence: 'UNMAPPED',
        sals3CategoryId: null,
      }),
    );
  });
});

describe('reviewCategoryMappingDecision', () => {
  const APPROVE = {
    mappingId: '00000000-0000-4000-8000-000000000002',
    expectedMappingVersion: 2,
    decision: 'APPROVE_AND_ACTIVATE' as const,
    reason: 'Reviewed against the CJ category tree export.',
    reviewedBy: 'reviewer-1',
  };

  beforeEach(() => {
    mocks.findMappingById.mockResolvedValue(mappingRow());
    mocks.reviewMapping.mockImplementation(
      async (_tx: unknown, input: Record<string, unknown>) =>
        mappingRow({
          status: input.nextStatus,
          reviewStatus: input.nextReviewStatus,
        }),
    );
  });

  it('activates an approved proposal and audits the activation', async () => {
    const result = await reviewCategoryMappingDecision(DB, APPROVE);

    expect(result).toMatchObject({ outcome: 'ACTIVATED' });
    expect(mocks.reviewMapping).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        expectedStatus: 'PROPOSED',
        expectedMappingVersion: 2,
        nextStatus: 'ACTIVE',
        nextReviewStatus: 'APPROVED',
      }),
    );
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: 'category_mapping.activated' }),
    );
  });

  it('supersedes the previous active mapping and opens a remap review', async () => {
    mocks.findActiveMapping.mockResolvedValue({
      mapping: mappingRow({
        id: 'mapping-1',
        mappingVersion: 1,
        status: 'ACTIVE',
      }),
      category: CATEGORY,
    });
    mocks.supersedeActiveMapping.mockResolvedValue(
      mappingRow({ id: 'mapping-1', status: 'SUPERSEDED' }),
    );

    const result = await reviewCategoryMappingDecision(DB, APPROVE);

    expect(result).toMatchObject({
      outcome: 'ACTIVATED',
      supersededMappingId: 'mapping-1',
      remapReview: {
        recorded: true,
        findingId: 'finding-1',
        // Recorded, not listed. Never rendered as "nothing was affected".
        affectedCandidatesEnumerated: false,
      },
    });
    expect(mocks.supersedeActiveMapping).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ expectedMappingVersion: 1 }),
    );
    expect(mocks.insertRemapReviewSummary).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({
        previousMappingId: 'mapping-1',
        previousMappingVersion: 1,
        newMappingId: 'mapping-2',
      }),
    );
  });

  it('is idempotent: a replayed correction re-raises nothing', async () => {
    mocks.findActiveMapping.mockResolvedValue({
      mapping: mappingRow({
        id: 'mapping-1',
        mappingVersion: 1,
        status: 'ACTIVE',
      }),
      category: CATEGORY,
    });
    mocks.supersedeActiveMapping.mockResolvedValue(
      mappingRow({ id: 'mapping-1', status: 'SUPERSEDED' }),
    );
    mocks.insertRemapReviewSummary.mockResolvedValue(null);

    const result = await reviewCategoryMappingDecision(DB, APPROVE);

    expect(result).toMatchObject({
      outcome: 'ACTIVATED',
      remapReview: { recorded: false, findingId: null },
    });
  });

  it('never writes to a candidate, evaluation, snapshot or existing audit row during a remap', async () => {
    mocks.findActiveMapping.mockResolvedValue({
      mapping: mappingRow({
        id: 'mapping-1',
        mappingVersion: 1,
        status: 'ACTIVE',
      }),
      category: CATEGORY,
    });
    mocks.supersedeActiveMapping.mockResolvedValue(
      mappingRow({ id: 'mapping-1', status: 'SUPERSEDED' }),
    );

    await reviewCategoryMappingDecision(DB, APPROVE);

    // The only write outside the mapping table is one append into the review
    // table; no candidate, evaluation or snapshot repository is even reachable
    // from this module.
    expect(mocks.insertRemapReviewSummary).toHaveBeenCalledTimes(1);
    // Audit is append-only: one new event, no update helper exists to call.
    expect(mocks.appendAuditEvent).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale review naming a version the proposal no longer holds', async () => {
    const result = await reviewCategoryMappingDecision(DB, {
      ...APPROVE,
      expectedMappingVersion: 1,
    });

    expect(result).toEqual({ outcome: 'STALE_WRITE_REJECTED' });
    expect(mocks.reviewMapping).not.toHaveBeenCalled();
  });

  it('answers a missing mapping and an already-reviewed mapping identically, leaking nothing', async () => {
    mocks.findMappingById.mockResolvedValueOnce(null);
    const missing = await reviewCategoryMappingDecision(DB, APPROVE);

    mocks.findMappingById.mockResolvedValueOnce(
      mappingRow({ status: 'ACTIVE', reviewStatus: 'APPROVED' }),
    );
    const alreadyReviewed = await reviewCategoryMappingDecision(DB, APPROVE);

    expect(missing).toEqual({ outcome: 'STALE_WRITE_REJECTED' });
    expect(alreadyReviewed).toEqual(missing);
  });

  it('rejects rather than activates when a concurrent writer already superseded the predecessor', async () => {
    mocks.findActiveMapping.mockResolvedValue({
      mapping: mappingRow({
        id: 'mapping-1',
        mappingVersion: 1,
        status: 'ACTIVE',
      }),
      category: CATEGORY,
    });
    mocks.supersedeActiveMapping.mockResolvedValue(null);

    const result = await reviewCategoryMappingDecision(DB, APPROVE);

    expect(result).toEqual({ outcome: 'STALE_WRITE_REJECTED' });
    expect(mocks.reviewMapping).not.toHaveBeenCalled();
  });

  it('rejects a proposal without touching the active mapping or raising remap work', async () => {
    mocks.findActiveMapping.mockResolvedValue({
      mapping: mappingRow({
        id: 'mapping-1',
        mappingVersion: 1,
        status: 'ACTIVE',
      }),
      category: CATEGORY,
    });

    const result = await reviewCategoryMappingDecision(DB, {
      ...APPROVE,
      decision: 'REJECT',
    });

    expect(result).toMatchObject({ outcome: 'REJECTED' });
    expect(mocks.supersedeActiveMapping).not.toHaveBeenCalled();
    expect(mocks.insertRemapReviewSummary).not.toHaveBeenCalled();
    expect(mocks.appendAuditEvent).toHaveBeenCalledWith(
      TX,
      expect.objectContaining({ action: 'category_mapping.rejected' }),
    );
  });

  it('rejects a malformed review request at the schema boundary', async () => {
    const result = await reviewCategoryMappingDecision(DB, {
      ...APPROVE,
      mappingId: 'not-a-uuid',
    });

    expect(result).toEqual({ outcome: 'INVALID', reason: 'VALIDATION_FAILED' });
    expect(mocks.findMappingById).not.toHaveBeenCalled();
  });
});
