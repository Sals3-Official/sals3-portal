'use client';

import { ChevronDown, ChevronRight, Copy } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { toast } from 'sonner';
import StatusPill, {
  type StatusPillTone,
} from '@/components/seller-center/shared/StatusPill';
import { Checkbox } from '@/components/ui/checkbox';
import { TableCell, TableRow } from '@/components/ui/table';
import copyToClipboard from '@/lib/seller-center/clipboard';
import { formatMoney } from '@/lib/seller-center/product-editor/format';
import {
  LISTING_STATUS_LABELS,
  type CatalogueProductFixture,
  type ListingStatus,
} from '@/lib/seller-center/product-catalogue/types';
import describePricingUnavailable from './pricing-unavailable-messages';
import AttentionBadge from './AttentionBadge';
import CatalogueRowActions from './CatalogueRowActions';
import CatalogueVariantRow from './CatalogueVariantRow';
import ContentScoreBadge from './ContentScoreBadge';
import ListingQualityBadge from './ListingQualityBadge';
import MediaStatusBadge from './MediaStatusBadge';
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
  const priceUnavailableReason = describePricingUnavailable(
    product.sellingPriceUnavailableReason ?? null,
  );
  const editHref =
    product.editorHref ?? `/listings/new?fixture=${product.editorFixtureKey}`;
  /**
   * The product's own name is the row's primary click target, and what it
   * opens depends on whether there is a live page to send a seller to.
   *
   * A live listing opens the real storefront address — the thing a seller
   * clicking a product in a catalogue most often wants to check — in a new
   * tab, so the catalogue itself is never navigated away from. A draft has no
   * storefront page yet, so it falls back to the editor exactly as before;
   * editing stays reachable for every row regardless, through the row's own
   * `Edit` menu item.
   */
  const isLive =
    product.status === 'LIVE' || product.status === 'LIVE_NEEDS_ATTENTION';
  const canOpenStorefront = isLive && product.storefrontUrl !== null;

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
              {canOpenStorefront ? (
                <a
                  href={product.storefrontUrl ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground hover:underline"
                >
                  {product.name}
                </a>
              ) : (
                <Link
                  href={editHref}
                  className="font-medium text-foreground hover:underline"
                >
                  {product.name}
                </Link>
              )}
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
        {/*
          The price, and — when there is none — the reason there is none.

          The pencil that used to sit here only ever raised "Editing price
          isn't built yet", and it was never going to be built: a seller does
          not type a selling price into this cell. Market Rules resolves it
          from observed supplier cost and the destination's margin, under a
          floor of 2.5% above cost, so a per-row box would either contradict
          that engine or become an override with no expiry and no audit —
          which is what `Edit Special Price` is deliberately for, in one place.

          What replaces it is the answer the row already had. "Not available"
          named nothing; the resolver's reason is the same fact that will
          refuse the publish, so the cell a seller checks before publishing now
          tells them what to go and fix.
        */}
        <TableCell>
          <div className="flex flex-col gap-0.5">
            {product.sellingPrice === null ? (
              <span className="text-muted-foreground">Not set</span>
            ) : (
              formatMoney(product.sellingPrice)
            )}
            {priceUnavailableReason === null ? null : (
              <span className="text-xs text-amber-700">
                {priceUnavailableReason}
              </span>
            )}
          </div>
        </TableCell>
        <TableCell>
          <MediaStatusBadge mediaStatus={product.mediaStatus} />
        </TableCell>
        <TableCell>
          <ListingQualityBadge product={product} />
        </TableCell>
        <TableCell>
          <AttentionBadge reasons={product.attentionReasons} />
        </TableCell>
        <TableCell>
          <CatalogueRowActions
            product={product}
            editHref={editHref}
            onPauseListing={onPauseListing}
            onArchive={onArchive}
          />
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
