'use client';

import { ChevronDown, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import {
  value,
  type CatalogueRowView,
} from '@/lib/seller-center/product-catalogue/view';
import ContentScoreBadge from './ContentScoreBadge';
import CopyableIdentity from './CopyableIdentity';
import SupplierConnectionHealthBadge from './SupplierConnectionHealthBadge';

type CatalogueRowIdentityCellProps = {
  row: CatalogueRowView;
  expanded: boolean;
  onToggleExpanded: (id: string) => void;
};

/**
 * The identity column: expand affordance, thumbnail slot, name, the copyable
 * Sals3 and supplier identifiers, and the two inline badges.
 *
 * Sals3 identity leads and the supplier reference follows it, never labelled
 * "Product ID" - a seller quoting a CJ id to Sals3 support is a bug we chose
 * not to design in.
 *
 * A `CONNECTED` connection prints no badge. Silence there means healthy, which
 * is why the untracked arm must still render: an unmeasured connection is not
 * a healthy one.
 */
export default function CatalogueRowIdentityCell({
  row,
  expanded,
  onToggleExpanded,
}: CatalogueRowIdentityCellProps) {
  const hasVariants = row.variants.length > 0;
  const providerName =
    row.supplierProviderName.kind === 'value'
      ? row.supplierProviderName.value
      : 'Supplier';
  const health = row.supplierConnectionHealth;

  return (
    <div className="flex items-start gap-2.5">
      {hasVariants ? (
        <button
          type="button"
          onClick={() => onToggleExpanded(row.id)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${row.variants.length} variants`}
          className="mt-1 shrink-0 text-muted-foreground hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown aria-hidden="true" className="size-4" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-4" />
          )}
        </button>
      ) : (
        <span className="size-4 shrink-0" aria-hidden="true" />
      )}

      <span
        aria-hidden="true"
        className="flex size-12 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-[10px] text-muted-foreground"
      >
        {row.hasImage.kind === 'value' && row.hasImage.value
          ? null
          : 'No image'}
      </span>

      <div className="min-w-0 flex-1">
        <Link
          href={row.actions.editHref}
          className="font-medium text-foreground hover:underline"
        >
          {row.name}
        </Link>
        <CopyableIdentity
          displayLabel="Sals3 Product ID"
          copyLabel="Sals3 Product ID"
          tracked={value(row.sals3ProductId)}
        />
        <CopyableIdentity
          displayLabel={`${providerName} · CJ ID`}
          copyLabel="CJ Product ID"
          tracked={row.supplierReference}
        />
        <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
          <ContentScoreBadge score={row.contentReadiness} />
          {health.kind === 'value' && health.value === 'CONNECTED' ? null : (
            <SupplierConnectionHealthBadge health={health} />
          )}
        </div>
      </div>
    </div>
  );
}
