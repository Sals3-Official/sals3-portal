// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db/client', () => ({
  default: () => ({ marker: 'db' }),
  isDatabaseConfigured: vi.fn(() => true),
}));

vi.mock('@/modules/catalog/taxonomy/migrate-attribute-controls', () => ({
  runAttributeControlsDdl: vi.fn(),
  seedAttributeControlsData: vi.fn(),
}));

/* eslint-disable import/first */
import { NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import {
  runAttributeControlsDdl,
  seedAttributeControlsData,
} from '@/modules/catalog/taxonomy/migrate-attribute-controls';
import { POST } from './route';
/* eslint-enable import/first */

const asMock = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const SECRET = 'cron-secret-1';
const URL =
  'https://portal.example.com/api/internal/catalog/taxonomy/migrate-attribute-controls';

const DDL_RESULT = { statementsRun: 15, statementsSkippedAlreadyExists: 0 };
const SEED_RESULT = {
  controlsVersion: 'sals3-attribute-controls-v1',
  dictionaryInExtract: 149,
  dictionaryInserted: 149,
  controlsInExtract: 53625,
  controlsInserted: 53625,
  missingCategoryCodes: [],
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
  asMock(runAttributeControlsDdl).mockResolvedValue(DDL_RESULT);
  asMock(seedAttributeControlsData).mockResolvedValue(SEED_RESULT);
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
    expect(runAttributeControlsDdl).not.toHaveBeenCalled();
    expect(seedAttributeControlsData).not.toHaveBeenCalled();
  });

  it('refuses when the control secret is unset rather than falling open', async () => {
    delete process.env.CRON_SECRET;

    const response = await POST(authorized());

    expect(response.status).toBe(401);
    expect(runAttributeControlsDdl).not.toHaveBeenCalled();
  });

  it('reports no-database-configured instead of attempting a write', async () => {
    asMock(isDatabaseConfigured).mockReturnValue(false);

    const response = await POST(authorized());

    expect(response.status).toBe(503);
    expect(runAttributeControlsDdl).not.toHaveBeenCalled();
    expect(seedAttributeControlsData).not.toHaveBeenCalled();
  });

  it('runs the DDL before the seed, and returns both results on an authorized request', async () => {
    const response = await POST(authorized());
    const body: unknown = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, ddl: DDL_RESULT, seed: SEED_RESULT });
  });

  it('returns 500 without leaking internal detail when the DDL step throws', async () => {
    asMock(runAttributeControlsDdl).mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    const response = await POST(authorized());
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(seedAttributeControlsData).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('connection terminated');
  });

  it('returns 500 without leaking internal detail when the seed step throws', async () => {
    asMock(seedAttributeControlsData).mockRejectedValue(
      new Error('connection terminated unexpectedly'),
    );

    const response = await POST(authorized());
    const body: unknown = await response.json();

    expect(response.status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('connection terminated');
  });
});
