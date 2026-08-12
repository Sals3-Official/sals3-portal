import { z } from 'zod';

import type { Executor } from '@/modules/catalog/candidates/repository';

import { findCategoryByCode, findPresetByCategoryCode } from './repository';
import {
  CATEGORY_ATTRIBUTE_FINDING_LABELS,
  CATEGORY_FORM_CONTRACT_VERSION,
  CATEGORY_FORM_UNAVAILABLE_REASON_LABELS,
  type CategoryAttributeFinding,
  type CategoryAttributeValidation,
  type CategoryFormContract,
  type CategoryFormUnavailableReason,
  type VariationTierCount,
} from './types';

/**
 * Category-driven required attributes and variation rules (ADR-002 §4).
 *
 * The form contract is derived entirely from the persisted taxonomy preset:
 * the required-attribute list is the allow list, and there is no branch that
 * invents a field, a default, or a tier count. When the preset is absent the
 * answer is `CATEGORY_FORM_UNAVAILABLE`, not an empty-but-confident contract
 * that a caller would read as "this category requires nothing".
 *
 * Nothing here touches price, margin, market, stock, or publication. A
 * category contract describes what a listing must *say*, never what it may
 * cost or where it may sell.
 */

/**
 * Exact prefixes the workbook actually uses. An allow list rather than a
 * regex over "N-Tier" so a future preset value this code has never seen
 * surfaces as `UNKNOWN` plus a review finding instead of being parsed into a
 * confident number of tiers.
 */
const VARIATION_TIER_PREFIXES: ReadonlyArray<[string, VariationTierCount]> = [
  ['1-Tier', 'ONE_TIER'],
  ['2-Tier', 'TWO_TIER'],
];

export function readVariationTiers(
  variationArchitecture: string | null,
): VariationTierCount {
  if (variationArchitecture === null) return 'UNKNOWN';

  const matched = VARIATION_TIER_PREFIXES.find(([prefix]) =>
    variationArchitecture.startsWith(prefix),
  );

  return matched?.[1] ?? 'UNKNOWN';
}

/**
 * Server-side shape gate for an attribute payload. Bounded in key count and
 * value length so an oversized or deeply-nested body is rejected before any
 * per-attribute work, and typed as `string` values only — a nested object or
 * array is not an attribute value this contract knows how to review.
 */
export const categoryAttributePayloadSchema = z.record(
  z.string().trim().min(1).max(120),
  z.string().max(2_000),
);

export type CategoryAttributePayload = z.infer<
  typeof categoryAttributePayloadSchema
>;

function finding(
  code: CategoryAttributeFinding['code'],
  attributeName: string | null,
): CategoryAttributeFinding {
  return {
    code,
    label: CATEGORY_ATTRIBUTE_FINDING_LABELS[code],
    attributeName,
  };
}

function unavailable(
  reason: CategoryFormUnavailableReason,
): CategoryFormContract {
  return {
    outcome: 'CATEGORY_FORM_UNAVAILABLE',
    reason,
    reasonLabel: CATEGORY_FORM_UNAVAILABLE_REASON_LABELS[reason],
    contractVersion: CATEGORY_FORM_CONTRACT_VERSION,
  };
}

export async function resolveCategoryFormContract(
  executor: Executor,
  input: { sals3CategoryCode: string; taxonomyVersion: string },
): Promise<CategoryFormContract> {
  const category = await findCategoryByCode(executor, input.sals3CategoryCode);

  if (category === null) return unavailable('CATEGORY_NOT_FOUND');

  const preset = await findPresetByCategoryCode(
    executor,
    input.sals3CategoryCode,
    input.taxonomyVersion,
  );

  if (preset === null) return unavailable('TAXONOMY_PRESET_UNAVAILABLE');

  return {
    outcome: 'CATEGORY_FORM_CONTRACT',
    categoryCode: category.code,
    categoryPath: category.path,
    taxonomyVersion: preset.taxonomyVersion,
    variationArchitecture: preset.variationArchitecture,
    variationTiers: readVariationTiers(preset.variationArchitecture),
    tier1Attribute: preset.tier1Attribute,
    tier2Attribute: preset.tier2Attribute,
    skuFormatStandard: preset.skuFormatStandard,
    requiredAttributes: preset.requiredItemAttributes,
    source: {
      workbook: preset.sourceWorkbook,
      sheet: preset.sourceSheet,
      checksum: preset.sourceChecksum,
    },
    contractVersion: CATEGORY_FORM_CONTRACT_VERSION,
  };
}

/**
 * Checks a draft's attribute payload against the persisted preset.
 *
 * Three rules, all of them about telling the truth rather than passing:
 *
 * - a required attribute that is absent or blank produces a finding and
 *   stays absent — no placeholder, no supplier value copied in to fill it;
 * - an attribute the preset does not name is kept verbatim in
 *   `unrecognizedAttributes` (ADR-002 §4's "incompatible values move to an
 *   explicit unmapped-values panel"), never silently dropped so the form
 *   validates;
 * - a preset whose variation architecture this code cannot read is reported,
 *   not assumed to be single-tier.
 *
 * Pure: it takes an already-resolved contract, so it makes no query and can
 * never reach a supplier.
 */
export function validateCategoryAttributes(
  contract: Extract<
    CategoryFormContract,
    { outcome: 'CATEGORY_FORM_CONTRACT' }
  >,
  payload: CategoryAttributePayload,
): CategoryAttributeValidation {
  const findings: CategoryAttributeFinding[] = [];
  const acceptedAttributes: Record<string, string> = {};
  const missingRequiredAttributes: string[] = [];

  const required = new Set(contract.requiredAttributes);

  contract.requiredAttributes.forEach((name) => {
    const raw = payload[name];

    if (raw === undefined || raw.trim() === '') {
      missingRequiredAttributes.push(name);
      findings.push(
        finding(
          raw === undefined
            ? 'REQUIRED_ATTRIBUTE_MISSING'
            : 'REQUIRED_ATTRIBUTE_BLANK',
          name,
        ),
      );
      return;
    }

    acceptedAttributes[name] = raw.trim();
  });

  const unrecognizedAttributes = Object.entries(payload)
    .filter(([name]) => !required.has(name))
    .map(([name, value]) => ({ name, value }));

  unrecognizedAttributes.forEach(({ name }) => {
    findings.push(finding('UNRECOGNIZED_ATTRIBUTE_PRESERVED', name));
  });

  if (contract.variationTiers === 'UNKNOWN') {
    findings.push(finding('VARIATION_ARCHITECTURE_UNRECOGNIZED', null));
  }

  return {
    outcome: findings.length === 0 ? 'VALID' : 'NEEDS_REVIEW',
    categoryCode: contract.categoryCode,
    taxonomyVersion: contract.taxonomyVersion,
    acceptedAttributes,
    missingRequiredAttributes,
    unrecognizedAttributes,
    findings,
    contractVersion: contract.contractVersion,
  };
}
