import Image from 'next/image';
import { Package } from 'lucide-react';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatUsdCents, type CjProduct } from '@/lib/cj/normalize';
import CheckForSals3Action from './CheckForSals3Action';

type CjProductRowProps = {
  product: CjProduct;
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
export default function CjProductRow({ product }: CjProductRowProps) {
  return (
    <TableRow className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3 md:table-row md:px-0 md:py-0">
      {/* `md:w-full md:max-w-0` is the table-truncation idiom: it makes this the
          column that absorbs the leftover width, which gives the inner
          `truncate` a bound to work against. Without it the cell grows to fit
          the longest product name and pushes the last column out of view. */}
      <TableCell className="block w-full min-w-0 p-0 whitespace-normal md:table-cell md:w-full md:max-w-0 md:p-2">
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
            <p className="truncate font-medium" title={product.name}>
              {product.name}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              {product.sku} · {product.category}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell className="block p-0 text-right tabular-nums md:table-cell md:p-2">
        <p className="font-medium">{formatUsdCents(product.priceCentsUsd)}</p>
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
        <CheckForSals3Action
          externalProductId={product.id}
          productName={product.name}
        />
      </TableCell>
      {/* Mobile only: the columns hidden above are still useful on a phone, so
          they return as one muted line instead of disappearing. */}
      <TableCell className="block w-full p-0 text-xs whitespace-normal text-muted-foreground md:hidden">
        {product.weight} · ships from{' '}
        {product.shipsFrom.length === 0 ? '—' : product.shipsFrom.join(', ')}
      </TableCell>
    </TableRow>
  );
}
