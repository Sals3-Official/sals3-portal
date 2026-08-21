'use client';

import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { TableCell, TableRow } from '@/components/ui/table';
import copyToClipboard from '@/lib/seller-center/clipboard';
import { estimateMarginMinor } from '@/lib/seller-center/product-catalogue/derive';
import {
  formatDateTime,
  formatMoney,
} from '@/lib/seller-center/product-editor/format';
import type { CatalogueVariantFixture } from '@/lib/seller-center/product-catalogue/types';
import AvailabilityBadge from './AvailabilityBadge';

type CatalogueVariantRowProps = {
  variant: CatalogueVariantFixture;
  onTogglePaused: (variantId: string) => void;
};

async function copyIdentity(value: string, label: string) {
  const ok = await copyToClipboard(value);

  toast(
    ok
      ? `Copied ${label} to clipboard.`
      : `Couldn't copy ${label} to clipboard.`,
  );
}

function announceUnbuilt(action: string) {
  toast(`${action} isn't built yet.`, {
    description: 'This design preview has no catalogue backend.',
  });
}

const SUPPLIER_DRIVEN_UNAVAILABLE = new Set([
  'OUT_OF_STOCK',
  'SUPPLIER_DISCONNECTED',
  'MARKET_UNAVAILABLE',
  'UNKNOWN_OR_STALE',
  'SUPPLIER_CHECK_PENDING',
]);

type VariantAction = {
  label: string;
  onClick: () => void;
};

function resolveVariantAction(
  variant: CatalogueVariantFixture,
  onTogglePaused: (variantId: string) => void,
): VariantAction {
  if (variant.manuallyPaused) {
    return {
      label: 'Review & resume',
      onClick: () => announceUnbuilt('Review & resume'),
    };
  }

  if (SUPPLIER_DRIVEN_UNAVAILABLE.has(variant.availability)) {
    return {
      label: 'Request fresh check',
      onClick: () => announceUnbuilt('Request fresh check'),
    };
  }

  return {
    label: 'Pause variant',
    onClick: () => onTogglePaused(variant.id),
  };
}

/** One Sals3 variant, nested under its parent listing row. */
export default function CatalogueVariantRow({
  variant,
  onTogglePaused,
}: CatalogueVariantRowProps) {
  const margin = estimateMarginMinor(
    variant.sellingPrice,
    variant.supplierCost,
  );
  const action = resolveVariantAction(variant, onTogglePaused);

  return (
    <TableRow className="bg-muted/30">
      <TableCell />
      <TableCell colSpan={2}>
        <div className="flex items-start gap-2.5 pl-8">
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] text-muted-foreground"
          >
            {variant.hasImage ? null : 'No image'}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm">{variant.optionLabel}</p>
            <button
              type="button"
              onClick={() =>
                copyIdentity(variant.sals3VariantId, 'Sals3 Variant ID')
              }
              aria-label={`Copy Sals3 Variant ID ${variant.sals3VariantId}`}
              className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Sals3 Variant ID: {variant.sals3VariantId}
              <Copy aria-hidden="true" className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => copyIdentity(variant.sellerSku, 'Seller SKU')}
              aria-label={`Copy Seller SKU ${variant.sellerSku}`}
              className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Seller SKU: {variant.sellerSku}
              <Copy aria-hidden="true" className="size-3" />
            </button>
            <button
              type="button"
              onClick={() => copyIdentity(variant.cjVariantId, 'CJ Variant ID')}
              aria-label={`Copy CJ Variant ID ${variant.cjVariantId}`}
              className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              CJ Variant ID: {variant.cjVariantId}
              <Copy aria-hidden="true" className="size-3" />
            </button>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="text-sm">
          <div>
            {variant.sellingPrice === null
              ? 'Not available'
              : formatMoney(variant.sellingPrice)}
          </div>
          <div className="text-xs text-muted-foreground">
            Supplier cost: {formatMoney(variant.supplierCost)}
          </div>
          {margin === null ? null : (
            <div className="text-xs text-muted-foreground">
              Est. margin:{' '}
              {formatMoney({
                amountMinor: margin,
                currency:
                  variant.sellingPrice?.currency ??
                  variant.supplierCost.currency,
              })}{' '}
              (illustrative, excludes freight/fees)
            </div>
          )}
        </div>
      </TableCell>
      {/* Media + Listing quality. Quality is a product-level reading, so a
          variant row shows none of its own rather than repeating the parent's.
          The parent's Availability column was removed on 2026-08-22; per-variant
          availability stays here, which is the level the evidence is actually
          observed at and costs the table no header width. */}
      <TableCell colSpan={2}>
        <div className="flex flex-col gap-1">
          <AvailabilityBadge availability={variant.availability} />
          <p className="text-xs text-muted-foreground">
            {variant.supplierObservedQuantity === null
              ? 'Supplier-reported quantity: unknown'
              : `Supplier-reported: ${variant.supplierObservedQuantity} (not a guaranteed promise)`}
          </p>
          <p className="text-xs text-muted-foreground">
            Last checked: {formatDateTime(variant.lastCheckedAt)}
          </p>
        </div>
      </TableCell>
      <TableCell />
      <TableCell>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={action.onClick}
        >
          {action.label}
        </Button>
      </TableCell>
    </TableRow>
  );
}
