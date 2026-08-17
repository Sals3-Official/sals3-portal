import type {
  AttributeAeoGeoVisibility,
  AttributeInputControlType,
  AttributeRequirementLevel,
  AttributeSeoVisibility,
} from '@/lib/db/schema';

/**
 * Contracts for category-driven attribute controls (the Product Editor's
 * "Specification" section) - dropdowns, multi-selects, text/number/
 * measurement/boolean/date fields extracted from the finalized taxonomy
 * workbook's `Category_Attribute_Controls`/`Attribute_Control_Dictionary`
 * sheets.
 *
 * Deliberately a new, parallel contract - not an extension of
 * `CategoryFormContract` in `types.ts`. That contract answers a different
 * question (variation tiers, SKU format) and has its own version; nothing
 * here changes its shape or its callers. `CATEGORY_ATTRIBUTE_CONTRACT_VERSION`
 * is bumped only when *this* contract's shape changes.
 */

export const CATEGORY_ATTRIBUTE_CONTRACT_VERSION =
  'category-attribute-contract-v1';

export type CategoryAttributeContractUnavailableReason =
  'CATEGORY_NOT_FOUND' | 'ATTRIBUTE_CONTROLS_UNAVAILABLE';

export const CATEGORY_ATTRIBUTE_CONTRACT_UNAVAILABLE_REASON_LABELS: Record<
  CategoryAttributeContractUnavailableReason,
  string
> = {
  CATEGORY_NOT_FOUND: 'Sals3 category not found',
  ATTRIBUTE_CONTROLS_UNAVAILABLE:
    'No category attribute controls for this category',
};

/**
 * One category-specific control. `complianceReviewFlag`/`sourceBasis` are
 * deliberately not included here - internal review metadata a reviewer sees
 * via the reference tables directly, not something the seller-facing form
 * contract needs to render.
 */
export type CategoryAttributeControl = {
  attributeName: string;
  requirementLevel: AttributeRequirementLevel;
  inputControlType: AttributeInputControlType;
  allowedValues: readonly string[];
  allowCustomValue: boolean;
  allowMultipleValues: boolean;
  sellerHelpText: string | null;
  seoVisibility: AttributeSeoVisibility;
  aeoGeoVisibility: AttributeAeoGeoVisibility;
};

export type CategoryAttributeContract =
  | {
      outcome: 'CATEGORY_ATTRIBUTE_CONTRACT';
      categoryCode: string;
      categoryPath: string;
      controlsVersion: string;
      /** The allow list. An attribute not named here is never accepted as a known field. */
      controls: readonly CategoryAttributeControl[];
      source: {
        workbook: string;
        sheet: string;
        checksum: string;
      };
      contractVersion: string;
    }
  | {
      outcome: 'CATEGORY_ATTRIBUTE_CONTRACT_UNAVAILABLE';
      reason: CategoryAttributeContractUnavailableReason;
      reasonLabel: string;
      contractVersion: string;
    };

export type AttributeSubmissionFindingCode =
  | 'REQUIRED_ATTRIBUTE_MISSING'
  | 'REQUIRED_ATTRIBUTE_BLANK'
  | 'RECOMMENDED_ATTRIBUTE_MISSING'
  | 'UNRECOGNIZED_ATTRIBUTE_PRESERVED'
  | 'VALUE_NOT_IN_ALLOWED_LIST'
  | 'VALUE_SHAPE_INVALID'
  | 'MULTIPLE_VALUES_NOT_PERMITTED';

export const ATTRIBUTE_SUBMISSION_FINDING_LABELS: Record<
  AttributeSubmissionFindingCode,
  string
> = {
  REQUIRED_ATTRIBUTE_MISSING: 'Required specification is missing',
  REQUIRED_ATTRIBUTE_BLANK: 'Required specification is empty',
  RECOMMENDED_ATTRIBUTE_MISSING: 'Recommended specification is missing',
  UNRECOGNIZED_ATTRIBUTE_PRESERVED:
    'Attribute is not in this category’s controls and was kept for review',
  VALUE_NOT_IN_ALLOWED_LIST: 'Value is not one of the allowed options',
  VALUE_SHAPE_INVALID: 'Value is not in the expected format for this control',
  MULTIPLE_VALUES_NOT_PERMITTED:
    'This control accepts only one value - extra values were kept for review',
};

export type AttributeSubmissionFinding = {
  code: AttributeSubmissionFindingCode;
  label: string;
  attributeName: string | null;
};

/** What was accepted for one attribute: its values and whether any came from a free-typed custom entry. */
export type AcceptedAttributeValue = {
  values: readonly string[];
  isCustomValue: boolean;
};

/**
 * `NEEDS_REVIEW` never means "rejected" and never means "fixed" - same
 * discipline as `CategoryAttributeValidation` in `types.ts`. Nothing here
 * substitutes a default, and `unrecognizedAttributes` keeps every value the
 * contract did not know about instead of dropping it to make the form pass.
 */
export type CategoryAttributeSubmissionValidation = {
  outcome: 'VALID' | 'NEEDS_REVIEW';
  categoryCode: string;
  controlsVersion: string;
  acceptedAttributes: Readonly<Record<string, AcceptedAttributeValue>>;
  missingRequiredAttributes: readonly string[];
  missingRecommendedAttributes: readonly string[];
  unrecognizedAttributes: ReadonlyArray<{
    name: string;
    values: readonly string[];
  }>;
  findings: readonly AttributeSubmissionFinding[];
  contractVersion: string;
};
