import { revalidatePath } from 'next/cache';

/**
 * Every seller-facing view that reads a listing, invalidated as one subtree.
 *
 * ## The bug this exists to end
 *
 * Nine action files called `revalidatePath('/listings')` and the Product Editor
 * does not live there — it is `/listings/new?productId=…`, and the description
 * studio is `/listings/[productId]/description`. A bare path revalidates that
 * one page, so every editor write landed in Postgres and then read back stale:
 * the seller saw an optimistic value, `router.refresh()` re-requested a page
 * nothing had invalidated, and the old projection overwrote what they had just
 * done. Assigning a photo to a variant showed the thumbnail and then dropped it.
 *
 * `description-actions.ts` had already hit this and fixed it locally by adding a
 * second literal `revalidatePath('/listings/new')` — one file out of nine, and
 * the only reason description edits stuck while photo assignment did not.
 *
 * ## Why `'layout'` and not a list of paths
 *
 * The second argument revalidates the whole subtree under the segment, so this
 * covers `/listings`, `/listings/new`, and `/listings/[productId]/description`
 * without naming any of them — including the next editor route somebody adds.
 * A list of literals is a list that goes stale silently, which is exactly the
 * failure above: the paths were not wrong when they were written, they were
 * wrong once the editor moved.
 *
 * It invalidates more than the one page a given write touched. That cost is
 * real and it is small — these are authenticated, per-seller, uncached-by-CDN
 * screens whose data is a database read away — and it buys a rule that cannot
 * be half-applied.
 *
 * ## Not the storefront
 *
 * Published catalogue data is invalidated separately by
 * `updateTag(STOREFRONT_CATALOG_TAG)`, which callers still do for themselves.
 * A draft edit must not touch the buyer-facing cache: nothing here is published
 * until `publishProduct` says so.
 *
 * ## No `server-only` guard
 *
 * Its default export throws unconditionally outside Next's bundler condition,
 * and every caller here has a Vitest suite that imports it — adding the guard
 * failed nine test files at once for a protection the callers' own `'use server'`
 * directive already provides. Same reasoning `read-model.ts` records for itself.
 */
export default function revalidateListingViews(): void {
  revalidatePath('/listings', 'layout');
}
