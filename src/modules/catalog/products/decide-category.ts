import getDb, { type Database } from '@/lib/db/client';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import {
  assignProductCategory,
  findCategoryByCode,
} from '@/modules/catalog/taxonomy/repository';
import { findProductForSteward } from './repository';

export type DecideProductCategoryResult =
  | {
      ok: true;
      categoryCode: string;
      categoryPath: string;
      productVersion: number;
    }
  | { ok: false; reason: 'NOT_FOUND' }
  | { ok: false; reason: 'UNKNOWN_SALS3_CATEGORY'; detail: string }
  | { ok: false; reason: 'STALE_WRITE' };

/**
 * Sets the Sals3 category a seller's own product is tagged under.
 *
 * Owner decision 2026-08-15: this is a per-seller, per-product decision, not
 * a platform-wide one. Earlier in this same change it was built the other
 * way — reusing `taxonomy/governance.ts`'s propose/review flow, which writes
 * to `provider_category_mappings` keyed by `(provider, externalCategoryId)`,
 * so one seller's pick would have silently reclassified every other
 * seller's product sourced under the same CJ category. The owner rejected
 * that: category tagging is each seller's own business call, on their own
 * risk (mistag a product and it simply sells worse under the wrong
 * category) — not something one seller's pick should impose on another's
 * catalogue. Guardrails on tagging quality are deliberately deferred,
 * separate work.
 *
 * That governance module is untouched and still exists for whatever ADR-014
 * purpose it originally had; this function does not call it, does not read
 * or write `provider_category_mappings`, and does not derive a CJ
 * `externalCategoryId` at all — there is no shared resource here to key
 * anything off. `sals3CategoryCode` still cannot be invented: it is resolved
 * against the real `sals3_categories` table (`findCategoryByCode`), so an
 * unrecognised code refuses cleanly instead of writing garbage.
 *
 * One transaction, one table's write, one audit event —
 * `product.category_declared` distinguishes this in the audit trail from
 * `product.category_assigned` (the governance-resolved kind
 * `applyResolvedCategoryToProduct` records), since nobody reading the audit
 * log later should have to guess which path produced a given category.
 */
export async function decideProductSals3Category(input: {
  productId: string;
  sellerAccountId: string;
  expectedProductVersion: number;
  sals3CategoryCode: string;
  reason: string;
  actorId: string;
  db?: Database;
}): Promise<DecideProductCategoryResult> {
  const db = input.db ?? getDb();

  return db.transaction(async (tx): Promise<DecideProductCategoryResult> => {
    const product = await findProductForSteward(
      tx,
      input.productId,
      input.sellerAccountId,
    );

    if (product === null || product.version !== input.expectedProductVersion) {
      return { ok: false, reason: 'NOT_FOUND' };
    }

    const category = await findCategoryByCode(tx, input.sals3CategoryCode);

    if (category === null) {
      return {
        ok: false,
        reason: 'UNKNOWN_SALS3_CATEGORY',
        detail: `"${input.sals3CategoryCode}" is not a Sals3 Taxonomy v1 category code.`,
      };
    }

    const updated = await assignProductCategory(tx, {
      productId: product.id,
      stewardSellerAccountId: input.sellerAccountId,
      expectedVersion: product.version,
      categoryId: category.id,
      categoryMappingConfidence: 'EXACT',
      // No `provider_category_mappings` row backs this — the seller declared
      // it directly for this one product, not through the CJ-category
      // crosswalk. The schema allows `categoryId` set with both of these
      // null (see `product-catalog.ts`'s check constraint); the audit event
      // below is this decision's provenance instead of a mapping row.
      categoryMappingId: null,
      categoryMappingVersion: null,
      actorId: input.actorId,
    });

    if (updated === null) return { ok: false, reason: 'STALE_WRITE' };

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: 'product.category_declared',
      entityType: 'product',
      entityId: updated.id,
      payload: {
        sellerAccountId: input.sellerAccountId,
        categoryCode: category.code,
        categoryPath: category.path,
        reason: input.reason,
        previousCategoryId: product.categoryId,
      },
    });

    return {
      ok: true,
      categoryCode: category.code,
      categoryPath: category.path,
      productVersion: updated.version,
    };
  });
}
