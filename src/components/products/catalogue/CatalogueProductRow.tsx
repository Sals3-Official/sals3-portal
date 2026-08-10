'use client';

import { ChevronDown, ChevronRight, Copy, Pencil } from 'lucide-react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { TableCell, TableRow } from '@/components/ui/table';
import {
  formatCount,
  formatMoney,
} from '@/lib/seller-center/product-editor/format';
import type { CatalogueProductFixture } from '@/lib/seller-center/product-catalogue/types';
import CatalogueVariantRow from './CatalogueVariantRow';
import ContentScoreBadge from './ContentScoreBadge';
import MicroMetricBadges from './MicroMetricBadges';

type CatalogueProductRowProps = {
  product: CatalogueProductFixture;
  selected: boolean;
  expanded: boolean;
  onToggleSelected: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  onToggleActive: (id: string) => void;
  onToggleVariantActive: (productId: string, variantId: string) => void;
};

function announceUnbuilt(action: string, productName: string) {
  toast(`${action} isn't built yet for "${productName}".`, {
    description: 'This design preview has no catalogue backend.',
  });
}

/** Parent row: one product, plus its expandable SKU variant rows. */
export default function CatalogueProductRow({
  product,
  selected,
  expanded,
  onToggleSelected,
  onToggleExpanded,
  onToggleActive,
  onToggleVariantActive,
}: CatalogueProductRowProps) {
  const hasVariants = product.variants.length > 0;
  const editHref = `/listings/new?fixture=${product.editorFixtureKey}`;

  return (
    <>
      <TableRow>
        <TableCell>
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelected(product.id)}
            aria-label={`Select ${product.name}`}
          />
        </TableCell>
        <TableCell>
          <div className="flex items-start gap-2.5">
            {hasVariants ? (
              <button
                type="button"
                onClick={() => onToggleExpanded(product.id)}
                aria-expanded={expanded}
                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${product.variants.length} variants`}
                className="mt-1 shrink-0 text-muted-foreground hover:text-foreground"
              >
                {expanded ? (
                  <ChevronDown aria-hidden="true" className="size-4" />
                ) : (
                  <ChevronRight aria-hidden="true" className="size-4" />
                )}
              </button>
            ) : (
              <span className="size-4 shrink-0" aria-hidden="true" />
            )}

            <span
              aria-hidden="true"
              className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] text-muted-foreground"
            >
              {product.hasImage ? null : 'No image'}
            </span>

            <div className="min-w-0 flex-1">
              <Link
                href={editHref}
                className="font-medium text-foreground hover:underline"
              >
                {product.name}
              </Link>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(product.externalProductId);
                  toast(`Copied "${product.externalProductId}" to clipboard.`);
                }}
                className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Product ID: {product.externalProductId}
                <Copy aria-hidden="true" className="size-3" />
              </button>
              <div className="mt-1.5">
                <MicroMetricBadges product={product} />
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <div>
              <div className="flex items-center gap-1.5">
                {formatMoney(product.price)}
                {product.compareAtPrice === null ? null : (
                  <span className="text-xs text-muted-foreground line-through">
                    {formatMoney(product.compareAtPrice)}
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => announceUnbuilt('Editing price', product.name)}
              aria-label={`Edit price for ${product.name}`}
              className="text-muted-foreground hover:text-foreground"
            >
              <Pencil aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            <span
              className={
                product.totalStock === 0
                  ? 'text-sm font-medium text-red-600'
                  : 'text-sm'
              }
            >
              {formatCount(product.totalStock)}
            </span>
            <button
              type="button"
              onClick={() => announceUnbuilt('Editing stock', product.name)}
              aria-label={`Edit stock for ${product.name}`}
              className="text-muted-foreground hover:text-foreground"
            >
              <Pencil aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        </TableCell>
        <TableCell>
          <Switch
            checked={product.active}
            onCheckedChange={() => onToggleActive(product.id)}
            aria-label={`${product.active ? 'Deactivate' : 'Activate'} ${product.name}`}
          />
        </TableCell>
        <TableCell>
          <ContentScoreBadge score={product.contentScore} />
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-3">
            <Link
              href={editHref}
              className="text-sm font-medium text-primary hover:underline"
            >
              Edit
            </Link>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    More
                    <ChevronDown aria-hidden="true" className="size-3.5" />
                  </button>
                }
              />
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() =>
                    announceUnbuilt(
                      product.active ? 'Deactivate' : 'Activate',
                      product.name,
                    )
                  }
                >
                  {product.active ? 'Deactivate' : 'Activate'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    announceUnbuilt('Duplicate Listing', product.name)
                  }
                >
                  Duplicate Listing
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    announceUnbuilt('View Live Page', product.name)
                  }
                >
                  View Live Page
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => announceUnbuilt('Delete', product.name)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>

      {expanded
        ? product.variants.map((variant) => (
            <CatalogueVariantRow
              key={variant.id}
              variant={variant}
              onToggleActive={(variantId) =>
                onToggleVariantActive(product.id, variantId)
              }
            />
          ))
        : null}
    </>
  );
}
