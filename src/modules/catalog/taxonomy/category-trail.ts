/**
 * ## No `import 'server-only'` here, and that is a decision
 *
 * `variation-families.ts` carries that guard for exactly this kind of extract,
 * and it is the right default. It does not fit here: this module is reached
 * through `catalog-feed.ts`, which six `/api/storefront/*` routes import, so the
 * guard put **seven** test files into `vi.mock('server-only')` to test pure
 * functions. `read-model.ts` refused the guard for the same reason at nine files.
 *
 * The risk the guard covers is real — one import from a `'use client'` component
 * would ship the whole taxonomy to every browser — so it is covered by
 * `category-trail.client-boundary.test.ts` instead, which walks the import graph
 * and asserts no client module reaches this file. That tests the property rather
 * than mocking a proxy for it.
 */
import taxonomyExtract from '@/lib/db/seed-data/sals3-taxonomy-v1.json';
import { slugBaseFromTitle } from '@/modules/catalog/products/slug';
import { departmentSlugForName } from './departments';

/**
 * Every level of a product's category path as an addressable place.
 *
 * ## The problem this solves
 *
 * A PDP breadcrumb reads `Office Supplies / General Office Supplies / Paper
 * Products / Notebooks & Notepads`, and until now only the first was a link.
 * `/c/[slug]` resolved the 21 L1 departments and nothing else, so
 * `/c/clothing` and `/c/pants` answered 404 — the deeper levels were plain text
 * on every product page in the catalogue.
 *
 * The blocker was never the filter. It was that a URL has to resolve back to
 * exactly one taxonomy row, and `slugBaseFromTitle` lower-cases, collapses and
 * truncates — `departments.ts` says plainly that no expression inverts it. So a
 * bare slug cannot identify a level.
 *
 * ## Why the Google id, and why in the slug
 *
 * Every level is its own `sals3_categories` row with its own unique
 * `CAT-GGL-<Google numeric id>` code — `Paper Products` is `CAT-GGL-956`,
 * `Notebooks & Notepads` is `CAT-GGL-961`. Owner decision 2026-08-31: a deeper
 * level is addressed as `<slug>-<id>`.
 *
 * The **id is authoritative and the slug is decoration**. That is the point of
 * the shape: a renamed category, a re-slugged title or a hand-typed link with the
 * wrong words still resolves, because only the trailing digits are read. Nothing
 * has to stay in sync, and no `slug` column had to be added to a table whose DDL
 * reaches production through a break-glass workflow.
 *
 * ## L1 keeps its bare slug
 *
 * `/c/office-supplies` is already live and linked from the home tiles, the
 * all-departments list, the footer and the browse sidebar. The 21 departments
 * have a curated name list on both sides of the wire, so they are invertible and
 * need no id — and changing their URLs would break four surfaces and re-open
 * URLs Google has already indexed, to gain nothing.
 *
 * So the two shapes are not an inconsistency to tidy: they are two different
 * facts. Twenty-one curated departments are addressable by name; 5,574 taxonomy
 * rows are not.
 *
 * ## Read from the committed extract, not the database
 *
 * The same file `scripts/seed-sals3-taxonomy-v1.mts` seeds production from, so a
 * trail cannot disagree with the rows it describes, and building one costs **no
 * query at all** — which matters because this runs on every product detail read.
 * `variation-families.ts` established the pattern.
 *
 * A CJ-mirrored category is absent from the extract by construction (it is
 * minted at runtime, not seeded), so its levels get no slug and render as text.
 * That is the correct outcome: those rows put a whole supplier path in `l1` and
 * are not browsable.
 */

const PATH_SEPARATOR = ' > ';
const CODE_PREFIX = 'CAT-GGL-';

type TaxonomyRow = { code: string; path: string };

/**
 * Both directions, built once at module load over 5,595 rows.
 *
 * Two maps rather than one plus a scan: every one of these is read on a product
 * detail request and on every `/c/[slug]` resolution, and an `includes` over
 * 5,595 values per call is the kind of cost that only shows up under load.
 */
const CODE_BY_PATH = new Map<string, string>();
const PATH_BY_CODE = new Map<string, string>();

(taxonomyExtract as TaxonomyRow[]).forEach((row) => {
  CODE_BY_PATH.set(row.path, row.code);
  PATH_BY_CODE.set(row.code, row.path);
});

/** The numeric half of `CAT-GGL-961`, or `null` for anything else. */
function googleIdFromCode(code: string): string | null {
  if (!code.startsWith(CODE_PREFIX)) return null;

  const id = code.slice(CODE_PREFIX.length);

  return /^\d+$/.test(id) ? id : null;
}

export type CategoryTrailEntry = {
  /** The level's own display name, exactly as the taxonomy spells it. */
  name: string;
  /**
   * The `/c/[slug]` segment, absent where the level is not addressable.
   *
   * Absent rather than guessed: a CJ-mirrored path, or a level the extract does
   * not know, must render as text rather than point at a 404.
   */
  slug?: string;
};

/**
 * `Office Supplies > General Office Supplies > Paper Products` →
 * three entries, each linkable.
 *
 * Ancestors are resolved by their own path prefix, which is why this needs the
 * whole path rather than the leaf: `Paper Products` alone is ambiguous across the
 * taxonomy, and its id belongs to the row whose full path ends there.
 */
export function categoryTrailForPath(path: string): CategoryTrailEntry[] {
  const names = path
    .split(PATH_SEPARATOR)
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  return names.map((name, index) => {
    // The first level is a department if it is one of the 21 — addressable by
    // name, and already live at that URL.
    if (index === 0) {
      const departmentSlug = departmentSlugForName(name);

      if (departmentSlug !== null) return { name, slug: departmentSlug };
    }

    const ancestorPath = names.slice(0, index + 1).join(PATH_SEPARATOR);
    const code = CODE_BY_PATH.get(ancestorPath);
    const googleId = code === undefined ? null : googleIdFromCode(code);

    return googleId === null
      ? { name }
      : { name, slug: `${slugBaseFromTitle(name)}-${googleId}` };
  });
}

/**
 * The `sals3_categories.code` a `<slug>-<id>` segment addresses, or `null`.
 *
 * Only the trailing digits are read, so the words in front of them are never
 * trusted — which is what makes a renamed category keep working and a
 * hand-mangled link resolve rather than 404. A segment with no trailing `-digits`
 * is not a taxonomy address at all; the caller tries the department list for
 * those.
 *
 * `null` for a bare number too: `/c/961` carries no readable subject, and
 * accepting it would create a second address for every category with nothing to
 * gain.
 */
export function taxonomyCodeFromSlug(slug: string): string | null {
  const match = /^(.+)-(\d+)$/.exec(slug.trim());

  if (match === null) return null;

  const [, words, id] = match;

  if (words === undefined || words.length === 0 || id === undefined)
    return null;

  const code = `${CODE_PREFIX}${id}`;

  // Checked against the extract rather than returned on shape alone, so an
  // invented id answers "no such category" here instead of reaching a query.
  return PATH_BY_CODE.has(code) ? code : null;
}

/** The path a code addresses, for a caller that needs the subtree or a title. */
export function taxonomyPathForCode(code: string): string | null {
  return PATH_BY_CODE.get(code) ?? null;
}
