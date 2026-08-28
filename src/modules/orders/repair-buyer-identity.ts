import 'server-only';

import { eq } from 'drizzle-orm';
import getDb, { type DbExecutor } from '@/lib/db/client';
import { checkoutIntents, sals3Orders } from '@/lib/db/schema';

/**
 * Repoints one order's contact address at the account that actually paid for it.
 *
 * Exists for the orders stranded before `buyer_uid` existed. Until 2026-08-28
 * the only identity on an order was `buyer_email` — the address typed into the
 * checkout form — so a buyer who typed anything other than their account
 * address paid for an order that then vanished from their list and refused them
 * their own receipt. `buyer_uid` stops it happening again; it cannot reach back
 * and rescue a row that never recorded one.
 *
 * Deliberately narrow:
 *
 * - **One order at a time, named explicitly.** No pattern, no batch, no
 *   "everything that looks unmatched" — a wrong guess here hands one person's
 *   order to another account.
 * - **Refuses a row that already has a `buyer_uid`.** Those authorize by uid
 *   alone, so rewriting the email would change nothing and imply otherwise.
 * - **Returns the address it replaced.** The operator sees what actually
 *   changed rather than trusting a 200.
 *
 * The intent row is updated alongside the order so the two cannot disagree
 * about who the buyer was.
 */
export type RepairBuyerIdentityResult =
  | {
      ok: true;
      orderNumber: string;
      previousEmail: string;
      buyerEmail: string;
      changed: boolean;
    }
  | { ok: false; reason: 'order-not-found' | 'order-has-uid' };

export default async function repairBuyerIdentity(
  input: { orderNumber: string; buyerEmail: string },
  options: { executor?: DbExecutor } = {},
): Promise<RepairBuyerIdentityResult> {
  const executor = options.executor ?? getDb();
  const orderNumber = input.orderNumber.trim().toUpperCase();
  const buyerEmail = input.buyerEmail.trim();

  const [order] = await executor
    .select({
      id: sals3Orders.id,
      checkoutIntentId: sals3Orders.checkoutIntentId,
      buyerEmail: sals3Orders.buyerEmail,
      buyerUid: sals3Orders.buyerUid,
    })
    .from(sals3Orders)
    .where(eq(sals3Orders.orderNumber, orderNumber))
    .limit(1);

  if (order === undefined) return { ok: false, reason: 'order-not-found' };
  if (order.buyerUid !== null) return { ok: false, reason: 'order-has-uid' };

  const changed = order.buyerEmail.toLowerCase() !== buyerEmail.toLowerCase();

  await executor
    .update(sals3Orders)
    .set({ buyerEmail, updatedAt: new Date() })
    .where(eq(sals3Orders.id, order.id));

  await executor
    .update(checkoutIntents)
    .set({ buyerEmail, updatedAt: new Date() })
    .where(eq(checkoutIntents.id, order.checkoutIntentId));

  return {
    ok: true,
    orderNumber,
    previousEmail: order.buyerEmail,
    buyerEmail,
    changed,
  };
}
