'use client';

import { Pencil } from 'lucide-react';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import { formatMoney } from '@/lib/seller-center/product-editor/format';
import type {
  CatalogueRowAction,
  CatalogueRowView,
  VariantActionView,
} from '@/lib/seller-center/product-catalogue/view';
import AttentionBadge from './AttentionBadge';
import AvailabilityBadge from './AvailabilityBadge';
import CatalogueRowActionsMenu from './CatalogueRowActionsMenu';
import CatalogueRowIdentityCell from './CatalogueRowIdentityCell';
import CatalogueVariantRow from './CatalogueVariantRow';
import MediaStatusBadge from './MediaStatusBadge';
import NotTrackedPill from './NotTrackedPill';

/**
 * A paused row explains itself; every other row prints nothing here. A
 * "pause reason: not tracked" line under a draft would be noise.
 */
function pauseReasonLine(pauseReason: CatalogueRowView['pauseReason']) {
  if (pauseReason.kind !== 'value')
    return (
      <p className="mt-1 max-w-40 text-xs text-muted-foreground">
        <NotTrackedPill tracked={pauseReason} />
      </p>
    );

  if (pauseReason.value === null) return null;

  return (
    <p className="mt-1 max-w-40 text-xs text-muted-foreground">
      {pauseReason.value}
    </p>
  );
}

type CatalogueProductRowProps = {
  row: CatalogueRowView;
  selected: boolean;
  expanded: boolean;
  onToggleSelected: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  onAction: (id: string, action: CatalogueRowAction) => void;
  onVariantAction: (
    productId: string,
    variantId: string,
    kind: VariantActionView['kind'],
  ) => void;
};

/**
 * Parent row: one Sals3 listing, plus its expandable Sals3 variant rows.
 *
 * Renders a `CatalogueRowView`, never a fixture and never a database row, so
 * the design preview at `/design-preview/product-catalogue` and the real
 * `/listings` share this markup exactly. Anything the real system does not
 * record arrives as a non-`value` arm and prints "Not tracked yet" instead of a
 * plausible number.
 */
export default function CatalogueProductRow({
  row,
  selected,
  expanded,
  onToggleSelected,
  onToggleExpanded,
  onAction,
  onVariantAction,
}: CatalogueProductRowProps) {
  const price = row.sellingPrice;

  return (
    <>
      <TableRow>
        <TableCell>
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelected(row.id)}
            aria-label={`Select ${row.name}`}
          />
        </TableCell>
        <TableCell>
          <CatalogueRowIdentityCell
            row={row}
            expanded={expanded}
            onToggleExpanded={onToggleExpanded}
          />
        </TableCell>
        <TableCell>
          <StatusPill label={row.status.label} tone={row.status.tone} />
          {pauseReasonLine(row.pauseReason)}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            {price.kind === 'value' ? (
              formatMoney(price.value)
            ) : (
              <NotTrackedPill tracked={price} />
            )}
            {row.actions.editPrice.kind === 'hidden' ? null : (
              <button
                type="button"
                onClick={() => onAction(row.id, 'editPrice')}
                aria-label={`Edit selling price for ${row.name}`}
                className="text-muted-foreground hover:text-foreground"
              >
                <Pencil aria-hidden="true" className="size-3.5" />
              </button>
            )}
          </div>
        </TableCell>
        <TableCell>
          <AvailabilityBadge availability={row.availability} />
          {row.evidenceNotes.length === 0 ? null : (
            <ul className="mt-1 flex max-w-48 flex-col gap-0.5 text-xs text-muted-foreground">
              {row.evidenceNotes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </TableCell>
        <TableCell>
          <MediaStatusBadge mediaStatus={row.mediaStatus} />
        </TableCell>
        <TableCell>
          <AttentionBadge reasons={row.attentionReasons} />
        </TableCell>
        <TableCell>
          <CatalogueRowActionsMenu
            productName={row.name}
            actions={row.actions}
            onAction={(action) => onAction(row.id, action)}
          />
        </TableCell>
      </TableRow>

      {expanded
        ? row.variants.map((variant) => (
            <CatalogueVariantRow
              key={variant.id}
              variant={variant}
              onAction={(variantId, kind) =>
                onVariantAction(row.id, variantId, kind)
              }
            />
          ))
        : null}
    </>
  );
}
