import { CircleCheck, OctagonAlert, TriangleAlert } from 'lucide-react';
import presentEvaluationStatus from '@/components/products/cj/evaluation-status';
import { Button } from '@/components/ui/button';
import {
  enabledVariants,
  issuesOfSeverity,
  publishableMediaCount,
  retailRange,
  type PublishDecision,
} from '@/lib/seller-center/product-editor/derive';
import {
  NOT_AVAILABLE_LABEL,
  formatDateTime,
  formatMoneyRange,
} from '@/lib/seller-center/product-editor/format';
import type {
  EditorSectionId,
  ProductEditorFixture,
  VariantFixture,
} from '@/lib/seller-center/product-editor/types';
import { CONNECTION_STATUS_PRESENTATION } from './presentation';

type ReviewPublishSectionProps = {
  fixture: ProductEditorFixture;
  variants: VariantFixture[];
  decision: PublishDecision;
  onGoToSection: (section: EditorSectionId) => void;
};

type SummaryRowProps = {
  label: string;
  value: string;
  tone?: 'danger' | 'warning' | 'success';
};

function SummaryRow({ label, value, tone }: SummaryRowProps) {
  const toneClass = () => {
    if (tone === 'danger') return 'text-red-600';
    if (tone === 'warning') return 'text-amber-600';
    if (tone === 'success') return 'text-green-600';

    return '';
  };

  return (
    <div className="flex justify-between gap-3 border-b border-border py-2 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span className={`text-right font-medium ${toneClass()}`}>{value}</span>
    </div>
  );
}

/**
 * The final summary, and the only place the three publication outcomes are
 * spelled out side by side.
 *
 * `decision` comes from `publishDecision()` - the same call the action bar
 * and the confirmation dialog read - so this section cannot claim a
 * product is ready while the button says otherwise.
 */
export default function ReviewPublishSection({
  fixture,
  variants,
  decision,
  onGoToSection,
}: ReviewPublishSectionProps) {
  const status = presentEvaluationStatus(fixture.evaluationStatus);
  const blockers = issuesOfSeverity(fixture.issues, 'BLOCKER');
  const listed = enabledVariants(variants);
  const retail = retailRange(variants);
  // What will actually publish: the seller's own uploads, plus the
  // supplier's originals unless the seller has explicitly turned that off -
  // `fixture.media` alone reads as "0 of 0" for every product today, which
  // would misreport a product the supplier's photos already make publishable.
  const effectiveMedia = fixture.showSupplierPhoto
    ? [...fixture.media, ...fixture.supplierMedia]
    : fixture.media;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="grid grid-cols-1 gap-x-6 @3xl:grid-cols-2">
        <SummaryRow
          label="Overall readiness"
          value={status.label}
          tone={decision.blockerCount > 0 ? 'danger' : undefined}
        />
        <SummaryRow
          label="Product completeness"
          value={`${fixture.completionPercent}%`}
        />
        <SummaryRow
          label="Enabled variants"
          value={`${listed.length} of ${variants.length}`}
          tone={listed.length === 0 ? 'danger' : undefined}
        />
        <SummaryRow
          label="Pricing"
          value={
            retail === null
              ? NOT_AVAILABLE_LABEL
              : `${formatMoneyRange(retail.min, retail.max)} retail`
          }
        />
        <SummaryRow
          label="Media"
          value={`${publishableMediaCount(effectiveMedia)} publishable of ${effectiveMedia.length}`}
        />
        <SummaryRow
          label="Outstanding warnings"
          value={String(decision.warningCount)}
          tone={decision.warningCount > 0 ? 'warning' : undefined}
        />
        <SummaryRow
          label="Hard blockers"
          value={String(decision.blockerCount)}
          tone={decision.blockerCount > 0 ? 'danger' : 'success'}
        />
        <SummaryRow
          label="Last validation"
          value={formatDateTime(fixture.lastValidatedAt)}
        />
        <SummaryRow
          label="Source connection"
          value={`${fixture.source.providerDisplayName} · ${
            CONNECTION_STATUS_PRESENTATION[fixture.source.connectionStatus]
              .label
          }`}
          tone={
            fixture.source.connectionStatus === 'CONNECTED'
              ? undefined
              : 'warning'
          }
        />
      </div>

      {decision.blockerCount > 0 ? (
        <div
          role="alert"
          className="rounded-lg border border-red-600/30 bg-danger-surface p-3.5"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-red-600">
            <OctagonAlert aria-hidden="true" className="size-4" />
            Publishing is disabled
          </p>
          <ul className="mt-2 flex list-none flex-col gap-1.5 p-0 text-[13px] text-ink-muted">
            {blockers.map((blocker) => (
              <li
                key={blocker.id}
                className="flex flex-wrap items-center gap-1.5"
              >
                <span>{blocker.title} —</span>
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => onGoToSection(blocker.section)}
                >
                  go to {blocker.affectedScope}
                </Button>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            The Publish button below stays visible and states why it cannot be
            used. It is never quietly greyed out.
          </p>
        </div>
      ) : null}

      {decision.blockerCount === 0 && decision.warningCount > 0 ? (
        <div className="rounded-lg border border-amber-600/30 bg-warning-surface/60 p-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-amber-600">
            <TriangleAlert aria-hidden="true" className="size-4" />
            {decision.warningCount} warning
            {decision.warningCount === 1 ? '' : 's'} will remain after
            publication
          </p>
          <p className="mt-1.5 text-[13px] leading-relaxed text-ink-muted">
            You can publish now. Each warning stays visible on the listing and
            in Listing Readiness until it is resolved or the supplier evidence
            changes. No item-by-item approval is required.
          </p>
        </div>
      ) : null}

      {decision.blockerCount === 0 && decision.warningCount === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-green-600/30 bg-success-surface/60 p-3.5 text-sm font-semibold text-green-600">
          <CircleCheck aria-hidden="true" className="size-4" />
          No blockers and no warnings. This product is ready to publish.
        </p>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Publishing runs a fresh server-side validation first. Nothing on this
        screen confirms publication until the server does.
      </p>
    </div>
  );
}
