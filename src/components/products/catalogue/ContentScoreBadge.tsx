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
  CONTENT_SCORE_LABELS,
  type ContentScoreLevel,
} from '@/lib/seller-center/product-catalogue/types';

type ContentScoreBadgeProps = {
  score: ContentScoreLevel;
};

const TONE_BY_SCORE: Record<ContentScoreLevel, StatusPillTone> = {
  TOP: 'success',
  GOOD: 'neutral',
  NEEDS_IMPROVEMENT: 'warning',
};

const TIP_BY_SCORE: Record<ContentScoreLevel, string> = {
  TOP: 'Cover image, title, and required specifications all meet the recommended bar.',
  GOOD: 'Publishable, but at least one recommended field (extra images, a fuller description) is missing.',
  NEEDS_IMPROVEMENT:
    'Missing several recommended fields - more images, a longer description, or filled-in specifications usually raise this.',
};

/**
 * Fictional in this design preview - no real listing-quality scoring model
 * exists yet. Placement and wording match what a real one would need:
 * a tone-coded label plus a hover explanation, never a bare number with no
 * context for what to fix.
 */
export default function ContentScoreBadge({ score }: ContentScoreBadgeProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="inline-flex items-center gap-1">
            <StatusPill
              label={CONTENT_SCORE_LABELS[score]}
              tone={TONE_BY_SCORE[score]}
            />
            <Info
              aria-label={`What ${CONTENT_SCORE_LABELS[score]} content score means`}
              className="size-3.5 text-muted-foreground"
            />
          </span>
        }
      />
      <TooltipContent>{TIP_BY_SCORE[score]}</TooltipContent>
    </Tooltip>
  );
}
