import { formatMoney, peso } from '@/lib/money';
import {
  PRODUCT_BRAND_LABELS,
  PRODUCT_CATEGORY_LABELS,
  SALES_CHANNEL_LABELS,
  SHIPPING_CLASS_LABELS,
} from '@/lib/products/constants';
import { effectivePriceMinor, totalStock } from '@/lib/products/query';
import type { Product } from '@/lib/products/types';

type OverviewPanelProps = {
  product: Product;
};

/** Key facts, plus the rejection reason when a reviewer sent the product back. */
export default function OverviewPanel({ product }: OverviewPanelProps) {
  const facts: Array<[string, string]> = [
    ['Category', PRODUCT_CATEGORY_LABELS[product.category]],
    ['Brand', PRODUCT_BRAND_LABELS[product.brand]],
    ['SKU', product.identifiers.sku],
    ['Barcode', product.identifiers.barcode ?? 'None'],
    ['Price', formatMoney(peso(effectivePriceMinor(product)))],
    ['Regular price', formatMoney(peso(product.pricing.regularMinor))],
    ['Stock', String(totalStock(product))],
    ['Variants', String(product.variants.length)],
    ['Weight', `${product.shipping.weightGrams} g`],
    ['Shipping class', SHIPPING_CLASS_LABELS[product.shipping.shippingClass]],
    [
      'Sales channels',
      product.visibility.channels
        .map((channel) => SALES_CHANNEL_LABELS[channel])
        .join(', '),
    ],
    ['Web address', `/${product.seo.slug}`],
    ['Created', `${product.createdAt} by ${product.createdBy}`],
    ['Last updated', `${product.updatedAt} by ${product.updatedBy}`],
  ];

  return (
    <div className="flex flex-col gap-4">
      {product.rejectionReason === null ? null : (
        <div className="rounded-lg border border-destructive/40 bg-danger-surface p-3">
          <h3 className="text-sm font-semibold text-red-600">
            Why this product was rejected
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            {product.rejectionReason}
          </p>
        </div>
      )}

      <p className="text-sm text-ink-muted">{product.description}</p>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-sm font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
