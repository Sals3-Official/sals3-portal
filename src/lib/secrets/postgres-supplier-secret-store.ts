import 'server-only';

import { eq } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import { supplierConnectionSecrets } from '@/lib/db/schema';
import { decryptSupplierCredential, encryptSupplierCredential } from './crypto';
import type { SupplierSecretStore } from './supplier-secret-store';

/** Bump when the master key rotates. Old rows keep their own recorded version. */
const CURRENT_KEY_VERSION = 1;

/**
 * Drizzle-backed `SupplierSecretStore`. Credentials are JSON-serialized,
 * then AES-256-GCM encrypted before ever reaching Postgres - no plaintext
 * credential is written, logged, or returned outside this module.
 */
export default class PostgresSupplierSecretStore implements SupplierSecretStore {
  // These methods don't reference `this` - each runs on the executor it is
  // handed - but the class shape matches the given `SupplierSecretStore` DI
  // contract (constructible, mockable/swappable) rather than a plain module
  // of functions.
  // eslint-disable-next-line class-methods-use-this
  async write(
    executor: DbExecutor,
    connectionId: string,
    providerCode: string,
    credentials: unknown,
  ): Promise<void> {
    const encrypted = encryptSupplierCredential(JSON.stringify(credentials), {
      connectionId,
      providerCode,
      keyVersion: CURRENT_KEY_VERSION,
    });

    await executor
      .insert(supplierConnectionSecrets)
      .values({
        connectionId,
        ciphertextBase64: encrypted.ciphertextBase64,
        ivBase64: encrypted.ivBase64,
        authTagBase64: encrypted.authTagBase64,
        keyVersion: encrypted.keyVersion,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: supplierConnectionSecrets.connectionId,
        set: {
          ciphertextBase64: encrypted.ciphertextBase64,
          ivBase64: encrypted.ivBase64,
          authTagBase64: encrypted.authTagBase64,
          keyVersion: encrypted.keyVersion,
          updatedAt: new Date(),
        },
      });
  }

  // eslint-disable-next-line class-methods-use-this
  async read<T>(
    executor: DbExecutor,
    connectionId: string,
    providerCode: string,
  ): Promise<T> {
    const rows = await executor
      .select()
      .from(supplierConnectionSecrets)
      .where(eq(supplierConnectionSecrets.connectionId, connectionId))
      .limit(1);

    const row = rows[0];

    if (row === undefined) {
      throw new Error('No credential is stored for this connection.');
    }

    const plaintext = decryptSupplierCredential(
      {
        ciphertextBase64: row.ciphertextBase64,
        ivBase64: row.ivBase64,
        authTagBase64: row.authTagBase64,
        keyVersion: row.keyVersion,
      },
      { connectionId, providerCode },
    );

    return JSON.parse(plaintext) as T;
  }

  // eslint-disable-next-line class-methods-use-this
  async delete(executor: DbExecutor, connectionId: string): Promise<void> {
    await executor
      .delete(supplierConnectionSecrets)
      .where(eq(supplierConnectionSecrets.connectionId, connectionId));
  }
}
