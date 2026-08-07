import type { CandidateEvidence } from '@/lib/cj/evidence';

/** Falls back to the CJ product id when no evidence has been captured yet. */
export function displayName(
  externalProductId: string,
  evidence: CandidateEvidence | null,
): string {
  return evidence?.name && evidence.name !== ''
    ? evidence.name
    : externalProductId;
}

export function totalStock(evidence: CandidateEvidence | null): number | null {
  if (evidence === null) return null;

  const known = evidence.variants
    .map((variant) => variant.totalInventory)
    .filter((value): value is number => value !== null);

  return known.length === 0
    ? null
    : known.reduce((sum, value) => sum + value, 0);
}

export function shippingOrigins(evidence: CandidateEvidence | null): string {
  if (evidence === null) return '—';

  const stocked = evidence.warehouses.filter(
    (warehouse) => (warehouse.totalInventory ?? 0) > 0,
  );

  return stocked.length === 0
    ? '—'
    : stocked.map((warehouse) => warehouse.name).join(', ');
}

export function formatUsd(value: number | null): string {
  return value === null ? '—' : `$${value.toFixed(2)}`;
}

export function formatStock(value: number | null): string {
  return value === null ? '—' : String(value);
}
