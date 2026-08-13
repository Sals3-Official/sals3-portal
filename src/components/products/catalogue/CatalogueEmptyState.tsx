import LinkButton from '@/components/portal/LinkButton';

/**
 * The catalogue has no products at all - a different fact from "no row matches
 * the current filters", which the table itself states inside its own body.
 *
 * Keeping the two apart matters: a seller who has added nothing needs the route
 * to Product Sourcing, while a seller whose filter excluded everything needs to
 * know their filter did it. One shared "empty" message would answer the wrong
 * question half the time.
 */
export default function CatalogueEmptyState() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-card p-6">
      <p className="text-base font-semibold">Nothing in your catalogue yet</p>
      <p className="max-w-prose text-sm text-ink-muted">
        Products arrive here when you select qualified candidates on Product
        Sourcing and add them. They start as drafts - publishing is a separate,
        unbuilt step.
      </p>
      <LinkButton href="/products/pipeline?tab=ready" size="sm">
        Open Product Sourcing
      </LinkButton>
    </div>
  );
}
