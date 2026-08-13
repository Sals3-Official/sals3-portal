'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { LISTINGS_PATH } from '@/lib/portal/listings-params';
import archiveProduct, {
  type ArchiveOutcome,
} from '@/modules/catalog/products/archive-product';
import authorizeDraftAction from './draft-action-auth';

/**
 * Archive, for one product or a selection of them.
 *
 * Reuses `authorizeDraftAction` - the same permission, business-model and
 * rate-limit gate the draft actions run - so there is exactly one place that
 * decides who may mutate this seller's catalogue.
 *
 * Sequential, one transaction per product, for the same reason the bulk draft
 * action is: N concurrent transactions pin N pooled connections while the page
 * still needs some. Each product's outcome is returned separately, because
 * "archived 3, 1 was already archived, 1 lost a race" is the truth and a single
 * boolean is not.
 */

const ARCHIVE_RATE_LIMIT = { capacity: 20, refillIntervalMs: 60_000 };

const archiveInputSchema = z.object({
  productIds: z.array(z.string().uuid()).min(1).max(25),
});

export type ArchiveProductsResult =
  | { ok: true; outcomes: ArchiveOutcome[] }
  | {
      ok: false;
      reason: 'invalid_input' | 'denied' | 'rate_limited' | 'not_configured';
    };

export default async function archiveProductsAction(
  input: unknown,
): Promise<ArchiveProductsResult> {
  const parsed = archiveInputSchema.safeParse(input);

  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorizeDraftAction(
    'product:import',
    'catalog-product:archive',
    ARCHIVE_RATE_LIMIT,
  );

  if (!auth.ok) return auth;

  const outcomes: ArchiveOutcome[] = [];

  // One transaction per product, deliberately not concurrent - see module doc.
  // eslint-disable-next-line no-restricted-syntax -- matches bulk-draft-action.
  for (const productId of parsed.data.productIds) {
    /* eslint-disable no-await-in-loop -- sequential by design, same reason. */
    outcomes.push(
      await archiveProduct({
        sellerAccountId: auth.sellerAccountId,
        productId,
        actorId: auth.actorId,
      }),
    );
    /* eslint-enable no-await-in-loop */
  }

  if (outcomes.some((outcome) => outcome.kind === 'archived'))
    revalidatePath(LISTINGS_PATH);

  return { ok: true, outcomes };
}
