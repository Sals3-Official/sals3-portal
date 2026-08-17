import { z } from 'zod';

import type { Executor } from '@/modules/catalog/candidates/repository';
import type { AttributeInputControlType } from '@/lib/db/schema';

import {
  findAttributeControlsByCategoryCode,
  findCategoryByCode,
} from './repository';
import {
  ATTRIBUTE_SUBMISSION_FINDING_LABELS,
  CATEGORY_ATTRIBUTE_CONTRACT_UNAVAILABLE_REASON_LABELS,
  CATEGORY_ATTRIBUTE_CONTRACT_VERSION,
  type AcceptedAttributeValue,
  type AttributeSubmissionFinding,
  type CategoryAttributeContract,
  type CategoryAttributeContractUnavailableReason,
  type CategoryAttributeControl,
  type CategoryAttributeSubmissionValidation,
} from './attribute-types';

/**
 * Category-driven attribute controls for the Product Editor's Specification
 * section (owner brief, workbook `Category_Attribute_Controls` sheet).
 *
 * Same discipline as `category-form.ts`: the contract is derived entirely
 * from persisted control rows, there is no branch that invents a control, a
 * default, or an allowed value, and an absent contract is reported as
 * `CATEGORY_ATTRIBUTE_CONTRACT_UNAVAILABLE`, never an empty-but-confident
 * contract a caller would read as "this category has no specifications".
 */

const DROPDOWN_TYPES: ReadonlySet<AttributeInputControlType> = new Set([
  'SINGLE_SELECT_DROPDOWN',
  'MULTI_SELECT_DROPDOWN',
]);

/**
 * Server-side shape gate for a submission payload. Every attribute submits
 * as a string array - 0 or 1 entries for a single-value control, N for
 * multi-select - one consistent shape instead of a second schema per control
 * type. Bounded in key count/length and array size so an oversized or
 * deeply-nested body is rejected before any per-attribute work.
 */
export const categoryAttributeSubmissionSchema = z.record(
  z.string().trim().min(1).max(120),
  z.array(z.string().max(2_000)).max(50),
);

export type CategoryAttributeSubmissionPayload = z.infer<
  typeof categoryAttributeSubmissionSchema
>;

/** Exact shapes this code accepts for a non-dropdown control's value string. Never guessed, never coerced. */
const VALUE_SHAPE_PATTERNS: Partial<Record<AttributeInputControlType, RegExp>> =
  {
    NUMBER_INPUT: /^-?\d+(\.\d+)?$/,
    MEASUREMENT_INPUT: /^-?\d+(\.\d+)?\s?[a-zA-Z%]*$/,
    BOOLEAN_TOGGLE: /^(true|false)$/,
    DATE_PICKER: /^\d{4}-\d{2}-\d{2}$/,
  };

function isValueShapeValid(
  inputControlType: AttributeInputControlType,
  value: string,
): boolean {
  const pattern = VALUE_SHAPE_PATTERNS[inputControlType];

  return pattern === undefined ? true : pattern.test(value);
}

function finding(
  code: AttributeSubmissionFinding['code'],
  attributeName: string | null,
): AttributeSubmissionFinding {
  return {
    code,
    label: ATTRIBUTE_SUBMISSION_FINDING_LABELS[code],
    attributeName,
  };
}

function unavailable(
  reason: CategoryAttributeContractUnavailableReason,
): CategoryAttributeContract {
  return {
    outcome: 'CATEGORY_ATTRIBUTE_CONTRACT_UNAVAILABLE',
    reason,
    reasonLabel: CATEGORY_ATTRIBUTE_CONTRACT_UNAVAILABLE_REASON_LABELS[reason],
    contractVersion: CATEGORY_ATTRIBUTE_CONTRACT_VERSION,
  };
}

export async function resolveCategoryAttributeContract(
  executor: Executor,
  input: { sals3CategoryCode: string; controlsVersion: string },
): Promise<CategoryAttributeContract> {
  const category = await findCategoryByCode(executor, input.sals3CategoryCode);

  if (category === null) return unavailable('CATEGORY_NOT_FOUND');

  const controlRows = await findAttributeControlsByCategoryCode(
    executor,
    input.sals3CategoryCode,
    input.controlsVersion,
  );

  if (controlRows.length === 0)
    return unavailable('ATTRIBUTE_CONTROLS_UNAVAILABLE');

  const first = controlRows[0];

  return {
    outcome: 'CATEGORY_ATTRIBUTE_CONTRACT',
    categoryCode: category.code,
    categoryPath: category.path,
    controlsVersion: input.controlsVersion,
    controls: controlRows.map((row) => ({
      attributeName: row.attributeName,
      requirementLevel: row.requirementLevel,
      inputControlType: row.inputControlType,
      allowedValues: row.allowedValues,
      allowCustomValue: row.allowCustomValue,
      allowMultipleValues: row.allowMultipleValues,
      sellerHelpText: row.sellerHelpText,
      seoVisibility: row.seoVisibility,
      aeoGeoVisibility: row.aeoGeoVisibility,
    })),
    source: {
      workbook: first.sourceWorkbook,
      sheet: first.sourceSheet,
      checksum: first.sourceChecksum,
    },
    contractVersion: CATEGORY_ATTRIBUTE_CONTRACT_VERSION,
  };
}

