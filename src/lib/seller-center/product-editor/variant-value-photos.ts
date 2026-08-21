import type { MappedOptionAxis } from '@/lib/seller-center/product-catalogue/types';
import type { VariantFixture, VariantMatrixValuePhoto } from './types';

/**
 * Which photo stands against each saved Variant Matrix value, and which variant
 * it is really pinned to.
 *
 * Pure, and derived from state the editor already holds: the saved axes carry
 * `variantIds` from `product_variant_option_values`, and `variants` carries each
 * variant's own photo. Nothing is stored per option value and nothing needs to
 * be — see `VariantValuePhotoStrip` for why that column is not being added.
 *
 * ## Which variant represents a value
 *
 * The first carrying variant **that already has a photo**, in the order the
 * editor lists variants. A value whose variants are all photoless still gets an
 * entry, pointed at the first of them, because that is the row a seller means
 * when they press an empty chip on a single-variant value.
 *
 * `variantCount` counts only carrying variants the editor actually knows about.
 * A `variantIds` entry with no matching row is dropped rather than counted: it
 * would inflate the count that decides whether a chip is a control, and a value
 * would silently stop being assignable.
 */
export default function resolveVariantValuePhotos(
  axes: MappedOptionAxis[],
  variants: VariantFixture[],
): Record<string, VariantMatrixValuePhoto> {
  if (axes.length === 0 || variants.length === 0) return {};

  const byId = new Map(variants.map((variant) => [variant.id, variant]));

  return Object.fromEntries(
    axes
      .flatMap((axis) => axis.values)
      .map((value) => {
        const carrying = (value.variantIds ?? [])
          .map((variantId) => byId.get(variantId))
          .filter(
            (variant): variant is VariantFixture => variant !== undefined,
          );
        const representative =
          carrying.find(
            (variant) =>
              variant.imageUrl !== null && variant.imageUrl !== undefined,
          ) ?? carrying[0];

        if (representative === undefined) return null;

        const photo: VariantMatrixValuePhoto = {
          variantId: representative.id,
          variantLabel: representative.optionLabel,
          imageUrl: representative.imageUrl ?? null,
          mediaId: representative.imageMediaId ?? null,
          variantCount: carrying.length,
        };

        return [value.valueId, photo] as const;
      })
      .filter(
        (entry): entry is readonly [string, VariantMatrixValuePhoto] =>
          entry !== null,
      ),
  );
}
