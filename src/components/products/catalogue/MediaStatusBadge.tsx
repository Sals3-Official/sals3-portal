import { Info } from 'lucide-react';
import StatusPill, {
  type StatusPillTone,
} from '@/components/seller-center/shared/StatusPill';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  MEDIA_STATUS_LABELS,
  type MediaStatus,
} from '@/lib/seller-center/product-catalogue/types';

type MediaStatusBadgeProps = {
  mediaStatus: MediaStatus;
};

const TONE_BY_MEDIA_STATUS: Record<MediaStatus, StatusPillTone> = {
  OWN_PICTURES: 'success',
  SUPPLIER_PICTURES: 'info',
  MIXED_PICTURES: 'info',
  SUPPLIER_FALLBACK: 'warning',
  NEEDS_MEDIA_REVIEW: 'warning',
  NO_USABLE_PICTURES: 'danger',
};

/**
 * ADR-011's exact catalogue media-status labels and meanings. Listing
 * lifecycle and media source are separate fields on purpose - a `LIVE`
 * listing can still show `SUPPLIER_FALLBACK`, which is visible to the
 * seller and is not itself a customer-facing warning when the supplier
 * assets are approved.
 */
const TIP_BY_MEDIA_STATUS: Record<MediaStatus, string> = {
  OWN_PICTURES:
    'The resolved gallery uses only the seller’s own uploaded pictures.',
  SUPPLIER_PICTURES:
    'The revision preference is supplier-only. The resolved gallery uses approved supplier pictures.',
  MIXED_PICTURES:
    'The resolved gallery uses the seller’s own pictures plus approved supplier pictures for remaining coverage.',
  SUPPLIER_FALLBACK:
    'No eligible seller picture exists yet, so approved supplier pictures are used automatically. Visible to the seller, not a customer-facing warning by itself.',
  NEEDS_MEDIA_REVIEW:
    'A picture does not clearly match its variant, or rights/quality could not be confirmed. Needs review before it can publish.',
  NO_USABLE_PICTURES:
    'No rights-known, publishable picture exists for this listing. Publication is blocked until media is added.',
};

export default function MediaStatusBadge({
  mediaStatus,
}: MediaStatusBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex items-center gap-1">
            <StatusPill
              label={MEDIA_STATUS_LABELS[mediaStatus]}
              tone={TONE_BY_MEDIA_STATUS[mediaStatus]}
            />
            <Info
              aria-label={`What "${MEDIA_STATUS_LABELS[mediaStatus]}" means`}
              className="size-3.5 text-muted-foreground"
            />
          </span>
        }
      />
      <TooltipContent>{TIP_BY_MEDIA_STATUS[mediaStatus]}</TooltipContent>
    </Tooltip>
  );
}
