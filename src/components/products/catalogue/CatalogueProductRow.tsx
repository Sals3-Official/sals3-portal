'use client';

import { ChevronDown, ChevronRight, Copy, Pencil } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { toast } from 'sonner';
import StatusPill, {
  type StatusPillTone,
} from '@/components/seller-center/shared/StatusPill';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TableCell, TableRow } from '@/components/ui/table';
import copyToClipboard from '@/lib/seller-center/clipboard';
import { deriveProductAvailability } from '@/lib/seller-center/product-catalogue/derive';
import { formatMoney } from '@/lib/seller-center/product-editor/format';
import {
  LISTING_STATUS_LABELS,
  type CatalogueProductFixture,
  type ListingStatus,
} from '@/lib/seller-center/product-catalogue/types';
import AttentionBadge from './AttentionBadge';
import AvailabilityBadge from './AvailabilityBadge';
import CatalogueVariantRow from './CatalogueVariantRow';
import ContentScoreBadge from './ContentScoreBadge';
import MediaStatusBadge from './MediaStatusBadge';
import PublishProductButton from './PublishProductButton';
import SupplierConnectionHealthBadge from './SupplierConnectionHealthBadge';

type CatalogueProductRowProps = {
  product: CatalogueProductFixture;
  selected: boolean;
  expanded: boolean;
  onToggleSelected: (id: string) => void;
  onToggleExpanded: (id: string) => void;
  onPauseListing: (id: string) => void;
  onArchive: (id: string) => void;
  onToggleVariantPaused: (productId: string, variantId: string) => void;
};

const LISTING_STATUS_TONE: Record<ListingStatus, StatusPillTone> = {
  DRAFT: 'neutral',
  LIVE: 'success',
  LIVE_NEEDS_ATTENTION: 'warning',
  AUTO_PAUSED: 'danger',
  ARCHIVED: 'neutral',
};

function announceUnbuilt(action: string, productName: string) {
  toast(`${action} isn't built yet for "${productName}".`, {
    description: 'This design preview has no catalogue backend.',
  });
}

async function copyIdentity(value: string, label: string) {
  const ok = await copyToClipboard(value);

  toast(
    ok
      ? `Copied ${label} to clipboard.`
      : `Couldn't copy ${label} to clipboard.`,
  );
}

