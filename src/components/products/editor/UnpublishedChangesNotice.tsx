import { CloudOff } from 'lucide-react';

type UnpublishedChangesNoticeProps = {
  /** Nothing is pending when the product has never been published. */
  isPublished: boolean;
  /** The open draft has moved ahead of what the storefront serves. */
  hasUnpublishedChanges: boolean;
};

/**
 * Says the one thing a "Draft saved." toast cannot: the storefront has not
 * changed.
 *
 * Editing a published product forks a new draft revision and leaves
 * `products.published_revision_id` alone, which is what keeps buyers on the
 * copy that was published. The cost of that correctness is a seller who edits,
 * sees a success message, opens their live listing and finds the old text —
 * and reasonably concludes the save was a lie. This states the gap while it
 * exists, persistently, rather than in a toast that is gone in four seconds.
 *
 * Rendered only for a product that is actually live. On an unpublished draft
 * there is no published copy to differ from, and claiming one would be its own
 * small untruth.
 */
export default function UnpublishedChangesNotice({
  isPublished,
  hasUnpublishedChanges,
}: UnpublishedChangesNoticeProps) {
  if (!isPublished || !hasUnpublishedChanges) return null;

  return (
    <div
      role="status"
      className="flex flex-wrap items-start gap-2.5 rounded-lg border border-amber-600/30 bg-warning-surface p-3"
    >
      <CloudOff
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-amber-700"
      />
      <div className="min-w-56 flex-1">
        <p className="text-[13px] font-semibold text-amber-700">
          Saved, but not live yet
        </p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
          These changes are saved to a new draft. Your storefront still shows
          the published version until you press Publish Update.
        </p>
      </div>
    </div>
  );
}
