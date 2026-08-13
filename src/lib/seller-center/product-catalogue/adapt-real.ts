import type {
  CatalogueVariantRowData,
  CataloguePricingSummary,
} from '@/modules/catalog/products/catalogue-detail-queries';
import type { CatalogueListingRow } from '@/modules/catalog/products/catalogue-queries';
import type { MoneyValue } from '@/lib/seller-center/product-editor/types';
import { presentPublicationState } from './status';
import {
  ENABLED,
  HIDDEN,
  absent,
  disabled,
  notTracked,
  value,
  type CatalogueRowActionsView,
  type CatalogueRowView,
  type CatalogueVariantView,
  type Tracked,
  type VariantActionView,
} from './view';

/**
 * Database rows to `CatalogueRowView` for the REAL `/listings`.
 *
 * The sibling of `adapt-fixture.ts`, and the reason the `Tracked` union exists:
 * this file is where every "we do not record that" is stated once, in code a
 * reviewer can check against the schema, instead of being spread across badges
 * as a plausible default. Three rules hold throughout:
 *
 * 1. **Never a placeholder.** No `$0.00`, no `Available`, no `Clear`, no `(0)`.
 *    An unrecorded dimension returns `notTracked`, and the pill says so.
 * 2. **A recorded absence is not an unrecorded dimension.** `categoryPath IS
 *    NULL` means "no category mapped yet" - a fact - and reads as `absent`.
 *    Collapsing the two is how "no supplier reference" starts sounding like
 *    "Sals3 does not track suppliers".
 * 3. **Prefer the stored reason over a derived one.** When pricing recorded WHY
 *    it could not resolve, that string is shown verbatim rather than replaced
 *    with this module's own guess about the cause.
 */

const NOT_MAPPED = 'Not mapped yet';

function money(
  minor: bigint | null,
  currency: string | null,
): MoneyValue | null {
  if (minor === null || currency === null) return null;

  return { amountMinor: Number(minor), currency };
}

/**
 * Price, in the three states the database can actually be in. `absent` carries
 * the resolver's own reason, which is more useful than "Not tracked yet"
 * because it names the specific thing blocking this product.
 */
function priceOf(
  pricing: CataloguePricingSummary | undefined,
): Tracked<MoneyValue> {
  if (pricing === undefined) return notTracked('NO_PRICE_RESOLVED');

  const resolved = money(pricing.lowestPriceMinor, pricing.priceCurrency);

  if (pricing.resolvedCount > 0 && resolved !== null) return value(resolved);

  return absent(
    `No price yet: ${pricing.unresolvedReason ?? 'reason not recorded'}`,
  );
}

/**
 * The supplier facts this system genuinely holds, as display lines.
 *
 * `syncState` is `STALE` from the moment a reference is written, by design -
 * the snapshot behind it is history, not a live read - so printing it is the
 * one honest freshness signal available.
 */
function evidenceNotesOf(row: CatalogueListingRow): string[] {
  const notes: string[] = [];

  if (row.sourceStatus !== null)
    notes.push(`Supplier-side status: ${row.sourceStatus}`);
  if (row.syncState !== null) notes.push(`Evidence: ${row.syncState}`);
  notes.push(
    row.lastObservedAt === null
      ? 'Supplier evidence: never captured'
      : `Evidence captured: ${row.lastObservedAt.toISOString()}`,
  );

  return notes;
}

/**
 * One variant control, always the same one: pausing a variant needs a published
 * listing, and publishing is unbuilt. It renders disabled with that reason
 * rather than vanishing, so the affordance a seller expects is visibly present
 * and visibly explained.
 */
const VARIANT_ACTION: VariantActionView = {
  kind: 'PAUSE',
  label: 'Pause variant',
  isDisabled: true,
  disabledReason:
    'Pausing needs a published listing. Publishing is not built yet, so nothing here can be paused.',
};

/**
 * Variant rows carry real observed supplier facts and nothing else. Availability
 * stays untracked even here: an observed inventory number is one supplier
 * reading at one moment, not a checkout-relevant availability state, and
 * promoting it to one is the exact overstatement ADR-013 separates.
 */
