'use server';

import { createHash } from 'crypto';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import getDb from '@/lib/db/client';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { PermissionError } from '@/lib/auth/permissions';
import { checkRateLimit } from '@/lib/rate-limit';
import { cjAccessTokenSchema } from '@/lib/cj/schemas';
import { CJ_BASE_URL, CjApiError } from '@/services/cj/config';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import { cjCredentialBundleSchema } from '@/modules/suppliers/providers/cj/cj-schemas';
import {
  createStepUpChallenge,
  verifyStepUpChallenge,
} from '@/lib/security/step-up-challenge';
import {
  disconnectConnection,
  findConnectionByProviderAndHash,
  findConnectionBySellerAndProvider,
  findProviderByCode,
  insertConnection,
  reconnectConnection,
} from '@/modules/suppliers/repository';
import {
  appendAuditEvent,
  requeueConnectionPausedEvaluations,
} from '@/modules/catalog/candidates/repository';

/**
 * "Connect CJ" (ADR-008 Supplier Apps). The browser sends only an API key
 * and a display label - everything else (seller identity, provider
 * resolution, CJ validation, encryption) happens on the server, matching
 * the same "browser sends intent, server assembles the command" discipline
 * `checkForSals3Candidate`'s replacement already established.
 */

const RATE_LIMIT = { capacity: 5, refillIntervalMs: 60_000 };

/**
 * A connection in one of these statuses is not actively in use, so
 * reconnecting updates it in place instead of being blocked as
 * "already_connected" - see `reconnectConnection`'s own reasoning.
 */
const RECONNECTABLE_STATUSES = new Set([
  'DISCONNECTED',
  'REVOKED',
  'REAUTH_REQUIRED',
]);

const connectCjInputSchema = z.object({
  apiKey: z.string().trim().min(1).max(200),
  displayName: z.string().trim().min(1).max(80).default('CJ Dropshipping'),
});

export type ConnectCjResult =
  | { ok: true; connectionId: string; displayName: string; status: string }
  | {
      ok: false;
      reason:
        | 'invalid_input'
        | 'denied'
        | 'rate_limited'
        | 'already_connected'
        | 'provider_unavailable'
        | 'verification_failed'
        | 'failed';
    };

type VerifiedCjAuth = {
  openId: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
};

/**
 * Calls CJ's real `/authentication/getAccessToken` - verified live
 * 2026-08-07 to return `openId` (CJ's own stable per-account identifier),
 * `accessToken`, `refreshToken`, and both expiry dates in one response. No
 * separate account-info or refresh endpoint is needed or has been verified.
 */
async function verifyCjApiKey(apiKey: string): Promise<VerifiedCjAuth> {
  const response = await fetch(`${CJ_BASE_URL}/authentication/getAccessToken`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey }),
    cache: 'no-store',
  });

  if (!response.ok) throw new CjApiError('upstream-unavailable');

  const parsed = cjAccessTokenSchema.safeParse(await response.json());

  if (!parsed.success) {
    throw new CjApiError('unexpected-response');
  }

  if (parsed.data.code !== 200 || !parsed.data.data) {
    throw new CjApiError(
      parsed.data.code === 401
        ? 'authentication-failed'
        : 'unexpected-response',
    );
  }

  const { data } = parsed.data;

  if (data.openId === null) {
    throw new CjApiError('unexpected-response');
  }

  return {
    openId: String(data.openId),
    accessToken: data.accessToken,
    accessTokenExpiresAt: data.accessTokenExpiryDate,
    refreshToken: data.refreshToken,
    refreshTokenExpiresAt: data.refreshTokenExpiryDate,
  };
}

function maskOpenId(openId: string): string {
  return `CJ...${openId.slice(-4)}`;
}

