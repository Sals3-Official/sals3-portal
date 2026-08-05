import { z } from 'zod';
import {
  PRODUCT_BRANDS,
  PRODUCT_CATEGORIES,
  PRODUCT_SORT_KEYS,
  PRODUCT_STATUSES,
  PRODUCTS_PAGE_SIZE,
  SALES_CHANNELS,
  SEO_DESCRIPTION_MAX,
  SEO_TITLE_MAX,
  SHIPPING_CLASSES,
} from './constants';

/**
 * Every value that reaches the server passes through one of these schemas.
 * Enums act as allow lists, so an unknown status, category, brand, channel,
 * or shipping class is rejected instead of stored.
 */

const skuPattern = /^[A-Z0-9-]{3,32}$/;
const digitsOnly = /^[0-9]+$/;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export const productCategorySchema = z.enum(PRODUCT_CATEGORIES);
export const productBrandSchema = z.enum(PRODUCT_BRANDS);
export const salesChannelSchema = z.enum(SALES_CHANNELS);
export const shippingClassSchema = z.enum(SHIPPING_CLASSES);
export const productSortSchema = z.enum(PRODUCT_SORT_KEYS);

export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(skuPattern, 'Use 3 to 32 letters, numbers, or dashes.');

const amountMinorSchema = z
  .number()
  .int('Use a whole number of centavos.')
  .min(0, 'Price cannot be less than zero.')
  .max(1_000_000_000, 'Price is too high.');

export const productMediaSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['image', 'video']),
  url: z.string().url('Enter a full web address.'),
  alt: z
    .string()
    .trim()
    .max(160, 'Keep the image text under 160 characters.')
    .default(''),
});

export const productVariantSchema = z.object({
  id: z.string().min(1),
  options: z.record(z.string().min(1), z.string().trim().min(1)),
  sku: skuSchema,
  priceMinor: amountMinorSchema,
  stock: z
    .number()
    .int('Use a whole number.')
    .min(0, 'Stock cannot be less than zero.'),
});

export const productPricingSchema = z
  .object({
    regularMinor: amountMinorSchema,
    saleMinor: amountMinorSchema.nullable().default(null),
    costMinor: amountMinorSchema.nullable().default(null),
    discountStartsAt: z.string().date().nullable().default(null),
    discountEndsAt: z.string().date().nullable().default(null),
  })
  .refine(
    (value) => value.saleMinor === null || value.saleMinor < value.regularMinor,
    {
      path: ['saleMinor'],
      error: 'The sale price must be lower than the regular price.',
    },
  )
  .refine(
    (value) =>
      value.discountStartsAt === null ||
      value.discountEndsAt === null ||
      value.discountStartsAt <= value.discountEndsAt,
    {
      path: ['discountEndsAt'],
      error: 'The discount end date must come after the start date.',
    },
  );

export const productIdentifiersSchema = z.object({
  sku: skuSchema,
  upc: z
    .string()
    .trim()
    .regex(digitsOnly, 'Use numbers only.')
    .length(12, 'A UPC has 12 numbers.')
    .nullable()
    .default(null),
  ean: z
    .string()
    .trim()
    .regex(digitsOnly, 'Use numbers only.')
    .length(13, 'An EAN has 13 numbers.')
    .nullable()
    .default(null),
  barcode: z.string().trim().max(64).nullable().default(null),
});

export const productShippingSchema = z.object({
  weightGrams: z.number().int().min(1, 'Enter the weight in grams.'),
  lengthMm: z.number().int().min(1, 'Enter the length in millimetres.'),
  widthMm: z.number().int().min(1, 'Enter the width in millimetres.'),
  heightMm: z.number().int().min(1, 'Enter the height in millimetres.'),
  shippingClass: shippingClassSchema,
  restrictedRegions: z.array(z.string().trim().min(1)).max(64).default([]),
});

export const productVisibilitySchema = z
  .object({
    published: z.boolean(),
    channels: z
      .array(salesChannelSchema)
      .min(1, 'Choose at least one sales channel.'),
    availableFrom: z.string().date().nullable().default(null),
    availableUntil: z.string().date().nullable().default(null),
  })
  .refine(
    (value) =>
      value.availableFrom === null ||
      value.availableUntil === null ||
      value.availableFrom <= value.availableUntil,
    {
      path: ['availableUntil'],
      error: 'The end date must come after the start date.',
    },
  );

export const productSeoSchema = z.object({
  pageTitle: z
    .string()
    .trim()
    .min(1, 'Enter a page title.')
    .max(
      SEO_TITLE_MAX,
      `Keep the page title under ${SEO_TITLE_MAX} characters.`,
    ),
  metaDescription: z
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
});

/** The write shape a create or edit action accepts. */
export const productInputSchema = z.object({
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
  media: z.array(productMediaSchema).max(12).default([]),
  variants: z
    .array(productVariantSchema)
    .min(1, 'Add at least one variant.')
    .max(50, 'A product can have up to 50 variants.'),
  pricing: productPricingSchema,
  identifiers: productIdentifiersSchema,
  shipping: productShippingSchema,
  visibility: productVisibilitySchema,
  seo: productSeoSchema,
});

/** Query string of the product list page. Bad input falls back, never throws. */
export const productListQuerySchema = z.object({
  q: z.string().trim().max(120).catch('').default(''),
  status: productStatusSchema.or(z.literal('all')).catch('all').default('all'),
  category: productCategorySchema
    .or(z.literal('all'))
    .catch('all')
    .default('all'),
  brand: productBrandSchema.or(z.literal('all')).catch('all').default('all'),
  sort: productSortSchema.catch('updated-desc').default('updated-desc'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
  perPage: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .catch(PRODUCTS_PAGE_SIZE)
    .default(PRODUCTS_PAGE_SIZE),
});

export const bulkProductActionSchema = z.object({
  productIds: z
    .array(z.string().trim().min(1).max(64))
    .min(1, 'Select at least one product.')
    .max(200, 'Select up to 200 products at a time.'),
  action: z.enum(['publish', 'unpublish', 'archive', 'delete']),
});

export const reviewReplySchema = z.object({
  reviewId: z.string().trim().min(1).max(64),
  body: z
    .string()
    .trim()
    .min(5, 'Write at least 5 characters.')
    .max(1000, 'Keep the reply under 1000 characters.'),
});
