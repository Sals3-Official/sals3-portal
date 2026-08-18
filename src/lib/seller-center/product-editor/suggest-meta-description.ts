/**
 * A deterministic, local starting point for the Meta Description field —
 * never an AI call (owner scope: no network request to a generation
 * provider in this pass). Composed from data already on screen: product
 * name, category, a few specification/variant highlights, brand, and the
 * product description's own opening sentence. Always editable, and never
 * itself persisted — only what the seller confirms (by leaving it, or
 * changing it) is ever saved.
 */

const TARGET_MAX_CHARS = 160;

/**
 * Brand labels that mean "no real brand" and should never lead a suggested
 * snippet — matching the same buyer-facing default the Basic Information
 * brand declaration and the workbook's `UNBRANDED` category attribute use.
 */
const GENERIC_BRAND_LABELS = new Set([
  '',
  'generic',
  'no brand / generic',
  'unbranded',
]);

function firstSentence(text: string): string | null {
  const trimmed = text.trim();

  if (trimmed === '') return null;

  const match = /^[^.!?\n]+[.!?]?/.exec(trimmed);

  return (match?.[0] ?? trimmed).trim();
}

/** Truncates on a word boundary rather than mid-word, with an ellipsis. */
function truncateAtWord(text: string, max: number): string {
  if (text.length <= max) return text;

  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const boundary = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;

  return `${boundary.trimEnd()}…`;
}

export type MetaDescriptionSuggestionInput = {
  productName: string;
  /** e.g. `categoryPath`'s last segment, or `null` when unmapped. */
  categoryLabel: string | null;
  brandDeclaration: string;
  descriptionText: string;
  /** A few already-filled specification/category-attribute values. */
  specificationHighlights: string[];
  /** Buyer-facing variant labels (e.g. from the Variant Matrix), deduped. */
  variantHighlights: string[];
};

export function suggestMetaDescription(
  input: MetaDescriptionSuggestionInput,
): string {
  const brand = input.brandDeclaration.trim();
  const includeBrand = !GENERIC_BRAND_LABELS.has(brand.toLowerCase());

  const lead = [includeBrand ? brand : null, input.productName.trim()]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(' ');

  const highlights = [
    ...input.specificationHighlights,
    ...input.variantHighlights,
  ]
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .slice(0, 3);

  const highlightText = highlights.length > 0 ? highlights.join(', ') : null;

  const summary = firstSentence(input.descriptionText);

  const candidate = [
    lead,
    input.categoryLabel?.trim() || null,
    highlightText,
    summary,
  ]
    .filter((part): part is string => part !== null && part.length > 0)
    .join('. ');

  return truncateAtWord(candidate.trim(), TARGET_MAX_CHARS);
}
