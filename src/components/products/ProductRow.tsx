import Link from 'next/link';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatMoney, peso } from '@/lib/money';
import {
  PRODUCT_BRAND_LABELS,
  PRODUCT_CATEGORY_LABELS,
} from '@/lib/products/constants';
import { effectivePriceMinor, totalStock } from '@/lib/products/query';
import type { Product } from '@/lib/products/types';
import ProductRowActions from './ProductRowActions';
import ProductStatusBadge from './ProductStatusBadge';
import ProductThumb from './ProductThumb';

type ProductRowProps = {
  product: Product;
  selected: boolean;
  onToggle: (id: string, next: boolean) => void;
  canEdit: boolean;
  canDuplicate: boolean;
  onDuplicate: (id: string) => void;
};

/**
 * One product row.
 *
 * The same markup serves both layouts. From `md` up it is a real table row;
 * below that the row and its cells switch to block and flex, so the data stacks
 * into a card. Rendering a second card component instead would put every row in
 * the DOM twice and duplicate each checkbox and link in the accessibility tree,
 * and choosing between them in JavaScript would make the server and client
 * render different markup.
 */
export default function ProductRow({
  product,
  selected,
  onToggle,
  canEdit,
  canDuplicate,
  onDuplicate,
}: ProductRowProps) {
  const stock = totalStock(product);
  const onSale = product.pricing.saleMinor !== null;

  return (
    <TableRow
      data-state={selected ? 'selected' : undefined}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-3 md:table-row md:px-0 md:py-0"
    >
      <TableCell className="block w-auto p-0 md:table-cell md:w-10 md:p-2">
        <Checkbox
          checked={selected}
          onCheckedChange={(next) => onToggle(product.id, next === true)}
          aria-label={`Select ${product.name}`}
          className="cursor-pointer"
        />
      </TableCell>
      <TableCell className="block min-w-0 flex-1 p-0 md:table-cell md:p-2">
        <div className="flex items-center gap-3">
          <ProductThumb
            tone={product.tone}
            media={product.media}
            name={product.name}
          />
          <div className="min-w-0">
            <Link
              href={`/products/${product.id}`}
              className="block truncate font-medium text-foreground hover:text-primary hover:underline"
            >
              {product.name}
            </Link>
            <p className="truncate text-xs text-muted-foreground">
              {product.identifiers.sku} · {product.variants.length}{' '}
              {product.variants.length === 1 ? 'variant' : 'variants'}
            </p>
          </div>
        </div>
      </TableCell>
      <TableCell className="order-last block w-full p-0 md:order-none md:table-cell md:w-auto md:p-2">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 md:contents">
          <ProductStatusBadge status={product.status} />
          <span className="text-sm font-medium tabular-nums md:hidden">
            {formatMoney(peso(effectivePriceMinor(product)))}
          </span>
          <span className="text-xs text-muted-foreground md:hidden">
            {PRODUCT_CATEGORY_LABELS[product.category]} ·{' '}
            {stock === 0 ? 'Out of stock' : `${stock} in stock`} · updated{' '}
            {product.updatedAt}
          </span>
        </div>
      </TableCell>
      <TableCell className="hidden text-sm text-ink-muted md:table-cell">
        <p>{PRODUCT_CATEGORY_LABELS[product.category]}</p>
        <p className="text-xs text-muted-foreground">
          {PRODUCT_BRAND_LABELS[product.brand]}
        </p>
      </TableCell>
      <TableCell className="hidden text-right tabular-nums md:table-cell">
        <p className="font-medium">
          {formatMoney(peso(effectivePriceMinor(product)))}
        </p>
        {onSale ? (
          <p className="text-xs text-muted-foreground line-through">
            {formatMoney(peso(product.pricing.regularMinor))}
          </p>
        ) : null}
      </TableCell>
      <TableCell className="hidden text-right tabular-nums md:table-cell">
        <span className={stock === 0 ? 'font-medium text-red-600' : undefined}>
          {stock === 0 ? 'Out of stock' : stock}
        </span>
      </TableCell>
      <TableCell className="hidden text-sm whitespace-nowrap text-muted-foreground md:table-cell">
        {product.updatedAt}
      </TableCell>
      <TableCell className="block p-0 text-right md:table-cell md:p-2">
        <ProductRowActions
          productId={product.id}
          productName={product.name}
          canEdit={canEdit}
          canDuplicate={canDuplicate}
          onDuplicate={() => onDuplicate(product.id)}
        />
      </TableCell>
    </TableRow>
  );
}
