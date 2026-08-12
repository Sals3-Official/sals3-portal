'use server';

import { requirePermission } from '@/lib/auth/session';
import { revealBuyerContact } from '@/lib/seller-center/mock-data/orders';
import type { RevealedContact } from '@/modules/orders/contracts';

/**
 * Returns a parcel's real buyer contact.
 *
 * This exists so the plaintext never sits in the page payload. Rendering the
 * masked and unmasked values together and toggling between them in the browser
 * looks identical on screen and is not the same thing at all: the real address
 * ships to everyone who loads the page, readable from view-source, and the
 * permission check decorates a decision that was already made.
 *
 * `requirePermission` runs first and throws for a role without
 * `order:fulfill` - `viewer` holds `order:read` and gets nothing. That is the
 * authorization boundary; hiding the button is not.
 */
export default async function revealParcelContactAction(
  parcelId: string,
): Promise<RevealedContact | null> {
  await requirePermission('order:fulfill');

  return revealBuyerContact(parcelId);
}
