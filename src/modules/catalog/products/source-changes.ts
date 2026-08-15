import type {
  MoneyValue,
  SourceChangeFixture,
} from '@/lib/seller-center/product-editor/types';

/**
 * What the supplier changed since this product was drafted.
 *
 * ## Why this is free
 *
 * Two rows already hold both halves of the comparison, and neither needs a
 * supplier request to read:
 *
 * - `provider_variant_references` has exactly one writer — `create-draft.ts`, at
 *   draft time — so its observed cost, inventory and label are **frozen at the
 *   moment the seller drafted the product**.
 * - `supplier_snapshots.evidence` is unique on `candidate_id` and overwritten in
 *   place, so it always holds the **most recent** supplier truth Sals3 captured.
 *
 * Diffing them therefore answers "what changed since I drafted this" for the cost
 * of a `SELECT` that has already happened. No CJ call, no points (ADR-017).
 *
 * ## The honest limit, stated rather than hidden
 *
 * `captureCandidateEvidence` has only human-triggered callers. Discovery never
 * refreshes a snapshot on its own, so evidence can be arbitrarily old, and this
 * diff can only ever report changes that were *captured*. An empty result means
 * "nothing differs from what we last saw", never "the supplier has not changed" —
 * which is why `capturedAt` travels with the result and the panel says so.
 *
 * ## Deliberately not every difference
 *
 * Inventory moves constantly on a dropshipping feed. Reporting every fluctuation
 * would bury the two facts that actually cost a seller money — a cost that rose
 * above their retail price, and a variant that no longer exists — so stock is
 * reported only when it reaches zero.
 */

/** The draft-time record, as the catalogue read-model already assembles it. */
export type FrozenVariant = {
  variantId: string;
  /** CJ's `vid`, the join key to the snapshot. */
  externalVariantId: string;
  /** What the label was when drafted. */
  supplierOptionLabel: string | null;
  /** Display name for the seller, which may fall back to a key or SKU. */
  displayLabel: string;
  /** Cost as observed at draft time. */
  supplierCost: MoneyValue;
  supplierObservedQuantity: number | null;
  /** The seller's own retail price, for the cost-above-retail alarm. */
  retailPrice: MoneyValue | null;
};

/** The current snapshot, re-validated by the caller before it reaches here. */
export type EvidenceVariant = {
  vid: string;
  optionLabel: string | null;
  /** Supplier price in whole currency units, as the evidence stores it. */
  priceUsd: number | null;
  totalInventory: number | null;
};

const ACCEPTED_ORDER_IMPACT =
  'Accepted orders are unaffected. Each one keeps the product, variant, price basis, image and supplier evidence it was accepted with.';

function money(value: MoneyValue): string {
  return `${value.currency} ${(value.amountMinor / 100).toFixed(2)}`;
}

/**
 * Evidence stores a decimal price; the reference stores integer minor units.
 * Rounding here rather than comparing floats keeps `7.8` and `780` equal instead
 * of reporting a change nobody made.
 */
function toMinor(priceUsd: number): number {
  return Math.round(priceUsd * 100);
}

/**
 * A named export and not a default. `tsx` loads a `.ts` module imported from an
 * `.mts` file through CommonJS interop, and a default arrives wrapped in the
 * module object rather than as the function — `typeof` reports `object` and the
 * call throws, with nothing failing at type-check time. `option-split.ts` carries
 * the same note for the same reason.
 */
