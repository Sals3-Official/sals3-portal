import { z } from 'zod';
import { parsePesosToMinor } from '@/lib/money';
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from './constants';
import {
  productBrandSchema,
  productCategorySchema,
  productMediaSchema,
  productVariantSchema,
  salesChannelSchema,
  shippingClassSchema,
  skuSchema,
} from './schemas';

/**
 * Raw form parsing.
 *
 * The browser sends every field as a string, so this schema owns the conversion
 * and rejects anything malformed. Its keys match the form field names, so a
 * failure maps straight to the input that caused it. The result is then checked
 * again by `productInputSchema` before it reaches the store - the client-side
 * checks are a convenience, and this is the real gate.
 */

const money = (label: string) =>
  z.string().transform((value, ctx) => {
    const minor = parsePesosToMinor(value);

    if (minor === null) {
      ctx.addIssue({ code: 'custom', message: `Enter ${label} as a number.` });

      return z.NEVER;
    }

    return minor;
  });

const optionalMoney = (label: string) =>
  z
    .string()
    .transform((value, ctx) => {
      if (value.trim() === '') {
        return null;
      }

      const minor = parsePesosToMinor(value);

      if (minor === null) {
        ctx.addIssue({
          code: 'custom',
          message: `Enter ${label} as a number.`,
        });

        return z.NEVER;
      }

      return minor;
    })
    .nullable()
    .default(null);

const optionalDate = z
  .string()
  .transform((value) => (value.trim() === '' ? null : value.trim()))
  .nullable()
  .pipe(z.string().date('Choose a valid date.').nullable())
  .default(null);

const optionalText = z
  .string()
  .transform((value) => (value.trim() === '' ? null : value.trim()))
  .nullable()
  .default(null);

const wholeNumber = (label: string) =>
  z.coerce
    .number({ error: `Enter ${label} as a whole number.` })
    .int(`Enter ${label} as a whole number.`)
    .min(1, `Enter ${label}.`);

/** Variant and media rows travel as JSON, because their count is dynamic. */
const jsonArray = <T extends z.ZodTypeAny>(item: T, label: string) =>
  z.string().transform((value, ctx) => {
    try {
      const parsed = z.array(item).safeParse(JSON.parse(value || '[]'));

      if (!parsed.success) {
        ctx.addIssue({ code: 'custom', message: `Check the ${label}.` });

        return z.NEVER;
      }

      return parsed.data;
    } catch {
      ctx.addIssue({ code: 'custom', message: `Check the ${label}.` });

      return z.NEVER;
    }
  });

const digitsOnly = /^[0-9]+$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const optionalDigits = (length: number, label: string) =>
  optionalText.pipe(
    z
      .string()
      .regex(digitsOnly, 'Use numbers only.')
      .length(length, `${label} has ${length} numbers.`)
      .nullable(),
  );

/**
 * Field rules live here, not only on the write schema, so every message keys to
 * the form field that caused it. `z.flattenError` reports one level of keys, so
 * a rule placed on a nested object would surface as "pricing" or "seo" and the
 * form could not put it beside the right input.
 */
const baseFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(3, 'Enter a product name with at least 3 characters.')
    .max(120, 'Keep the product name under 120 characters.'),
  description: z
    .string()
    .trim()
    .min(20, 'Write at least 20 characters about the product.')
    .max(5000, 'Keep the description under 5000 characters.'),
  category: productCategorySchema,
  brand: productBrandSchema,
  regularPrice: money('the regular price'),
  salePrice: optionalMoney('the sale price'),
  costPrice: optionalMoney('the cost price'),
  discountStartsAt: optionalDate,
  discountEndsAt: optionalDate,
  sku: skuSchema,
  upc: optionalDigits(12, 'A UPC'),
  ean: optionalDigits(13, 'An EAN'),
  barcode: optionalText,
  weightGrams: wholeNumber('the weight in grams'),
  lengthMm: wholeNumber('the length in millimetres'),
  widthMm: wholeNumber('the width in millimetres'),
  heightMm: wholeNumber('the height in millimetres'),
  shippingClass: shippingClassSchema,
  restrictedRegions: z.string().transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== ''),
  ),
  published: z
    .string()
    .nullish()
    .transform((value) => value === 'on' || value === 'true'),
  channels: z.array(salesChannelSchema).min(1, 'Choose a sales channel.'),
  availableFrom: optionalDate,
  availableUntil: optionalDate,
  seoTitle: z
    .string()
    .trim()
    .min(1, 'Enter a page title.')
    .max(
      SEO_TITLE_MAX,
      `Keep the page title under ${SEO_TITLE_MAX} characters.`,
    ),
  seoDescription: z
    .string()
    .trim()
    .min(1, 'Enter a short page description.')
    .max(
      SEO_DESCRIPTION_MAX,
      `Keep the description under ${SEO_DESCRIPTION_MAX} characters.`,
    ),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(slugPattern, 'Use lowercase letters, numbers, and dashes.'),
  variants: jsonArray(productVariantSchema, 'variants').pipe(
    z
      .array(productVariantSchema)
      .min(1, 'Add at least one variant.')
      .max(50, 'A product can have up to 50 variants.'),
  ),
  media: jsonArray(productMediaSchema, 'images and videos'),
});

