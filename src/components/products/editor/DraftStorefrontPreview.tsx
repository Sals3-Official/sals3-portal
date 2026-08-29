import { Monitor, Smartphone } from 'lucide-react';
import Image from 'next/image';
import { useEffect, useRef, useState } from 'react';
import { Label } from '@/components/ui/label';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/seller-center/product-editor/format';
import { listCheckoutDestinations } from '@/modules/market-config/checkout-destinations';
import pricesByDestinationAction from '@/app/(portal)/listings/price-by-destination-actions';
import type { DestinationPrice } from '@/modules/catalog/products/prices-by-destination';
import type {
  MediaItemFixture,
  SpecificationFixture,
  VariantFixture,
} from '@/lib/seller-center/product-editor/types';

type PreviewDevice = 'browser' | 'phone';

/** Fixture ids are synthetic, so only a real row id is worth asking about. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

type MarketPriceState =
  | { status: 'idle' }
  | {
      status: 'ready';
      /** Which variant these prices belong to — see `settled` below. */
      variantId: string;
      byMarket: Map<string, DestinationPrice>;
    }
  | { status: 'error'; variantId: string; message: string };

/**
 * The seller-facing sentence for each way the lookup can decline.
 *
 * Each refusal wants a different response, so each says something different.
 * A panel that fell silent on error would be indistinguishable from one still
 * loading and from a product that genuinely cannot be priced.
 */
function messageFor(reason: string): string {
  switch (reason) {
    case 'denied':
      return 'You do not have permission to see these prices.';
    case 'rate_limited':
      return 'Too many lookups at once. Try again in a moment.';
    case 'not_found':
      return 'This variant is no longer in your catalogue.';
    case 'unavailable':
      return 'The catalogue database is not available right now.';
    default:
      return 'The prices could not be worked out right now.';
  }
}

