import { eq } from 'drizzle-orm';
import getDb from '@/lib/db/client';
import { productVariants, providerVariantReferences } from '@/lib/db/schema';
import deriveAxesProposal, { type DerivedAxis } from './derive-axes-proposal';
import saveOptionMapping, {
  type SaveOptionMappingRefusal,
} from './save-option-mapping';

/**
 * Derive AND save a product's option mapping in one server-side step - the
 * internal API's `auto: true` mode.
 *
 * The client used to compute the axes itself and send them; that computation
 * (`derive_axes_payload`) split labels on the FIRST dash while the server
 * splits on every one - a drift that had not bitten only because no product
 * had hit it yet. Deriving here, from the same
 * `provider_variant_references.source_option_label` rows `saveOptionMapping`
 * itself re-derives from inside its transaction, removes the second
 * implementation entirely.
 *
 * `not_derivable` is a normal answer, not an error: labels that do not
 * encode a clean split, and shapes the naming heuristic refuses (see
 * `derive-axes-proposal.ts`), are mapped by hand in the editor.
 */

export type AutoMapOptionsResult =
  | {
      ok: true;
      axes: DerivedAxis[];
      axisCount: number;
      mappedVariantCount: number;
    }
  | {
      ok: false;
      reason: 'not_derivable' | SaveOptionMappingRefusal;
      detail?: string;
    };

export default async function autoMapOptions(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  expectedProductVersion: number;
}): Promise<AutoMapOptionsResult> {
  const db = getDb();

  // The same rows `saveOptionMapping.loadVariantLabels` reads - variant id
  // plus the supplier's verbatim label, at most one reference per variant.
  const rows = await db
    .select({
      variantId: productVariants.id,
      label: providerVariantReferences.sourceOptionLabel,
    })
    .from(productVariants)
    .leftJoin(
      providerVariantReferences,
      eq(providerVariantReferences.variantId, productVariants.id),
    )
    .where(eq(productVariants.productId, input.productId));

  const axes = deriveAxesProposal(rows);

  if (axes === null) {
    return {
      ok: false,
      reason: 'not_derivable',
      detail:
        'the variant labels do not derive to nameable axes - map this ' +
        'product by hand in the editor',
    };
  }

  const result = await saveOptionMapping({
    productId: input.productId,
    sellerAccountId: input.sellerAccountId,
    actorId: input.actorId,
    expectedProductVersion: input.expectedProductVersion,
    axes,
  });

  if (!result.ok) return result;

  return {
    ok: true,
    axes,
    axisCount: result.axisCount,
    mappedVariantCount: result.mappedVariantCount,
  };
}
