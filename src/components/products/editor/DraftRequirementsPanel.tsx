import { CircleDashed } from 'lucide-react';
import {
  DRAFT_MISSING_REQUIREMENT_EXPLANATIONS,
  type DraftMissingRequirement,
} from '@/modules/catalog/products/contracts';
import type { DescriptionDocument } from '@/modules/catalog/products/description-document';
import type { ProductEditorData } from '@/modules/catalog/products/editor-queries';

type DraftRequirementsPanelProps = {
  product: ProductEditorData['product'];
  variants: ProductEditorData['variants'];
  descriptionDocument: DescriptionDocument;
};

/**
 * Why this draft is not a listable product - derived from the CURRENT rows on
 * every render, never the stale list recorded at creation time. Saving a
 * description makes that requirement disappear on the next load; nothing else
 * on this panel is seller-fixable yet, and the copy says which is which.
 *
 * There is deliberately no Publish button anywhere on this page: publication
 * is a separate, unbuilt flow with database-enforced gates, and a disabled
 * fake button would imply it works somewhere else.
 */
export default function DraftRequirementsPanel({
  product,
  variants,
  descriptionDocument,
}: DraftRequirementsPanelProps) {
  const missing: DraftMissingRequirement[] = [];

  if (variants.length === 0) missing.push('NO_PERSISTED_SUPPLIER_EVIDENCE');
  if (descriptionDocument.blocks.length === 0)
    missing.push('STRUCTURED_DESCRIPTION_REQUIRED');
  if (product.categoryMappingConfidence === 'UNMAPPED')
    missing.push('CATEGORY_MAPPING_REQUIRED');
  if (variants.length > 0) missing.push('PRODUCT_OPTIONS_UNMAPPED');
  if (product.categoryMappingConfidence === 'UNMAPPED')
    missing.push('PRICING_UNRESOLVED');
  // Unconditional, honestly: `product_media_sources` has NO write path anywhere
  // in this repo (its own schema comment says the candidate-to-draft flow
  // writes no rows), so every product is missing media provenance. When a
  // media flow ships, this panel must learn to read that table instead.
  missing.push('MEDIA_SOURCE_NOT_RECORDED');

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-base font-semibold">Before this can publish</h2>
      {missing.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No missing requirement is derivable from this record - but publishing
          itself is not built yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {missing.map((code) => (
            <li key={code} className="flex items-start gap-2">
              <CircleDashed
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-ink-faint"
              />
              <span className="text-sm text-ink-muted">
                {DRAFT_MISSING_REQUIREMENT_EXPLANATIONS[code]}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-ink-subtle">
        Publishing is a separate flow that does not exist yet. The description
        is fixable here; category mapping, option mapping, pricing, and media
        are not built anywhere in this portal.
      </p>
    </section>
  );
}
