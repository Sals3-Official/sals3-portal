import { z } from 'zod';

/**
 * CJ's own Level 1 category for a candidate, resolved without ever calling CJ.
 *
 * ## Why this file holds no database import
 *
 * Everything here is pure, and it is imported by `pipeline-filters.ts`, which a
 * component test reaches. A top-level `@/lib/db/client` import would put a
 * server-only module into that graph and fail the import outright — the same
 * defect the per-destination pricing action had to defer its imports to avoid.
 * The read lives in `cj-category-l1-read.ts`; the shape lives here.
 *
 * ## Why this costs no points
 *
 * `handle-cycle-start.ts` already calls `adapter.getCategoryTree(connection.id)`
 * once per discovery cycle — one `/product/getCategory` request for the WHOLE
 * three-level tree, not one per product — and `recordCategorySnapshotIfAbsent`
 * persists the flattened result into `discovery_cycles.category_snapshot` as
 * `jsonb`. Each entry is a `SupplierCategoryLeaf`:
 *
 *     { categoryId, categoryName, path: [categoryFirstName, categorySecondName] }
 *
 * so `path[0]` **is** CJ's Level 1, and `categoryId` is exactly what
 * `supplier_candidates.provider_category_id` holds. Resolving a candidate's L1
 * is therefore a lookup against data already in Postgres, already paid for when
 * the candidate was discovered. Nothing in this file reaches a supplier
 * adapter, and nothing here may ever be allowed to: a category label is not
 * worth a points charge, and a per-row fetch would be one per row.
 *
 * ## Why the snapshot is read, not a lookup table
 *
 * A dedicated `provider_category_paths` table would index better, and it would
 * also need DDL — a migration, a break-glass production run, and a backfill —
 * for a value that is already persisted and already immutable per cycle. This
 * reads what exists. If the row count of the tree ever makes this the slow part
 * of the page, materialising it is a separate, additive change that does not
 * alter a single caller of this module.
 *
 * ## Why the LATEST cycle
 *
 * `category_snapshot` is deliberately immutable per cycle, so an older cycle
 * describes CJ's tree as it was then. The newest non-null snapshot is the
 * closest thing to CJ's tree today. A candidate whose category CJ has since
 * retired simply resolves to `null` and the row renders its stored leaf name
 * alone — an absent L1, never a guessed one.
 */

/**
 * Parsed rather than cast: `category_snapshot` is `jsonb`, so it arrives
 * untyped and a shape change upstream must degrade one entry, never throw on
 * the whole page. Entries missing an id or a first-level label are dropped —
 * a label with no identity cannot answer a lookup.
 */
const snapshotEntrySchema = z.object({
  categoryId: z.string().min(1),
  categoryName: z.string().optional(),
  path: z.array(z.string()).optional(),
});

export type CjCategoryIndex = {
  /** Provider category id to CJ's Level 1 label. */
  l1ById: Record<string, string>;
  /** Every Level 1 label present in the tree, sorted for a stable filter list. */
  l1Labels: string[];
};

export const EMPTY_CJ_CATEGORY_INDEX: CjCategoryIndex = {
  l1ById: {},
  l1Labels: [],
};

/** Flattens a raw snapshot into the two lookups the pipeline table needs. */
export function indexCategorySnapshot(snapshot: unknown): CjCategoryIndex {
  if (!Array.isArray(snapshot)) return EMPTY_CJ_CATEGORY_INDEX;

  const l1ById: Record<string, string> = {};
  const labels = new Set<string>();

  snapshot.forEach((raw) => {
    const parsed = snapshotEntrySchema.safeParse(raw);

    if (!parsed.success) return;

    const l1 = parsed.data.path?.[0]?.trim() ?? '';

    if (l1 === '') return;

    l1ById[parsed.data.categoryId] = l1;
    labels.add(l1);
  });

  return { l1ById, l1Labels: [...labels].sort((a, b) => a.localeCompare(b)) };
}

/**
 * The provider category ids that sit under one CJ Level 1 label.
 *
 * This is what makes the Level 1 filter a plain indexed predicate:
 * `provider_category_id IN (…)` against `supplier_candidates`, rather than a
 * join through a jsonb array. CJ's tree is a few thousand leaves and one L1
 * holds a slice of that, so the list stays a normal `IN` rather than a scan.
 */
export function categoryIdsForL1(index: CjCategoryIndex, l1: string): string[] {
  return Object.keys(index.l1ById).filter((id) => index.l1ById[id] === l1);
}
