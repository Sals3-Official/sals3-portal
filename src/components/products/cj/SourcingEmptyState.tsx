type SourcingEmptyStateProps = {
  title: string;
  description: string;
};

/** Shared empty state for the Product Sourcing pages. Never mock data. */
export default function SourcingEmptyState({
  title,
  description,
}: SourcingEmptyStateProps) {
  return (
    <div className="rounded-lg border border-border bg-card px-6 py-16 text-center">
      <h2 className="font-display text-lg font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}
