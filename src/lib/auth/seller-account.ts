import { cache } from 'react';
import getDb from '@/lib/db/client';
import { findSellerAccountByIdentityId } from '@/modules/suppliers/repository';
import type { SellerAccountRow } from '@/lib/db/schema';

/**
 * The one request-scoped read of a seller account by its identity.
 *
 * Measured before this existed: one render of `/products/pipeline` read the SAME
 * `seller_accounts` row **three times** - once for the layout's `getSession()`,
 * once for `requireDropshipperAccount`'s own `getSession()`, and once for its
 * explicit lookup. `shell-data.ts`'s doc comment already asked for this
 * ("reuse that identity here instead of doing another `getSession()` + seller
 * lookup on every navigation"); `React.cache` makes it true rather than
 * aspirational.
 *
 * ## Why the wrapper, and not `cache(findSellerAccountByIdentityId)`
 *
 * That function takes a `DbExecutor` as its first argument, and
 * `insertSellerAccountIfAbsent` calls it with a transaction. `React.cache` keys
 * on argument identity, and `getDb()` is a `globalThis` singleton - so the
 * pooled case WOULD hit, and a read inside a transaction that must see its own
 * uncommitted insert would be served the pre-insert memo instead. Keying on the
 * identity id alone, with the executor closed over, cannot make that mistake.
 *
 * Callers outside a request (scripts, the evaluator) must keep using the
 * repository function directly - `cache` outside a render scope simply calls
 * through, so it is harmless there, but this module exists to serve renders.
 */
const readSellerAccountForIdentity = cache(
  async (identityId: string): Promise<SellerAccountRow | null> =>
    findSellerAccountByIdentityId(getDb(), identityId),
);

export default readSellerAccountForIdentity;
