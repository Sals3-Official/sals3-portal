'use client';

import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { minorToPesoInput, parsePesosToMinor } from '@/lib/money';
import type { Product, ProductVariant } from '@/lib/products/types';
import VariantRow, { type VariantRowValues } from './VariantRow';

type VariantsTabProps = {
  product: Product | null;
  fieldErrors: Record<string, string[]>;
};

const COLUMNS = ['Option', 'Value', 'SKU', 'Price (PHP)', 'Stock'];

function toRows(variants: ProductVariant[] | undefined): VariantRowValues[] {
  if (variants === undefined || variants.length === 0) {
    return [
      {
        id: 'variant-1',
        optionName: 'Size',
        optionValue: 'One size',
        sku: '',
        price: '',
        stock: '0',
      },
    ];
  }

  return variants.map((variant, index) => {
    const [optionName = 'Size', optionValue = ''] =
      Object.entries(variant.options)[0] ?? [];

    return {
      id: variant.id || `variant-${index + 1}`,
      optionName,
      optionValue,
      sku: variant.sku,
      price: minorToPesoInput(variant.priceMinor),
      stock: String(variant.stock),
    };
  });
}

/**
 * Variant rows. Each row carries its own SKU, price, and stock. The rows are
 * serialised into one hidden field, because the row count is dynamic; the
 * server still validates every row against `productVariantSchema`.
 */
export default function VariantsTab({
  product,
  fieldErrors,
}: VariantsTabProps) {
  const [rows, setRows] = useState<VariantRowValues[]>(() =>
    toRows(product?.variants),
  );

  const update = useCallback((id: string, patch: Partial<VariantRowValues>) => {
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    );
  }, []);

  const removeRow = useCallback((id: string) => {
    setRows((current) => current.filter((row) => row.id !== id));
  }, []);

  const addRow = useCallback(() => {
    setRows((current) => [
      ...current,
      {
        id: `variant-new-${current.length + 1}`,
        optionName: current[0]?.optionName ?? 'Size',
        optionValue: '',
        sku: '',
        price: current[0]?.price ?? '',
        stock: '0',
      },
    ]);
  }, []);

  const serialised = JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      options: { [row.optionName]: row.optionValue },
      sku: row.sku.trim().toUpperCase(),
      priceMinor: parsePesosToMinor(row.price) ?? 0,
      stock: Number.parseInt(row.stock, 10) || 0,
    })),
  );

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="variants" value={serialised} />

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted text-left text-xs text-ink-muted">
            <tr>
              {COLUMNS.map((column) => (
                <th key={column} className="px-2 py-2 font-medium">
                  {column}
                </th>
              ))}
              <th className="w-12 px-2 py-2">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <VariantRow
                key={row.id}
                row={row}
                index={index}
                removable={rows.length > 1}
                onChange={update}
                onRemove={removeRow}
              />
            ))}
          </tbody>
        </table>
      </div>

      {fieldErrors.variants === undefined ? null : (
        <p className="text-xs font-medium text-destructive">
          {fieldErrors.variants[0]}
        </p>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        className="w-fit cursor-pointer"
      >
        <Plus aria-hidden="true" />
        Add variant
      </Button>
    </div>
  );
}
