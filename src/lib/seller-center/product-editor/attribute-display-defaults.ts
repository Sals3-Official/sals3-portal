/**
 * Buyer-facing display defaults for a small, fixed set of category
 * attributes whose raw workbook token or unresolved state would otherwise
 * read as a technical artifact rather than a real answer.
 *
 * Display only. Neither function changes what is submitted or stored —
 * `save-category-attributes.ts` still receives and persists the seller's
 * actual raw pick (e.g. the literal `UNBRANDED` token), and an unresolved
 * field is still unresolved for readiness/blocker purposes. This exists
 * only to stop `UNBRANDED` and a bare empty dropdown from reading like
 * technical debt to a buyer.
 *
 * The attribute names matched here mirror the finalized taxonomy workbook's
 * attribute-controls dictionary
 * (`src/lib/db/seed-data/sals3-category-attribute-controls-v1.json`) as of
 * this pass — "Brand", "Brand / Publisher", and "Country of Origin" are its
 * exact `attributeName` strings. A future workbook revision that renames one
 * of these needs this list kept in step; there is no shared machine-readable
 * key (`canonicalAttributeKey`) threaded through to the editor fixture today
 * to match on instead.
 */

const BRAND_ATTRIBUTE_NAMES = new Set(['Brand', 'Brand / Publisher']);
const COUNTRY_OF_ORIGIN_ATTRIBUTE_NAME = 'Country of Origin';

/** The workbook's own "no real brand" token — never shown to a seller or buyer verbatim. */
const UNBRANDED_TOKEN = 'UNBRANDED';

const NO_BRAND_DISPLAY_LABEL = 'Generic';
const UNKNOWN_ORIGIN_DISPLAY_LABEL = 'Others';
const DEFAULT_PLACEHOLDER = 'Select a value';

/**
 * The label shown for one already-selected (or selectable) dropdown value.
 * Only `UNBRANDED` on a Brand-family attribute is remapped; every other
 * value, on every other attribute, is returned unchanged.
 */
export function categoryAttributeValueDisplayLabel(
  attributeName: string,
  rawValue: string,
): string {
  if (
    BRAND_ATTRIBUTE_NAMES.has(attributeName) &&
    rawValue === UNBRANDED_TOKEN
  ) {
    return NO_BRAND_DISPLAY_LABEL;
  }

  return rawValue;
}

/**
 * The placeholder shown while the dropdown has no value yet — a display
 * default standing in for "buyers will read this as X until you decide
 * otherwise," never a silently pre-selected answer. `field.unresolved`
 * still drives the real blocker/warning severity, unaffected by this text.
 */
export function categoryAttributeUnresolvedPlaceholder(
  attributeName: string,
): string {
  if (BRAND_ATTRIBUTE_NAMES.has(attributeName)) return NO_BRAND_DISPLAY_LABEL;
  if (attributeName === COUNTRY_OF_ORIGIN_ATTRIBUTE_NAME) {
    return UNKNOWN_ORIGIN_DISPLAY_LABEL;
  }

  return DEFAULT_PLACEHOLDER;
}
