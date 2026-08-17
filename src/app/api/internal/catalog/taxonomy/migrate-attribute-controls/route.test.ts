// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({ marker: 'db' }),
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock('@/modules/catalog/taxonomy/migrate-attribute-controls', () => ({
  migrateAttributeControls: vi.fn(),
}));

/* eslint-disable import/first */
import { NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import { migrateAttributeControls } from '@/modules/catalog/taxonomy/migrate-attribute-controls';
import { POST } from './route';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SECRET = 'cron-secret-1';
const URL =
  'https://portal.example.com/api/internal/catalog/taxonomy/migrate-attribute-controls';

const SUCCESS_RESULT = {
  ok: true,
  ddl: { statementsRun: 19, statementsSkippedAlreadyExists: 0 },
  migrationRecord: { createdAt: 1786935292882, inserted: true },
  seed: {
    ok: true,
    controlsVersion: 'sals3-attribute-controls-v1',
    dictionaryInExtract: 149,
    dictionaryInserted: 149,
    controlsInExtract: 53625,
    controlsInserted: 53625,
  },
};

const MISSING_CATEGORY_CODES_RESULT = {
  ok: false,
  reason: 'missing-category-codes',
  missingCategoryCodeCount: 2,
  missingCategoryCodesSample: [
    'CAT-GGL-DOES-NOT-EXIST-1',
    'CAT-GGL-DOES-NOT-EXIST-2',
  ],
};

function request(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(URL, { method: 'POST', headers });
}

function authorized(): NextRequest {
  return request({ authorization: `Bearer ${SECRET}` });
}

beforeEach(() => {
  process.env.CRON_SECRET = SECRET;
  asMock(isDatabaseConfigured).mockReturnValue(true);
  asMock(migrateAttributeControls).mockResolvedValue(SUCCESS_RESULT);
});

afterEach(() => {
  delete process.env.CRON_SECRET;
  vi.clearAllMocks();
});

describe('POST /api/internal/catalog/taxonomy/migrate-attribute-controls', () => {
  it('rejects a missing or wrong control secret with 401 and writes nothing', async () => {
    const missing = await POST(request());
    const wrong = await POST(request({ authorization: 'Bearer nope' }));

    expect(missing.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(migrateAttributeControls).not.toHaveBeenCalled();
  });

  it('refuses when the control secret is unset rather than falling open', async () => {
    delete process.env.CRON_SECRET;

    const response = await POST(authorized());

    expect(response.status).toBe(401);
    expect(migrateAttributeControls).not.toHaveBeenCalled();
  });

  it('reports no-database-configured instead of attempting a write', async () => {
    asMock(isDatabaseConfigured).mockReturnValue(false);

    const response = await POST(authorized());

    expect(response.status).toBe(503);
    expect(migrateAttributeControls).not.toHaveBeenCalled();
  });

  it('runs the migration and returns its result on an authorized request', async () => {
    const response = await POST(authorized());
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(SUCCESS_RESULT);
  });

  it('returns 409 and writes nothing when the seed refuses due to missing category codes', async () => {
    asMock(migrateAttributeControls).mockResolvedValue(
      MISSING_CATEGORY_CODES_RESULT,
    );

    const response = await POST(authorized());
    const body: unknown = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual(MISSING_CATEGORY_CODES_RESULT);
  });

  it('returns 500 without leaking internal detail when the migration throws', async () => {
    asMock(migrateAttributeControls).mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    const response = await POST(authorized());
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('connection terminated');
  });
});
