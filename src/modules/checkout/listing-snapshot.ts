import { z } from 'zod';
import type { DbExecutor } from '@/lib/db/client';
import { descriptionBlockSchema } from '@/modules/catalog/products/description-document';
import {
  findPublishedProductBySlug,
  type StorefrontDetailRow,
} from '@/modules/catalog/storefront/read-model';

/**
 * What the buyer saw, frozen onto the order line.
 *
 * ## The rule this implements
 *
 * Owner decision 2026-08-21: an order freezes **every** buyer-visible listing
 * detail, and a seller's later edit applies to new orders only. A seller may
 * rename a product, replace every photo, rewrite the description, reorder the
 * option axes — all of which they are entitled to do — and none of it may change
 * what someone who already bought it is shown they bought.
 *
 * `title`, `variant_label`, and `image_url` were already frozen per line
 * (ADR-007). Everything else on the product page was read live. This is the rest
 * of it.
 *
 * ## Sourced from the storefront read model, not from a second set of joins
 *
 * `findPublishedProductBySlug` is the exact projection `/api/storefront` served
 * the buyer. Re-deriving these fields from the catalogue tables here would mean
 * two queries that are supposed to agree about what a product page says, and the
 * one that drifts would be this one — silently, since nothing renders it until
 * someone opens an old order. Reading the same function means the snapshot is
 * the page, by construction.
 *
 * It is also why this captures the *published* state rather than the draft: that
 * projection reads `products.published_revision_id`, so an unpublished edit in
 * progress is not what gets frozen.
 *
 * ## Costs nothing at the supplier
 *
 * Local reads only. No CJ call, no points (ADR-017, and the checkout path
 * already spends its supplier budget on freight).
 */

export const LISTING_SNAPSHOT_VERSION = 1;

/**
 * Lenient on read, exact on write.
 *
 * Every field is optional or nullable because this parses rows written by older
 * deployments, and a buyer's order page must never fail because a snapshot from
 * three months ago lacks a field added since. `safeParse` plus a `null` fallback
 * at the call site is the contract: an unreadable snapshot degrades to the three
 * frozen columns, it does not throw.
 */
export const listingSnapshotSchema = z.object({
  version: z.number().int().positive(),
  /** The public path the buyer bought from, for support to retrace. */
  productSlug: z.string().min(1),
  title: z.string().min(1),
  categoryPath: z.string().nullable(),
  /**
   * The option axes as the seller had named and ordered them — `Colour: Army
   * Green`, `Size: XL` — not the supplier's own concatenated token, which stays
   * in `variant_label`. This is the field the reorder and rename work makes
   * mutable, and therefore the one that most needs freezing.
   */
  options: z.array(z.object({ name: z.string(), value: z.string() })),
  /** The whole gallery the buyer could page through, in the order shown. */
  imageUrls: z.array(z.string()),
  /** The published description document, blocks verbatim. */
  description: z.object({ blocks: z.array(descriptionBlockSchema) }).nullable(),
  /**
   * The seller's own answers to their category's attribute set, label and value
   * exactly as the product page listed them.
   */
  specification: z
    .array(z.object({ label: z.string(), value: z.string() }))
    .nullable(),
  /** Supplier-reported physical facts, plus brand and condition. */
  specs: z
    .object({
      weightGrams: z.number().nullable(),
      lengthMillimeters: z.number().nullable(),
      widthMillimeters: z.number().nullable(),
      heightMillimeters: z.number().nullable(),
      gtins: z.array(z.string()).nullable(),
      mpn: z.string().nullable(),
      brand: z.string().nullable(),
      condition: z.string().nullable(),
    })
    .nullable(),
});

export type ListingSnapshot = z.infer<typeof listingSnapshotSchema>;

function nullable<T>(value: T | undefined): T | null {
  return value ?? null;
}

/**
 * One product page plus the variant the buyer chose, as a snapshot.
 *
 * Pure, so the shape is testable without a database and without a checkout.
 * Returns `null` when the product is no longer published — the caller stores no
 * snapshot rather than an empty one, and the line still carries its three frozen
 * columns.
 */
export function listingSnapshotOf(
  detail: StorefrontDetailRow | null,
  variantId: string,
): ListingSnapshot | null {
  if (detail === null) return null;

  const variant = detail.variants?.find((item) => item.id === variantId);
  const specs = detail.specs ?? null;

  return {
    version: LISTING_SNAPSHOT_VERSION,
    productSlug: detail.slug,
    title: detail.title,
    categoryPath: detail.categoryPath,
    // Empty for a product with no axes — one implicit variant, and the buyer
    // chose nothing. Empty is the honest record of that, not a missing field.
    options: variant?.options ?? [],
    imageUrls: detail.images.map((image) => image.url),
    description: detail.description === undefined ? null : detail.description,
    specification:
      detail.specification === undefined
        ? null
        : detail.specification.map((entry) => ({
            label: entry.label,
            value: entry.value,
          })),
    specs:
      specs === null
        ? null
        : {
            weightGrams: nullable(specs.weightGrams),
            lengthMillimeters: nullable(specs.lengthMillimeters),
            widthMillimeters: nullable(specs.widthMillimeters),
            heightMillimeters: nullable(specs.heightMillimeters),
            gtins: nullable(specs.gtins),
            mpn: nullable(specs.mpn),
            brand: nullable(specs.brand),
            condition: nullable(specs.condition),
          },
  };
}

/** The cart-line identity a snapshot is stored against. */
export function listingSnapshotKey(line: {
  slug: string;
  variantId: string;
}): string {
  return `${line.slug}|${line.variantId}`;
}

/**
 * Snapshots for every line of one checkout, keyed by `slug|variantId`.
 *
 * One read per **distinct product**, not per line: a cart holding three sizes of
 * one shirt is one product page, and fetching it three times would triple the
 * work to produce three identical documents. The variant-specific part is picked
 * from that one payload afterwards.
 */
export async function loadListingSnapshots(
  lines: { slug: string; variantId: string }[],
  executor: DbExecutor,
): Promise<Map<string, ListingSnapshot>> {
  const slugs = [...new Set(lines.map((line) => line.slug))];
  const details = await Promise.all(
    slugs.map(
      async (slug) =>
        [slug, await findPublishedProductBySlug(slug, executor)] as const,
    ),
  );
  const bySlug = new Map(details);
  const snapshots = new Map<string, ListingSnapshot>();

  lines.forEach((line) => {
    const snapshot = listingSnapshotOf(
      bySlug.get(line.slug) ?? null,
      line.variantId,
    );

    if (snapshot !== null) {
      snapshots.set(listingSnapshotKey(line), snapshot);
    }
  });

  return snapshots;
}
