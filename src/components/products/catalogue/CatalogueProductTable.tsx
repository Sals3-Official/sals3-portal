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
import CatalogueProductRow from './CatalogueProductRow';

type CatalogueProductTableProps = {
  products: CatalogueProductFixture[];
  selectedIds: Set<string>;
  expandedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onToggleExpanded: (id: string) => void;
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
  onPauseListing,
  onArchive,
  onToggleVariantPaused,
}: CatalogueProductTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>Product</TableHead>
            <TableHead>Listing Status</TableHead>
            <TableHead>Selling Price</TableHead>
            <TableHead>Availability</TableHead>
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
                colSpan={9}
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
