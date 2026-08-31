'use client';

import { useState } from 'react';
import type { ReportedReview } from '@/modules/reviews/moderation';
import ReportedReviewCard from './ReportedReviewCard';

type Photo = { url: string; width: number; height: number };

/**
 * The moderation queue, and the only client state on this screen: which
 * reviews this moderator has already decided on but the server has not yet
 * confirmed absent from a fresh read.
 *
 * ## Why a decided review must not wait to disappear
 *
 * Same root cause as `ReviewList`'s reply overlay, mirror-imaged: a
 * moderator's own action already told this screen the decision was recorded —
 * `moderateReviewAction`'s success *is* the fact — and asking them to wait on
 * a second, separate server read to confirm a fact they already have is
 * exactly the gap that let a seller's own reply sit unreflected in production
 * on 2026-08-31 until a manual reload.
 *
 * `decidedIds` hides a resolved review the instant its own button reports
 * success. It is reconciled by **presence**, not held forever: once a fresh
 * `rows` prop genuinely no longer contains an id, the local hide for it is
 * redundant and is dropped — the same "compare during render, adjust" shape
 * `ProductCatalogueWorkspace` uses, with removal standing in for a merge.
 */
export default function ReportedReviewsList({
  rows,
  photos,
}: {
  rows: ReportedReview[];
  photos: Photo[][];
}) {
  const [decidedIds, setDecidedIds] = useState<Set<string>>(new Set());
  const [lastRows, setLastRows] = useState(rows);

  if (lastRows !== rows) {
    setLastRows(rows);

    const stillPresent = new Set(rows.map((row) => row.reviewId));

    setDecidedIds((current) => {
      const next = new Set(
        Array.from(current).filter((id) => stillPresent.has(id)),
      );

      return next.size === current.size ? current : next;
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((row, index) =>
        decidedIds.has(row.reviewId) ? null : (
          <ReportedReviewCard
            key={row.reviewId}
            review={row}
            photos={photos[index] ?? []}
            onDecided={() =>
              setDecidedIds((current) => {
                const next = new Set(current);

                next.add(row.reviewId);

                return next;
              })
            }
          />
        ),
      )}
    </div>
  );
}
