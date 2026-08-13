'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  CatalogueRowAction,
  CatalogueRowView,
  VariantActionView,
} from '@/lib/seller-center/product-catalogue/view';
import CatalogueProductRow from './CatalogueProductRow';

type CatalogueProductTableProps = {
  rows: CatalogueRowView[];
  selectedIds: Set<string>;
  expandedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  onAction: (id: string, action: CatalogueRowAction) => void;
  onVariantAction: (
    productId: string,
    variantId: string,
    kind: VariantActionView['kind'],
  ) => void;
};

/**
 * The eight-column catalogue table, shared by the design preview and the real
 * `/listings`. It takes `CatalogueRowView`, so neither caller can hand it a
 * fixture-shaped lie or a raw database row.
 */
export default function CatalogueProductTable({
  rows,
  selectedIds,
  expandedIds,
  onToggleSelected,
  onToggleExpanded,
  onAction,
  onVariantAction,
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
            <TableHead>Attention</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <CatalogueProductRow
              key={row.id}
              row={row}
              selected={selectedIds.has(row.id)}
              expanded={expandedIds.has(row.id)}
              onToggleSelected={onToggleSelected}
              onToggleExpanded={onToggleExpanded}
              onAction={onAction}
              onVariantAction={onVariantAction}
            />
          ))}
          {rows.length === 0 ? (
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
