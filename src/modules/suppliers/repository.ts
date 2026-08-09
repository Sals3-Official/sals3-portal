import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  sellerAccounts,
  supplierConnections,
  supplierProviders,
  type NewSellerAccountRow,
  type NewSupplierConnectionRow,
  type SellerAccountRow,
  type SupplierConnectionRow,
  type SupplierProviderRow,
} from '@/lib/db/schema';

/**
 * Data access for seller accounts, providers, and connections. Every
 * seller-facing read takes an explicit `sellerAccountId` and enforces it in
 * the same `WHERE` clause as the lookup key - never a separate
 * check-then-fetch, per the tenant-scoped query pattern this module exists
 * to enforce.
 */

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

export async function findSellerAccountByIdentityId(
  executor: Executor,
  identityId: string,
): Promise<SellerAccountRow | null> {
  const rows = await executor
    .select()
    .from(sellerAccounts)
    .where(eq(sellerAccounts.identityId, identityId))
    .limit(1);

  return rows[0] ?? null;
}

/** Bootstrap-only: creates the seller account once, idempotent on `identityId`. */
export async function insertSellerAccountIfAbsent(
  executor: Executor,
  input: NewSellerAccountRow,
): Promise<SellerAccountRow> {
  const inserted = await executor
    .insert(sellerAccounts)
    .values(input)
    .onConflictDoNothing({ target: sellerAccounts.identityId })
    .returning();

  if (inserted[0] !== undefined) return inserted[0];

  const existing = await findSellerAccountByIdentityId(
    executor,
    input.identityId,
  );

  if (existing === null) {
    throw new Error(
      'Seller account conflicted on insert but could not be read back.',
    );
  }

  return existing;
}