export async function connectCjSupplier(
  input: unknown,
): Promise<ConnectCjResult> {
  const parsedInput = connectCjInputSchema.safeParse(input);

  if (!parsedInput.success) {
    return { ok: false, reason: 'invalid_input' };
  }

  let session;
  let sellerAccount;

  try {
    ({ session, sellerAccount } = await requireDropshipperAccount());
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, reason: 'denied' };
    throw error;
  }

  const limit = checkRateLimit(
    `connect-cj:${sellerAccount.id}:${session.userId}`,
    RATE_LIMIT,
  );
  if (!limit.allowed) {
    return { ok: false, reason: 'rate_limited' };
  }

  const provider = await findProviderByCode(getDb(), 'CJ_DROPSHIPPING');

  if (provider === null) {
    return { ok: false, reason: 'provider_unavailable' };
  }

  const existing = await findConnectionBySellerAndProvider(
    getDb(),
    sellerAccount.id,
    provider.id,
  );

  if (existing !== null && !RECONNECTABLE_STATUSES.has(existing.status)) {
    return { ok: false, reason: 'already_connected' };
  }

  let verified: VerifiedCjAuth;

  try {
    // CJ call happens outside any transaction, per this codebase's
    // established rule against holding a DB transaction across a
    // third-party round trip.
    verified = await verifyCjApiKey(parsedInput.data.apiKey);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] CJ connection verification failed', {
      sellerAccountId: sellerAccount.id,
      reason: error instanceof CjApiError ? error.reason : 'unknown',
    });
    return { ok: false, reason: 'verification_failed' };
  }

  const lookupHash = createHash('sha256')
    .update(`${provider.code}:${verified.openId}`)
    .digest('hex');

  // Excludes the connection being reconnected itself - re-verifying the same
  // CJ account it already belonged to must not read back as "another seller
  // already has this account", which is the real thing this check guards.
  const duplicateAccount = await findConnectionByProviderAndHash(
    getDb(),
    provider.id,
    lookupHash,
    existing?.id,
  );

  if (duplicateAccount !== null) {
    return { ok: false, reason: 'already_connected' };
  }

  const credentialBundle = cjCredentialBundleSchema.parse({
    apiKey: parsedInput.data.apiKey,
    openId: verified.openId,
    accessToken: verified.accessToken,
    accessTokenExpiresAt: verified.accessTokenExpiresAt,
    refreshToken: verified.refreshToken,
    refreshTokenExpiresAt: verified.refreshTokenExpiresAt,
  });

  try {
    const connection = await getDb().transaction(async (tx) => {
      const row =
        existing === null
          ? await insertConnection(tx, {
              sellerAccountId: sellerAccount.id,
              providerId: provider.id,
              displayName: parsedInput.data.displayName,
              externalAccountLookupHash: lookupHash,
              externalAccountMasked: maskOpenId(verified.openId),
              status: 'CONNECTED',
              accessTokenExpiresAt: new Date(verified.accessTokenExpiresAt),
              lastVerifiedAt: new Date(),
            })
          : await reconnectConnection(tx, existing.id, {
              displayName: parsedInput.data.displayName,
              externalAccountLookupHash: lookupHash,
              externalAccountMasked: maskOpenId(verified.openId),
              accessTokenExpiresAt: new Date(verified.accessTokenExpiresAt),
              lastVerifiedAt: new Date(),
            });

      // Encryption happens after the row's id is known, so the secret write
      // is the second statement in the same short transaction rather than a
      // separate one - both are fast, local Postgres operations with no
      // third-party call in between. `write` upserts, so this also
      // overwrites a reconnected connection's previous (now stale) secret.
      await new PostgresSupplierSecretStore().write(
        row.id,
        provider.code,
        credentialBundle,
      );

      // ADR-007: reconnect "performs a bounded requeue through Evaluating
      // before any row can return to Ready." Only meaningful on an actual
      // reconnect (`existing !== null`) - a brand-new connection cannot yet
      // own any paused candidate. Every affected row goes back through a
      // full re-evaluation (`QUEUED`, not straight to `PASS`), and only rows
      // this exact connection's own pause caused are touched.
      const requeuedEvaluationCount =
        existing === null
          ? 0
          : await requeueConnectionPausedEvaluations(tx, row.id);

      await appendAuditEvent(tx, {
        actorId: session.userId,
        action:
          existing === null
            ? 'supplier_connection.created'
            : 'supplier_connection.reconnected',
        entityType: 'SupplierConnection',
        entityId: row.id,
        payload: {
          sellerAccountId: sellerAccount.id,
          providerCode: provider.code,
          ...(existing === null ? {} : { requeuedEvaluationCount }),
        },
      });

      return row;
    });

    revalidatePath('/supplier-apps');

    return {
      ok: true,
      connectionId: connection.id,
      displayName: connection.displayName,
      status: connection.status,
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] CJ connection persistence failed', {
      sellerAccountId: sellerAccount.id,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

function disconnectChallengeKey(connectionId: string): string {
  return `disconnect-cj:${connectionId}`;
}

export type RequestDisconnectVerificationResult =
  | { ok: true; devCode?: string }
  | {
      ok: false;
      reason: 'denied' | 'rate_limited' | 'not_connected' | 'failed';
    };

/**
 * Step 1 of disconnecting: issues a short-lived, single-use verification
 * code the seller must type back before `disconnectCjSupplier` will act.
 * Disconnecting stops the automated pipeline from sourcing through this
 * connection (see `disconnectCjSupplier`'s own doc for what it does and does
 * not affect) - a single accidental click is an easy way to silently break
 * that, so it is gated like a destructive action even though the underlying
 * disconnect itself is soft and reversible.
 *
 * DELIVERY IS NOT WIRED YET. No email/SMS provider is connected, and there is
 * no real seller identity/contact info to send to either - this whole app
 * still runs on one `dev-user` placeholder (see `seller-guard.ts`). Outside
 * production, the code is returned directly in `devCode` so the flow is
 * fully testable today; in production it is generated and audited but never
 * delivered, which means disconnect is effectively unusable in production
 * until a real channel (email OTP, SMS, or an admin passphrase) is wired in
 * here - a deliberate, visible gap rather than a fake "verified" state.
 */
export async function requestCjDisconnectVerification(): Promise<RequestDisconnectVerificationResult> {
  let session;
  let sellerAccount;

  try {
    ({ session, sellerAccount } = await requireDropshipperAccount());
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, reason: 'denied' };
    throw error;
  }

  const limit = checkRateLimit(
    `disconnect-verify:${sellerAccount.id}:${session.userId}`,
    RATE_LIMIT,
  );
  if (!limit.allowed) {
    return { ok: false, reason: 'rate_limited' };
  }

  const provider = await findProviderByCode(getDb(), 'CJ_DROPSHIPPING');

  if (provider === null) {
    return { ok: false, reason: 'not_connected' };
  }

  const connection = await findConnectionBySellerAndProvider(
    getDb(),
    sellerAccount.id,
    provider.id,
  );

  if (connection === null || RECONNECTABLE_STATUSES.has(connection.status)) {
    return { ok: false, reason: 'not_connected' };
  }

  const { code } = createStepUpChallenge(disconnectChallengeKey(connection.id));

  await appendAuditEvent(getDb(), {
    actorId: session.userId,
    action: 'supplier_connection.disconnect_verification_requested',
    entityType: 'SupplierConnection',
    entityId: connection.id,
    payload: {
      sellerAccountId: sellerAccount.id,
      providerCode: provider.code,
    },
  });

  if (process.env.NODE_ENV === 'production') {
    return { ok: true };
  }

  return { ok: true, devCode: code };
}

