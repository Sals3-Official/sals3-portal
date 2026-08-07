'use client';

import { useState } from 'react';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type {
  CatalogFxRates,
  SupplierConnectionFixture,
  SupplierProductFixture,
} from '@/lib/products/catalog-types';
import SupplierComparisonPanel from './SupplierComparisonPanel';
import SupplierProductCard from './SupplierProductCard';
import SupplierProductDetailsDrawer from './SupplierProductDetailsDrawer';
import SupplierProductRow from './SupplierProductRow';

type SupplierCatalogResultsProps = {
  products: SupplierProductFixture[];
  /**
   * Every product the seller's active connections currently source,
   * regardless of the current search/filter/page - used only to resolve a
   * duplicate partner that search, a filter, or pagination has pushed out of
   * `products`. A real implementation would resolve this with its own
   * server-side lookup by ID instead of holding the full list client-side.
   */
  allProducts: SupplierProductFixture[];
  connectionsById: Record<string, SupplierConnectionFixture>;
  rates: CatalogFxRates;
  nowIso: string;
};

const COLUMNS = [
  'Product',
  'Supplier',
  'Supplier cost',
  'Availability',
  'Ships from',
  'Listings',
  'Pipeline status',
  'Last synced',
];

function productsByIds(
  products: SupplierProductFixture[],
  ids: string[],
): SupplierProductFixture[] {
  const set = new Set(ids);

  return products.filter((product) => set.has(product.id));
}

/**
 * Owns the one shared details drawer and one shared comparison dialog for
 * the whole result set, opened by whichever row/card was clicked - cheaper
 * than mounting a drawer per row, and it is the only reason this container
 * needs to be a Client Component at all (everything upstream stays server
 * rendered).
 */
export default function SupplierCatalogResults({
  products,
  allProducts,
  connectionsById,
  rates,
  nowIso,
}: SupplierCatalogResultsProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [duplicateAnchorId, setDuplicateAnchorId] = useState<string | null>(
    null,
  );

  const selected =
    products.find((product) => product.id === selectedId) ?? null;
  const selectedConnection =
    selected === null ? null : (connectionsById[selected.connectionId] ?? null);

  const duplicateAnchor =
    allProducts.find((product) => product.id === duplicateAnchorId) ?? null;
  const duplicateCandidates =
    duplicateAnchor === null
      ? []
      : [
          duplicateAnchor,
          ...productsByIds(
            allProducts,
            duplicateAnchor.potentialDuplicateOfIds,
          ),
        ]
          .filter(
            (product) => connectionsById[product.connectionId] !== undefined,
          )
          .map((product) => ({
            product,
            connection: connectionsById[product.connectionId],
          }));

  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => {
              const connection = connectionsById[product.connectionId];

              if (connection === undefined) return null;

              return (
                <SupplierProductRow
                  key={product.id}
                  product={product}
                  connection={connection}
                  rates={rates}
                  nowIso={nowIso}
                  onOpenDetails={() => setSelectedId(product.id)}
                  onOpenDuplicates={() => setDuplicateAnchorId(product.id)}
                />
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 md:hidden">
        {products.map((product) => {
          const connection = connectionsById[product.connectionId];

          if (connection === undefined) return null;

          return (
            <SupplierProductCard
              key={product.id}
              product={product}
              connection={connection}
              rates={rates}
              nowIso={nowIso}
              onOpenDetails={() => setSelectedId(product.id)}
              onOpenDuplicates={() => setDuplicateAnchorId(product.id)}
            />
          );
        })}
      </div>

      <SupplierProductDetailsDrawer
        product={selected}
        connection={selectedConnection}
        rates={rates}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedId(null);
        }}
      />
      <SupplierComparisonPanel
        candidates={duplicateCandidates}
        open={duplicateAnchor !== null}
        onOpenChange={(open) => {
          if (!open) setDuplicateAnchorId(null);
        }}
      />
    </>
  );
}
