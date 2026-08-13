'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import { estimateMarginMinor } from '@/lib/seller-center/product-catalogue/derive';
import {
  formatDateTime,
  formatMoney,
} from '@/lib/seller-center/product-editor/format';
import {
  value,
  type CatalogueVariantView,
  type Tracked,
  type VariantActionView,
} from '@/lib/seller-center/product-catalogue/view';
import AvailabilityBadge from './AvailabilityBadge';
import CopyableIdentity from './CopyableIdentity';
import NotTrackedPill from './NotTrackedPill';

type CatalogueVariantRowProps = {
  variant: CatalogueVariantView;
  onAction: (variantId: string, kind: VariantActionView['kind']) => void;
};

/**
 * A tracked value rendered inline, where a pill would break the line's type
 * scale. The `absent` arm prints its own label: the adapter already wrote it as
 * a full phrase ("Supplier-reported quantity: unknown").
 */
function inline<T>(
  tracked: Tracked<T>,
  format: (resolved: T) => string,
): ReactNode {
  if (tracked.kind === 'value') return format(tracked.value);
  if (tracked.kind === 'absent') return tracked.label;

  return <NotTrackedPill tracked={tracked} />;
}

/** One Sals3 variant, nested under its parent listing row. */
export default function CatalogueVariantRow({
  variant,
  onAction,
}: CatalogueVariantRowProps) {
  const price = variant.sellingPrice;
  const cost = variant.supplierCost;
  // Computable only when both sides are real money - never from a placeholder.
  const margin =
    price.kind === 'value' && cost.kind === 'value'
      ? estimateMarginMinor(price.value, cost.value)
      : null;

  return (
    <TableRow className="bg-muted/30">
      <TableCell />
      <TableCell colSpan={2}>
        <div className="flex items-start gap-2.5 pl-8">
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] text-muted-foreground"
          >
            {variant.hasImage.kind === 'value' && variant.hasImage.value
              ? null
              : 'No image'}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm">
              {inline(variant.optionLabel, (label) => label)}
            </p>
            <CopyableIdentity
              displayLabel="Sals3 Variant ID"
              copyLabel="Sals3 Variant ID"
              tracked={value(variant.sals3VariantId)}
            />
            <CopyableIdentity
              displayLabel="Seller SKU"
              copyLabel="Seller SKU"
              tracked={variant.sellerSku}
            />
            <CopyableIdentity
              displayLabel="CJ Variant ID"
              copyLabel="CJ Variant ID"
              tracked={variant.supplierVariantId}
            />
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="text-sm">
          <div>{inline(price, (money) => formatMoney(money))}</div>
          <div className="text-xs text-muted-foreground">
            Supplier cost: {inline(cost, (money) => formatMoney(money))}
          </div>
          {margin === null || price.kind !== 'value' ? null : (
            <div className="text-xs text-muted-foreground">
              Est. margin:{' '}
              {formatMoney({
                amountMinor: margin,
                currency: price.value.currency,
              })}{' '}
              (illustrative, excludes freight/fees)
            </div>
          )}
        </div>
      </TableCell>
      <TableCell colSpan={2}>
        <div className="flex flex-col gap-1">
          <AvailabilityBadge availability={variant.availability} />
          <p className="text-xs text-muted-foreground">
            {inline(
              variant.supplierObservedQuantity,
              (quantity) =>
                `Supplier-reported: ${quantity} (not a guaranteed promise)`,
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            Last checked: {inline(variant.lastCheckedAt, formatDateTime)}
          </p>
        </div>
      </TableCell>
      <TableCell />
      <TableCell>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={variant.action.isDisabled}
          title={variant.action.disabledReason}
          onClick={() => onAction(variant.id, variant.action.kind)}
        >
          {variant.action.label}
        </Button>
      </TableCell>
    </TableRow>
  );
}