export type DisconnectCjResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        'denied' | 'rate_limited' | 'not_connected' | 'invalid_code' | 'failed';
    };

/**
 * Disconnects the seller's own CJ connection (ADR-008). Soft: the row and
 * its encrypted secret stay - see `disconnectConnection`'s own reasoning -
 * so this is reversible through the same "Connect CJ" form afterwards
 * (`connectCjSupplier`'s reconnect branch). Requires a code from
 * `requestCjDisconnectVerification` first - never trusts the browser to
 * have gated this on its own.
 */
export async function disconnectCjSupplier(
  code: string,
): Promise<DisconnectCjResult> {
  let session;
  let sellerAccount;

  try {
    ({ session, sellerAccount } = await requireDropshipperAccount());
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, reason: 'denied' };
    throw error;
  }

  const limit = checkRateLimit(
    `disconnect-cj:${sellerAccount.id}:${session.userId}`,
    RATE_LIMIT,
  );
  if (!limit.allowed) {
    return { ok: false, reason: 'rate_limited' };
  }

  const provider = await findProviderByCode(getDb(), 'CJ_DROPSHIPPING');

  if (provider === null) {
    return { ok: false, reason: 'not_connected' };
  }

  const connection = await findConnectionBySellerAndProvider(
    getDb(),
    sellerAccount.id,
    provider.id,
  );

  if (connection === null || RECONNECTABLE_STATUSES.has(connection.status)) {
    return { ok: false, reason: 'not_connected' };
  }

  if (!verifyStepUpChallenge(disconnectChallengeKey(connection.id), code)) {
    return { ok: false, reason: 'invalid_code' };
  }

  try {
    await getDb().transaction(async (tx) => {
      await disconnectConnection(tx, connection.id);

      await appendAuditEvent(tx, {
        actorId: session.userId,
        action: 'supplier_connection.disconnected',
        entityType: 'SupplierConnection',
        entityId: connection.id,
        payload: {
          sellerAccountId: sellerAccount.id,
          providerCode: provider.code,
        },
      });
    });

    revalidatePath('/supplier-apps');

    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] CJ disconnect failed', {
      sellerAccountId: sellerAccount.id,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}
