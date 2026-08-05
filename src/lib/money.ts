export type Money = {
  amountMinor: number;
  currency: 'PHP';
};

export function peso(amountMinor: number): Money {
  return { amountMinor, currency: 'PHP' };
}

export function formatMoney(money: Money): string {
  const majorUnits = money.amountMinor / 100;
  const formatted = majorUnits.toLocaleString('en-PH', {
    minimumFractionDigits: majorUnits % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
  return `₱${formatted}`;
}

/**
 * Reads a typed peso amount into centavos. Accepts "2499", "2,499.50", and
 * "₱2,499.50"; returns null for anything else, so the caller reports a field
 * error instead of storing a wrong price.
 */
export function parsePesosToMinor(value: string): number | null {
  const cleaned = value.replace(/[₱,\s]/g, '');

  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
    return null;
  }

  return Math.round(Number(cleaned) * 100);
}

/** Centavos back to the plain decimal string a number input expects. */
export function minorToPesoInput(amountMinor: number): string {
  return (amountMinor / 100).toFixed(2);
}

export function percentOff(
  oldAmountMinor: number,
  newAmountMinor: number,
): string {
  const off = Math.round((1 - newAmountMinor / oldAmountMinor) * 100);
  return `-${off}%`;
}
