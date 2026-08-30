import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import getDb, { type Database } from '@/lib/db/client';
import { auditEvents, products } from '@/lib/db/schema';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import {
  readOptionMappingRows,
  readProductVariantIds,
} from './option-mapping-rows';
import writeOptionMapping, {
  type OptionMappingPlan,
} from './write-option-mapping';

/**
 * Rebuilding the Variant Matrix a product used to have, from the audit trail.
 *
 * ## Why the audit event is the source, and why that is not a misuse of it
 *
 * `product_options` has no history table. When a mapping is removed or replaced,
 * the buyer-facing labels a person typed and the assignment of each variant exist
 * in exactly one place afterwards: the `removed` / `replaced` snapshot on
 * `catalog_product.options_unmapped` or `catalog_product.options_remapped`. Those
 * snapshots were written for this purpose.
 *
 * Reading them is a read. `audit_events` stays append-only — this adds a new
 * event rather than touching the one it read — so the trail still records every
 * state the mapping has been in, now including the fact that one of them was
 * reinstated and from which event.
 *
 * ## The payload is untrusted, even though Sals3 wrote it
 *
 * `payload` is `jsonb` with no shape enforced by the database, and this module is
 * about to turn it into what buyers read. So it is parsed with Zod and refused if
 * it does not fit, rather than indexed into and hoped for. A hand-edited row, a
 * snapshot written by an older version of the writer, or a future change to the
 * payload shape all land as `SNAPSHOT_UNREADABLE` instead of as a half-built
 * mapping or a crash.
 *
 * ## It refuses rather than partially restores
 *
 * If any variant named in the snapshot is gone, or the product has variants the
 * snapshot never covered, this refuses. A partial restore would leave some
 * variants mapped and others not — and an unmapped variant with a combination key
 * missing from a grid the others share is precisely the shape that makes a buyer's
 * selection unanswerable. Nothing here deletes: a mapped product is refused as
 * `ALREADY_MAPPED`, because replacing one is `remapOptionMapping`'s job and doing
 * it silently from a stale snapshot would be the worst version of this feature.
 *
 * ## Costs nothing at the supplier
 *
 * Two reads and the same inserts a mapping always makes. No CJ call, no points
 * (ADR-017).
 */

const RESTORABLE_ACTIONS = [
  'catalog_product.options_unmapped',
  'catalog_product.options_remapped',
] as const;

/**
 * One variant × option entry, exactly as `toMappingSnapshot` writes it.
 *
 * `nullable` on the value and variant fields is not defensiveness: the snapshot
 * query uses left joins so an axis with no values still appears, and those rows
 * carry nulls. They are dropped when the assignment is built, and an axis that
 * holds only such rows is what makes the plan fail validation below.
 */
const snapshotEntrySchema = z.object({
  optionName: z.string().min(1),
  optionPosition: z.number().int().nonnegative(),
  valueLabel: z.string().min(1).nullable(),
  valueNormalized: z.string().min(1).nullable(),
  valuePosition: z.number().int().nonnegative().nullable(),
  variantId: z.string().uuid().nullable(),
});

const snapshotPayloadSchema = z.object({
  removed: z.array(snapshotEntrySchema).min(1).optional(),
  replaced: z.array(snapshotEntrySchema).min(1).optional(),
});

type SnapshotEntry = z.infer<typeof snapshotEntrySchema>;

export type RestoreOptionMappingRefusal =
  | 'not_found'
  | 'version_conflict'
  | 'ALREADY_MAPPED'
  | 'NOTHING_TO_RESTORE'
  | 'SNAPSHOT_UNREADABLE'
  | 'VARIANTS_CHANGED';

export type RestoreOptionMappingResult =
  | {
      ok: true;
      axisCount: number;
      mappedVariantCount: number;
      restoredFromEventId: string;
      restoredFromAction: string;
    }
  | { ok: false; reason: RestoreOptionMappingRefusal; detail?: string };

/**
 * The flat snapshot back into axes and per-variant assignments.
 *
 * Order is the whole reason this is careful. `writeOptionMapping` takes each
 * axis's `position` from array order and each value's from its own, so axes are
 * sorted by `optionPosition` and values by `valuePosition` — otherwise a restore
 * would reinstate `S, M, L, XL` as whatever order the rows happened to arrive in,
 * and the arrangement is the one thing in a mapping no algorithm can recover.
 *
 * Exported for its own tests: it is pure, and the reconstruction is where a
 * mistake would be silent.
 */
