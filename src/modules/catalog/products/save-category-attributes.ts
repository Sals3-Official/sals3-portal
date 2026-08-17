import { and, eq } from 'drizzle-orm';
import getDb, { type Database } from '@/lib/db/client';
import { productCategoryAttributeValues, products } from '@/lib/db/schema';
import { ACTIVE_ATTRIBUTE_CONTROLS_VERSION } from '@/lib/db/schema/category-attribute-controls';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import {
  resolveCategoryAttributeContract,
  validateCategoryAttributeSubmission,
  type CategoryAttributeSubmissionPayload,
} from '@/modules/catalog/taxonomy/attribute-contract';
import { findCategoryById } from '@/modules/catalog/taxonomy/repository';
import type { CategoryAttributeSubmissionValidation } from '@/modules/catalog/taxonomy/attribute-types';
import { findProductForSteward } from './repository';

/**
 * Persists a seller's answers to their product's category-driven attribute
 * controls (the Product Editor's Specification section).
 *
 * Same shape as `save-option-mapping.ts`: tenant-scope + compare-and-set on
 * `products.version` in one transaction, then a server-side re-validation
 * that never trusts client-computed validity. The category, its controls,
 * and every rule about what counts as valid all live in
 * `taxonomy/attribute-contract.ts`; this module only resolves *which*
 * category and persists the result.
 *
 * ## A draft save is not a publish gate
 *
 * This always saves what validates, even when required attributes remain
 * unresolved - the validation result is returned so the caller (and the
 * read-model, on the next load) can surface findings, but a `REQUIRED`
 * attribute being missing is never a reason this write itself fails. Only
 * *publish* refuses on an open `REQUIRED_ATTRIBUTE_MISSING` finding
 * (`publish.ts`).
 *
 * ## What gets written, and why nothing is invented
 *
 * For every attribute name present as a key in the submission:
 *  - if it validated, its accepted values (and whether any came from a free-
 *    typed custom entry) are upserted - one current row per attribute per
 *    product, never an append.
 *  - if it did not validate (missing, blank, rejected, or the wrong shape),
 *    any previously stored value for that attribute name is deleted rather
 *    than left in place looking valid - a seller clearing or breaking a
 *    field is a real edit, not a no-op.
 *  - if the contract does not recognise the attribute name at all, it is
 *    upserted verbatim rather than dropped, satisfying the same "preserve
 *    unrecognised attributes" guarantee `validateCategoryAttributes` (the
 *    older, unrelated variation-tier contract) already keeps.
 *
 * An attribute name absent from the submission entirely is never touched -
 * this endpoint accepts partial saves, it does not require re-submitting
 * every control on every save.
 */

export type SaveCategoryAttributesRefusal =
  | 'not_found'
  | 'version_conflict'
  | 'NO_CATEGORY_ASSIGNED'
  | 'ATTRIBUTE_CONTROLS_UNAVAILABLE';

export type SaveCategoryAttributesResult =
  | {
      ok: true;
      productVersion: number;
      validation: CategoryAttributeSubmissionValidation;
    }
  | { ok: false; reason: SaveCategoryAttributesRefusal };

export default async function saveCategoryAttributes(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  expectedProductVersion: number;
  attributes: CategoryAttributeSubmissionPayload;
  db?: Database;
}): Promise<SaveCategoryAttributesResult> {
  const db = input.db ?? getDb();
  const now = new Date();

  return db.transaction(async (tx): Promise<SaveCategoryAttributesResult> => {
    const product = await findProductForSteward(
      tx,
      input.productId,
      input.sellerAccountId,
    );

    if (product === null) {
      return { ok: false, reason: 'not_found' };
    }

    if (product.version !== input.expectedProductVersion) {
      return { ok: false, reason: 'version_conflict' };
    }

    if (product.categoryId === null) {
      return { ok: false, reason: 'NO_CATEGORY_ASSIGNED' };
    }

    const category = await findCategoryById(tx, product.categoryId);

    if (category === null) {
      return { ok: false, reason: 'NO_CATEGORY_ASSIGNED' };
    }

    const contract = await resolveCategoryAttributeContract(tx, {
      sals3CategoryCode: category.code,
      controlsVersion: ACTIVE_ATTRIBUTE_CONTROLS_VERSION,
    });

    if (contract.outcome !== 'CATEGORY_ATTRIBUTE_CONTRACT') {
      return { ok: false, reason: 'ATTRIBUTE_CONTROLS_UNAVAILABLE' };
    }

    // Re-validated here, unconditionally - never trusts whatever the
    // client believed was valid.
    const validation = validateCategoryAttributeSubmission(
      contract,
      input.attributes,
    );

    const submittedNames = new Set(Object.keys(input.attributes));

    // eslint-disable-next-line no-restricted-syntax
    for (const name of submittedNames) {
      const accepted = validation.acceptedAttributes[name];

      if (accepted !== undefined) {
        // eslint-disable-next-line no-await-in-loop
        await tx
          .insert(productCategoryAttributeValues)
          .values({
            productId: input.productId,
            attributeName: name,
            controlsVersion: contract.controlsVersion,
            values: [...accepted.values],
            isCustomValue: accepted.isCustomValue,
            updatedAt: now,
            updatedBy: input.actorId,
          })
          .onConflictDoUpdate({
            target: [
              productCategoryAttributeValues.productId,
              productCategoryAttributeValues.attributeName,
            ],
            set: {
              controlsVersion: contract.controlsVersion,
              values: [...accepted.values],
              isCustomValue: accepted.isCustomValue,
              updatedAt: now,
              updatedBy: input.actorId,
            },
          });
      } else {
        // eslint-disable-next-line no-await-in-loop
        await tx
          .delete(productCategoryAttributeValues)
          .where(
            and(
              eq(productCategoryAttributeValues.productId, input.productId),
              eq(productCategoryAttributeValues.attributeName, name),
            ),
          );
      }
    }

    // eslint-disable-next-line no-restricted-syntax
    for (const unrecognized of validation.unrecognizedAttributes) {
      // eslint-disable-next-line no-await-in-loop
      await tx
        .insert(productCategoryAttributeValues)
        .values({
          productId: input.productId,
          attributeName: unrecognized.name,
          controlsVersion: contract.controlsVersion,
          values: [...unrecognized.values],
          isCustomValue: false,
          updatedAt: now,
          updatedBy: input.actorId,
        })
        .onConflictDoUpdate({
          target: [
            productCategoryAttributeValues.productId,
            productCategoryAttributeValues.attributeName,
          ],
          set: {
            controlsVersion: contract.controlsVersion,
            values: [...unrecognized.values],
            isCustomValue: false,
            updatedAt: now,
            updatedBy: input.actorId,
          },
        });
    }

    await tx
      .update(products)
      .set({
        version: input.expectedProductVersion + 1,
        updatedAt: now,
        updatedBy: input.actorId,
      })
      .where(
        and(
          eq(products.id, input.productId),
          eq(products.version, input.expectedProductVersion),
        ),
      );

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: 'catalog_product.category_attributes_saved',
      entityType: 'product',
      entityId: input.productId,
      payload: {
        categoryCode: contract.categoryCode,
        controlsVersion: contract.controlsVersion,
        submittedAttributeCount: submittedNames.size,
        acceptedAttributeCount: Object.keys(validation.acceptedAttributes)
          .length,
        findingCount: validation.findings.length,
      },
    });

    return {
      ok: true,
      productVersion: input.expectedProductVersion + 1,
      validation,
    };
  });
}
