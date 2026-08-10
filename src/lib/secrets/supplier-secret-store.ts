import type { DbExecutor } from '@/lib/db/client';

/**
 * Storage-agnostic interface for a supplier connection's encrypted
 * credential bundle. `credentials`/`T` are opaque to the store - callers are
 * responsible for their own Zod contract (e.g. `cjCredentialBundleSchema`).
 *
 * `executor` is first and required, never defaulted. A credential is written
 * immediately after its connection row is inserted, so the write must run on
 * the *same* connection as that insert or the foreign key sees a row that has
 * not been committed yet. A default of `getDb()` would compile everywhere and
 * silently reintroduce exactly that failure - see `DbExecutor`'s own note.
 *
 * `import type` keeps this file free of any runtime dependency on the
 * server-only database client.
 */
export interface SupplierSecretStore {
  write(
    executor: DbExecutor,
    connectionId: string,
    providerCode: string,
    credentials: unknown,
  ): Promise<void>;

  read<T>(
    executor: DbExecutor,
    connectionId: string,
    providerCode: string,
  ): Promise<T>;

  delete(executor: DbExecutor, connectionId: string): Promise<void>;
}
