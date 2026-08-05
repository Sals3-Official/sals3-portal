import { minorToPesoInput } from '@/lib/money';
import type { Product } from '@/lib/products/types';
import TextField from './TextField';

type PricingTabProps = {
  product: Product | null;
  fieldErrors: Record<string, string[]>;
};

function optionalPeso(amountMinor: number | null | undefined): string {
  return amountMinor === null || amountMinor === undefined
    ? ''
    : minorToPesoInput(amountMinor);
}

/** Regular, sale, and cost price, plus the scheduled discount window. */
export default function PricingTab({ product, fieldErrors }: PricingTabProps) {
  const pricing = product?.pricing;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <TextField
        name="regularPrice"
        label="Regular price (PHP)"
        required
        inputMode="decimal"
        placeholder="2499.00"
        defaultValue={optionalPeso(pricing?.regularMinor)}
        errors={fieldErrors.regularPrice}
      />
      <TextField
        name="salePrice"
        label="Sale price (PHP)"
        inputMode="decimal"
        placeholder="Leave empty for no sale"
        defaultValue={optionalPeso(pricing?.saleMinor)}
        hint="The sale price must be lower than the regular price."
        errors={fieldErrors.salePrice}
      />
      <TextField
        name="costPrice"
        label="Cost price (PHP)"
        inputMode="decimal"
        defaultValue={optionalPeso(pricing?.costMinor)}
        hint="Only your team sees this. It is never shown to shoppers."
        errors={fieldErrors.costPrice}
      />
      <div className="hidden md:block" />
      <TextField
        name="discountStartsAt"
        label="Discount starts"
        type="date"
        defaultValue={pricing?.discountStartsAt ?? ''}
        errors={fieldErrors.discountStartsAt}
      />
      <TextField
        name="discountEndsAt"
        label="Discount ends"
        type="date"
        defaultValue={pricing?.discountEndsAt ?? ''}
        errors={fieldErrors.discountEndsAt}
      />
    </div>
  );
}
