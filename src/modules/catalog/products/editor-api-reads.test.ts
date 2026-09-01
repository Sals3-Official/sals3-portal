// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The read half of the internal API, and the tenancy rule that guards it.
 *
 * These exist because the write-only first cut forced every caller back into
 * a browser to *look* at a product, and each page-scraping reader it grew
 * broke on a Portal change that was nobody's fault - a paginated
 * `/listings`, a candidate id that was really a thumbnail filename, a photo
 * picker that split into one strip per axis. The routes remove the
 * inference; these tests cover the two things the routes themselves decide:
 * which tenant a listing is scoped to, and how a candidate row is shaped.
 */

const SELLER = '11111111-1111-1111-1111-111111111111';
const OTHER_SELLER = '22222222-2222-2222-2222-222222222222';

const listCandidatesByStatus = vi.fn();
const findCataloguedCandidateIds = vi.fn();
const selectChain = vi.fn();

vi.mock('@/lib/db/client', () => ({
  default: () => ({ select: selectChain }),
  isDatabaseConfigured: () => true,
}));

vi.mock('./read-model', () => ({
  findCataloguedCandidateIds: (...args: unknown[]) =>
    findCataloguedCandidateIds(...args),
  findProductEditorFixtureForSeller: vi.fn(),
  listCatalogueProductsForSeller: vi.fn(),
}));

vi.mock('@/modules/catalog/candidates/queries', () => ({
  listCandidatesByStatus: (...args: unknown[]) =>
    listCandidatesByStatus(...args),
}));

vi.mock('./repository', () => ({
  findProductById: vi.fn(),
  findOpenDraftRevision: vi.fn(),
  findRevisionOfProduct: vi.fn(),
}));

function candidate(id: string, name: string) {
  return {
    candidateId: id,
    externalProductId: `ext-${id}`,
    intendedMarketCodes: ['AU'],
    providerCategoryName: 'Casual Pants',
    evaluation: { feedSnapshot: { name, sku: `SKU-${id}` } },
  };
}

describe('readReadyCandidates', () => {
  beforeEach(() => {
    vi.resetModules();
    listCandidatesByStatus.mockReset();
    findCataloguedCandidateIds.mockReset();
  });

  it('only ever asks for PASS, so a caller cannot get rows it must not spend on', async () => {
    listCandidatesByStatus.mockResolvedValue([]);
    findCataloguedCandidateIds.mockResolvedValue(new Set());

    const { readReadyCandidates } = await import('./editor-api-reads');

    await readReadyCandidates({
      sellerAccountId: SELLER,
      limit: 10,
      offset: 0,
    });

    expect(listCandidatesByStatus).toHaveBeenCalledWith(
      SELLER,
      ['PASS'],
      expect.objectContaining({ limit: 10, offset: 0 }),
    );
  });

  /**
   * The field that exists so a client never infers this from a rendered
   * page again: drafting an already-drafted candidate spends 10 CJ points a
   * second time.
   */
  it('marks the already-drafted candidates from the catalogue, not from a label', async () => {
    listCandidatesByStatus.mockResolvedValue([
      candidate('c-1', 'Cargo Pants'),
      candidate('c-2', 'Ripped Jeans'),
    ]);
    findCataloguedCandidateIds.mockResolvedValue(new Set(['c-2']));

    const { readReadyCandidates } = await import('./editor-api-reads');
    const rows = await readReadyCandidates({
      sellerAccountId: SELLER,
      limit: 10,
      offset: 0,
    });

    expect(
      rows.map((row) => [row.candidateId, row.alreadyInCatalogue]),
    ).toEqual([
      ['c-1', false],
      ['c-2', true],
    ]);
  });

  it('carries the supplier name and SKU so a caller needs no second read', async () => {
    listCandidatesByStatus.mockResolvedValue([candidate('c-1', 'Cargo Pants')]);
    findCataloguedCandidateIds.mockResolvedValue(new Set());

    const { readReadyCandidates } = await import('./editor-api-reads');
    const [row] = await readReadyCandidates({
      sellerAccountId: SELLER,
      limit: 10,
      offset: 0,
    });

    expect(row?.productName).toBe('Cargo Pants');
    expect(row?.supplierSku).toBe('SKU-c-1');
  });

  it('survives a candidate whose feed snapshot has no name', async () => {
    listCandidatesByStatus.mockResolvedValue([
      { ...candidate('c-1', ''), evaluation: { feedSnapshot: null } },
    ]);
    findCataloguedCandidateIds.mockResolvedValue(new Set());

    const { readReadyCandidates } = await import('./editor-api-reads');
    const [row] = await readReadyCandidates({
      sellerAccountId: SELLER,
      limit: 10,
      offset: 0,
    });

    expect(row?.productName).toBe('');
  });

  it('omits `search` entirely rather than passing undefined through', async () => {
    listCandidatesByStatus.mockResolvedValue([]);
    findCataloguedCandidateIds.mockResolvedValue(new Set());

    const { readReadyCandidates } = await import('./editor-api-reads');

    await readReadyCandidates({ sellerAccountId: SELLER, limit: 5, offset: 0 });

    const options = listCandidatesByStatus.mock.calls[0]?.[2] as
      Record<string, unknown> | undefined;

    expect(options).not.toHaveProperty('search');
  });
});

describe('readTenantForListing', () => {
  beforeEach(() => {
    vi.resetModules();
    selectChain.mockReset();
  });

  it('scopes a session caller to its own tenant, ignoring any query string', async () => {
    const { readTenantForListing } = await import('./editor-api-auth');

    await expect(
      readTenantForListing(
        { via: 'session', sellerAccountId: SELLER, actorId: 'u-1' },
        OTHER_SELLER,
      ),
    ).resolves.toEqual({ ok: true, sellerAccountId: SELLER });
    // Never even looked one up: the session's own tenant is the answer.
    expect(selectChain).not.toHaveBeenCalled();
  });

  /**
   * The escalation this refusal prevents. The secret is deployment-wide, so
   * on a listing - which names no resource - there is no tenant to borrow.
   * Answering "all tenants" would turn it into a cross-tenant read, and
   * defaulting to the only seller account that happens to exist today is a
   * rule that changes meaning the day a second one is created.
   */
  it('refuses a secret caller that named no tenant', async () => {
    const { readTenantForListing } = await import('./editor-api-auth');

    await expect(
      readTenantForListing({ via: 'secret' }, null),
    ).resolves.toEqual({ ok: false, reason: 'seller_account_required' });
  });

  it('accepts a secret caller that named a real tenant', async () => {
    selectChain.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [{ id: SELLER }] }) }),
    });

    const { readTenantForListing } = await import('./editor-api-auth');

    await expect(
      readTenantForListing({ via: 'secret' }, SELLER),
    ).resolves.toEqual({ ok: true, sellerAccountId: SELLER });
  });

  it('refuses a secret caller that named a tenant which does not exist', async () => {
    selectChain.mockReturnValue({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    });

    const { readTenantForListing } = await import('./editor-api-auth');

    await expect(
      readTenantForListing({ via: 'secret' }, OTHER_SELLER),
    ).resolves.toEqual({ ok: false, reason: 'not_found' });
  });
});
