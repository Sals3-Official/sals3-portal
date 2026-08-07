/* eslint-disable no-console -- this is a CLI script; status output is its job. */
/**
 * One-time bootstrap: creates the Sals3 Official Dropshipper seller
 * account, the CJ_DROPSHIPPING provider row, and one encrypted supplier
 * connection from the existing global `CJ_API_KEY`, then backfills every
 * pre-existing `supplier_candidates` row to that connection.
 *
 * Run with: npm run bootstrap:cj
 *
 * Runs under `tsx` (dev dependency, scripts-only, no runtime impact),
 * because plain Node's native TypeScript support cannot resolve this
 * codebase's directory-index imports (e.g. `./schema` for `schema/index.ts`)
 * the way TypeScript's own `bundler` moduleResolution and Next.js's bundler
 * both already do. Uses extensionless relative imports (matching this
 * codebase's own convention) rather than the `@/` alias, since alias
 * resolution outside Next.js has not been verified here.
 * Imports only modules with no `server-only` guard (that guard's default
 * export throws outside Next.js's bundler condition, which a script never
 * has) - see `src/lib/secrets/crypto-core.ts`'s own comment for why the
 * guarded `crypto.ts` is deliberately not imported here.
 *
 * Does not reuse `src/lib/db/client.ts`'s pooled `getDb()`: that module's
 * own internal `import * as schema from './schema'` barrel re-export does
 * not survive tsx/esbuild's CJS interop under this script's runtime
 * (verified directly - the same barrel works fine under Next.js and
 * Vitest), and a short-lived one-shot script has no use for a cached,
 * hot-reload-aware connection pool anyway. This script opens its own
 * single-connection client instead, closed in `finally`.
 */
import { createHash } from 'node:crypto';
import { isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Database } from '../src/lib/db/client';
/* eslint-disable import/extensions -- extensionless is what actually works
   here: `tsc` rejects an explicit `.ts` extension without
   `allowImportingTsExtensions` (a project-wide tsconfig change out of scope
   for one script), and tsx/esbuild resolves extensionless relative imports
   correctly, matching this codebase's own convention. Imported directly
   from their own files, not the `schema` barrel - see the file header. */
import { SALS3_OFFICIAL_IDENTITY_ID } from '../src/lib/auth/identity';
import { auditEvents, supplierCandidates } from '../src/lib/db/schema/catalog';
import { supplierConnectionSecrets } from '../src/lib/db/schema/supplier-secrets';
import { encryptSupplierCredential } from '../src/lib/secrets/crypto-core';
import { CJ_BASE_URL } from '../src/services/cj/config';
import { cjAccessTokenSchema } from '../src/lib/cj/schemas';
import {
  findConnectionBySellerAndProvider,
  insertConnection,
  insertProviderIfAbsent,
  insertSellerAccountIfAbsent,
  reconnectConnection,
} from '../src/modules/suppliers/repository';
/* eslint-enable import/extensions */

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

function isDatabaseConfigured(): boolean {
  const value = process.env.DATABASE_URL;
  return value !== undefined && value !== '';
}

function createScriptDb() {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is not set.');
  }

  const sql = postgres(connectionString, { max: 1 });

  // This script's schema-less `drizzle(sql)` has the same runtime query
  // builder shape as the app's schema-typed `Database` (the schema generic
  // only affects `.query.*` relational helpers, which nothing here uses) -
  // cast rather than importing the app's full schema barrel, which does not
  // survive this script's tsx/esbuild CJS interop (see the file header).
  return {
    db: drizzle(sql) as unknown as Database,
    close: () => sql.end(),
  };
}

const CJ_PROVIDER_CODE = 'CJ_DROPSHIPPING';
const KEY_VERSION = 1;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function maskOpenId(openId: string): string {
  return `CJ...${openId.slice(-4)}`;
}

