'use client';

import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { VARIANT_OPTION_NAMES } from '@/lib/products/constants';

export type VariantRowValues = {
  id: string;
  optionName: string;
  optionValue: string;
  sku: string;
  price: string;
  stock: string;
};

type VariantRowProps = {
  row: VariantRowValues;
  index: number;
  removable: boolean;
  onChange: (id: string, patch: Partial<VariantRowValues>) => void;
  onRemove: (id: string) => void;
};

/** One editable variant row. Every control carries its own accessible name. */
export default function VariantRow({
  row,
  index,
  removable,
  onChange,
  onRemove,
}: VariantRowProps) {
  const position = index + 1;

  return (
    <tr className="border-t border-border">
      <td className="p-1.5">
        <select
          aria-label={`Option name for row ${position}`}
          value={row.optionName}
          onChange={(event) =>
            onChange(row.id, { optionName: event.target.value })
          }
          className="h-9 w-full cursor-pointer rounded-md border border-input bg-card px-2 text-sm"
        >
          {VARIANT_OPTION_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </td>
      <td className="p-1.5">
        <Input
          aria-label={`Option value for row ${position}`}
          value={row.optionValue}
          onChange={(event) =>
            onChange(row.id, { optionValue: event.target.value })
          }
          className="h-9 bg-card"
        />
      </td>
      <td className="p-1.5">
        <Input
          aria-label={`SKU for row ${position}`}
          value={row.sku}
          onChange={(event) => onChange(row.id, { sku: event.target.value })}
          className="h-9 bg-card"
        />
      </td>
      <td className="p-1.5">
        <Input
          aria-label={`Price for row ${position}`}
          inputMode="decimal"
          value={row.price}
          onChange={(event) => onChange(row.id, { price: event.target.value })}
          className="h-9 bg-card"
        />
      </td>
      <td className="p-1.5">
        <Input
          aria-label={`Stock for row ${position}`}
          inputMode="numeric"
          value={row.stock}
          onChange={(event) => onChange(row.id, { stock: event.target.value })}
          className="h-9 bg-card"
        />
      </td>
      <td className="p-1.5 text-right">
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={`Remove variant row ${position}`}
          disabled={!removable}
          onClick={() => onRemove(row.id)}
          className="cursor-pointer"
        >
          <Trash2 aria-hidden="true" />
        </Button>
      </td>
    </tr>
  );
}