function adaptVariant(variant: CatalogueVariantRowData): CatalogueVariantView {
  const cost = money(
    variant.lastObservedCostMinor,
    variant.lastObservedCostCurrency,
  );

  return {
    id: variant.variantId,
    optionLabel:
      variant.sourceOptionLabel === null
        ? absent('Supplier option not captured')
        : value(variant.sourceOptionLabel),
    sals3VariantId: variant.variantId,
    sellerSku: value(variant.sals3Sku),
    supplierVariantId:
      variant.externalVariantId === null
        ? absent('No supplier reference')
        : value(variant.externalVariantId),
    hasImage: notTracked('NO_MEDIA_WRITERS'),
    sellingPrice: notTracked('NO_PRICE_RESOLVED'),
    supplierCost: cost === null ? absent('Cost not observed') : value(cost),
    availability: notTracked('NO_STOCK_EVIDENCE_STORE'),
    supplierObservedQuantity:
      variant.lastObservedInventory === null
        ? absent('Supplier-reported quantity: not observed')
        : value(variant.lastObservedInventory),
    lastCheckedAt:
      variant.lastObservedAt === null
        ? absent('never')
        : value(variant.lastObservedAt.toISOString()),
    action: VARIANT_ACTION,
  };
}

const PUBLISH_UNBUILT = ' — publishing is unbuilt';

/**
 * Only two controls are shown greyed, not all six unbuilt ones.
 *
 * Pause and Publish are greyed because a seller genuinely expects them and the
 * reason they cannot run is the single most useful thing this menu can say.
 * Duplicate, Restore, Review & resume and View Live Page are hidden instead: a
 * menu of six greyed rows teaches nothing, and the status pill already answers
 * what View Live Page would.
 */
function adaptActions(row: CatalogueListingRow): CatalogueRowActionsView {
  const isArchived = row.publicationState === 'ARCHIVED';

  return {
    editHref: `/listings/${row.productId}`,
    // No write path for price - see the pricing panel in the editor.
    editPrice: HIDDEN,
    pause: isArchived ? HIDDEN : disabled(PUBLISH_UNBUILT),
    resume:
      row.publicationState === 'PAUSED' ? disabled(PUBLISH_UNBUILT) : HIDDEN,
    publish:
      row.publicationState === 'UNPUBLISHED'
        ? disabled(PUBLISH_UNBUILT)
        : HIDDEN,
    restore: HIDDEN,
    duplicate: HIDDEN,
    viewLive: HIDDEN,
    archive: isArchived ? HIDDEN : ENABLED,
  };
}

export default function adaptRealRows(
  rows: CatalogueListingRow[],
  variantsByProduct: Map<string, CatalogueVariantRowData[]>,
  pricingByProduct: Map<string, CataloguePricingSummary>,
): CatalogueRowView[] {
  return rows.map((row) => ({
    id: row.productId,
    // The uuid IS the canonical Sals3 identity - there is no second, prettier
    // product number to show, and inventing one would create a code a seller
    // could quote that no query can resolve.
    sals3ProductId: row.productId,
    name: row.title,
    hasImage: notTracked('NO_MEDIA_WRITERS'),
    status: presentPublicationState(row.publicationState),
    categoryPath:
      row.categoryPath === null ? absent(NOT_MAPPED) : value(row.categoryPath),
    createdAt: row.createdAt.toISOString(),
    supplierProviderName:
      row.providerDisplayName === null
        ? absent('No supplier linked')
        : value(row.providerDisplayName),
    supplierReference:
      row.externalProductId === null
        ? absent('No supplier reference')
        : value(row.externalProductId),
    supplierConnectionHealth:
      row.connectionStatus === null
        ? absent('Source connection unknown')
        : value(row.connectionStatus),
    sellingPrice: priceOf(pricingByProduct.get(row.productId)),
    availability: notTracked('NO_STOCK_EVIDENCE_STORE'),
    mediaStatus: notTracked('NO_MEDIA_WRITERS'),
    contentReadiness: notTracked('NO_CONTENT_SCORING'),
    attentionReasons: notTracked('NO_ATTENTION_SYSTEM'),
    // Only a paused row is asked why; every other row prints nothing.
    pauseReason:
      row.publicationState === 'PAUSED'
        ? notTracked('NO_MANUAL_PAUSE_COLUMN')
        : value(null),
    evidenceNotes: evidenceNotesOf(row),
    variants: (variantsByProduct.get(row.productId) ?? []).map(adaptVariant),
    actions: adaptActions(row),
  }));
}
