import { sql } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';

/**
 * Fills in the packed box dimensions of variants imported before the draft
 * path wrote them.
 *
 * ## What was wrong
 *
 * `insertDraftVariant` passed `weightGrams` through and hard-coded
 * `length_millimeters`, `width_millimeters`, and `height_millimeters` to
 * `null` — and `create-draft.ts`'s own subset schema did not even read the
 * three fields off the evidence snapshot, so they were dropped twice on the
 * way in. The Portal's "Package dimensions (supplier)" label never noticed,
 * because it is derived from the snapshot at read time rather than from the
 * columns.
 *
 * Two things read the columns, and both were quietly degraded: the
 * storefront's Supplier details block, which showed a weight and no size, and
 * `freight-quotes.ts`, which cannot compute a volumetric weight unless all
 * three are present.
 *
 * Fixing the write path only helps products imported after it ships. Every
 * product already in the catalogue keeps three null columns until this runs.
 *
 * ## Where the numbers come from
 *
 * `supplier_snapshots.evidence` — the richer CJ product-detail capture, one
 * row per candidate — carries `lengthMm`, `widthMm`, and `heightMm` per
 * variant, keyed by CJ's own `vid`. That `vid` is exactly what
 * `provider_variant_references.external_variant_id` stores, so a variant is
 * matched to its evidence by supplier identity rather than by array position.
 * Matching on order would silently pair a variant with another variant's box
 * the first time CJ returned a different sequence.
 *
 * No supplier call is made. This is a read of data the database already holds
 * (ADR-017, and the CJ call-budget rule in the agent contract).
 *
 * ## Why it is safe to run twice
 *
 * The statement only touches rows where all three columns are still null, so a
 * second run matches nothing and reports `0`. It never overwrites a value that
 * is already there — including one a seller or a later audited override set,
 * which this must not clobber.
 *
 * A variant whose evidence lacks any of the three is left alone rather than
 * partially filled: `freight-quotes.ts` needs all three to compute a volume,
 * and a half-filled box would read as a measured fact instead of a missing
 * one. Products whose only evidence is the cheap discovery feed have no
 * dimensions at all and are correctly skipped — the feed has no equivalent
 * field.
 */
export type BackfillVariantDimensionsResult = {
  /** Variants that gained all three dimensions on this run. */
  variantsFilled: number;
  /** Variants still missing them afterwards — no evidence to fill from. */
  variantsStillMissing: number;
};

/**
 * Rounded to whole millimetres because the columns are `integer`. CJ has never
 * been observed to report a fraction; rounding rather than refusing keeps one
 * odd payload from stopping the whole backfill.
 */
const BACKFILL_STATEMENT = `
  UPDATE product_variants AS v
  SET length_millimeters = round(e.length_mm)::int,
      width_millimeters = round(e.width_mm)::int,
      height_millimeters = round(e.height_mm)::int,
      updated_at = now(),
      updated_by = 'system:backfill-variant-dimensions'
  FROM provider_variant_references AS pvr
  JOIN provider_product_references AS ppr
    ON ppr.id = pvr.provider_product_reference_id
  JOIN supplier_snapshots AS ss
    ON ss.candidate_id = ppr.source_candidate_id
  CROSS JOIN LATERAL (
    SELECT (variant ->> 'lengthMm')::numeric AS length_mm,
           (variant ->> 'widthMm')::numeric AS width_mm,
           (variant ->> 'heightMm')::numeric AS height_mm
    FROM jsonb_array_elements(ss.evidence -> 'variants') AS variant
    WHERE variant ->> 'vid' = pvr.external_variant_id
    LIMIT 1
  ) AS e
  WHERE pvr.variant_id = v.id
    AND v.length_millimeters IS NULL
    AND v.width_millimeters IS NULL
    AND v.height_millimeters IS NULL
    AND e.length_mm IS NOT NULL
    AND e.width_mm IS NOT NULL
    AND e.height_mm IS NOT NULL
    AND e.length_mm >= 0
    AND e.width_mm >= 0
    AND e.height_mm >= 0
  RETURNING v.id
`;

/** Counted after the write, so the report describes the database, not the intent. */
const STILL_MISSING_STATEMENT = `
  SELECT count(*)::int AS remaining
  FROM product_variants
  WHERE length_millimeters IS NULL
     OR width_millimeters IS NULL
     OR height_millimeters IS NULL
`;

export async function backfillVariantDimensions(
  db: Database,
): Promise<BackfillVariantDimensionsResult> {
  // `RETURNING` and `rows.length` rather than the driver's affected-row
  // metadata: every other raw statement in this module family reads its result
  // as an array, and a count that depends on which driver is configured is a
  // number nobody can check.
  const updated = (await db.execute(
    sql.raw(BACKFILL_STATEMENT),
  )) as unknown as unknown[];
  const remaining = (await db.execute(
    sql.raw(STILL_MISSING_STATEMENT),
  )) as unknown as { remaining: number }[];

  return {
    variantsFilled: updated.length,
    variantsStillMissing: remaining[0]?.remaining ?? 0,
  };
}
