import Image from 'next/image';
import { ChevronDown, ChevronUp, ImageOff, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import RetailPriceInput from '@/components/products/editor/RetailPriceInput';
import { cn } from '@/lib/utils';
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
  onBulkSetPrice: () => void;
  /**
   * Opens the photo picker for one variant. Omitted in fixture/design-preview
   * mode and wherever no real media can be assigned, in which case the cell
   * reports the state without offering a control that would do nothing.
   */
  onPickImage?: (variantId: string) => void;
};

/**
 * The variant grid's columns: which of them a seller fills in, and which are
 * supplier evidence.
 *
 * `required` marks a column the server really refuses on, not one that merely
 * looks editable. Retail price is a publication gate — `publishProduct` refuses
 * a listing without one, and refuses one under the supplier-cost floor. Sals3
 * SKU is editable and gates nothing, so it carries no marker: a required mark on
 * an optional field is the same defect as a blocker pill on a warning. The
 * marker is the editor's own dot rather than a form asterisk, so this table and
 * the Variant Matrix above it use one marker language.
 *
 * It is `aria-hidden` and deliberately carries no `sr-only` counterpart. A first
 * attempt added one and it was wrong twice over: it made the header's accessible
 * name `Retail price(required)`, which is what a table announces on every column
 * move and what `ProductEditor.test.tsx` queries the header by, and a column
 * heading is the wrong place for the claim anyway — required-ness belongs on the
 * field. The authoritative signal is already text and already elsewhere: the
 * readiness panel lists the publish gate by name, and `publishProduct` refuses
 * with it.
 *
 * `evidence` recesses a cell onto the muted surface. That is not decoration and
 * it is not a full grid of rules: `Supplier cost` and `Supplier stock` are the
 * two read-only numbers sitting either side of the one number a seller does set,
 * which is the only place in this table where read-only can be mistaken for a
 * field. `VariantMatrixValueRow` already recesses the locked supplier token this
 * exact way, so the table now says "supplier's, not yours" in the same visual
 * language the matrix does. `Image`, `Variant` and `Attention` are read-only too
 * and stay unrecessed — nothing about them invites typing.
 */
const COLUMNS: { label: string; required?: boolean; evidence?: boolean }[] = [
  { label: 'List' },
  { label: 'Image' },
  { label: 'Variant' },
  { label: 'Sals3 SKU' },
  { label: 'Supplier cost', evidence: true },
  { label: 'Retail price', required: true },
  { label: 'Supplier stock', evidence: true },
  { label: 'Attention' },
];

/** The recessed surface, shared by the header cell and every body cell. */
const EVIDENCE_CELL = 'bg-muted/40';

/**
 * The Image cell: the variant's own photo, or the offer to choose one.
 *
 * It used to render the literal string `img` in a bordered box for a variant
 * that had a photo — a placeholder for a picture the cell already had the
 * address of, next to rows that could never gain one because nothing wrote
 * `product_media_sources.variant_id`. Now the photo is the cell, and the cell is
 * the control.
 *
 * 36px square at 72px source: it is a thumbnail in a dense table, and asking
 * for a full-size render per row would download twelve product photos to draw
 * twelve small squares.
 */
function VariantImageCell({
  variant,
  onPick,
}: {
  variant: VariantFixture;
  onPick?: (() => void) | undefined;
}) {
  const content =
    variant.imageUrl === null || variant.imageUrl === undefined ? (
      <span className="flex size-9 items-center justify-center rounded-md border border-dashed border-border-strong text-amber-600">
        <ImageOff aria-hidden="true" className="size-3.5" />
      </span>
    ) : (
      <Image
        src={variant.imageUrl}
        alt=""
        width={72}
        height={72}
        loading="lazy"
        className="size-9 rounded-md border border-border object-cover"
      />
    );

  if (onPick === undefined) {
    return (
      <span title={variant.hasImage ? undefined : 'No variant image'}>
        {content}
        <span className="sr-only">
          {variant.hasImage ? 'Variant photo' : 'No variant image'}
        </span>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={onPick}
      // The accessible name carries the variant, because a table of ten
      // identical "Choose photo" buttons names none of them.
      aria-label={`${variant.hasImage ? 'Change' : 'Choose'} photo for ${variant.optionLabel}`}
      className="rounded-md outline-offset-2 transition hover:brightness-95 focus-visible:outline-2"
    >
      {content}
    </button>
  );
}

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
  onBulkSetPrice,
  onPickImage,
}: VariantPricingTableProps) {
  return (
    <div className="flex flex-col gap-3">
      {/*
        The variant rows read as one list rather than as loose fields because
        the header, the count and the bulk control sit inside the same bordered
        box as the table. That grouping is the borrowed idea; the wording is
        this editor's own - `Variants`, matching the section it lives in, not a
        third noun for the same thing.

        The bulk control stays a dialog rather than an inline apply-to-all row.
        That is deliberate: the dialog is one of the three places the 2.5%
        retail-over-supplier-cost floor is enforced - it states its blast radius
        and disables Apply against the highest affected cost. An inline field
        would either duplicate that guard or quietly ship without it.
      */}
      <div className="overflow-hidden rounded-lg border border-border">
        <div className="border-b border-border bg-muted/30 px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-xs font-semibold tracking-wide uppercase text-ink-muted">
              Variants
            </h4>
            <span className="text-xs text-muted-foreground">
              {variants.length} {variants.length === 1 ? 'variant' : 'variants'}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ms-auto"
              onClick={onBulkSetPrice}
            >
              <Tag aria-hidden="true" />
              Set retail price…
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-muted-foreground">
            Variants with stock are listed automatically. Blocked and paused
            ones are never switched on for you.
          </p>
        </div>

        {/*
          Taller rows, and no vertical rules. A full grid of cell edges is one
          way to keep a dense row of inputs scannable, but it draws eight lines
          to answer one question, and the portal's tables are ruled
          horizontally only. The recessed `Supplier cost` and `Supplier stock`
          columns answer that question instead - see `COLUMNS`.
        */}
        <Table className="min-w-[68rem] [&_td]:py-3">
          <TableHeader>
            <TableRow>
              {COLUMNS.map((column) => (
                <TableHead
                  key={column.label}
                  scope="col"
                  className={cn(
                    'whitespace-nowrap',
                    column.evidence === true ? EVIDENCE_CELL : undefined,
                  )}
                >
                  {column.required === true ? (
                    <span aria-hidden="true" className="mr-1 text-destructive">
                      •
                    </span>
                  ) : null}
                  {column.label}
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
                    <VariantImageCell
                      variant={variant}
                      onPick={
                        onPickImage === undefined
                          ? undefined
                          : () => onPickImage(variant.id)
                      }
                    />
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
                  <TableCell className={EVIDENCE_CELL}>
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
                  <TableCell className={EVIDENCE_CELL}>
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
          The shaded columns are stored supplier evidence and read-only. Retail
          prices are shown in the currency they are set in. The portal does not
          convert supplier prices — no approved exchange-rate source exists for
          this screen.
        </p>
      </div>
    </div>
  );
}
