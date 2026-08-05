'use client';

import { useCallback, useState, useTransition } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { duplicateProductAction } from '@/app/(portal)/products/actions';
import type { Product } from '@/lib/products/types';
import BulkActionBar from './BulkActionBar';
import ProductRow from './ProductRow';
import SortableColumn, { type SortableField } from './SortableColumn';

export type ProductTablePermissions = {
  canEdit: boolean;
  canCreate: boolean;
  canPublish: boolean;
  canArchive: boolean;
  canDelete: boolean;
};

type ProductsTableProps = {
  products: Product[];
  sort: string;
  permissions: ProductTablePermissions;
};

const COLUMNS: Array<{
  field: SortableField | null;
  label: string;
  align?: string;
}> = [
  { field: 'name', label: 'Product' },
  { field: null, label: 'Status' },
  { field: null, label: 'Category' },
  { field: 'price', label: 'Price', align: 'text-right' },
  { field: 'stock', label: 'Stock', align: 'text-right' },
  { field: 'updated', label: 'Updated' },
];

/**
 * The selectable product list. This is the only client component in the list
 * page: it holds the row selection and the duplicate feedback. Search, filter,
 * sort, and paging stay on the server through the URL.
 *
 * One markup serves both layouts: the rows restack into cards below 768px
 * through CSS. See ProductRow for why that beats a second card component.
 */
export default function ProductsTable({
  products,
  sort,
  permissions,
}: ProductsTableProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [, startTransition] = useTransition();

  const visibleIds = products.map((product) => product.id);
  const allSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));

  const toggleOne = useCallback((id: string, next: boolean) => {
    setSelected((current) =>
      next ? [...current, id] : current.filter((value) => value !== id),
    );
  }, []);

  const clearSelection = useCallback(() => setSelected([]), []);

  const duplicate = useCallback(
    (id: string) => {
      startTransition(async () => {
        const result = await duplicateProductAction(id);

        setNotice(result.message);
      });
    },
    [startTransition],
  );

  return (
    <div className="flex flex-col gap-3">
      {selected.length > 0 ? (
        <BulkActionBar
          selectedIds={selected}
          onClear={clearSelection}
          canPublish={permissions.canPublish}
          canArchive={permissions.canArchive}
          canDelete={permissions.canDelete}
        />
      ) : null}

      <p aria-live="polite" className="sr-only">
        {notice}
      </p>
      {notice === '' ? null : (
        <p className="rounded-md border border-border bg-card px-3 py-2 text-sm">
          {notice}
        </p>
      )}

      <div className="rounded-lg border border-border bg-card">
        <Table className="block md:table">
          <TableHeader className="hidden md:table-header-group">
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(next) =>
                    setSelected(next === true ? visibleIds : [])
                  }
                  aria-label="Select every product on this page"
                  className="cursor-pointer"
                />
              </TableHead>
              {COLUMNS.map((column) => (
                <TableHead key={column.label} className={column.align}>
                  {column.field === null ? (
                    column.label
                  ) : (
                    <SortableColumn
                      field={column.field}
                      label={column.label}
                      sort={sort}
                    />
                  )}
                </TableHead>
              ))}
              <TableHead className="w-12 text-right">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody className="block md:table-row-group">
            {products.map((product) => (
              <ProductRow
                key={product.id}
                product={product}
                selected={selected.includes(product.id)}
                canEdit={permissions.canEdit}
                canDuplicate={permissions.canCreate}
                onDuplicate={duplicate}
                onToggle={toggleOne}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
