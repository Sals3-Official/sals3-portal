import { Monitor, Smartphone } from 'lucide-react';
import { useState } from 'react';
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
import type {
  MarketEvidenceFixture,
  SpecificationFixture,
  VariantFixture,
} from '@/lib/seller-center/product-editor/types';

type PreviewDevice = 'browser' | 'phone';

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
  markets: MarketEvidenceFixture[];
  specifications: SpecificationFixture[];
  previewMarketCode: string;
  onPreviewMarketChange: (code: string) => void;
  previewVariantId: string;
  onPreviewVariantChange: (variantId: string) => void;
  /** Off inside a sheet, whose own title already names the panel. */
  showHeading?: boolean;
};

/**
 * A draft-only render of how the listing would read on the storefront.
 *
 * "Add to Cart" is a real `<button disabled>` rather than a styled div: it
 * is announced as a disabled button, it is not focusable, and it has no
 * handler at all - there is no cart call to make from a draft, and a
 * preview that mutated something would be worse than no preview.
 *
 * No converted shopper price is shown. The portal has no approved FX
 * source for this screen, so inventing one here would put a number in
 * front of a seller that nothing downstream would honour.
 */
export default function DraftStorefrontPreview({
  productName,
  description,
  variants,
  markets,
  specifications,
  previewMarketCode,
  onPreviewMarketChange,
  previewVariantId,
  onPreviewVariantChange,
  showHeading = true,
}: DraftStorefrontPreviewProps) {
  const [device, setDevice] = useState<PreviewDevice>('browser');
  const variant =
    variants.find((item) => item.id === previewVariantId) ?? variants[0];
  const market =
    markets.find((item) => item.code === previewMarketCode) ?? markets[0];
  const summary = description.split('\n')[0] ?? '';

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
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {markets.map((item) => (
              <SelectItem key={item.code} value={item.code}>
                {item.name}
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
            <SelectValue />
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
        <span
          aria-hidden="true"
          className="flex aspect-square items-center justify-center bg-muted font-mono text-xs text-muted-foreground"
        >
          product image
        </span>

        <div className="flex flex-col gap-2 p-3">
          <p className="text-sm leading-snug font-semibold">{productName}</p>

          {variant === undefined ? null : (
            <p className="font-display text-lg font-semibold text-brand-900 tabular-nums">
              {formatMoney(variant.retailPrice)}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            Display currency follows the market at publish time. No converted
            price is shown here.
          </p>

          {variant === undefined ? null : (
            <StatusPill
              label={variant.supplierStock === 0 ? 'Out of stock' : 'In stock'}
              tone={variant.supplierStock === 0 ? 'danger' : 'success'}
            />
          )}

          <p className="text-xs text-ink-muted">
            {market?.deliveryRangeLabel === undefined ||
            market?.deliveryRangeLabel === null
              ? 'Delivery estimate unavailable for this market.'
              : `Estimated delivery ${market.deliveryRangeLabel}`}
          </p>

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
        Approximate. Price, delivery and stock shown here come from unvalidated
        draft data and are confirmed at checkout.
      </p>
    </div>
  );
}
