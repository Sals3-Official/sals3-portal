'use client';

import { Info } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import type { CatalogueProductFixture } from '@/lib/seller-center/product-catalogue/types';
import CatalogueProductRow from './CatalogueProductRow';

type CatalogueProductTableProps = {
  products: CatalogueProductFixture[];
  selectedIds: Set<string>;
  expandedIds: Set<string>;
  onToggleSelected: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  onToggleActive: (id: string) => void;
  onToggleVariantActive: (productId: string, variantId: string) => void;
};

export default function CatalogueProductTable({
  products,
  selectedIds,
  expandedIds,
  onToggleSelected,
  onToggleExpanded,
  onToggleActive,
  onToggleVariantActive,
}: CatalogueProductTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>Product Info</TableHead>
            <TableHead>Price</TableHead>
            <TableHead>
              <span className="inline-flex items-center gap-1">
                Stock
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Info
                        aria-label="Total stock across every variant"
                        className="size-3.5 text-muted-foreground"
                      />
                    }
                  />
                  <TooltipContent>
                    Total stock across every variant.
                  </TooltipContent>
                </Tooltip>
              </span>
            </TableHead>
            <TableHead>Active</TableHead>
            <TableHead>Content Score</TableHead>
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
              onToggleActive={onToggleActive}
              onToggleVariantActive={onToggleVariantActive}
            />
          ))}
          {products.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={7}
                className="py-10 text-center text-sm text-muted-foreground"
              >
                No products match the current filters.
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  );
}
