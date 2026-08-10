'use client';

import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Switch } from '@/components/ui/switch';
import { TableCell, TableRow } from '@/components/ui/table';
import {
  formatMoney,
  formatCount,
} from '@/lib/seller-center/product-editor/format';
import type { CatalogueVariantFixture } from '@/lib/seller-center/product-catalogue/types';

type CatalogueVariantRowProps = {
  variant: CatalogueVariantFixture;
  onToggleActive: (variantId: string, active: boolean) => void;
};

async function copySku(sku: string) {
  await navigator.clipboard.writeText(sku);
  toast(`Copied "${sku}" to clipboard.`);
}

/** One SKU-level child row, nested under its parent product row. */
export default function CatalogueVariantRow({
  variant,
  onToggleActive,
}: CatalogueVariantRowProps) {
  return (
    <TableRow className="bg-muted/30">
      <TableCell />
      <TableCell>
        <div className="flex items-center gap-2.5 pl-8">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] text-muted-foreground"
          >
            {variant.hasImage ? null : 'No image'}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm">{variant.specsLabel}</p>
            <button
              type="button"
              onClick={() => copySku(variant.sellerSku)}
              className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Seller SKU: {variant.sellerSku}
              <Copy aria-hidden="true" className="size-3" />
            </button>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5 text-sm">
          {formatMoney(variant.price)}
          {variant.compareAtPrice === null ? null : (
            <span className="text-xs text-muted-foreground line-through">
              {formatMoney(variant.compareAtPrice)}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <span
          className={
            variant.stock === 0 ? 'text-sm font-medium text-red-600' : 'text-sm'
          }
        >
          {formatCount(variant.stock)}
        </span>
      </TableCell>
      <TableCell>
        <Switch
          size="sm"
          checked={variant.active}
          onCheckedChange={(checked) => onToggleActive(variant.id, checked)}
          aria-label={`${variant.active ? 'Deactivate' : 'Activate'} ${variant.specsLabel}`}
        />
      </TableCell>
      <TableCell />
      <TableCell />
    </TableRow>
  );
}
