import {
  SHIPPING_CLASS_LABELS,
  SHIPPING_CLASSES,
} from '@/lib/products/constants';
import type { Product } from '@/lib/products/types';
import SelectField from './SelectField';
import TextField from './TextField';

type ShippingTabProps = {
  product: Product | null;
  fieldErrors: Record<string, string[]>;
};

const CLASS_OPTIONS = SHIPPING_CLASSES.map((value) => ({
  value,
  label: SHIPPING_CLASS_LABELS[value],
}));

/** Weight, size, shipping class, and delivery restrictions. */
export default function ShippingTab({
  product,
  fieldErrors,
}: ShippingTabProps) {
  const shipping = product?.shipping;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TextField
        name="weightGrams"
        label="Weight (grams)"
        required
        type="number"
        min={1}
        defaultValue={shipping?.weightGrams.toString()}
        errors={fieldErrors.weightGrams}
      />
      <SelectField
        name="shippingClass"
        label="Shipping class"
        options={CLASS_OPTIONS}
        defaultValue={shipping?.shippingClass}
        errors={fieldErrors.shippingClass}
      />
      <TextField
        name="lengthMm"
        label="Length (mm)"
        required
        type="number"
        min={1}
        defaultValue={shipping?.lengthMm.toString()}
        errors={fieldErrors.lengthMm}
      />
      <TextField
        name="widthMm"
        label="Width (mm)"
        required
        type="number"
        min={1}
        defaultValue={shipping?.widthMm.toString()}
        errors={fieldErrors.widthMm}
      />
      <TextField
        name="heightMm"
        label="Height (mm)"
        required
        type="number"
        min={1}
        defaultValue={shipping?.heightMm.toString()}
        errors={fieldErrors.heightMm}
      />
      <div className="md:col-span-2">
        <TextField
          name="restrictedRegions"
          label="Delivery restrictions"
          defaultValue={shipping?.restrictedRegions.join(', ')}
          hint="Separate places with commas. Leave empty to deliver everywhere."
          errors={fieldErrors.restrictedRegions}
        />
      </div>
    </div>
  );
}
