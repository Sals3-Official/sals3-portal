export const MINIMUM_RETAIL_MARKUP_BASIS_POINTS = 250;

const BASIS_POINTS = 10_000;

/**
 * Lowest seller-entered retail price allowed for a matching supplier cost.
 *
 * The floor is supplier cost plus 2.5%, rounded up to the next minor currency
 * unit so fractional cents never round the seller below the required spread.
 */
export function minimumRetailAmountMinorForSupplierCost(
  supplierCostMinor: number,
): number {
  if (supplierCostMinor <= 0) return 1;

  return Math.ceil(
    (supplierCostMinor * (BASIS_POINTS + MINIMUM_RETAIL_MARKUP_BASIS_POINTS)) /
      BASIS_POINTS,
  );
}

export function clampRetailAmountMinorToSupplierFloor(
  amountMinor: number,
  supplierCostMinor: number,
): number {
  if (amountMinor <= 0) return amountMinor;

  return Math.max(
    amountMinor,
    minimumRetailAmountMinorForSupplierCost(supplierCostMinor),
  );
}