export async function findProviderByCode(
  executor: Executor,
  code: string,
): Promise<SupplierProviderRow | null> {
  const rows = await executor
    .select()
    .from(supplierProviders)
    .where(eq(supplierProviders.code, code))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Every provider a seller could connect to today - the real source for the
 * Supplier Apps "Available" section. Never hardcode a provider list here;
 * `supplier_providers` seeds only real, owner-approved adapters (see that
 * table's own header comment), so an empty result is a real "nothing else
 * is approved yet", not a gap to fill with an illustrative name.
 */
export async function listActiveProviders(
  executor: Executor,
): Promise<SupplierProviderRow[]> {
  return executor
    .select()
    .from(supplierProviders)
    .where(eq(supplierProviders.status, 'ACTIVE'));
}

/** Bootstrap-only: seeds a provider row once, idempotent on `code`. */
export async function insertProviderIfAbsent(
  executor: Executor,
  input: {
    code: string;
    displayName: string;
    capabilities: SupplierProviderRow['capabilities'];
  },
): Promise<SupplierProviderRow> {
  const inserted = await executor
    .insert(supplierProviders)
    .values(input)
    .onConflictDoNothing({ target: supplierProviders.code })
    .returning();

  if (inserted[0] !== undefined) return inserted[0];

  const existing = await findProviderByCode(executor, input.code);

  if (existing === null) {
    throw new Error(
      'Provider conflicted on insert but could not be read back.',
    );
  }

  return existing;
}

export async function findConnectionBySellerAndProvider(
  executor: Executor,
  sellerAccountId: string,
  providerId: string,
): Promise<SupplierConnectionRow | null> {
  const rows = await executor
    .select()
    .from(supplierConnections)
    .where(
      and(
        eq(supplierConnections.sellerAccountId, sellerAccountId),
        eq(supplierConnections.providerId, providerId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Every connection this seller has, across every provider and status - the
 * real source for the Supplier Apps "Installed" section. A reauth-required
 * or disconnected connection still belongs here (Reconnect, not a fresh
 * Connect) - only a provider with no row at all is "Available".
 */
export async function listConnectionsBySeller(
  executor: Executor,
  sellerAccountId: string,
): Promise<SupplierConnectionRow[]> {
  return executor
    .select()
    .from(supplierConnections)
    .where(eq(supplierConnections.sellerAccountId, sellerAccountId));
}

export async function findConnectionByProviderAndHash(
  executor: Executor,
  providerId: string,
  externalAccountLookupHash: string,
  excludeConnectionId?: string,
): Promise<SupplierConnectionRow | null> {
  const rows = await executor
    .select()
    .from(supplierConnections)
    .where(
      and(
        eq(supplierConnections.providerId, providerId),
        eq(
          supplierConnections.externalAccountLookupHash,
          externalAccountLookupHash,
        ),
        excludeConnectionId === undefined
          ? undefined
          : ne(supplierConnections.id, excludeConnectionId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function insertConnection(
  executor: Executor,
  input: NewSupplierConnectionRow,
): Promise<SupplierConnectionRow> {
  const inserted = await executor
    .insert(supplierConnections)
    .values(input)
    .returning();

  return inserted[0];
}

/**
 * The statuses a connection may hold while system code sources through it.
 * `DEGRADED` stays workable on purpose: a transient upstream wobble should
 * not stop ingestion or the storefront feed; only an explicit disconnect,
 * revocation, or required re-auth does.
 */
export const WORKABLE_CONNECTION_STATUSES = [
  'CONNECTED',
  'DEGRADED',
] as const satisfies readonly SupplierConnectionRow['status'][];

export function isWorkableConnectionStatus(
  status: SupplierConnectionRow['status'],
): boolean {
  return (WORKABLE_CONNECTION_STATUSES as readonly string[]).includes(status);
}

/**
 * System-internal (not seller-scoped): the automation pipeline needs every
 * connection in a workable state, across every seller, to know what to
 * ingest/evaluate. Never used by a seller-facing page or Server Action.
 */
export async function listWorkableConnections(
  executor: Executor,
): Promise<SupplierConnectionRow[]> {
  return executor
    .select()
    .from(supplierConnections)
    .where(
      inArray(supplierConnections.status, [...WORKABLE_CONNECTION_STATUSES]),
    );
}

export async function findConnectionById(
  executor: Executor,
  connectionId: string,
): Promise<SupplierConnectionRow | null> {
  const rows = await executor
    .select()
    .from(supplierConnections)
    .where(eq(supplierConnections.id, connectionId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Seller-initiated disconnect. Soft: the row (and its encrypted secret)
 * stays, so history/audit and the `restrict` FK from `supplier_candidates`
 * are untouched - only the status flips, which is what
 * `listWorkableConnections` already filters on to stop the automation
 * pipeline from sourcing through it. Fully reversible via
 * `reconnectConnection`.
 */
export async function disconnectConnection(
  executor: Executor,
  connectionId: string,
): Promise<void> {
  await executor
    .update(supplierConnections)
    .set({
      status: 'DISCONNECTED',
      disconnectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(supplierConnections.id, connectionId));
}

/**
 * Re-activates an existing (DISCONNECTED/REVOKED/REAUTH_REQUIRED) connection
 * row in place, rather than inserting a second row - the
 * `(sellerAccountId, providerId)` unique index only allows one connection
 * per seller per provider, so "add it again" after a disconnect must update
 * the same row, not create a new one.
 */
export async function reconnectConnection(
  executor: Executor,
  connectionId: string,
  input: {
    displayName: string;
    externalAccountLookupHash: string;
    externalAccountMasked: string;
    accessTokenExpiresAt: Date;
    lastVerifiedAt: Date;
  },
): Promise<SupplierConnectionRow> {
  const updated = await executor
    .update(supplierConnections)
    .set({
      status: 'CONNECTED',
      disconnectedAt: null,
      lastErrorCode: null,
      displayName: input.displayName,
      externalAccountLookupHash: input.externalAccountLookupHash,
      externalAccountMasked: input.externalAccountMasked,
      accessTokenExpiresAt: input.accessTokenExpiresAt,
      lastVerifiedAt: input.lastVerifiedAt,
      updatedAt: new Date(),
    })
    .where(eq(supplierConnections.id, connectionId))
    .returning();

  if (updated[0] === undefined) {
    throw new Error('Connection disappeared during reconnect.');
  }

  return updated[0];
}

export async function updateConnectionHealth(
  executor: Executor,
  connectionId: string,
  input: {
    status: SupplierConnectionRow['status'];
    lastVerifiedAt?: Date;
    lastErrorCode?: string | null;
  },
): Promise<void> {
  await executor
    .update(supplierConnections)
    .set({
      status: input.status,
      lastVerifiedAt: input.lastVerifiedAt,
      lastErrorCode: input.lastErrorCode ?? null,
      updatedAt: new Date(),
    })
    .where(eq(supplierConnections.id, connectionId));
}
