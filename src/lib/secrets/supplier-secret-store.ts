/**
 * Storage-agnostic interface for a supplier connection's encrypted
 * credential bundle. `credentials`/`T` are opaque to the store - callers are
 * responsible for their own Zod contract (e.g. `cjCredentialBundleSchema`).
 */
export interface SupplierSecretStore {
  write(
    connectionId: string,
    providerCode: string,
    credentials: unknown,
  ): Promise<void>;

  read<T>(connectionId: string, providerCode: string): Promise<T>;

  delete(connectionId: string): Promise<void>;
}
