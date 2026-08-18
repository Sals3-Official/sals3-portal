import { ChevronDown, ChevronUp, ImageOff, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
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

/**
 * `optionLabel` arrives pre-formatted by the read-model: `"Colour: Army
 * Green, Size: XL"` once the Variant Matrix is mapped, or the supplier's raw
 * concatenated token (`"Army Green-XL"`) when it is not. Splitting the mapped
 * form into per-axis chips makes the buyer-facing identity easy to scan at a
 * glance instead of reading one run-on string; an unmapped label has no
 * `": "` pairs and renders as plain text, unchanged.
 */
function optionLabelParts(label: string): string[] | null {
  const parts = label.split(', ').filter((part) => part.includes(': '));

  return parts.length > 0 && parts.length === label.split(', ').length
    ? parts
    : null;
}

function VariantIdentity({ optionLabel }: { optionLabel: string }) {
  const parts = optionLabelParts(optionLabel);

  if (parts === null) {
    return <span className="truncate">{optionLabel}</span>;
  }

  return (
    <span className="flex flex-wrap gap-1">
      {parts.map((part) => (
        <span
          key={part}
          className="rounded bg-muted px-1.5 py-0.5 text-xs whitespace-nowrap text-ink-muted"
        >
          {part}
        </span>
      ))}
    </span>
  );
}

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
                    <Switch
                      checked={variant.enabled}
                      disabled={lockedOut}
                      aria-label={`List ${variant.optionLabel}`}
                      onCheckedChange={() => onToggleEnabled(variant.id)}
                      // Sals3 brand blues, not the theme's `--primary` token -
                      // scoped to this one control rather than a global
                      // restyle.
                      className="data-checked:bg-[#018CC9] data-unchecked:bg-[#002B53]"
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
                  <TableCell className="max-w-56 font-medium">
                    <VariantIdentity optionLabel={variant.optionLabel} />
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
                  <TableCell>
                    <div className="flex flex-col gap-0.5 tabular-nums">
                      <span>{formatMoney(variant.supplierCost)}</span>
                      <span className="text-xs text-muted-foreground">
                        Observed {formatDateTime(variant.evidenceCapturedAt)}
                      </span>
                    </div>
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
                  <TableCell>
                    <div className="flex flex-col gap-0.5 tabular-nums">
                      {variant.supplierStock === 0 ? (
                        <span className="font-medium text-amber-600">0</span>
                      ) : (
                        <span>{formatCount(variant.supplierStock)}</span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        Observed {formatDateTime(variant.evidenceCapturedAt)}
                      </span>
                    </div>
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
          Supplier cost and stock use stored supplier evidence only. Retail
          prices are shown in the currency they are set in. The portal does not
          convert supplier prices — no approved exchange-rate source exists for
          this screen.
        </p>
      </div>
    </div>
  );
}
