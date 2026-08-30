import Link from 'next/link';
import { cn } from '@/lib/utils';
import {
  pipelineClearFiltersHref,
  pipelineFilterHref,
  PIPELINE_PATH,
  PIPELINE_STALE_AFTER_DAYS,
  type PipelineSeenFilter,
  type PipelineStockFilter,
} from '@/lib/portal/pipeline-params';
import FilterSelect from '../FilterSelect';

/**
 * Filters for Ready and Needs Attention.
 *
 * ## Why every control is a link
 *
 * The tabs above this bar are already real links, for the reason the page's own
 * comment gives: a tab queries a different scope server-side, is paged
 * server-side, and searches its whole tab in SQL rather than filtering the page
 * already in hand. A filter is the same kind of thing. A client-side filter
 * would narrow the twenty rows in view and confidently report "3 of 432,654",
 * which is not a smaller truth — it is a wrong one.
 *
 * So this renders `<a>` elements that change the URL, the Server Component
 * re-queries, and every filtered view is shareable and bookmarkable by
 * construction.
 *
 * ## Why the category is a select and the other two are chips
 *
 * CJ's tree carries fifteen top-level categories on this account. Laid out as
 * chips they wrapped to three lines and pushed the table below the fold — the
 * exact failure the design predicted and shipped anyway. A facet past roughly
 * five values belongs in a native `<select>`, which is also the only shape that
 * survives a phone. Stock and Feed seen have three values each and stay chips,
 * where the whole choice is readable without opening anything.
 *
 * ## Why there are three facets and not seven
 *
 * Each of these three is backed by a real index: `provider_category_id` and
 * `stock_review_state` by their connection-scoped composites,
 * `provider_last_seen_at` by the freshness index. A cost band, a ships-from
 * origin or a demand range would have to read `candidate_evaluations.feed_snapshot`,
 * which is jsonb with nothing behind it — on a tab holding 432,654 rows that is
 * a sequential scan, and it would make the fastest screen in the Portal the
 * slowest. Those wait for a column or an expression index, not for a design.
 *
 * ## Why no counts beside the values
 *
 * A count per facet value is a `GROUP BY` over the whole tab per render. It is
 * worth having and it is not free, so it is a separate change with its own
 * measurement rather than something smuggled in beside the filter itself.
 */

type PipelineFilterBarProps = {
  currentParams: Record<string, string>;
  /** CJ Level 1 labels present in the discovery snapshot, already sorted. */
  categoryLabels: string[];
  applied: {
    cat: string;
    stock?: PipelineStockFilter;
    seen?: PipelineSeenFilter;
  };
  /** True when the tab's total reflects the filters rather than the whole tab. */
  filtered: boolean;
  total: number;
};

function FilterChip({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'true' : undefined}
      className={cn(
        'rounded-full px-2 py-0.5 text-xs font-medium transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'text-ink-muted hover:bg-muted',
      )}
    >
      {label}
    </Link>
  );
}

function FacetGroup({
  label,
  children,
  active,
}: {
  label: string;
  children: React.ReactNode;
  active: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-lg border px-2 py-1',
        active ? 'border-primary/40 bg-accent/40' : 'border-border bg-card',
      )}
    >
      <span className="text-xs text-ink-faint">{label}</span>
      {children}
    </div>
  );
}

export default function PipelineFilterBar({
  currentParams,
  categoryLabels,
  applied,
  filtered,
  total,
}: PipelineFilterBarProps) {
  return (
    <div className="mb-3 rounded-lg border border-border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2">
        {categoryLabels.length === 0 ? null : (
          <FilterSelect
            id="pipeline-cj-category"
            label="CJ category"
            value={applied.cat}
            options={[
              { value: '', label: 'All categories' },
              ...categoryLabels.map((label) => ({ value: label, label })),
            ]}
            path={PIPELINE_PATH}
            param="cat"
            clearedValue=""
            className="w-full sm:w-64"
          />
        )}

        <FacetGroup label="Stock" active={applied.stock !== undefined}>
          <FilterChip
            href={pipelineFilterHref(currentParams, 'stock', null)}
            label="All"
            active={applied.stock === undefined}
          />
          <FilterChip
            href={pipelineFilterHref(currentParams, 'stock', 'checked')}
            label="Reviewed"
            active={applied.stock === 'checked'}
          />
          <FilterChip
            href={pipelineFilterHref(currentParams, 'stock', 'unchecked')}
            label="Not checked"
            active={applied.stock === 'unchecked'}
          />
        </FacetGroup>

        <FacetGroup label="Feed seen" active={applied.seen !== undefined}>
          <FilterChip
            href={pipelineFilterHref(currentParams, 'seen', null)}
            label="All"
            active={applied.seen === undefined}
          />
          <FilterChip
            href={pipelineFilterHref(currentParams, 'seen', 'fresh')}
            label={`Last ${PIPELINE_STALE_AFTER_DAYS} days`}
            active={applied.seen === 'fresh'}
          />
          <FilterChip
            href={pipelineFilterHref(currentParams, 'seen', 'stale')}
            label="Stale"
            active={applied.seen === 'stale'}
          />
        </FacetGroup>

        {filtered ? (
          <Link
            href={pipelineClearFiltersHref(currentParams)}
            className="rounded-lg border border-dashed border-input px-2 py-1 text-xs text-ink-muted hover:bg-muted"
          >
            Clear filters
          </Link>
        ) : null}
      </div>

      <p className="mt-2 border-t border-muted pt-2 text-sm text-ink-muted">
        <span className="font-semibold text-foreground tabular-nums">
          {total.toLocaleString()}
        </span>{' '}
        {filtered
          ? 'candidates match these filters'
          : 'candidates passed evaluation with no open issue'}
      </p>
    </div>
  );
}
