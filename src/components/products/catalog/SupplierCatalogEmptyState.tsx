import { PackageSearch, type LucideIcon } from 'lucide-react';
import LinkButton from '@/components/portal/LinkButton';

type SupplierCatalogEmptyStateProps = {
  title: string;
  description: string;
  icon?: LucideIcon;
  action?: {
    label: string;
    href: string;
  };
};

/**
 * Same bento shape as `SourcingEmptyState` (icon tile + message tile), with
 * one addition: an optional primary action, since "No active supplier apps"
 * (spec section 4) needs a real way out - "Manage Supplier Apps" - not just
 * an explanation. Left as its own component instead of adding the action
 * prop to `SourcingEmptyState` itself, so the existing Product Sourcing
 * screens are untouched by this redesign.
 */
export default function SupplierCatalogEmptyState({
  title,
  description,
  icon: Icon = PackageSearch,
  action,
}: SupplierCatalogEmptyStateProps) {
  return (
    <div className="grid animate-in fade-in slide-in-from-bottom-2 grid-cols-1 gap-3 duration-300 sm:grid-cols-[10rem_1fr]">
      <div className="relative flex items-center justify-center overflow-hidden rounded-lg border border-border bg-primary/5 py-10 sm:py-0">
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[radial-gradient(circle_at_1px_1px,var(--color-border)_1px,transparent_0)] [background-size:16px_16px] opacity-50"
        />
        <Icon aria-hidden="true" className="relative size-10 text-primary" />
      </div>
      <div className="flex flex-col justify-center gap-3 rounded-lg border border-border bg-card px-6 py-10 text-center sm:text-left">
        <div>
          <h2 className="font-display text-lg font-semibold">{title}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{description}</p>
        </div>
        {action === undefined ? null : (
          <div className="sm:self-start">
            <LinkButton href={action.href} size="default">
              {action.label}
            </LinkButton>
          </div>
        )}
      </div>
    </div>
  );
}
