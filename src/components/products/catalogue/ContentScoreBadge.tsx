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
  CONTENT_READINESS_LABELS,
  type CatalogueProductFixture,
} from '@/lib/seller-center/product-catalogue/types';

type ContentReadiness = CatalogueProductFixture['contentReadiness'];

type ContentScoreBadgeProps = {
  score: ContentReadiness;
};

const TONE_BY_SCORE: Record<ContentReadiness, StatusPillTone> = {
  TOP: 'success',
  GOOD: 'neutral',
  NEEDS_IMPROVEMENT: 'warning',
};

const TIP_BY_SCORE: Record<ContentReadiness, string> = {
  TOP: 'Cover image, title, and required specifications all meet the recommended bar.',
  GOOD: 'Publishable, but at least one recommended field (extra images, a fuller description) is missing.',
  NEEDS_IMPROVEMENT:
    'Missing several recommended fields - more images, a longer description, or filled-in specifications usually raise this.',
};

/**
 * Fictional in this design preview - no real listing-quality scoring model
 * exists yet. Deliberately demoted to a small secondary chip near the
 * product name rather than its own table column: content readiness is a
 * useful preview concept, but it must never crowd out or stand in for a
 * hard publication gate (availability, supplier health, media, attention).
 */
export default function ContentScoreBadge({ score }: ContentScoreBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex items-center gap-1">
            <StatusPill
              label={`Content: ${CONTENT_READINESS_LABELS[score]}`}
              tone={TONE_BY_SCORE[score]}
            />
            <Info
              aria-label={`What "${CONTENT_READINESS_LABELS[score]}" content readiness means`}
              className="size-3.5 text-muted-foreground"
            />
          </span>
        }
      />
      <TooltipContent>{TIP_BY_SCORE[score]}</TooltipContent>
    </Tooltip>
  );
}