type VerifiedCjAuth = {
  openId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

/**
 * Verified live 2026-08-07: this one call returns `openId` (CJ's own stable
 * per-account identifier), `accessToken`, `refreshToken`, and both expiry
 * dates together - no separate account-info or refresh endpoint is needed.
 */
async function verifyAndFetchToken(apiKey: string): Promise<VerifiedCjAuth> {
  const response = await fetch(`${CJ_BASE_URL}/authentication/getAccessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(
      `CJ authentication request failed with HTTP ${response.status}`,
    );
  }

  const parsed = cjAccessTokenSchema.safeParse(await response.json());

  if (!parsed.success || parsed.data.code !== 200 || !parsed.data.data) {
    throw new Error('CJ rejected the configured CJ_API_KEY.');
  }

  const { data } = parsed.data;

  if (data.openId === null) {
    throw new Error('CJ did not return an openId for this API key.');
  }

  return {
    openId: String(data.openId),
    accessToken: data.accessToken,
    accessTokenExpiresAt: data.accessTokenExpiryDate,
    refreshToken: data.refreshToken,
    refreshTokenExpiresAt: data.refreshTokenExpiryDate,
  };
}

async function runBootstrap(
  db: ReturnType<typeof createScriptDb>['db'],
  apiKey: string,
): Promise<void> {
  const sellerAccount = await insertSellerAccountIfAbsent(db, {
    identityId: SALS3_OFFICIAL_IDENTITY_ID,
    businessModel: 'DROPSHIPPER',
    verificationState: 'VERIFIED',
    accountState: 'ACTIVE',
  });

  const provider = await insertProviderIfAbsent(db, {
    code: CJ_PROVIDER_CODE,
    displayName: 'CJdropshipping',
    capabilities: {
      catalog: true,
      inventory: true,
      productWebhooks: false,
      orderSubmission: false,
      orderWebhooks: false,
    },
  });

  // Always re-verifies (one CJ call) so the stored credential is fresh
  // either way - a one-time/occasional bootstrap script has no hot-path
  // reason to skip it, and it is what lets an idempotent re-run detect a
  // *different* CJ account without decrypting the previously stored one.
  const verified = await verifyAndFetchToken(apiKey);
  const maskedOpenId = maskOpenId(verified.openId);

  const existingConnection = await findConnectionBySellerAndProvider(
    db,
    sellerAccount.id,
    provider.id,
  );

  let connectionId: string;
  const lookupHash = createHash('sha256')
    .update(`${provider.code}:${verified.openId}`)
    .digest('hex');

  if (existingConnection !== null) {
    if (existingConnection.externalAccountMasked !== maskedOpenId) {
      throw new Error(
        `Refusing to overwrite existing connection ${existingConnection.id} ` +
          `(${existingConnection.externalAccountMasked}) with a different CJ account (${maskedOpenId}).`,
      );
    }

    connectionId = existingConnection.id;

    // Re-running this script must also undo a disconnect, not only refresh
    // the credential - otherwise a re-run after `disconnectCjSupplier` would
    // silently leave `status` at `DISCONNECTED` while quietly rewriting a
    // fresh secret underneath it, which is exactly backwards (verified live
    // 2026-08-07: this was the actual bug before this fix).
    await reconnectConnection(db, connectionId, {
      displayName: existingConnection.displayName,
      externalAccountLookupHash: lookupHash,
      externalAccountMasked: maskedOpenId,
      accessTokenExpiresAt: new Date(verified.accessTokenExpiresAt),
      lastVerifiedAt: new Date(),
    });

    console.log(
      `[bootstrap] Connection ${connectionId} already exists for the same CJ account - refreshed its stored credential, reconnected, and continuing to backfill.`,
    );
  } else {
    const created = await insertConnection(db, {
      sellerAccountId: sellerAccount.id,
      providerId: provider.id,
      displayName: 'CJ Dropshipping (Sals3 Official)',
      externalAccountLookupHash: lookupHash,
      externalAccountMasked: maskedOpenId,
      status: 'CONNECTED',
      accessTokenExpiresAt: new Date(verified.accessTokenExpiresAt),
      lastVerifiedAt: new Date(),
    });

    connectionId = created.id;
    console.log(`[bootstrap] Created connection ${connectionId}.`);
  }

  const encrypted = encryptSupplierCredential(
    JSON.stringify({
      apiKey,
      openId: verified.openId,
      accessToken: verified.accessToken,
      accessTokenExpiresAt: new Date(
        verified.accessTokenExpiresAt,
      ).toISOString(),
      refreshToken: verified.refreshToken,
      refreshTokenExpiresAt: new Date(
        verified.refreshTokenExpiresAt,
      ).toISOString(),
    }),
    { connectionId, providerCode: provider.code, keyVersion: KEY_VERSION },
  );

  await db
    .insert(supplierConnectionSecrets)
    .values({
      connectionId,
      ciphertextBase64: encrypted.ciphertextBase64,
      ivBase64: encrypted.ivBase64,
      authTagBase64: encrypted.authTagBase64,
      keyVersion: encrypted.keyVersion,
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

  const beforeCount = await db
    .select({ id: supplierCandidates.id })
    .from(supplierCandidates)
    .where(isNull(supplierCandidates.supplierConnectionId));

  await db
    .update(supplierCandidates)
    .set({ supplierConnectionId: connectionId, updatedAt: new Date() })
    .where(isNull(supplierCandidates.supplierConnectionId));

  const remainingNull = await db
    .select({ id: supplierCandidates.id })
    .from(supplierCandidates)
    .where(isNull(supplierCandidates.supplierConnectionId));

  if (remainingNull.length > 0) {
    throw new Error(
      `${remainingNull.length} candidate row(s) still have no supplier_connection_id after backfill.`,
    );
  }

  await db.insert(auditEvents).values({
    actorId: 'system:bootstrap-sals3-official-cj',
    action: 'supplier_connection.bootstrapped',
    entityType: 'SupplierConnection',
    entityId: connectionId,
    payload: {
      sellerAccountId: sellerAccount.id,
      providerCode: provider.code,
      backfilledCandidateCount: beforeCount.length,
    },
  });

  console.log('[bootstrap] Done.');
  console.log(`  sellerAccountId: ${sellerAccount.id}`);
  console.log(`  providerId: ${provider.id}`);
  console.log(`  connectionId: ${connectionId}`);
  console.log(`  candidates backfilled: ${beforeCount.length}`);
  console.log('  candidates remaining without a connection: 0');
}

async function main(): Promise<void> {
  if (isProduction() && process.env.BOOTSTRAP_SALS3_OFFICIAL_CJ !== 'true') {
    throw new Error(
      'Refusing to run in production without BOOTSTRAP_SALS3_OFFICIAL_CJ=true.',
    );
  }

  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is not set - nothing to bootstrap against.');
  }

  const apiKey = process.env.CJ_API_KEY;

  if (apiKey === undefined || apiKey.trim() === '') {
    throw new Error('CJ_API_KEY is not set.');
  }

  const { db, close } = createScriptDb();

  try {
    await runBootstrap(db, apiKey);
  } finally {
    await close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(
      '[bootstrap] Failed:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
