import Image from 'next/image';
import { ExternalLink, Package, Star } from 'lucide-react';
import { cjProductPageUrl, type CjProduct } from '@/lib/cj/normalize';
import {
  estimatePhpMinor,
  formatPhpEstimate,
} from '@/lib/products/catalog-presentation';
import type {
  CatalogFxRates,
  SupplierConnectionFixture,
} from '@/lib/products/catalog-types';
import type { EvaluatedCandidateRow } from '@/modules/catalog/candidates/queries';
import SupplierIdentity from '../catalog/SupplierIdentity';
import CjPriceConversionPopover from './CjPriceConversionPopover';
import EvaluationStatusBadge from './EvaluationStatusBadge';

type CjProductCardProps = {
  product: CjProduct;
  evaluated: EvaluatedCandidateRow | undefined;
  connection: SupplierConnectionFixture;
  rates: CatalogFxRates;
  usdToAudRate: number | null;
};

/**
 * Image-forward alternative to the table row (the "Grid" view). Same data,
 * same real evaluation badge/drawer - just a layout built for scanning
 * pictures instead of scanning numbers.
 */
export default function CjProductCard({
  product,
  evaluated,
  connection,
  rates,
  usdToAudRate,
}: CjProductCardProps) {
  const phpEstimate = formatPhpEstimate(
    product.priceCentsUsd === null
      ? null
      : estimatePhpMinor('USD', product.priceCentsUsd, rates),
  );
  const audAmount =
    product.priceCentsUsd === null || usdToAudRate === null
      ? null
      : (product.priceCentsUsd / 100) * usdToAudRate;
  const reviews = evaluated?.evidence?.reviews ?? null;
  const productUrl = cjProductPageUrl(product.id);

  return (
    <div className="group flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-shadow duration-150 hover:shadow-md">
      <a
        href={productUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="relative aspect-square w-full bg-muted"
      >
        {product.imageUrl === null ? (
          <div className="flex h-full items-center justify-center">
            <Package className="size-8 text-ink-faint" />
          </div>
        ) : (
          <Image
            src={product.imageUrl}
            alt={product.name}
            fill
            sizes="(min-width: 1280px) 20vw, (min-width: 768px) 33vw, 50vw"
            loading="lazy"
            className="object-cover transition-transform duration-200 group-hover:scale-105"
          />
        )}
        {product.freeShipping ? (
          <span className="absolute top-2 left-2 rounded-full bg-green-600 px-2 py-0.5 text-xs font-medium text-white">
            Free shipping
          </span>
        ) : null}
        <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100">
          <ExternalLink aria-hidden="true" className="size-3.5" />
        </span>
      </a>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <a
          href={productUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={product.name}
          className="line-clamp-2 min-h-10 text-sm font-medium hover:text-primary hover:underline"
        >
          {product.name}
        </a>

        <div className="flex items-center justify-between gap-2">
          <SupplierIdentity connection={connection} variant="compact" />
          {reviews === null || reviews.sampledAverageScore === null ? null : (
            <span
              title="CJ supplier-platform reviews, not a Sals3 buyer rating"
              className="flex shrink-0 items-center gap-0.5 text-xs text-amber-600"
            >
              <Star aria-hidden="true" className="size-3 fill-current" />
              {reviews.sampledAverageScore.toFixed(1)}
            </span>
          )}
        </div>

        <div>
          {product.priceCentsUsd === null ? (
            <p className="font-display text-lg font-semibold">—</p>
          ) : (
            <CjPriceConversionPopover
              priceCentsUsd={product.priceCentsUsd}
              phpEstimate={phpEstimate}
              audAmount={audAmount}
            />
          )}
        </div>

        <p className="text-xs text-ink-muted">
          {product.weight} · {product.shipsFrom.join(', ') || 'ships from —'}
        </p>

        <div className="mt-auto pt-1">
          <EvaluationStatusBadge
            productName={product.name}
            evaluation={evaluated?.evaluation ?? null}
            evidence={evaluated?.evidence ?? null}
          />
        </div>
      </div>
    </div>
  );
}
