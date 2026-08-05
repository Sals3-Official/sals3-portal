import type { Product } from '@/lib/products/types';
import TextField from './TextField';

type InventoryTabProps = {
  product: Product | null;
  fieldErrors: Record<string, string[]>;
};

/** Product-level SKU and the retail barcode numbers. */
export default function InventoryTab({
  product,
  fieldErrors,
}: InventoryTabProps) {
  const identifiers = product?.identifiers;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TextField
        name="sku"
        label="SKU"
        required
        defaultValue={identifiers?.sku}
        hint="3 to 32 letters, numbers, or dashes. Example: TOWER-COOLER-01."
        errors={fieldErrors.sku}
      />
      <TextField
        name="barcode"
        label="Internal barcode"
        defaultValue={identifiers?.barcode ?? ''}
        hint="Optional. Use the code your warehouse scans."
        errors={fieldErrors.barcode}
      />
      <TextField
        name="upc"
        label="UPC"
        inputMode="numeric"
        defaultValue={identifiers?.upc ?? ''}
        hint="12 numbers. Leave empty if the product has none."
        errors={fieldErrors.upc}
      />
      <TextField
        name="ean"
        label="EAN"
        inputMode="numeric"
        defaultValue={identifiers?.ean ?? ''}
        hint="13 numbers. Leave empty if the product has none."
        errors={fieldErrors.ean}
      />
    </div>
  );
}
