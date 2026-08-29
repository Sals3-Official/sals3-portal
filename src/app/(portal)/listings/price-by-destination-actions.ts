'use server';

import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import type { DestinationPrice } from '@/modules/catalog/products/prices-by-destination';

/**
 * What one variant would be priced at in every destination this account sells
 * to, asked for when a seller actually wants to know.
 *
 * ## Why an action and not part of the page
 *
 * The Variants & Pricing table already resolves one market per variant, which is
 * about six queries each. Resolving every destination with the page would
 * multiply that by the destination count — roughly 1,100 queries to render a
 * table most sellers will never interrogate. This runs six, on hover or on
 * keyboard focus, for the one row somebody is looking at.
 *
 * ## Read-only, and still gated
 *
 * It writes nothing, so there is no revalidation and no audit event. It is
 * authorized and rate-limited anyway: it returns supplier-derived pricing for a
 * variant id, and a read that leaks another tenant's margins is a leak whether
 * or not it changed anything. `sellerAccountId` comes only from the session, and
 * the domain module scopes its own `WHERE` by it rather than filtering the row
 * after reading it.
 *
 * A variant this seller does not steward is `not_found`, exactly like one that
 * does not exist. Distinguishing them would answer "does this id belong to
 * somebody else", which is not a question a caller is entitled to have answered.
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control here even though nothing is mutated.
 */

/**
 * Higher than a write action's, because this fires from hovering a table row —
 * a seller comparing a dozen variants is behaving normally, not abusing it.
 * Still bounded: the work is six resolver calls, so an unbounded version would
 * be a cheap way to make the database do a lot.
 */
const RATE_LIMIT = { capacity: 120, refillIntervalMs: 60_000 };

const inputSchema = z.object({ variantId: z.string().uuid() });

export type PriceByDestinationResult =
  | { ok: true; destinations: DestinationPrice[] }
  | {
      ok: false;
      reason:
        | 'invalid_input'
        | 'denied'
        | 'rate_limited'
        | 'not_found'
        | 'unavailable'
        | 'failed';
    };

export default async function pricesByDestinationAction(
  input: unknown,
): Promise<PriceByDestinationResult> {
  const parsed = inputSchema.safeParse(input);

  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  let sellerAccountId: string;

  try {
    // The same permission the editor's other reads require. A seller who may
    // not open this product may not read its prices one destination at a time
    // either.
    const session = await requirePermission('product:edit');

    // ADR-006: this screen is the Dropshipper product editor, the same scope
    // `meta-description-actions.ts` and `media-actions.ts` hold to.
    if (session.sellerBusinessModel !== 'DROPSHIPPER') {
      return { ok: false, reason: 'denied' };
    }

    sellerAccountId = session.sellerId;
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, reason: 'denied' };

    throw error;
  }

  const limit = checkRateLimit(
    `prices-by-destination:${sellerAccountId}`,
    RATE_LIMIT,
  );

  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  /*
    Imported inside the call, not at module scope.

    The trigger for this action is a tooltip in a client component, so a
    top-level `db/client` import puts a server-only module in the client's graph
    — `db/client` throws on `typeof window !== 'undefined'` by design, and every
    test that merely *renders* the editor would have to mock this file to load
    at all. Deferring keeps the client graph to this shell. Same reason the
    break-glass routes defer their own domain imports.
  */
  const [
    { default: getDb, isDatabaseConfigured },
    { default: pricesByDestination },
  ] = await Promise.all([
    import('@/lib/db/client'),
    import('@/modules/catalog/products/prices-by-destination'),
  ]);

  if (!isDatabaseConfigured()) return { ok: false, reason: 'unavailable' };

  try {
    const destinations = await pricesByDestination(getDb(), {
      sellerAccountId,
      variantId: parsed.data.variantId,
    });

    if (destinations === null) return { ok: false, reason: 'not_found' };

    return { ok: true, destinations };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] prices by destination failed', {
      sellerAccountId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return { ok: false, reason: 'failed' };
  }
}
