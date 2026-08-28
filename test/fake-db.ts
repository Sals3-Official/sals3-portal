/**
 * Shared chainable fake Drizzle executor for repository unit tests - the
 * same technique `repository.tenant-scope.test.ts` established: every
 * chained method call is logged with its arguments, each `await` resolves
 * the next canned result from a queue (one entry per statement, in the
 * order the code under test awaits them), and `db.transaction(fn)` runs
 * `fn` against the same shared builder so both direct and transactional
 * code paths work against one fake.
 */

export type FakeDbCall = { method: string; args: unknown[] };

export function fakeDb(results: unknown[][]): {
  db: never;
  calls: FakeDbCall[];
} {
  const calls: FakeDbCall[] = [];
  const chainMethods = [
    'select',
    'selectDistinct',
    'from',
    'where',
    'limit',
    'orderBy',
    'groupBy',
    'innerJoin',
    'leftJoin',
    'for',
    'insert',
    'values',
    'onConflictDoNothing',
    'onConflictDoUpdate',
    'returning',
    'update',
    'set',
    'delete',
    'execute',
  ];
  const builder: Record<string, unknown> = {};

  chainMethods.forEach((method) => {
    builder[method] = (...args: unknown[]) => {
      calls.push({ method, args });

      // `execute` is awaited directly in some call sites; keep it chainable
      // (the shared `then` below resolves it like any other statement).
      return builder;
    };
  });

  let cursor = 0;
  builder.then = (onFulfilled: (value: unknown) => unknown) => {
    const value = results[cursor] ?? [];
    cursor += 1;
    return Promise.resolve(onFulfilled(value));
  };
  builder.transaction = (fn: (tx: unknown) => Promise<unknown>) => fn(builder);

  return { db: builder as never, calls };
}

export function callsOf(calls: FakeDbCall[], method: string): FakeDbCall[] {
  return calls.filter((call) => call.method === method);
}

export function lastCallArgs(calls: FakeDbCall[], method: string): unknown[] {
  const matching = callsOf(calls, method);

  if (matching.length === 0) {
    throw new Error(`Expected at least one call to "${method}".`);
  }

  return matching[matching.length - 1]!.args;
}
