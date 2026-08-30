// @vitest-environment node
//
// The module imports `@/lib/db/client` for its `Database` type, and that file
// throws when `window` is defined — a load-bearing guard against bundling the
// DB client into client code.
import { describe, expect, it, vi } from 'vitest';
import {
  migrateSearchTrigram,
  readSearchTrigramState,
  TRIGRAM_INDEXES,
} from './migrate-search-trigram';

type Row = Record<string, unknown>;

/**
 * A stub executor that answers each `execute` from a queue and records the SQL
 * it was asked to run.
 *
 * This asserts the DECISIONS — which statements are issued, in what order, and
 * whether an invalid index is dropped first — not that the SQL runs. A stubbed
 * executor cannot tell you a query runs; that is what the workflow's own
 * read-back of `pg_index.indisvalid` is for, and why the workflow loops on the
 * database's answer rather than on an exit code.
 */
function stubDb(responses: Row[][]) {
  const issued: string[] = [];
  let call = 0;

  const db = {
    execute: vi.fn(async (query: unknown) => {
      const rendered = JSON.stringify(query);

      issued.push(rendered);
      call += 1;

      return responses[call - 1] ?? [];
    }),
  };

  return { db, issued, raw: () => issued.join('\n') };
}

const NO_EXTENSION: Row[] = [];
const HAS_EXTENSION: Row[] = [{ present: 1 }];

function indexRows(entries: Array<{ name: string; valid: boolean }>): Row[] {
  return entries;
}

describe('readSearchTrigramState', () => {
  it('reports ready only when the extension and every index are good', async () => {
    const { db } = stubDb([
      HAS_EXTENSION,
      indexRows(TRIGRAM_INDEXES.map((i) => ({ name: i.name, valid: true }))),
    ]);

    const state = await readSearchTrigramState(db as never);

    expect(state.extensionInstalled).toBe(true);
    expect(state.ready).toBe(true);
  });

  it('is not ready when the extension is missing, however good the indexes', async () => {
    const { db } = stubDb([
      NO_EXTENSION,
      indexRows(TRIGRAM_INDEXES.map((i) => ({ name: i.name, valid: true }))),
    ]);

    expect((await readSearchTrigramState(db as never)).ready).toBe(false);
  });

  it('is not ready when an index exists but is INVALID', async () => {
    // The case that makes a naive re-run lie: the name is present, so
    // `IF NOT EXISTS` does nothing, while the planner ignores the index and
    // every write still maintains it.
    const { db } = stubDb([
      HAS_EXTENSION,
      indexRows([
        { name: TRIGRAM_INDEXES[0].name, valid: false },
        { name: TRIGRAM_INDEXES[1].name, valid: true },
      ]),
    ]);

    const state = await readSearchTrigramState(db as never);

    expect(state.indexes[0]).toEqual({
      name: TRIGRAM_INDEXES[0].name,
      exists: true,
      valid: false,
    });
    expect(state.ready).toBe(false);
  });

  it('reports an absent index as neither existing nor valid', async () => {
    const { db } = stubDb([HAS_EXTENSION, indexRows([])]);
    const state = await readSearchTrigramState(db as never);

    expect(state.indexes.every((i) => !i.exists && !i.valid)).toBe(true);
  });
});

describe('migrateSearchTrigram', () => {
  it('creates the extension and both indexes on a fresh database', async () => {
    const { db, raw } = stubDb([
      NO_EXTENSION,
      indexRows([]),
      [],
      [],
      [],
      [],
      HAS_EXTENSION,
      indexRows(TRIGRAM_INDEXES.map((i) => ({ name: i.name, valid: true }))),
    ]);

    const result = await migrateSearchTrigram(db as never);

    expect(raw()).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    TRIGRAM_INDEXES.forEach((index) => {
      expect(raw()).toContain(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${index.name}`,
      );
    });
    expect(result.droppedInvalid).toEqual([]);
  });

  it('builds every index CONCURRENTLY, never with a plain CREATE INDEX', async () => {
    // Not cosmetic: `candidate_evaluations` has fourteen write paths and
    // discovery writes continuously, so a plain build would hold a lock for
    // minutes and stall it.
    const { db, raw } = stubDb([NO_EXTENSION, indexRows([])]);

    await migrateSearchTrigram(db as never);

    expect(raw()).not.toMatch(/CREATE INDEX (?!CONCURRENTLY)/);
  });

  it('clears statement_timeout before building', async () => {
    // Being killed by a timeout is exactly what leaves an invalid index behind.
    const { db, raw } = stubDb([NO_EXTENSION, indexRows([])]);

    await migrateSearchTrigram(db as never);

    expect(raw()).toContain('SET statement_timeout = 0');
  });

  it('drops an INVALID index before rebuilding it', async () => {
    const { db, raw, issued } = stubDb([
      HAS_EXTENSION,
      indexRows([{ name: TRIGRAM_INDEXES[0].name, valid: false }]),
    ]);

    const result = await migrateSearchTrigram(db as never);

    expect(result.droppedInvalid).toEqual([TRIGRAM_INDEXES[0].name]);
    expect(raw()).toContain(
      `DROP INDEX CONCURRENTLY IF EXISTS ${TRIGRAM_INDEXES[0].name}`,
    );

    const dropAt = issued.findIndex((s) => s.includes('DROP INDEX'));
    const createAt = issued.findIndex((s) =>
      s.includes(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${TRIGRAM_INDEXES[0].name}`,
      ),
    );

    // Order is the whole point: recreating before dropping would be a no-op
    // against the name already there.
    expect(dropAt).toBeGreaterThan(-1);
    expect(createAt).toBeGreaterThan(dropAt);
  });

  it('leaves a valid index alone rather than rebuilding it', async () => {
    const { db, raw } = stubDb([
      HAS_EXTENSION,
      indexRows(TRIGRAM_INDEXES.map((i) => ({ name: i.name, valid: true }))),
    ]);

    const result = await migrateSearchTrigram(db as never);

    expect(raw()).not.toContain('DROP INDEX');
    expect(raw()).not.toContain('CREATE INDEX');
    expect(result.statementsRun).toBe(0);
  });

  it('does not reinstall an extension that is already present', async () => {
    const { db, raw } = stubDb([
      HAS_EXTENSION,
      indexRows(TRIGRAM_INDEXES.map((i) => ({ name: i.name, valid: true }))),
    ]);

    await migrateSearchTrigram(db as never);

    expect(raw()).not.toContain('CREATE EXTENSION');
  });
});
