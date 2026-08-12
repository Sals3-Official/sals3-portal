import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isDatabaseUnavailableError,
  readOrUnavailable,
  resetUnavailableLogThrottle,
} from './availability';

/**
 * The value of this classifier is entirely in what it refuses to match. A
 * version that returned `true` generously would turn a missing migration or a
 * bad credential into a page that renders "cannot reach the database" and
 * looks deliberate - so the negative cases below matter more than the
 * positive ones.
 */

/** Mirrors how Drizzle actually surfaces a driver failure: wrapped, with the original on `cause`. */
function wrapLikeDrizzle(cause: unknown): Error {
  const wrapper = new Error('Failed query: select ... from "seller_accounts"');
  (wrapper as { cause?: unknown }).cause = cause;
  return wrapper;
}

function driverError(code: string, message = 'driver failure'): Error {
  const error = new Error(message);
  (error as { code?: string }).code = code;
  return error;
}

describe('isDatabaseUnavailableError', () => {
  it('matches the socket failure that broke the seller pages', () => {
    // The exact shape observed: postgres.js read ECONNRESET, wrapped by Drizzle.
    expect(
      isDatabaseUnavailableError(
        wrapLikeDrizzle(driverError('ECONNRESET', 'read ECONNRESET')),
      ),
    ).toBe(true);
  });

  it('matches a dropped database (3D000)', () => {
    expect(
      isDatabaseUnavailableError(
        wrapLikeDrizzle(
          driverError('3D000', 'database "sals3" does not exist'),
        ),
      ),
    ).toBe(true);
  });

  it.each([
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    '08006',
    '57P03',
    '53300',
    'CONNECTION_CLOSED',
    'CONNECT_TIMEOUT',
  ])('matches %s', (code) => {
    expect(isDatabaseUnavailableError(driverError(code))).toBe(true);
  });

  it('does NOT match a missing table, so an unmigrated deployment stays loud', () => {
    // 42P01 means the server answered and the schema is wrong. Degrading here
    // would hide unapplied migrations behind a state that looks intentional.
    expect(
      isDatabaseUnavailableError(
        wrapLikeDrizzle(
          driverError('42P01', 'relation "products" does not exist'),
        ),
      ),
    ).toBe(false);
  });

  it('does NOT match an authentication failure', () => {
    expect(
      isDatabaseUnavailableError(
        wrapLikeDrizzle(driverError('28P01', 'password authentication failed')),
      ),
    ).toBe(false);
  });

  it('does NOT match a unique violation or a plain application error', () => {
    expect(isDatabaseUnavailableError(driverError('23505'))).toBe(false);
    expect(isDatabaseUnavailableError(new Error('boom'))).toBe(false);
    expect(isDatabaseUnavailableError(null)).toBe(false);
    expect(isDatabaseUnavailableError('ECONNRESET')).toBe(false);
  });

  it('terminates on a cyclic cause chain instead of spinning', () => {
    const a = new Error('a');
    const b = new Error('b');
    (a as { cause?: unknown }).cause = b;
    (b as { cause?: unknown }).cause = a;

    expect(isDatabaseUnavailableError(a)).toBe(false);
  });

  it('gives up past the depth cap rather than walking an unbounded chain', () => {
    let deepest: Error = driverError('ECONNRESET');
    for (let i = 0; i < 8; i += 1) {
      deepest = wrapLikeDrizzle(deepest);
    }

    expect(isDatabaseUnavailableError(deepest)).toBe(false);
  });
});

describe('readOrUnavailable', () => {
  beforeEach(() => {
    resetUnavailableLogThrottle();
  });

  it('passes the value through when the read succeeds', async () => {
    await expect(
      readOrUnavailable('test read', async () => ({ rows: 3 })),
    ).resolves.toEqual({ ok: true, data: { rows: 3 } });
  });

  it('converts unavailability into a renderable result', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(
      readOrUnavailable('test read', async () => {
        throw wrapLikeDrizzle(driverError('ECONNRESET'));
      }),
    ).resolves.toEqual({ ok: false, reason: 'DATABASE_UNAVAILABLE' });

    spy.mockRestore();
  });

  it('logs at warn, never error, so a handled outage does not raise the dev overlay', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});

    await readOrUnavailable('test read', async () => {
      throw wrapLikeDrizzle(driverError('ECONNRESET'));
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();

    warn.mockRestore();
    error.mockRestore();
  });

  it('logs one line per surface per outage, not one per read', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Five concurrent reads on one page load, all failing the same way.
    await Promise.all(
      Array.from({ length: 5 }, () =>
        readOrUnavailable('overview', async () => {
          throw wrapLikeDrizzle(driverError('ECONNRESET'));
        }),
      ),
    );

    expect(spy).toHaveBeenCalledTimes(1);

    // A different surface is a different signal and still gets its own line.
    await readOrUnavailable('supplier apps', async () => {
      throw wrapLikeDrizzle(driverError('ECONNRESET'));
    });

    expect(spy).toHaveBeenCalledTimes(2);

    spy.mockRestore();
  });

  it('rethrows a PermissionError, so authorization is never softened', async () => {
    class PermissionError extends Error {}

    await expect(
      readOrUnavailable('test read', async () => {
        throw new PermissionError('denied');
      }),
    ).rejects.toBeInstanceOf(PermissionError);
  });

  it('rethrows a missing-table error', async () => {
    await expect(
      readOrUnavailable('test read', async () => {
        throw wrapLikeDrizzle(driverError('42P01'));
      }),
    ).rejects.toThrow();
  });

  it('logs the label and driver message but never the connection string', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await readOrUnavailable('supplier products', async () => {
      const error = wrapLikeDrizzle(
        driverError('ECONNRESET', 'read ECONNRESET'),
      );
      (error as { connectionString?: string }).connectionString =
        'postgresql://sals3_app:hunter2@localhost:5432/sals3';
      throw error;
    });

    const logged = spy.mock.calls.flat().join(' ');

    expect(logged).toContain('supplier products');
    expect(logged).not.toContain('hunter2');
    expect(logged).not.toContain('postgresql://');

    spy.mockRestore();
  });
});
