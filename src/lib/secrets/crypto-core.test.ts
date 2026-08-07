import { beforeEach, describe, expect, it } from 'vitest';
import {
  decryptSupplierCredential,
  encryptSupplierCredential,
} from './crypto-core';

const INPUT = {
  connectionId: 'connection-1',
  providerCode: 'CJ_DROPSHIPPING',
  keyVersion: 1,
};

describe('encryptSupplierCredential / decryptSupplierCredential', () => {
  beforeEach(() => {
    // 32 bytes, base64 - a real key would come from SUPPLIER_CREDENTIAL_MASTER_KEY_BASE64.
    process.env.SUPPLIER_CREDENTIAL_MASTER_KEY_BASE64 = Buffer.alloc(
      32,
      7,
    ).toString('base64');
  });

  it('round-trips the exact plaintext', () => {
    const plaintext = JSON.stringify({ apiKey: 'CJ123@api@secret' });
    const encrypted = encryptSupplierCredential(plaintext, INPUT);

    expect(decryptSupplierCredential(encrypted, INPUT)).toBe(plaintext);
  });

  it('never stores the plaintext in the encrypted envelope', () => {
    const plaintext = 'a very secret CJ api key';
    const encrypted = encryptSupplierCredential(plaintext, INPUT);

    expect(encrypted.ciphertextBase64).not.toContain(plaintext);
    expect(JSON.stringify(encrypted)).not.toContain(plaintext);
  });

  it('fails closed when the ciphertext is tampered with', () => {
    const encrypted = encryptSupplierCredential('secret', INPUT);
    const tampered = {
      ...encrypted,
      ciphertextBase64: Buffer.from('tampered-ciphertext').toString('base64'),
    };

    expect(() => decryptSupplierCredential(tampered, INPUT)).toThrow();
  });

  it('fails closed when the auth tag is tampered with', () => {
    const encrypted = encryptSupplierCredential('secret', INPUT);
    const tampered = {
      ...encrypted,
      authTagBase64: Buffer.alloc(16, 1).toString('base64'),
    };

    expect(() => decryptSupplierCredential(tampered, INPUT)).toThrow();
  });

  it('fails closed when decrypted under a different connection id (AAD mismatch)', () => {
    const encrypted = encryptSupplierCredential('secret', INPUT);

    expect(() =>
      decryptSupplierCredential(encrypted, {
        ...INPUT,
        connectionId: 'connection-2',
      }),
    ).toThrow();
  });

  it('throws a clear error when the master key is not configured', () => {
    delete process.env.SUPPLIER_CREDENTIAL_MASTER_KEY_BASE64;

    expect(() => encryptSupplierCredential('secret', INPUT)).toThrow(
      /encryption is not configured/i,
    );
  });

  it('throws when the configured key is not 32 bytes', () => {
    process.env.SUPPLIER_CREDENTIAL_MASTER_KEY_BASE64 =
      Buffer.alloc(16).toString('base64');

    expect(() => encryptSupplierCredential('secret', INPUT)).toThrow(
      /32 bytes/i,
    );
  });
});