/**
 * Validates one control's submitted values against its own rules. Returns
 * the findings raised and, when accepted, the value to store - never both a
 * finding and an accepted value for the same problem.
 */
function evaluateControl(
  control: CategoryAttributeControl,
  rawValues: readonly string[] | undefined,
): {
  findings: AttributeSubmissionFinding[];
  accepted: AcceptedAttributeValue | null;
  missing: 'REQUIRED' | 'RECOMMENDED' | null;
} {
  const trimmed = (rawValues ?? [])
    .map((value) => value.trim())
    .filter(Boolean);

  if (trimmed.length === 0) {
    if (control.requirementLevel === 'REQUIRED') {
      const code =
        rawValues === undefined
          ? 'REQUIRED_ATTRIBUTE_MISSING'
          : 'REQUIRED_ATTRIBUTE_BLANK';

      return {
        findings: [finding(code, control.attributeName)],
        accepted: null,
        missing: 'REQUIRED',
      };
    }

    if (control.requirementLevel === 'RECOMMENDED') {
      return {
        findings: [
          finding('RECOMMENDED_ATTRIBUTE_MISSING', control.attributeName),
        ],
        accepted: null,
        missing: 'RECOMMENDED',
      };
    }

    return { findings: [], accepted: null, missing: null };
  }

  const findings: AttributeSubmissionFinding[] = [];
  const isDropdown = DROPDOWN_TYPES.has(control.inputControlType);

  const usable = control.allowMultipleValues ? trimmed : trimmed.slice(0, 1);

  if (!control.allowMultipleValues && trimmed.length > 1) {
    findings.push(
      finding('MULTIPLE_VALUES_NOT_PERMITTED', control.attributeName),
    );
  }

  let isCustomValue = false;
  const acceptedValues: string[] = [];

  usable.forEach((value) => {
    if (isDropdown) {
      if (control.allowedValues.includes(value)) {
        acceptedValues.push(value);
        return;
      }

      if (control.allowCustomValue) {
        acceptedValues.push(value);
        isCustomValue = true;
        return;
      }

      findings.push(
        finding('VALUE_NOT_IN_ALLOWED_LIST', control.attributeName),
      );
      return;
    }

    if (!isValueShapeValid(control.inputControlType, value)) {
      findings.push(finding('VALUE_SHAPE_INVALID', control.attributeName));
      return;
    }

    acceptedValues.push(value);
  });

  return {
    findings,
    accepted:
      acceptedValues.length === 0
        ? null
        : { values: acceptedValues, isCustomValue },
    missing: null,
  };
}

/**
 * Checks a draft's attribute submission against the resolved contract.
 *
 * Three rules, same posture as `validateCategoryAttributes` in
 * `category-form.ts`:
 *
 * - a REQUIRED control that is absent or blank produces a finding and stays
 *   absent - no placeholder, no value invented to fill it;
 * - an attribute name the contract does not list is kept verbatim in
 *   `unrecognizedAttributes`, never silently dropped;
 * - a dropdown value outside `Allowed Values` is rejected unless the control
 *   permits a custom value, in which case it is accepted and flagged.
 *
 * Pure: it takes an already-resolved contract, so it makes no query.
 */
export function validateCategoryAttributeSubmission(
  contract: Extract<
    CategoryAttributeContract,
    { outcome: 'CATEGORY_ATTRIBUTE_CONTRACT' }
  >,
  payload: CategoryAttributeSubmissionPayload,
): CategoryAttributeSubmissionValidation {
  const findings: AttributeSubmissionFinding[] = [];
  const acceptedAttributes: Record<string, AcceptedAttributeValue> = {};
  const missingRequiredAttributes: string[] = [];
  const missingRecommendedAttributes: string[] = [];

  const controlByName = new Map(
    contract.controls.map((control) => [control.attributeName, control]),
  );

  contract.controls.forEach((control) => {
    const result = evaluateControl(control, payload[control.attributeName]);

    findings.push(...result.findings);

    if (result.accepted !== null) {
      acceptedAttributes[control.attributeName] = result.accepted;
    }

    if (result.missing === 'REQUIRED') {
      missingRequiredAttributes.push(control.attributeName);
    } else if (result.missing === 'RECOMMENDED') {
      missingRecommendedAttributes.push(control.attributeName);
    }
  });

  const unrecognizedAttributes = Object.entries(payload)
    .filter(([name]) => !controlByName.has(name))
    .map(([name, values]) => ({ name, values }));

  unrecognizedAttributes.forEach(({ name }) => {
    findings.push(finding('UNRECOGNIZED_ATTRIBUTE_PRESERVED', name));
  });

  return {
    outcome: findings.length === 0 ? 'VALID' : 'NEEDS_REVIEW',
    categoryCode: contract.categoryCode,
    controlsVersion: contract.controlsVersion,
    acceptedAttributes,
    missingRequiredAttributes,
    missingRecommendedAttributes,
    unrecognizedAttributes,
    findings,
    contractVersion: contract.contractVersion,
  };
}
