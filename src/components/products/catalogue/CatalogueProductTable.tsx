'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { CatalogueProductFixture } from '@/lib/seller-center/product-catalogue/types';
import { Checkbox } from '@/components/ui/checkbox';
import CatalogueProductRow from './CatalogueProductRow';

type CatalogueProductTableProps = {
  products: CatalogueProductFixture[];
  selectedIds: Set<string>;
  expandedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  /**
   * Selects every row currently shown, or clears the selection when they are
   * all already selected. Scoped to the visible list on purpose — see the
   * header cell.
   */
  onToggleSelectAll: () => void;
  onPauseListing: (id: string) => void;
  onArchive: (id: string) => void;
  onToggleVariantPaused: (productId: string, variantId: string) => void;
};

export default function CatalogueProductTable({
  products,
  selectedIds,
  expandedIds,
  onToggleSelected,
  onToggleExpanded,
  onToggleSelectAll,
  onPauseListing,
  onArchive,
  onToggleVariantPaused,
}: CatalogueProductTableProps) {
  const someVisibleSelected = products.some((product) =>
    selectedIds.has(product.id),
  );
  const allVisibleSelected =
    products.length > 0 &&
    products.every((product) => selectedIds.has(product.id));

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              {/*
                Selects every row the current tab and filters are showing, not
                every row in the catalogue. Acting on rows a seller cannot see
                is the way a bulk action becomes something nobody trusts —
                especially this one, where the neighbouring button publishes.
              */}
              <Checkbox
                checked={allVisibleSelected}
                indeterminate={someVisibleSelected && !allVisibleSelected}
                disabled={products.length === 0}
                onCheckedChange={() => onToggleSelectAll()}
                aria-label={
                  allVisibleSelected
                    ? 'Clear selection'
                    : `Select all ${products.length} listings shown`
                }
              />
            </TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Listing Status</TableHead>
            <TableHead>Selling Price</TableHead>
            <TableHead>Media</TableHead>
            <TableHead>Listing quality</TableHead>
            <TableHead>Attention</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <CatalogueProductRow
              key={product.id}
              product={product}
              selected={selectedIds.has(product.id)}
              expanded={expandedIds.has(product.id)}
              onToggleSelected={onToggleSelected}
              onToggleExpanded={onToggleExpanded}
              onPauseListing={onPauseListing}
              onArchive={onArchive}
              onToggleVariantPaused={onToggleVariantPaused}
            />
          ))}
          {products.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={8}
                className="py-10 text-center text-sm text-muted-foreground"
              >
                No listings match the current filters.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