/**
 * Cross-field rules. Each issue names the form field a person can fix, rather
 * than the object that holds it.
 */
export const productFormSchema = baseFormSchema.superRefine((values, ctx) => {
  if (values.salePrice !== null && values.salePrice >= values.regularPrice) {
    ctx.addIssue({
      code: 'custom',
      path: ['salePrice'],
      message: 'The sale price must be lower than the regular price.',
    });
  }

  if (
    values.discountStartsAt !== null &&
    values.discountEndsAt !== null &&
    values.discountStartsAt > values.discountEndsAt
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['discountEndsAt'],
      message: 'The discount end date must come after the start date.',
    });
  }

  if (
    values.availableFrom !== null &&
    values.availableUntil !== null &&
    values.availableFrom > values.availableUntil
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['availableUntil'],
      message: 'The end date must come after the start date.',
    });
  }
});

export type ProductFormValues = z.infer<typeof productFormSchema>;

/** Reads a submitted form into the raw shape `productFormSchema` expects. */
export function readProductForm(formData: FormData): Record<string, unknown> {
  const text = (key: string) => String(formData.get(key) ?? '');

  return {
    name: text('name'),
    description: text('description'),
    category: formData.get('category'),
    brand: formData.get('brand'),
    regularPrice: text('regularPrice'),
    salePrice: text('salePrice'),
    costPrice: text('costPrice'),
    discountStartsAt: text('discountStartsAt'),
    discountEndsAt: text('discountEndsAt'),
    sku: text('sku'),
    upc: text('upc'),
    ean: text('ean'),
    barcode: text('barcode'),
    weightGrams: text('weightGrams'),
    lengthMm: text('lengthMm'),
    widthMm: text('widthMm'),
    heightMm: text('heightMm'),
    shippingClass: formData.get('shippingClass'),
    restrictedRegions: text('restrictedRegions'),
    published: formData.get('published'),
    channels: formData.getAll('channels').map(String),
    availableFrom: text('availableFrom'),
    availableUntil: text('availableUntil'),
    seoTitle: text('seoTitle'),
    seoDescription: text('seoDescription'),
    slug: text('slug'),
    variants: text('variants'),
    media: text('media'),
  };
}

/** Maps validated form values onto the product write shape. */
export function toProductInput(values: ProductFormValues) {
  return {
    name: values.name,
    description: values.description,
    category: values.category,
    brand: values.brand,
    media: values.media,
    variants: values.variants,
    pricing: {
      regularMinor: values.regularPrice,
      saleMinor: values.salePrice,
      costMinor: values.costPrice,
      discountStartsAt: values.discountStartsAt,
      discountEndsAt: values.discountEndsAt,
    },
    identifiers: {
      sku: values.sku,
      upc: values.upc,
      ean: values.ean,
      barcode: values.barcode,
    },
    shipping: {
      weightGrams: values.weightGrams,
      lengthMm: values.lengthMm,
      widthMm: values.widthMm,
      heightMm: values.heightMm,
      shippingClass: values.shippingClass,
      restrictedRegions: values.restrictedRegions,
    },
    visibility: {
      published: values.published,
      channels: values.channels,
      availableFrom: values.availableFrom,
      availableUntil: values.availableUntil,
    },
    seo: {
      pageTitle: values.seoTitle,
      metaDescription: values.seoDescription,
      slug: values.slug,
    },
  };
}
