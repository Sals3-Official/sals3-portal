import type { z } from 'zod';
import type {
  bulkProductActionSchema,
  productBrandSchema,
  productCategorySchema,
  productIdentifiersSchema,
  productInputSchema,
  productListQuerySchema,
  productMediaSchema,
  productPricingSchema,
  productSeoSchema,
  productShippingSchema,
  productSortSchema,
  productStatusSchema,
  productVariantSchema,
  productVisibilitySchema,
  salesChannelSchema,
  shippingClassSchema,
} from './schemas';

export type ProductStatus = z.infer<typeof productStatusSchema>;
export type ProductCategory = z.infer<typeof productCategorySchema>;
export type ProductBrand = z.infer<typeof productBrandSchema>;
export type SalesChannel = z.infer<typeof salesChannelSchema>;
export type ShippingClass = z.infer<typeof shippingClassSchema>;
export type ProductSortKey = z.infer<typeof productSortSchema>;
export type ProductMedia = z.infer<typeof productMediaSchema>;
export type ProductVariant = z.infer<typeof productVariantSchema>;
export type ProductPricing = z.infer<typeof productPricingSchema>;
export type ProductIdentifiers = z.infer<typeof productIdentifiersSchema>;
export type ProductShipping = z.infer<typeof productShippingSchema>;
export type ProductVisibility = z.infer<typeof productVisibilitySchema>;
export type ProductSeo = z.infer<typeof productSeoSchema>;
export type ProductInput = z.infer<typeof productInputSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type BulkProductAction = z.infer<typeof bulkProductActionSchema>;

export type ProductAnalytics = {
  views: number;
  addToCart: number;
  unitsSold: number;
  revenueMinor: number;
};

export type ProductReview = {
  id: string;
  author: string;
  rating: 1 | 2 | 3 | 4 | 5;
  body: string;
  createdAt: string;
  reply: string | null;
  reported: boolean;
};

export type AuditEntry = {
  id: string;
  actor: string;
  field: string;
  from: string;
  to: string;
  at: string;
};

/** Decorative stand-in tone until real product photography exists. */
export type PlaceholderTone = 'ocean' | 'dusk' | 'meadow' | 'clay';

export type Product = ProductInput & {
  id: string;
  /** Owning seller. Used for the resource-ownership check on every write. */
  sellerId: string;
  tone: PlaceholderTone;
  status: ProductStatus;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
  analytics: ProductAnalytics;
  reviews: ProductReview[];
  auditTrail: AuditEntry[];
};

/** One page of list results, plus the counts the status tabs need. */
export type ProductListResult = {
  products: Product[];
  totalCount: number;
  totalPages: number;
  page: number;
  statusCounts: Record<ProductStatus | 'all', number>;
};
