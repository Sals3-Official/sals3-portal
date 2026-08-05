import { PRODUCT_STATUS_LABELS } from '@/lib/products/constants';
import type { ProductStatus } from '@/lib/products/types';

const STATUS_CLASSES: Record<ProductStatus, string> = {
  draft: 'bg-muted text-ink-muted',
  pending_approval: 'bg-brand-100 text-brand-900',
  published: 'bg-success-surface text-green-600',
  rejected: 'bg-danger-surface text-red-600',
  archived: 'bg-secondary text-ink-subtle',
};

type ProductStatusBadgeProps = {
  status: ProductStatus;
};

/**
 * Status pill. The written label is always present, so the status never
 * depends on colour alone.
 */
export default function ProductStatusBadge({
  status,
}: ProductStatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ${STATUS_CLASSES[status]}`}
    >
      {PRODUCT_STATUS_LABELS[status]}
    </span>
  );
}
