import { revalidateTag, updateTag } from 'next/cache';
import { after } from 'next/server';
import revalidateListingViews from '@/app/(portal)/listings/revalidate-listing-views';
import { STOREFRONT_CATALOG_TAG } from '@/lib/storefront/catalog-cache';

/**
 * The two side effects a successful publish or unpublish always triggers,
 * shared between `publish-actions.ts` (the seller-session Server Action) and
 * `/api/internal/products/[id]/publish` (the internal-API route) so they
 * cannot silently drift into two different notions of "published" -
 * `AGENTS.md`'s recurring lesson this session about a rule that exists in
 * two places instead of one.
 *
 * Extracted rather than duplicated: a `'use server'` file may only export
 * async functions (Next.js's own constraint on Server Action files), so
 * these plain helpers could not live in `publish-actions.ts` and still be
 * importable from a route handler.
 *
 * **Two cache-invalidation variants, not one - confirmed live 2026-09-02.**
 * `updateTag` throws `"updateTag can only be called from within a Server
 * Action"` when the call reaches it from a Route Handler's request context,
 * even though the *function* it is called through was already shared code.
 * Next resolves this by call-stack context, not by which file the code is
 * defined in - moving the code here did not itself break the Server Action
 * caller (confirmed: the full suite still passes with this file in place),
 * but it meant a Route Handler caller needed its own entry point rather
 * than silently 500ing on every publish.
 */

/**
 * Invalidating the storefront cache is what makes a publish visible now
 * rather than up to 30 seconds later. Call this from a Server Action.
 *
 * `updateTag`, not `revalidateTag`: Next's own docs reserve the former for
 * immediate expiration inside a Server Action, which is exactly this case
 * - a seller who pauses a mispriced product must not keep seeing it live.
 * Called after the domain module's own transaction commits, never before -
 * announcing a change that could still roll back would publish a state that
 * never actually landed.
 */
export function revalidateAfterPublicationChange(): void {
  updateTag(STOREFRONT_CATALOG_TAG);
  revalidateListingViews();
}

/**
 * The same invalidation as `revalidateAfterPublicationChange`, for a caller
 * that is a Route Handler rather than a Server Action - `updateTag` is not
 * reachable from there at all (see this module's doc comment).
 * `revalidateTag` gives up the "immediate" guarantee `updateTag` documents
 * for itself; the tradeoff is accepted here because the internal API's own
 * caller already treats a write-then-verify read as the real proof of a
 * change (matching this whole project's own `AGENTS.md` Rule 2 - "a green
 * tick is not evidence, a reload is"), not the response body alone.
 */
export function revalidateAfterPublicationChangeFromRouteHandler(): void {
  // `'max'`: the same profile every other Route Handler in this codebase
  // already passes for this exact tag (`api/storefront/reviews/route.ts`,
  // `api/internal/catalog/evaluate-tick/route.ts`) - this Next.js version
  // requires a cache-life profile as `revalidateTag`'s second argument.
  revalidateTag(STOREFRONT_CATALOG_TAG, 'max');
  revalidateListingViews();
}

/**
 * Take a durable copy of a newly published product's supplier photos, after
 * the response has gone out.
 *
 * ADR-007's `Media locking` requires an accepted order to keep showing the
 * media it was accepted with, and a CJ CDN address does not guarantee that:
 * CJ may replace or delete the file behind its own URL. Publication is the
 * moment that matters, because from here the product is orderable.
 *
 * `after()` rather than an `await`: this reads up to a dozen files off CJ's
 * CDN, and a slow CDN must not turn a successful publish into a timeout.
 * Best-effort rather than a publish gate for the same reason - a listing
 * that is otherwise ready should not become unpublishable because a CDN
 * blinked. Whatever is not copied here stays on the
 * `Products Backfill Media Copies` sweeper's list, and until a copy exists
 * every read path falls back to the supplier address exactly as it did
 * before: the old behaviour, not a new failure.
 *
 * Only on publish. Pausing or delisting shares
 * `revalidateAfterPublicationChange` but has nothing to copy.
 */
export function mirrorSupplierMediaAfterResponse(productId: string): void {
  after(async () => {
    try {
      const { default: mirrorSupplierMediaForProduct } =
        await import('@/modules/catalog/products/mirror-supplier-media');
      const outcome = await mirrorSupplierMediaForProduct({ productId });

      if (outcome.failures.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('[portal] supplier media not fully mirrored on publish', {
          productId,
          mirrored: outcome.mirrored,
          failures: outcome.failures.length,
        });
      }
    } catch (error) {
      // The listing published and the sweeper still owns the copy, so this
      // is logged rather than surfaced - but never swallowed silently.
      // eslint-disable-next-line no-console
      console.error('[portal] supplier media mirror failed after publish', {
        productId,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  });
}
