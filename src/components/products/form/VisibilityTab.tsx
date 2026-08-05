import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SALES_CHANNEL_LABELS, SALES_CHANNELS } from '@/lib/products/constants';
import type { Product } from '@/lib/products/types';
import TextField from './TextField';

type VisibilityTabProps = {
  product: Product | null;
  fieldErrors: Record<string, string[]>;
};

/** Publish switch, sales channels, and the availability window. */
export default function VisibilityTab({
  product,
  fieldErrors,
}: VisibilityTabProps) {
  const visibility = product?.visibility;
  const channels = visibility?.channels ?? ['web'];
  const channelErrors = fieldErrors.channels;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
        <Switch
          id="published"
          name="published"
          defaultChecked={visibility?.published ?? false}
          className="mt-0.5 cursor-pointer"
        />
        <div>
          <Label htmlFor="published" className="text-sm font-medium">
            Show this product on the storefront
          </Label>
          <p className="text-xs text-muted-foreground">
            A product still needs the Published status before shoppers can see
            it.
          </p>
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Sales channels</legend>
        {SALES_CHANNELS.map((channel) => (
          <div key={channel} className="flex items-center gap-2">
            <Checkbox
              id={`channel-${channel}`}
              name="channels"
              value={channel}
              defaultChecked={channels.includes(channel)}
              className="cursor-pointer"
            />
            <Label htmlFor={`channel-${channel}`} className="text-sm">
              {SALES_CHANNEL_LABELS[channel]}
            </Label>
          </div>
        ))}
        {channelErrors === undefined ? null : (
          <p className="text-xs font-medium text-destructive">
            {channelErrors[0]}
          </p>
        )}
      </fieldset>

      <div className="grid gap-4 md:grid-cols-2">
        <TextField
          name="availableFrom"
          label="Available from"
          type="date"
          defaultValue={visibility?.availableFrom ?? ''}
          errors={fieldErrors.availableFrom}
        />
        <TextField
          name="availableUntil"
          label="Available until"
          type="date"
          defaultValue={visibility?.availableUntil ?? ''}
          errors={fieldErrors.availableUntil}
        />
      </div>
    </div>
  );
}
