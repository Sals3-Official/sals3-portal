/** Allow-listed product values. Never accept a value outside these lists. */

export const PRODUCT_STATUSES = [
  'draft',
  'pending_approval',
  'published',
  'rejected',
  'archived',
] as const;

export const PRODUCT_STATUS_LABELS: Record<
  (typeof PRODUCT_STATUSES)[number],
  string
> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  published: 'Published',
  rejected: 'Rejected',
  archived: 'Archived',
};

export const PRODUCT_CATEGORIES = [
  'home-living',
  'electronics',
  'fashion',
  'beauty-health',
  'sports-outdoors',
  'baby-kids',
] as const;

export const PRODUCT_CATEGORY_LABELS: Record<
  (typeof PRODUCT_CATEGORIES)[number],
  string
> = {
  'home-living': 'Home and living',
  electronics: 'Electronics',
  fashion: 'Fashion',
  'beauty-health': 'Beauty and health',
  'sports-outdoors': 'Sports and outdoors',
  'baby-kids': 'Baby and kids',
};

export const PRODUCT_BRANDS = [
  'aeroluxe',
  'casapura',
  'nortek',
  'sunveil',
  'tidalform',
  'unbranded',
] as const;

export const PRODUCT_BRAND_LABELS: Record<
  (typeof PRODUCT_BRANDS)[number],
  string
> = {
  aeroluxe: 'AeroLuxe',
  casapura: 'CasaPura',
  nortek: 'Nortek',
  sunveil: 'SunVeil',
  tidalform: 'TidalForm',
  unbranded: 'Unbranded',
};

export const SALES_CHANNELS = ['web', 'mobile-app', 'marketplace'] as const;

export const SALES_CHANNEL_LABELS: Record<
  (typeof SALES_CHANNELS)[number],
  string
> = {
  web: 'Website',
  'mobile-app': 'Mobile app',
  marketplace: 'Partner marketplace',
};

export const SHIPPING_CLASSES = [
  'standard',
  'bulky',
  'fragile',
  'cold-chain',
] as const;

export const SHIPPING_CLASS_LABELS: Record<
  (typeof SHIPPING_CLASSES)[number],
  string
> = {
  standard: 'Standard',
  bulky: 'Bulky',
  fragile: 'Fragile',
  'cold-chain': 'Cold chain',
};

export const VARIANT_OPTION_NAMES = [
  'Size',
  'Color',
  'Material',
  'Model',
] as const;

export const PRODUCT_SORT_KEYS = [
  'updated-desc',
  'updated-asc',
  'name-asc',
  'name-desc',
  'price-asc',
  'price-desc',
  'stock-asc',
  'stock-desc',
] as const;

export const PRODUCT_SORT_LABELS: Record<
  (typeof PRODUCT_SORT_KEYS)[number],
  string
> = {
  'updated-desc': 'Last updated (newest)',
  'updated-asc': 'Last updated (oldest)',
  'name-asc': 'Name (A to Z)',
  'name-desc': 'Name (Z to A)',
  'price-asc': 'Price (low to high)',
  'price-desc': 'Price (high to low)',
  'stock-asc': 'Stock (low to high)',
  'stock-desc': 'Stock (high to low)',
};

export const PRODUCTS_PAGE_SIZE = 20;

export const SEO_TITLE_MAX = 60;
export const SEO_DESCRIPTION_MAX = 160;