/** Parent row: one Sals3 listing, plus its expandable Sals3 variant rows. */
export default function CatalogueProductRow({
  product,
  selected,
  expanded,
  onToggleSelected,
  onToggleExpanded,
  onPauseListing,
  onArchive,
  onToggleVariantPaused,
}: CatalogueProductRowProps) {
  const hasVariants = product.variants.length > 0;
  const editHref =
    product.editorHref ?? `/listings/new?fixture=${product.editorFixtureKey}`;
  const availability = deriveProductAvailability(
    product.variants,
    product.availability,
  );
  const isLive =
    product.status === 'LIVE' || product.status === 'LIVE_NEEDS_ATTENTION';
  const canViewLive = isLive && product.storefrontUrl !== null;

  return (
    <>
      <TableRow>
        <TableCell>
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelected(product.id)}
            aria-label={`Select ${product.name}`}
          />
        </TableCell>
        <TableCell>
          <div className="flex items-start gap-2.5">
            {hasVariants ? (
              <button
                type="button"
                onClick={() => onToggleExpanded(product.id)}
                aria-expanded={expanded}
                aria-label={`${expanded ? 'Collapse' : 'Expand'} ${product.variants.length} variants`}
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

            <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted text-[10px] text-muted-foreground">
              {product.coverImageUrl ? (
                <Image
                  src={product.coverImageUrl}
                  alt={product.name}
                  width={48}
                  height={48}
                  sizes="48px"
                  className="size-full object-contain"
                />
              ) : (
                'No image'
              )}
            </span>

            <div className="min-w-0 flex-1">
              <Link
                href={editHref}
                className="font-medium text-foreground hover:underline"
              >
                {product.name}
              </Link>
              <button
                type="button"
                onClick={() =>
                  copyIdentity(product.sals3ProductId, 'Sals3 Product ID')
                }
                aria-label={`Copy Sals3 Product ID ${product.sals3ProductId}`}
                className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                Sals3 Product ID: {product.sals3ProductId}
                <Copy aria-hidden="true" className="size-3" />
              </button>
              <button
                type="button"
                onClick={() =>
                  copyIdentity(product.cjProductId, 'CJ Product ID')
                }
                aria-label={`Copy CJ Product ID ${product.cjProductId}`}
                className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                {product.supplierProviderName} · CJ ID: {product.cjProductId}
                <Copy aria-hidden="true" className="size-3" />
              </button>
              <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                <ContentScoreBadge score={product.contentReadiness} />
                {product.supplierConnectionHealth === 'CONNECTED' ? null : (
                  <SupplierConnectionHealthBadge
                    health={product.supplierConnectionHealth}
                  />
                )}
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <StatusPill
            label={LISTING_STATUS_LABELS[product.status]}
            tone={LISTING_STATUS_TONE[product.status]}
          />
          {product.status === 'AUTO_PAUSED' && product.pauseReason !== null ? (
            <p className="mt-1 max-w-40 text-xs text-muted-foreground">
              {product.pauseReason}
            </p>
          ) : null}
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-1.5">
            {product.sellingPrice === null
              ? 'Not available'
              : formatMoney(product.sellingPrice)}
            <button
              type="button"
              onClick={() => announceUnbuilt('Editing price', product.name)}
              aria-label={`Edit selling price for ${product.name}`}
              className="text-muted-foreground hover:text-foreground"
            >
              <Pencil aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        </TableCell>
        <TableCell>
          <AvailabilityBadge availability={availability} />
        </TableCell>
        <TableCell>
          <MediaStatusBadge mediaStatus={product.mediaStatus} />
        </TableCell>
        <TableCell>
          <AttentionBadge reasons={product.attentionReasons} />
        </TableCell>
        <TableCell>
          <div className="flex items-center gap-3">
            <Link
              href={editHref}
              className="text-sm font-medium text-primary hover:underline"
            >
              Edit
            </Link>
            {/*
              Only for a real persisted row. `productVersion` is the
              compare-and-set token the publish action requires, and an
              illustrative fixture has no row to contend with — offering the
              control there would send a guessed version at a product that does
              not exist.
            */}
            {product.productVersion === undefined ? null : (
              <PublishProductButton
                productId={product.sals3ProductId}
                productVersion={product.productVersion}
                isLive={isLive}
              />
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={`More actions for ${product.name}`}
                    className="inline-flex items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
                  >
                    More
                    <ChevronDown aria-hidden="true" className="size-3.5" />
                  </button>
                }
              />
              <DropdownMenuContent align="end">
                {isLive ? (
                  <DropdownMenuItem onClick={() => onPauseListing(product.id)}>
                    Pause listing
                  </DropdownMenuItem>
                ) : null}
                {product.status === 'AUTO_PAUSED' ? (
                  <DropdownMenuItem
                    onClick={() =>
                      announceUnbuilt('Review & resume', product.name)
                    }
                  >
                    Review & resume
                  </DropdownMenuItem>
                ) : null}
                {product.status === 'DRAFT' ? (
                  <DropdownMenuItem
                    onClick={() => announceUnbuilt('Publish', product.name)}
                  >
                    Publish
                  </DropdownMenuItem>
                ) : null}
                {product.status === 'ARCHIVED' ? (
                  <DropdownMenuItem
                    onClick={() =>
                      announceUnbuilt('Restore as new draft', product.name)
                    }
                  >
                    Restore as new draft
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onClick={() =>
                    announceUnbuilt('Duplicate as new draft', product.name)
                  }
                >
                  Duplicate as new draft
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canViewLive}
                  onClick={() => {
                    if (canViewLive)
                      announceUnbuilt('View Live Page', product.name);
                  }}
                >
                  View Live Page
                  {canViewLive ? null : ' (not live)'}
                </DropdownMenuItem>
                {product.status !== 'ARCHIVED' ? (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => onArchive(product.id)}
                  >
                    Archive
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </TableCell>
      </TableRow>

      {expanded
        ? product.variants.map((variant) => (
            <CatalogueVariantRow
              key={variant.id}
              variant={variant}
              onTogglePaused={(variantId) =>
                onToggleVariantPaused(product.id, variantId)
              }
            />
          ))
        : null}
    </>
  );
}
