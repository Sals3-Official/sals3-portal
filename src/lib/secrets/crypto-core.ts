import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM envelope for supplier credentials - the actual logic, with no
 * `server-only` import. Kept separate from `crypto.ts` (the app-facing,
 * guarded entry point) because `server-only`'s default export throws
 * unconditionally outside Next.js's bundler `react-server` condition - a
 * plain Node script (`scripts/bootstrap-sals3-official-cj.mts`) has no such
 * condition and would crash on import. The bootstrap script is a trusted
 * CLI tool, never part of the browser bundle the guard protects against, so
 * importing this core module directly there is correct, not a bypass of
 * the actual security property.
 *
 * The additional authenticated data (AAD) binds a ciphertext to the exact
 * connection, provider, and key version it was encrypted for - swapping an
 * encrypted blob between two connections' rows fails to decrypt instead of
 * silently succeeding with the wrong plaintext.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;

function getMasterKey(): Buffer {
  const encoded = process.env.SUPPLIER_CREDENTIAL_MASTER_KEY_BASE64;

  if (!encoded) {
    throw new Error('Supplier credential encryption is not configured.');
  }

  const key = Buffer.from(encoded, 'base64');

  if (key.length !== 32) {
    throw new Error('Supplier credential encryption key must be 32 bytes.');
  }

  return key;
}

function buildAdditionalData(
  connectionId: string,
  providerCode: string,
  keyVersion: number,
): Buffer {
  return Buffer.from(`${connectionId}:${providerCode}:${keyVersion}`, 'utf8');
}

export type EncryptedCredential = {
  ciphertextBase64: string;
  ivBase64: string;
  authTagBase64: string;
  keyVersion: number;
};

export function encryptSupplierCredential(
  plaintext: string,
  input: { connectionId: string; providerCode: string; keyVersion: number },
): EncryptedCredential {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, getMasterKey(), iv);

  cipher.setAAD(
    buildAdditionalData(
      input.connectionId,
      input.providerCode,
      input.keyVersion,
    ),
  );

  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  return {
    ciphertextBase64: ciphertext.toString('base64'),
    ivBase64: iv.toString('base64'),
    authTagBase64: cipher.getAuthTag().toString('base64'),
    keyVersion: input.keyVersion,
  };
}

export function decryptSupplierCredential(
  encrypted: EncryptedCredential,
  input: { connectionId: string; providerCode: string },
): string {
  const decipher = createDecipheriv(
    ALGORITHM,
    getMasterKey(),
    Buffer.from(encrypted.ivBase64, 'base64'),
  );

  decipher.setAAD(
    buildAdditionalData(
      input.connectionId,
      input.providerCode,
      encrypted.keyVersion,
    ),
  );

  decipher.setAuthTag(Buffer.from(encrypted.authTagBase64, 'base64'));

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertextBase64, 'base64')),
    decipher.final(),
  ]);

  return plaintext.toString('utf8');
}
