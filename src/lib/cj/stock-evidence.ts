/**
 * Pure derivation of a stock-evidence truth label from preserved CJ inventory
 * components (ADR-013). This carries no qualification/decision meaning by
 * itself — factory-backed or unverified stock is neither an automatic pass
 * nor a permanent block; that policy call belongs to a future versioned
 * decision, not to this module.
 */

export const STOCK_EVIDENCE_LABELS = [
  'CJ_WAREHOUSE_STOCK',
  'FACTORY_BACKED_STOCK',
  'MIXED_STOCK',
  'ZERO_STOCK',
  'UNKNOWN_STOCK',
] as const;

export type StockEvidenceLabel = (typeof STOCK_EVIDENCE_LABELS)[number];

/** One preserved CJ inventory observation for one variant in one country. */
export type StockObservation = {
  countryCode: string;
  cjInventory: number | null;
  factoryInventory: number | null;
  totalInventory: number | null;
};

/**
 * Classifies a set of per-origin stock observations (typically one variant's
 * `stockByOrigin`, but the same rule applies at any grouping):
 *
 * - `UNKNOWN_STOCK` when no observation reports a known total.
 * - `ZERO_STOCK` when every known total is zero or negative.
 * - `CJ_WAREHOUSE_STOCK` / `FACTORY_BACKED_STOCK` / `MIXED_STOCK` when at
 *   least one origin has positive stock, attributed to CJ's own warehouse
 *   pool, the factory pool, or both across the observed origins.
 * - `UNKNOWN_STOCK` also covers the CJ data anomaly where a positive total is
 *   reported but neither `cjInventory` nor `factoryInventory` accounts for
 *   it — never guessed, per ADR-013.
 */
export function deriveStockEvidence(
  observations: StockObservation[],
): StockEvidenceLabel {
  const known = observations.filter((o) => o.totalInventory !== null);

  if (known.length === 0) return 'UNKNOWN_STOCK';

  const positive = known.filter((o) => (o.totalInventory ?? 0) > 0);

  if (positive.length === 0) return 'ZERO_STOCK';

  const hasCjStock = positive.some((o) => (o.cjInventory ?? 0) > 0);
  const hasFactoryStock = positive.some((o) => (o.factoryInventory ?? 0) > 0);

  if (hasCjStock && hasFactoryStock) return 'MIXED_STOCK';
  if (hasCjStock) return 'CJ_WAREHOUSE_STOCK';
  if (hasFactoryStock) return 'FACTORY_BACKED_STOCK';

  return 'UNKNOWN_STOCK';
}
