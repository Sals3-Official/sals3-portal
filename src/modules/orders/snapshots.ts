import 'server-only';

import { z } from 'zod';

/**
 * Read schemas for the JSON snapshots frozen onto a checkout intent.
 *
 * ## Why these are laxer than the schemas that wrote them
 *
 * `checkoutFreightAddressSchema` in `modules/checkout/freight-quotes.ts` is the
 * *write* authority: it validates what a buyer may submit, so it is strict on
 * purpose and its `country` is a `z.enum` of the destinations checkout accepts
 * today. Reading a stored snapshot back is a different question. That enum has
 * already widened once (`AU, PH` gained `FJ`), and it may narrow again — a read
 * schema sharing it would stop parsing orders that were perfectly valid when
 * they were placed, and a parcel that fails to parse does not render an error,
 * it silently disappears from the seller's list.
 *
 * So `country` is a bare string here, and the length floors are gone. These
 * rows are already-accepted history; the only question a reader may ask is
 * "are the fields I need present", never "would I accept this today".
 *
 * ## Why they live here rather than in each reader
 *
 * `buyer-read.ts` and `read-model.ts` both parse these columns — the buyer's
 * view of an order and the seller's view of the same parcel. Two private
 * copies of one shape is the defect this repository keeps rediscovering (a
 * rule relaxed in one file and left standing in another), so the shape has one
 * home and both readers import it.
 */
export const addressSnapshotSchema = z.object({
  email: z.string(),
  fullName: z.string(),
  phone: z.string().optional(),
  addressLine1: z.string(),
  addressLine2: z.string().optional(),
  city: z.string(),
  region: z.string(),
  postalCode: z.string(),
  country: z.string(),
});

export type AddressSnapshot = z.infer<typeof addressSnapshotSchema>;

export const shippingSelectionSnapshotSchema = z.object({
  packageSelections: z.array(
    z.object({
      packageId: z.string(),
      arrivalTime: z.string().optional(),
    }),
  ),
});

/**
 * Arrival windows keyed by package id, empty when the snapshot cannot be read.
 *
 * An unparseable selection snapshot yields no windows rather than throwing:
 * the delivery estimate is the least important thing on the card, and losing
 * the whole parcel over it would trade a missing label for a missing order.
 */
export function arrivalWindowsByPackage(intent: {
  shippingSelectionSnapshot: unknown;
}): Map<string, string> {
  const parsed = shippingSelectionSnapshotSchema.safeParse(
    intent.shippingSelectionSnapshot,
  );

  if (!parsed.success) return new Map();

  return new Map(
    parsed.data.packageSelections
      .filter((row) => row.arrivalTime !== undefined && row.arrivalTime !== '')
      .map((row) => [row.packageId, row.arrivalTime as string]),
  );
}

export function readAddressSnapshot(intent: {
  addressSnapshot: unknown;
}): AddressSnapshot | null {
  const parsed = addressSnapshotSchema.safeParse(intent.addressSnapshot);

  return parsed.success ? parsed.data : null;
}
