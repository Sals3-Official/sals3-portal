import { PackageOpen, SearchX } from 'lucide-react';
import LinkButton from '@/components/portal/LinkButton';

type ProductsEmptyStateProps = {
  filtered: boolean;
  canCreate: boolean;
};

/**
 * Two different empty states on purpose. "No products yet" and "nothing matches
 * this filter" need different next steps, and one generic message helps neither.
 */
export default function ProductsEmptyState({
  filtered,
  canCreate,
}: ProductsEmptyStateProps) {
  const Glyph = filtered ? SearchX : PackageOpen;

  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <Glyph aria-hidden="true" className="size-8 text-ink-faint" />
      <h2 className="font-display text-lg font-semibold">
        {filtered ? 'No products match these filters' : 'No products yet'}
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {filtered
          ? 'Change the search words or the filters to see more products.'
          : 'Add your first product. You can save it as a draft and finish it later.'}
      </p>
      {filtered ? (
        <LinkButton href="/products" variant="outline">
          Clear filters
        </LinkButton>
      ) : null}
      {!filtered && canCreate ? (
        <LinkButton href="/products/new">Add product</LinkButton>
      ) : null}
    </div>
  );
}