/** Frame width only - the preview's own content never reflows between the two, since this panel already lives in a narrow sidebar with no room for a real two-column desktop layout. */
function DeviceToggle({
  device,
  onChange,
}: {
  device: PreviewDevice;
  onChange: (device: PreviewDevice) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Preview device"
      className="inline-flex items-center gap-0.5 rounded-md bg-muted p-0.5"
    >
      {(
        [
          { value: 'browser', label: 'Browser', icon: Monitor },
          { value: 'phone', label: 'Phone', icon: Smartphone },
        ] as const
      ).map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={device === value}
          aria-label={`${label} preview`}
          title={`${label} preview`}
          onClick={() => onChange(value)}
          className={cn(
            'flex size-7 items-center justify-center rounded-[5px] transition-colors',
            device === value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon aria-hidden="true" className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

type DraftStorefrontPreviewProps = {
  productName: string;
  description: string;
  variants: VariantFixture[];
  media: MediaItemFixture[];
  specifications: SpecificationFixture[];
  previewMarketCode: string;
  onPreviewMarketChange: (code: string) => void;
  previewVariantId: string;
  onPreviewVariantChange: (variantId: string) => void;
  /** Off inside a sheet, whose own title already names the panel. */
  showHeading?: boolean;
};

/**
 * A draft-only render of how the listing would read on the storefront, in each
 * market a buyer can actually order from.
 *
 * "Add to Cart" is a real `<button disabled>` rather than a styled div: it
 * is announced as a disabled button, it is not focusable, and it has no
 * handler at all - there is no cart call to make from a draft, and a
 * preview that mutated something would be worse than no preview.
 *
 * ## The market picker used to change nothing (fixed 2026-08-30)
 *
 * It listed one synthetic entry - `editorMarkets()` returns a single row coded
 * `DB`, named "Configured offer market" - so the control read `DB`, offered no
 * alternative, and `previewMarketCode` was consumed by nothing but the
 * `<Select>` that set it. The card underneath rendered `variant.retailPrice`,
 * one number, whichever market was chosen.
 *
 * That single row is correct for what it was built for: the Markets tab's
 * evidence card, which describes the one market this product is actually
 * offered in, because `publish.ts` takes `offerDestinations[0]` and writes
 * exactly one offer per variant. The preview borrowed that list and inherited a
 * shape that was never meant to answer "what does this look like in Fiji".
 *
 * So the two are separated. The evidence card keeps its one configured market;
 * this panel lists `listCheckoutDestinations()` - the three a buyer can
 * complete a purchase to - and resolves each one's real price through the same
 * `pricesByDestinationAction` the Variants & Pricing tooltip uses. The markups
 * genuinely differ per destination, so this is a real difference, not a
 * relabelled constant.
 *
 * ## What it still does not show
 *
 * No converted shopper price. USD is what is charged (ADR-003 SS3); the
 * storefront's approximate local price is computed in `sals3-ecommerce` from a
 * central-bank rate this repository does not hold, so a number invented here
 * would be one nothing downstream honours. The panel says USD rather than
 * implying a conversion it cannot make.
 */
export default function DraftStorefrontPreview({
  productName,
  description,
  variants,
  media,
  specifications,
  previewMarketCode,
  onPreviewMarketChange,
  previewVariantId,
  onPreviewVariantChange,
  showHeading = true,
}: DraftStorefrontPreviewProps) {
  const [device, setDevice] = useState<PreviewDevice>('browser');
  const [prices, setPrices] = useState<MarketPriceState>({ status: 'idle' });
  /** The variant already asked about, so a re-render does not re-ask. */
  const requested = useRef<string | null>(null);
  const variant =
    variants.find((item) => item.id === previewVariantId) ?? variants[0];
  const summary = description.split('\n')[0] ?? '';
  const cover = media.find((item) => item.isCover) ?? media[0];
  const destinations = listCheckoutDestinations();
  const variantId = variant?.id ?? null;
  /*
    A non-UUID id means fixture/design-preview mode, where no such variant
    exists to price. The action would only ever answer `invalid_input`, so it is
    not called: the panel falls back to the draft price and says which it is,
    rather than showing an error for a preview that was never database-backed.
  */
  const shouldFetch = variantId !== null && UUID.test(variantId);

  /*
    One lookup per variant, not one per market change.

    `pricesByDestination` resolves every destination in a single call - about
    six resolver runs - so switching between AU, PH and FJ afterwards costs
    nothing. Re-asking on each change would turn one question into three.
  */
  useEffect(() => {
    if (!shouldFetch || requested.current === variantId) return undefined;

    requested.current = variantId;

    // Stops a slow answer for a variant the seller has already switched away
    // from overwriting the current one.
    let live = true;

    pricesByDestinationAction({ variantId })
      .then((result) => {
        if (!live) return;

        setPrices(
          result.ok
            ? {
                status: 'ready',
                variantId,
                byMarket: new Map(
                  result.destinations.map((destination) => [
                    destination.marketCode,
                    destination,
                  ]),
                ),
              }
            : {
                status: 'error',
                variantId,
                message: messageFor(result.reason),
              },
        );
      })
      .catch(() => {
        if (live) {
          setPrices({
            status: 'error',
            variantId,
            message: 'The prices could not be worked out right now.',
          });
        }
      });

    return () => {
      live = false;
    };
  }, [shouldFetch, variantId]);

  /*
    Loading is derived, never assigned.

    Setting it inside the effect body would be a synchronous setState in an
    effect - a cascading render, and what `react-hooks/set-state-in-effect`
    exists to stop. Carrying the variant id on the state instead answers the
    same question: anything we hold for a different variant is stale, which is
    exactly the definition of still loading.
  */
  const settled = prices.status !== 'idle' && prices.variantId === variantId;
  const loading = shouldFetch && !settled;
  const resolved =
    settled && prices.status === 'ready'
      ? (prices.byMarket.get(previewMarketCode) ?? null)
      : null;

  const marketLabel =
    destinations.find((item) => item.code === previewMarketCode)?.label ??
    previewMarketCode;

  /**
   * The price a buyer in the selected market would see, and where it came from.
   *
   * Every branch says which of the five situations it is in. The one thing this
   * must never do is print a number without saying which market it belongs to -
   * that was the previous behaviour, and it is what made one country's price
   * look like the price.
   */
  function renderPrice() {
    if (loading) {
      return (
        <p className="text-sm text-muted-foreground">
          Working out the {marketLabel} price...
        </p>
      );
    }

    if (settled && prices.status === 'error') {
      return <p className="text-sm text-red-700">{prices.message}</p>;
    }

    // Fixture/design-preview mode: no real variant to price, so the draft's own
    // number is shown and named as such rather than dressed up as a resolved
    // per-market price.
    if (!shouldFetch) {
      return variant === undefined ? null : (
        <>
          <p className="font-display text-lg font-semibold text-brand-900 tabular-nums">
            {formatMoney(variant.retailPrice)}
          </p>
          <p className="text-xs text-muted-foreground">
            Draft price. Per-market prices are resolved once this product is
            saved to the catalogue.
          </p>
        </>
      );
    }

    if (resolved === null) {
      return (
        <p className="text-sm text-muted-foreground">
          No price is configured for {marketLabel}.
        </p>
      );
    }

    if (resolved.price === null) {
      return (
        <>
          <p className="text-sm font-semibold text-amber-700">
            Cannot be priced for {marketLabel}
          </p>
          <p className="text-xs text-muted-foreground">
            {resolved.unavailableLabel}
          </p>
        </>
      );
    }

    return (
      <>
        <p className="font-display text-lg font-semibold text-brand-900 tabular-nums">
          {formatMoney(resolved.price)}
        </p>
        <p className="text-xs text-muted-foreground">
          Charged in USD in every market (ADR-003). Your {marketLabel} margin
          rules set this price; the storefront also shows an approximate local
          amount, which is estimated there and not here.
        </p>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 @min-[48rem]:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {showHeading ? (
          <h2 className="font-display text-[15px] font-semibold">
            Draft Storefront Preview
          </h2>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          <DeviceToggle device={device} onChange={setDevice} />
          <StatusPill label="Draft preview" tone="info" />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="preview-market">Preview market</Label>
        <Select
          value={previewMarketCode}
          onValueChange={(value) => onPreviewMarketChange(value ?? '')}
        >
          <SelectTrigger id="preview-market" className="w-full">
            {/*
              The label, not the raw value. A bare `<SelectValue />` renders
              what is stored — which is why this control used to read `DB`, and
              why the variant picker below rendered a UUID at a seller.
            */}
            <SelectValue>{marketLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {destinations.map((item) => (
              <SelectItem key={item.code} value={item.code}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="preview-variant">Preview variant</Label>
        <Select
          value={variant?.id ?? ''}
          onValueChange={(value) => onPreviewVariantChange(value ?? '')}
        >
          <SelectTrigger id="preview-variant" className="w-full">
            <SelectValue>{variant?.optionLabel ?? ''}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {variants.map((item) => (
              <SelectItem key={item.id} value={item.id}>
                {item.optionLabel}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        className={cn(
          'mx-auto overflow-hidden rounded-lg border border-border transition-[max-width] duration-200',
          device === 'phone' ? 'max-w-[220px]' : 'w-full',
        )}
      >
        {device === 'browser' ? (
          <div
            aria-hidden="true"
            className="flex items-center gap-1.5 border-b border-border bg-muted px-2.5 py-1.5"
          >
            <span className="size-2 rounded-full bg-red-600/60" />
            <span className="size-2 rounded-full bg-amber-600/60" />
            <span className="size-2 rounded-full bg-green-600/60" />
          </div>
        ) : (
          <div
            aria-hidden="true"
            className="flex justify-center border-b border-border bg-muted py-1.5"
          >
            <span className="h-1 w-10 rounded-full bg-border" />
          </div>
        )}
        {cover?.sourceUrl === undefined || cover.sourceUrl === null ? (
          <span
            aria-hidden="true"
            className="flex aspect-square items-center justify-center bg-muted font-mono text-xs text-muted-foreground"
          >
            product image
          </span>
        ) : (
          <span className="block aspect-square bg-muted">
            <Image
              src={cover.sourceUrl}
              alt={cover.altText}
              width={384}
              height={384}
              sizes={device === 'phone' ? '220px' : '320px'}
              className="size-full object-contain"
            />
          </span>
        )}

        <div className="flex flex-col gap-2 p-3">
          <p className="text-sm leading-snug font-semibold">{productName}</p>

          {renderPrice()}

          {variant === undefined ? null : (
            <StatusPill
              label={variant.supplierStock === 0 ? 'Out of stock' : 'In stock'}
              tone={variant.supplierStock === 0 ? 'danger' : 'success'}
            />
          )}

          <button
            type="button"
            disabled
            title="Preview only — this button does nothing"
            className="h-10 rounded-lg bg-primary text-sm font-semibold text-primary-foreground opacity-60"
          >
            Add to Cart
          </button>

          <div className="border-t border-border pt-2">
            <p className="mb-1 text-xs font-semibold">Key specifications</p>
            <ul className="m-0 list-disc pl-4 text-xs leading-relaxed text-ink-muted">
              {specifications.slice(0, 3).map((specification) => (
                <li key={specification.key}>
                  {specification.label}:{' '}
                  {specification.value === '' ? '—' : specification.value}
                </li>
              ))}
            </ul>
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            {summary === ''
              ? 'No description yet — this area stays empty on the storefront.'
              : summary}
          </p>
        </div>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Price and stock shown here come from draft data and are confirmed before
        publication and checkout.
      </p>
    </div>
  );
}
