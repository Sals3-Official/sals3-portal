import 'server-only';

import { eq } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import { supplierWebhookSecrets } from '@/lib/db/schema';
import { decryptSupplierCredential, encryptSupplierCredential } from './crypto';

/**
 * Encrypted-at-rest store for the CJ webhook signature secret: the account's
 * `openId` string, which CJ documents as the HMAC-SHA256 key for webhook
 * `sign` verification. Same AES-256-GCM envelope as the credential store,
 * with a distinct AAD provider code so a credential ciphertext can never be
 * replayed into this table (or vice versa).
 *
 * The value is written opportunistically whenever a token refresh observes
 * the account's `openId`, and read ONLY by the webhook verification path.
 * It is never logged and never leaves the server.
 */

const CURRENT_KEY_VERSION = 1;
const AAD_PROVIDER_CODE = 'CJ_DROPSHIPPING:webhook';

export async function writeWebhookSecret(
  executor: DbExecutor,
  connectionId: string,
  secret: string,
): Promise<void> {
  if (secret === '') return;

  const encrypted = encryptSupplierCredential(secret, {
    connectionId,
    providerCode: AAD_PROVIDER_CODE,
    keyVersion: CURRENT_KEY_VERSION,
  });

  await executor
    .insert(supplierWebhookSecrets)
    .values({
      connectionId,
      ciphertextBase64: encrypted.ciphertextBase64,
      ivBase64: encrypted.ivBase64,
      authTagBase64: encrypted.authTagBase64,
      keyVersion: encrypted.keyVersion,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: supplierWebhookSecrets.connectionId,
      set: {
        ciphertextBase64: encrypted.ciphertextBase64,
        ivBase64: encrypted.ivBase64,
        authTagBase64: encrypted.authTagBase64,
        keyVersion: encrypted.keyVersion,
        updatedAt: new Date(),
      },
    });
}

export type ConnectionWebhookSecret = {
  connectionId: string;
  secret: string;
};

/**
 * Every stored webhook secret, decrypted for signature checking. Bounded by
 * the number of supplier connections (a per-tenant handful), so trying each
 * secret against an incoming signature is a constant-cost step - and means
 * an attacker-supplied body field is never trusted to select the secret.
 */
export async function listWebhookSecrets(
  executor: DbExecutor,
): Promise<ConnectionWebhookSecret[]> {
  const rows = await executor.select().from(supplierWebhookSecrets);

  return rows.map((row) => ({
    connectionId: row.connectionId,
    secret: decryptSupplierCredential(
      {
        ciphertextBase64: row.ciphertextBase64,
        ivBase64: row.ivBase64,
        authTagBase64: row.authTagBase64,
        keyVersion: row.keyVersion,
      },
      { connectionId: row.connectionId, providerCode: AAD_PROVIDER_CODE },
    ),
  }));
}

export async function deleteWebhookSecret(
  executor: DbExecutor,
  connectionId: string,
): Promise<void> {
  await executor
    .delete(supplierWebhookSecrets)
    .where(eq(supplierWebhookSecrets.connectionId, connectionId));
}
