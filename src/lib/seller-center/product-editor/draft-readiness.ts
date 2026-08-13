import {
  DRAFT_MISSING_REQUIREMENT_EXPLANATIONS,
  type DraftMissingRequirement,
} from '@/modules/catalog/products/contracts';
import type { DescriptionDocument } from '@/modules/catalog/products/description-document';
import type { EditorSectionId, IssueSeverity, ReadinessIssue } from './types';

/**
 * Why a real draft cannot publish, in the vocabulary the editor's readiness UI
 * already speaks.
 *
 * Two jobs, deliberately in a pure module with no database and no React:
 *
 * 1. `deriveMissingRequirements` recomputes the missing set from the CURRENT
 *    rows on every render, never from the list recorded at creation time. Saving
 *    a description makes that requirement disappear on the next load; a stored
 *    snapshot would keep asserting it forever.
 * 2. `toReadinessIssues` translates those codes into `ReadinessIssue`, which is
 *    what lets `ReadinessIssueList`, `ReadinessSummary`, `ReadinessStatusHeader`
 *    and `EditorSectionNavigation` - all reviewed, all previously fixture-only -
 *    run on real data without a fictional `ProductEditorFixture` behind them.
 *
 * `resolution` is honest per code: only the description is fixable in this
 * portal today, and the others say where the work actually lives instead of
 * implying a button exists.
 */

type RequirementPresentation = {
  title: string;
  section: EditorSectionId;
  severity: IssueSeverity;
  resolution: string;
};

const UNBUILT_ELSEWHERE =
  'Not fixable here. This needs a flow that does not exist in this portal yet.';

const PRESENTATION: Record<DraftMissingRequirement, RequirementPresentation> = {
  NO_PERSISTED_SUPPLIER_EVIDENCE: {
    title: 'No supplier evidence stored',
    section: 'variants',
    severity: 'BLOCKER',
    resolution:
      'Re-check this product in Product Sourcing so its supplier detail is captured, then this draft can gain variants.',
  },
  NO_SUPPLIER_VARIANTS_IN_EVIDENCE: {
    title: 'Stored evidence lists no variants',
    section: 'variants',
    severity: 'BLOCKER',
    resolution:
      'The supplier reported no variants when the evidence was captured. A fresh check may find some.',
  },
  CATEGORY_MAPPING_REQUIRED: {
    title: 'No Sals3 category mapped',
    section: 'basic',
    severity: 'BLOCKER',
    resolution: UNBUILT_ELSEWHERE,
  },
  PRODUCT_OPTIONS_UNMAPPED: {
    title: 'Supplier options not mapped',
    section: 'variants',
    severity: 'BLOCKER',
    resolution: UNBUILT_ELSEWHERE,
  },
  PRICING_UNRESOLVED: {
    title: 'No price resolved',
    section: 'variants',
    severity: 'BLOCKER',
    resolution:
      'Pricing is server-owned and needs a mapped category first. It is never set by hand here.',
  },
  NO_ACTIVE_MARKET_PROFILE: {
    title: 'No active market profile',
    section: 'markets',
    severity: 'BLOCKER',
    resolution: UNBUILT_ELSEWHERE,
  },
  SUPPLIER_CONNECTION_UNHEALTHY: {
    title: 'Supplier connection not workable',
    section: 'variants',
    severity: 'WARNING',
    resolution:
      'Reconnect or reauthorize the supplier connection in Supplier Settings, then re-check this product.',
  },
  MEDIA_SOURCE_NOT_RECORDED: {
    title: 'No media provenance recorded',
    section: 'media',
    severity: 'BLOCKER',
    resolution: UNBUILT_ELSEWHERE,
  },
  STRUCTURED_DESCRIPTION_REQUIRED: {
    title: 'Description is empty',
    section: 'description',
    severity: 'BLOCKER',
    // The one requirement a seller can actually clear on this page.
    resolution:
      'Write the description in the Description section below and save. This is fixable here.',
  },
  EDITORIAL_RECORD_STEWARDED_BY_ANOTHER_SELLER: {
    title: 'Content owned by another account',
    section: 'basic',
    severity: 'BLOCKER',
    resolution:
      'Another Dropshipper stewards this product record. Your offers exist; its content is not editable here.',
  },
};

export function deriveMissingRequirements(input: {
  categoryMappingConfidence: string;
  variantCount: number;
  descriptionDocument: DescriptionDocument;
}): DraftMissingRequirement[] {
  const missing: DraftMissingRequirement[] = [];
  const unmapped = input.categoryMappingConfidence === 'UNMAPPED';

  if (input.variantCount === 0) missing.push('NO_PERSISTED_SUPPLIER_EVIDENCE');
  if (input.descriptionDocument.blocks.length === 0)
    missing.push('STRUCTURED_DESCRIPTION_REQUIRED');
  if (unmapped) missing.push('CATEGORY_MAPPING_REQUIRED');
  if (input.variantCount > 0) missing.push('PRODUCT_OPTIONS_UNMAPPED');
  if (unmapped) missing.push('PRICING_UNRESOLVED');
  // Unconditional, honestly: `product_media_sources` has NO writer anywhere in
  // this repo, so every product is missing media provenance. When a media flow
  // ships, this must learn to read that table instead of asserting the answer.
  missing.push('MEDIA_SOURCE_NOT_RECORDED');

  return missing;
}

export default function toReadinessIssues(
  codes: DraftMissingRequirement[],
): ReadinessIssue[] {
  return codes.map((code) => {
    const presentation = PRESENTATION[code];

    return {
      id: `requirement:${code}`,
      severity: presentation.severity,
      title: presentation.title,
      explanation: DRAFT_MISSING_REQUIREMENT_EXPLANATIONS[code],
      affectedScope: 'This product',
      // Derived from the product's own rows, not a supplier notification.
      source: 'AUTOMATED_VALIDATION',
      section: presentation.section,
      // These are Sals3 draft requirements, not pipeline rejection reasons.
      reasonCode: null,
      resolution: presentation.resolution,
    };
  });
}
