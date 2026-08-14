import { ChevronDown, ChevronUp, ImageOff, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import RetailPriceInput from '@/components/products/editor/RetailPriceInput';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  formatCount,
  formatDateTime,
  formatMoney,
} from '@/lib/seller-center/product-editor/format';
import type { VariantFixture } from '@/lib/seller-center/product-editor/types';

type VariantPricingTableProps = {
  variants: VariantFixture[];
  expandedVariantId: string | null;
  onToggleExpanded: (variantId: string) => void;
  onToggleEnabled: (variantId: string) => void;
  onRetailChange: (variantId: string, amountMinor: number) => void;
  onSellerSkuChange: (variantId: string, value: string) => void;
  onBulkEnableInStock: () => void;
  onBulkDisableUnavailable: () => void;
  onBulkSetPrice: () => void;
  evidenceCapturedAt: string;
};

const COLUMNS = [
  'List',
  'Image',
  'Variant',
  'Sals3 SKU',
  'Supplier cost',
  'Retail price',
  'Supplier stock',
  'Attention',
];

type VariantEvidenceRowProps = {
  variant: VariantFixture;
};

function VariantEvidenceRow({ variant }: VariantEvidenceRowProps) {
  const rows: Array<[string, string]> = [
    ['Supplier variant ID', variant.supplierVariantId],
    [
      'Supplier cost',
      `${formatMoney(variant.supplierCost)} ${variant.supplierCost.currency}`,
    ],
    [
      'Stock evidence',
      `${formatCount(variant.supplierStock)} units · ${variant.warehouseLabel}`,
    ],
    ['Evidence captured', formatDateTime(variant.evidenceCapturedAt)],
    ['Packed weight', `${formatCount(variant.packedWeightGrams)} g`],
  ];

  return (
    <TableRow>
      <TableCell colSpan={COLUMNS.length + 1} className="bg-background p-3.5">
        <h4 className="mb-2 text-xs font-bold tracking-wide uppercase text-ink-muted">
          Supplier evidence for {variant.optionLabel}
        </h4>
        <dl className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-x-4 gap-y-2 text-xs">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="font-semibold text-muted-foreground">{label}</dt>
              <dd className="mt-0.5">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2.5 text-xs text-muted-foreground">
          Supplier cost, stock, warehouse and variant identity are read-only.
          Only the Sals3 SKU and retail price are yours to set.
        </p>
      </TableCell>
    </TableRow>
  );
}

/**
 * Variant grid, bulk actions, and per-variant supplier evidence.
 *
 * The table keeps its own horizontal scroll container. That is deliberate
 * rather than a fallback: the supplier evidence columns cannot fit a phone, and the
 * alternative - scrolling the whole page sideways - breaks every other
 * screen in the portal.
 */
export default function VariantPricingTable({
  variants,
  expandedVariantId,
  onToggleExpanded,
  onToggleEnabled,
  onRetailChange,
  onSellerSkuChange,
  onBulkEnableInStock,
  onBulkDisableUnavailable,
  onBulkSetPrice,
  evidenceCapturedAt,
}: VariantPricingTableProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-3 py-2.5">
        <span className="text-xs font-semibold text-ink-muted">
          Bulk actions
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBulkSetPrice}
        >
          <Tag aria-hidden="true" />
          Set retail price…
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBulkEnableInStock}
        >
          Enable eligible in-stock variants
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onBulkDisableUnavailable}
        >
          Disable unavailable variants
        </Button>
        <span className="text-xs text-muted-foreground">
          Bulk actions skip blocked and paused variants — they are never
          re-enabled silently.
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <Table className="min-w-[68rem]">
          <TableHeader>
            <TableRow>
              {COLUMNS.map((column) => (
                <TableHead
                  key={column}
                  scope="col"
                  className="whitespace-nowrap"
                >
                  {column}
                </TableHead>
              ))}
              <TableHead scope="col">
                <span className="sr-only">Supplier evidence</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map((variant) => {
              const isExpanded = expandedVariantId === variant.id;
              const lockedOut =
                variant.listingState === 'BLOCKED' ||
                variant.listingState === 'PAUSED' ||
                variant.supplierStock === 0;

              return [
                <TableRow key={variant.id}>
                  <TableCell>
                    <Checkbox
                      checked={variant.enabled}
                      disabled={lockedOut}
                      aria-label={`List ${variant.optionLabel}`}
                      onCheckedChange={() => onToggleEnabled(variant.id)}
                    />
                  </TableCell>
                  <TableCell>
                    {variant.hasImage ? (
                      <span
                        aria-hidden="true"
                        className="flex size-9 items-center justify-center rounded-md border border-border bg-muted font-mono text-xs text-muted-foreground"
                      >
                        img
                      </span>
                    ) : (
                      <span
                        title="No variant image"
                        className="flex size-9 items-center justify-center rounded-md border border-dashed border-border-strong text-amber-600"
                      >
                        <ImageOff aria-hidden="true" className="size-3.5" />
                        <span className="sr-only">No variant image</span>
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-44 truncate font-medium">
                    {variant.optionLabel}
                  </TableCell>
                  <TableCell>
                    <Input
                      value={variant.sellerSku}
                      aria-label={`Sals3 SKU for ${variant.optionLabel}`}
                      className="h-8 w-32"
                      onChange={(event) =>
                        onSellerSkuChange(variant.id, event.target.value)
                      }
                    />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatMoney(variant.supplierCost)}
                  </TableCell>
                  <TableCell>
                    <RetailPriceInput
                      label={`Retail price for ${variant.optionLabel}`}
                      value={variant.retailPrice}
                      supplierCost={variant.supplierCost}
                      onChange={(amountMinor) =>
                        onRetailChange(variant.id, amountMinor)
                      }
                    />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {variant.supplierStock === 0 ? (
                      <span className="font-medium text-amber-600">0</span>
                    ) : (
                      formatCount(variant.supplierStock)
                    )}
                  </TableCell>
                  <TableCell>
                    {variant.attention === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <StatusPill label={variant.attention} tone="warning" />
                    )}
                  </TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      aria-expanded={isExpanded}
                      aria-label={`Supplier evidence for ${variant.optionLabel}`}
                      onClick={() => onToggleExpanded(variant.id)}
                    >
                      {isExpanded ? (
                        <ChevronUp aria-hidden="true" />
                      ) : (
                        <ChevronDown aria-hidden="true" />
                      )}
                    </Button>
                  </TableCell>
                </TableRow>,
                isExpanded ? (
                  <VariantEvidenceRow
                    key={`${variant.id}-evidence`}
                    variant={variant}
                  />
                ) : null,
              ];
            })}
          </TableBody>
        </Table>
      </div>

      <div className="flex flex-col gap-2 text-xs text-muted-foreground">
        <p>
          Supplier cost and stock captured {formatDateTime(evidenceCapturedAt)}.
          Retail prices are shown in the currency they are set in. The portal
          does not convert supplier prices — no approved exchange-rate source
          exists for this screen.
        </p>
      </div>
    </div>
  );
}