export function planFromSnapshot(
  productId: string,
  entries: SnapshotEntry[],
): OptionMappingPlan | undefined {
  const axisPositions = [
    ...new Set(entries.map((entry) => entry.optionPosition)),
  ].sort((left, right) => left - right);

  const axes = axisPositions.map((position) => {
    const forAxis = entries.filter(
      (entry) => entry.optionPosition === position,
    );
    const seen = new Set<string>();
    const values = forAxis
      .filter(
        (entry) => entry.valueNormalized !== null && entry.valueLabel !== null,
      )
      // A value used by twelve variants appears twelve times in a flat snapshot.
      .filter((entry) => {
        const key = entry.valueNormalized ?? '';

        if (seen.has(key)) return false;

        seen.add(key);

        return true;
      })
      .sort(
        (left, right) => (left.valuePosition ?? 0) - (right.valuePosition ?? 0),
      )
      .map((entry) => ({
        normalizedValue: entry.valueNormalized ?? '',
        label: entry.valueLabel ?? '',
      }));

    return { name: forAxis[0]?.optionName ?? '', values, position };
  });

  // An axis with a name and no values cannot be written, and a snapshot holding
  // one is not a mapping anybody can be given back.
  if (axes.some((axis) => axis.values.length === 0 || axis.name === '')) {
    return undefined;
  }

  const byVariant = new Map<string, Map<number, string>>();

  entries.forEach((entry) => {
    if (entry.variantId === null || entry.valueNormalized === null) return;

    const row = byVariant.get(entry.variantId) ?? new Map<number, string>();

    row.set(entry.optionPosition, entry.valueNormalized);
    byVariant.set(entry.variantId, row);
  });

  const assignments = [...byVariant.entries()].flatMap(([variantId, row]) => {
    const normalizedValues = axisPositions.map(
      (position) => row.get(position) ?? '',
    );

    // Complete or dropped — the caller then refuses on coverage rather than
    // writing a variant onto a partial combination.
    if (normalizedValues.some((value) => value === '')) return [];

    return [{ variantId, normalizedValues }];
  });

  if (assignments.length === 0) return undefined;

  return {
    productId,
    axes: axes.map((axis) => ({ name: axis.name, values: axis.values })),
    assignments,
  };
}

export default async function restoreOptionMapping(input: {
  productId: string;
  sellerAccountId: string;
  actorId: string;
  expectedProductVersion: number;
  db?: Database;
}): Promise<RestoreOptionMappingResult> {
  const db = input.db ?? getDb();
  const now = new Date();

  return db.transaction(async (tx): Promise<RestoreOptionMappingResult> => {
    const productRows = await tx
      .select({ id: products.id, version: products.version })
      .from(products)
      .where(
        and(
          eq(products.id, input.productId),
          eq(products.stewardSellerAccountId, input.sellerAccountId),
        ),
      )
      .limit(1);
    const product = productRows[0];

    if (product === undefined) return { ok: false, reason: 'not_found' };
    if (product.version !== input.expectedProductVersion) {
      return { ok: false, reason: 'version_conflict' };
    }

    const existing = await readOptionMappingRows(tx, input.productId);

    if (existing.length > 0) return { ok: false, reason: 'ALREADY_MAPPED' };

    /**
     * The most recent removal or replacement for this product.
     *
     * Ordered by `created_at` and narrowed by
     * `audit_events_entity_type_entity_id_idx`. Newest wins: after unmapping
     * twice, the mapping a seller means is the one they had last, not the first
     * they ever built.
     */
    const eventRows = await tx
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        payload: auditEvents.payload,
      })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.entityType, 'product'),
          eq(auditEvents.entityId, input.productId),
          inArray(auditEvents.action, [...RESTORABLE_ACTIONS]),
        ),
      )
      .orderBy(desc(auditEvents.createdAt))
      .limit(1);
    const event = eventRows[0];

    if (event === undefined) return { ok: false, reason: 'NOTHING_TO_RESTORE' };

    const parsed = snapshotPayloadSchema.safeParse(event.payload);

    if (!parsed.success) {
      return {
        ok: false,
        reason: 'SNAPSHOT_UNREADABLE',
        detail: 'The recorded mapping could not be read.',
      };
    }

    const entries = parsed.data.removed ?? parsed.data.replaced;

    if (entries === undefined) {
      return {
        ok: false,
        reason: 'SNAPSHOT_UNREADABLE',
        detail: 'That record carries no mapping to restore.',
      };
    }

    const plan = planFromSnapshot(input.productId, entries);

    if (plan === undefined) {
      return {
        ok: false,
        reason: 'SNAPSHOT_UNREADABLE',
        detail: 'The recorded mapping is not complete enough to rebuild.',
      };
    }

    /**
     * The variants have to be the same set, both ways.
     *
     * A snapshot naming a variant the product no longer has would write a pair
     * against a missing row; a product holding a variant the snapshot never
     * covered would come back partially mapped. Neither is a restore, so both
     * refuse with the same reason — the product changed, and the seller has to map
     * it themselves.
     */
    const currentVariantIds = await readProductVariantIds(tx, input.productId);
    const current = new Set(currentVariantIds);
    const planned = new Set(plan.assignments.map((row) => row.variantId));
    const missing = [...planned].filter((id) => !current.has(id));
    const uncovered = currentVariantIds.filter((id) => !planned.has(id));

    if (missing.length > 0 || uncovered.length > 0) {
      return {
        ok: false,
        reason: 'VARIANTS_CHANGED',
        detail: `This product's variants have changed since that mapping was recorded (${missing.length} gone, ${uncovered.length} new), so it cannot be put back as it was.`,
      };
    }

    const written = await writeOptionMapping(tx, plan, now);

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
      action: 'catalog_product.options_restored',
      entityType: 'product',
      entityId: input.productId,
      payload: {
        axisCount: written.axisCount,
        mappedVariantCount: written.mappedVariantCount,
        axisNames: plan.axes.map((axis) => axis.name),
        // Which event this came from, so the trail is a chain rather than a set
        // of unrelated states.
        restoredFromEventId: event.id,
        restoredFromAction: event.action,
      },
    });

    return {
      ok: true,
      axisCount: written.axisCount,
      mappedVariantCount: written.mappedVariantCount,
      restoredFromEventId: event.id,
      restoredFromAction: event.action,
    };
  });
}
