import {
  PRODUCT_BRAND_LABELS,
  PRODUCT_BRANDS,
  PRODUCT_CATEGORIES,
  PRODUCT_CATEGORY_LABELS,
} from '@/lib/products/constants';
import type { Product } from '@/lib/products/types';
import SelectField from './SelectField';
import TextField from './TextField';
import TextareaField from './TextareaField';

type DetailsTabProps = {
  product: Product | null;
  fieldErrors: Record<string, string[]>;
};

const CATEGORY_OPTIONS = PRODUCT_CATEGORIES.map((value) => ({
  value,
  label: PRODUCT_CATEGORY_LABELS[value],
}));

const BRAND_OPTIONS = PRODUCT_BRANDS.map((value) => ({
  value,
  label: PRODUCT_BRAND_LABELS[value],
}));

/** Name, description, category, and brand. */
export default function DetailsTab({ product, fieldErrors }: DetailsTabProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="md:col-span-2">
        <TextField
          name="name"
          label="Product name"
          required
          defaultValue={product?.name}
          hint="Use words a shopper would search for."
          errors={fieldErrors.name}
        />
      </div>
      <div className="md:col-span-2">
        <TextareaField
          name="description"
          label="Description"
          required
          rows={6}
          maxLength={5000}
          defaultValue={product?.description}
          hint="Explain what the product is and what is in the box. Use short sentences."
          errors={fieldErrors.description}
        />
      </div>
      <SelectField
        name="category"
        label="Category"
        options={CATEGORY_OPTIONS}
        defaultValue={product?.category}
        errors={fieldErrors.category}
      />
      <SelectField
        name="brand"
        label="Brand"
        options={BRAND_OPTIONS}
        defaultValue={product?.brand}
        errors={fieldErrors.brand}
      />
    </div>
  );
}
