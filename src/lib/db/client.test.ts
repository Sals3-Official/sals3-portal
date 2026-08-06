// @vitest-environment node
//
// This suite must run without a `window`. The module under test throws on
// purpose when `window` exists, which is its server-only guard — and this
// repo's Vitest default environment is jsdom.
import { afterEach, describe, expect, it, vi } from 'vitest';
import getDb, { isDatabaseConfigured } from './client';

/**
 * The load-bearing property here is that **importing** this module has no side
 * effects. Next.js imports every route module during `next build`'s
 * "Collecting page data" phase — including `force-dynamic` routes — so
 * connecting at module evaluation made the whole build fail in any
 * environment without `DATABASE_URL`. That is exactly what happened on a
 * Vercel preview deploy.
 *
 * This file importing `./client` at the top, with no `DATABASE_URL` stubbed,
 * is itself the regression guard: if the connection ever moves back to module
 * scope, this suite fails to load at all.
 */

describe('db client module import', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('imports without a DATABASE_URL, so a build never needs one', () => {
    // Reaching this line at all proves module evaluation did not connect.
    expect(typeof getDb).toBe('function');
  });

  it('reports the database as unconfigured when DATABASE_URL is absent', () => {
    vi.stubEnv('DATABASE_URL', '');
    expect(isDatabaseConfigured()).toBe(false);
  });

  it('reports the database as configured when DATABASE_URL is set', () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://u:p@localhost:5432/db');
    expect(isDatabaseConfigured()).toBe(true);
  });

  it('throws only when a query is actually attempted without configuration', () => {
    vi.stubEnv('DATABASE_URL', '');
    // The error surfaces at call time, not import time — the whole point.
    expect(() => getDb()).toThrow('DATABASE_URL is not set.');
  });
});
