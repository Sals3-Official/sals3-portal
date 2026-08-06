import type { Metadata } from 'next';
import PageHeader from '@/components/portal/PageHeader';
import SourcingEmptyState from '@/components/products/cj/SourcingEmptyState';
import { requirePermission } from '@/lib/auth/session';

export const metadata: Metadata = { title: 'Exception Queue · Sals3 Portal' };

/**
 * Exception queue for REVIEW / HOLD / BLOCKED candidates (spec section 8.14).
 *
 * Genuinely empty by construction, not by missing data: those three states are
 * preflight decisions (section 8.4), and full preflight is not implemented, so
 * no candidate can be in one yet. Stating that is more useful than showing a
 * fabricated queue.
 */
export default async function ExceptionQueuePage() {
  await requirePermission('catalog.candidate.read');

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Exception Queue"
        description="Candidates needing review, on hold, or blocked"
      />
      <SourcingEmptyState
        title="No exceptions to review"
        description="Exceptions come from full preflight, which is not implemented yet — no candidate can reach Review, Hold, or Blocked. Nothing is being hidden here."
      />
    </div>
  );
}
