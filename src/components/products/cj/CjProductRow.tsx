import Image from 'next/image';
import { ExternalLink, Package, Star } from 'lucide-react';
import { TableCell, TableRow } from '@/components/ui/table';
import { cjProductPageUrl, type CjProduct } from '@/lib/cj/normalize';
import {
  estimatePhpMinor,
  formatPhpEstimate,
} from '@/lib/products/catalog-presentation';
import type {
  CatalogFxRates,
  SupplierConnectionFixture,
} from '@/lib/products/catalog-types';
import type { EvaluatedCandidateRow } from '@/modules/catalog/candidates/queries';
import { cn } from '@/lib/utils';
import SupplierIdentity from '../catalog/SupplierIdentity';
import CjPriceConversionPopover from './CjPriceConversionPopover';
import presentEvaluationStatus from './evaluation-status';
import EvaluationStatusBadge from './EvaluationStatusBadge';

type CjProductRowProps = {
  product: CjProduct;
  evaluated: EvaluatedCandidateRow | undefined;
  connection: SupplierConnectionFixture;
  rates: CatalogFxRates;
  usdToAudRate: number | null;
  /** Caps the stagger delay so a long page doesn't take seconds to finish animating in. */
  index: number;
};

/** Same real decision the status badge shows, read again here only for the accent colour. */
const ACCENT_BORDER_CLASS: Record<
  ReturnType<typeof presentEvaluationStatus>['tone'],
  string
> = {
  success: 'border-l-green-600',
  warning: 'border-l-amber-600',
  danger: 'border-l-red-600',
  info: 'border-l-brand-600',
  neutral: 'border-l-border',
};

/**
 * One supplier product.
 *
 * The thumbnail sits inside the product cell rather than in a column of its own:
 * with automatic table layout, a narrow image column is squeezed to a few pixels
 * by the long product names beside it.
 *
 * Images come from CJ through `next/image` with fixed dimensions and lazy
 * loading, so a row never shifts as pictures arrive. A product with no
 * allow-listed image gets a neutral placeholder instead of a broken picture.
 */
export default function CjProductRow({
  product,
  evaluated,
  connection,
  rates,
  usdToAudRate,
  index,
}: CjProductRowProps) {
  const phpEstimate = formatPhpEstimate(
    product.priceCentsUsd === null
      ? null
      : estimatePhpMinor('USD', product.priceCentsUsd, rates),
  );
  const audAmount =
    product.priceCentsUsd === null || usdToAudRate === null
      ? null
      : (product.priceCentsUsd / 100) * usdToAudRate;
  const reviews = evaluated?.evidence?.reviews ?? null;
  const accentClass =
    ACCENT_BORDER_CLASS[
      presentEvaluationStatus(evaluated?.evaluation.status ?? null).tone
    ];

  return (
    <TableRow
      style={{ animationDelay: `${Math.min(index, 16) * 25}ms` }}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 border-l-4 px-3 py-3 duration-300 animate-in fade-in fill-mode-both md:table-row md:border-l-0 md:px-0 md:py-0',
        accentClass,
      )}
    >
      {/* `md:w-full md:max-w-0` is the table-truncation idiom: it makes this the
          column that absorbs the leftover width, which gives the inner
          `truncate` a bound to work against. Without it the cell grows to fit
          the longest product name and pushes the last column out of view. */}
      <TableCell
        className={cn(
          'block w-full min-w-0 p-0 whitespace-normal md:table-cell md:w-full md:max-w-0 md:border-l-4 md:p-2 md:pl-2',
          accentClass,
        )}
      >
        <div className="flex items-center gap-3">
          {product.imageUrl === null ? (
            <div
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-muted"
            >
              <Package className="size-4 text-ink-faint" />
            </div>
          ) : (
            <Image
              src={product.imageUrl}
              alt={product.name}
              width={40}
              height={40}
              // No `sizes`: the box is a fixed 40px, and passing `sizes` makes
              // Next build a srcset across every device width, so the fallback
              // `src` asks the optimizer for a 3840px render of a thumbnail.
              loading="lazy"
              className="size-10 shrink-0 rounded-md border border-border object-cover"
            />
          )}
          <div className="min-w-0">
            <a
              href={cjProductPageUrl(product.id)}
              target="_blank"
              rel="noopener noreferrer"
              title={product.name}
              className="inline-flex max-w-full items-baseline gap-1 truncate font-medium hover:text-primary hover:underline"
            >
              <span className="truncate">{product.name}</span>
              <ExternalLink
                aria-hidden="true"
                className="size-3 shrink-0 text-ink-faint"
              />
            </a>
            <p className="truncate text-xs text-muted-foreground">
              {product.sku} · {product.category}
            </p>
            {reviews === null || reviews.sampledAverageScore === null ? null : (
              <span
                title="CJ supplier-platform reviews, not a Sals3 buyer rating"
                className="mt-0.5 inline-flex items-center gap-0.5 text-xs text-amber-600"
              >
                <Star aria-hidden="true" className="size-3 fill-current" />
                {reviews.sampledAverageScore.toFixed(1)} ({reviews.totalCount})
              </span>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell md:p-2">
        <SupplierIdentity connection={connection} variant="compact" />
      </TableCell>
      <TableCell className="block p-0 text-right tabular-nums md:table-cell md:p-2">
        {product.priceCentsUsd === null ? (
          <p className="font-medium">—</p>
        ) : (
          <CjPriceConversionPopover
            priceCentsUsd={product.priceCentsUsd}
            phpEstimate={phpEstimate}
            audAmount={audAmount}
          />
        )}
        {product.freeShipping ? (
          <p className="text-xs text-green-600">Free shipping</p>
        ) : null}
      </TableCell>
      <TableCell className="hidden text-sm whitespace-nowrap text-ink-muted md:table-cell">
        {product.weight}
      </TableCell>
      <TableCell className="hidden text-sm text-ink-muted lg:table-cell">
        {product.shipsFrom.length === 0 ? '—' : product.shipsFrom.join(', ')}
      </TableCell>
      <TableCell className="hidden text-right text-sm tabular-nums text-ink-muted xl:table-cell">
        {product.listedCount ?? '—'}
      </TableCell>
      <TableCell className="block p-0 text-xs whitespace-nowrap text-muted-foreground md:table-cell md:p-2 md:text-sm">
        {product.createdAt ?? '—'}
      </TableCell>
      <TableCell className="block w-full p-0 md:table-cell md:w-auto md:p-2">
        <EvaluationStatusBadge
          productName={product.name}
          evaluation={evaluated?.evaluation ?? null}
          evidence={evaluated?.evidence ?? null}
        />
      </TableCell>
      {/* Mobile only: the columns hidden above are still useful on a phone, so
          they return as one muted line instead of disappearing. */}
      <TableCell className="block w-full p-0 md:hidden">
        <SupplierIdentity connection={connection} variant="compact" />
      </TableCell>
      <TableCell className="block w-full p-0 text-xs whitespace-normal text-muted-foreground md:hidden">
        {product.weight} · ships from{' '}
        {product.shipsFrom.length === 0 ? '—' : product.shipsFrom.join(', ')}
      </TableCell>
    </TableRow>
  );
}