export function deriveSourceChanges(input: {
  frozen: FrozenVariant[];
  current: EvidenceVariant[];
  /** When the snapshot was captured. Reported, never treated as "now". */
  capturedAt: string | null;
}): SourceChangeFixture[] {
  // No snapshot means no comparison is possible — which is not the same as no
  // change, and the panel says so rather than this inventing an entry.
  if (input.current.length === 0) return [];

  const currentByVid = new Map(input.current.map((row) => [row.vid, row]));
  const frozenByVid = new Map(
    input.frozen.map((row) => [row.externalVariantId, row]),
  );
  const occurredAt = input.capturedAt ?? '';
  const changes: SourceChangeFixture[] = [];

  input.frozen.forEach((variant) => {
    const now = currentByVid.get(variant.externalVariantId);

    if (now === undefined) {
      changes.push({
        id: `${variant.variantId}-withdrawn`,
        title: `${variant.displayLabel} is no longer offered by the supplier`,
        body: 'This variant was present when the product was drafted and is absent from the most recent supplier evidence. It cannot be fulfilled while that remains true.',
        occurredAt,
        currentListingImpact:
          'Disable this variant before publishing, or the listing offers something the supplier will not ship.',
        acceptedOrderImpact: ACCEPTED_ORDER_IMPACT,
        listingAutoPaused: false,
        sellerActionRequired: true,
      });

      return;
    }

    if (now.priceUsd !== null) {
      const currentMinor = toMinor(now.priceUsd);

      if (currentMinor !== variant.supplierCost.amountMinor) {
        const rose = currentMinor > variant.supplierCost.amountMinor;
        const retail = variant.retailPrice;
        // The alarm this whole diff was worth building for. A supplier cost that
        // has climbed past the seller's retail price means every sale of that
        // variant loses money, and nothing else in the editor would say so.
        const aboveRetail =
          retail !== null &&
          retail.amountMinor > 0 &&
          currentMinor > retail.amountMinor;

        changes.push({
          id: `${variant.variantId}-cost`,
          title: aboveRetail
            ? `${variant.displayLabel} now costs more than it sells for`
            : `${variant.displayLabel} supplier cost ${rose ? 'rose' : 'fell'}`,
          body: aboveRetail
            ? `The supplier now charges ${money({ amountMinor: currentMinor, currency: variant.supplierCost.currency })} against a retail price of ${money(retail)}. Every sale at that price loses money.`
            : `Was ${money(variant.supplierCost)} when drafted, now ${money({ amountMinor: currentMinor, currency: variant.supplierCost.currency })}.`,
          occurredAt,
          currentListingImpact: aboveRetail
            ? 'Raise the retail price or disable this variant. Publishing is refused while a retail price sits below supplier cost.'
            : 'The retail price is unchanged, so the margin on this variant has moved.',
          acceptedOrderImpact: ACCEPTED_ORDER_IMPACT,
          listingAutoPaused: false,
          sellerActionRequired: aboveRetail,
        });
      }
    }

    if (now.totalInventory === 0 && variant.supplierObservedQuantity !== 0) {
      changes.push({
        id: `${variant.variantId}-stock`,
        title: `${variant.displayLabel} is out of stock at the supplier`,
        body: 'The most recent supplier evidence reports no units. Stock on a dropshipping feed moves constantly, so only zero is reported here.',
        occurredAt,
        currentListingImpact:
          'The storefront will not offer this variant while the supplier reports none.',
        acceptedOrderImpact: ACCEPTED_ORDER_IMPACT,
        listingAutoPaused: false,
        sellerActionRequired: false,
      });
    }

    const labelNow = now.optionLabel?.trim() ?? null;

    if (
      variant.supplierOptionLabel !== null &&
      labelNow !== null &&
      labelNow !== variant.supplierOptionLabel
    ) {
      changes.push({
        id: `${variant.variantId}-label`,
        title: `${variant.displayLabel} was renamed by the supplier`,
        body: `The supplier's own label changed from "${variant.supplierOptionLabel}" to "${labelNow}". Option groups are matched on the label recorded at draft time, so an existing mapping still points at the right variant.`,
        occurredAt,
        currentListingImpact:
          'The storefront shows the label recorded when this product was drafted, not the new one.',
        acceptedOrderImpact: ACCEPTED_ORDER_IMPACT,
        listingAutoPaused: false,
        sellerActionRequired: false,
      });
    }
  });

  input.current.forEach((row) => {
    if (frozenByVid.has(row.vid)) return;

    changes.push({
      id: `${row.vid}-added`,
      title: `The supplier now offers ${row.optionLabel?.trim() ?? row.vid}`,
      body: 'This variant is in the most recent supplier evidence and was not present when the product was drafted. Sals3 does not add it on its own — a variant is only created when a draft is built.',
      occurredAt,
      currentListingImpact:
        'The listing does not offer this variant. Nothing is broken by leaving it that way.',
      acceptedOrderImpact: ACCEPTED_ORDER_IMPACT,
      listingAutoPaused: false,
      sellerActionRequired: false,
    });
  });

  // Action first: a cost above retail is losing money on every sale, and a
  // withdrawn variant cannot ship. Everything else is context.
  return changes.sort((left, right) => {
    if (left.sellerActionRequired === right.sellerActionRequired) return 0;

    return left.sellerActionRequired ? -1 : 1;
  });
}
