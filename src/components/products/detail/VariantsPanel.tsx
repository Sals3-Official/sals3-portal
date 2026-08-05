import { formatMoney, peso } from '@/lib/money';
import type { ProductVariant } from '@/lib/products/types';

type VariantsPanelProps = {
  variants: ProductVariant[];
};

/** Read-only variant list: options, SKU, price, and stock per variant. */
export default function VariantsPanel({ variants }: VariantsPanelProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted text-left text-xs text-ink-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Variant</th>
            <th className="px-3 py-2 font-medium">SKU</th>
            <th className="px-3 py-2 text-right font-medium">Price</th>
            <th className="px-3 py-2 text-right font-medium">Stock</th>
          </tr>
        </thead>
        <tbody>
          {variants.map((variant) => (
            <tr key={variant.id} className="border-t border-border">
              <td className="px-3 py-2">
                {Object.entries(variant.options)
                  .map(([name, value]) => `${name}: ${value}`)
                  .join(' · ')}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{variant.sku}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatMoney(peso(variant.priceMinor))}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {variant.stock === 0 ? (
                  <span className="font-medium text-red-600">Out of stock</span>
                ) : (
                  variant.stock
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
