import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ProductEditorData } from '@/modules/catalog/products/editor-queries';

function money(minor: bigint | null, currency: string | null): string {
  if (minor === null || currency === null) return 'Not observed';

  return `${(Number(minor) / 100).toFixed(2)} ${currency}`;
}

/**
 * Read-only variants: Sals3 identity plus the supplier's OBSERVED facts. The
 * option label is the raw CJ string, never parsed - option mapping is unbuilt,
 * which is also why every variant is still `DRAFT`.
 */
export default function ProductVariantsPanel({
  variants,
}: {
  variants: ProductEditorData['variants'];
}) {
  if (variants.length === 0) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <h2 className="text-base font-semibold">Variants</h2>
        <p className="text-sm text-ink-muted">
          No variants - no supplier evidence was stored for this candidate when
          it was drafted. Variants are created only from persisted CJ evidence,
          never invented.
        </p>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      <h2 className="text-base font-semibold">Variants ({variants.length})</h2>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {[
                'Sals3 SKU',
                'Supplier option',
                'Observed cost',
                'Observed stock',
                'Status',
              ].map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {variants.map(({ variant, reference }) => (
              <TableRow key={variant.id}>
                <TableCell className="font-mono text-xs">
                  {variant.sals3Sku}
                </TableCell>
                <TableCell className="max-w-56 truncate">
                  {reference?.sourceOptionLabel ?? 'Not captured'}
                </TableCell>
                <TableCell className="tabular-nums">
                  {money(
                    reference?.lastObservedCostMinor ?? null,
                    reference?.lastObservedCostCurrency ?? null,
                  )}
                </TableCell>
                <TableCell className="tabular-nums">
                  {reference?.lastObservedInventory ?? 'Not observed'}
                </TableCell>
                <TableCell>{variant.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-ink-subtle">
        Supplier facts are observations, not commitments - recorded when the
        evidence was captured, not live.
      </p>
    </section>
  );
}
