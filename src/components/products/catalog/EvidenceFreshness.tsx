import { AlertCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { formatRelativeTime } from '@/lib/products/catalog-presentation';

type EvidenceFreshnessProps = {
  lastSyncedAt: string;
  isStale: boolean;
  /** Passed in so this stays a pure render - no `Date.now()` at render time. */
  nowIso: string;
};

/**
 * Relative time with the exact timestamp in a keyboard-reachable tooltip
 * (spec section 7's "Last synced" column and section 17's "tooltips must
 * also work through keyboard focus"). A stale evidence flag is stated in
 * words, not colour alone.
 */
export default function EvidenceFreshness({
  lastSyncedAt,
  isStale,
  nowIso,
}: EvidenceFreshnessProps) {
  const relative = formatRelativeTime(lastSyncedAt, nowIso);
  const exact = new Date(lastSyncedAt).toLocaleString();

  return (
    <div className="flex items-center gap-1 text-xs text-muted-foreground">
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className="underline-offset-2 hover:underline"
            >
              {relative}
            </button>
          }
        />
        <TooltipContent>Synced {exact}</TooltipContent>
      </Tooltip>
      {isStale ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="Evidence may be stale"
                className="inline-flex text-amber-600"
              >
                <AlertCircle aria-hidden="true" className="size-3.5" />
              </button>
            }
          />
          <TooltipContent>
            This evidence is older than usual - price and stock may have changed
            since.
          </TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}
