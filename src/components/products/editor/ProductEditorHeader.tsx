import Link from 'next/link';
import { CircleDot, Eye, FileSearch, ListChecks } from 'lucide-react';
import presentEvaluationStatus from '@/components/products/cj/evaluation-status';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/seller-center/product-editor/format';
import type { ProductEditorFixture } from '@/lib/seller-center/product-editor/types';
import EditorStatusPill from './EditorStatusPill';
import SupplierSourceBadge from './SupplierSourceBadge';
import { LISTING_STATE_PRESENTATION } from './presentation';

type ProductEditorHeaderProps = {
  fixture: ProductEditorFixture;
  productName: string;
  isDirty: boolean;
  onOpenReadiness: () => void;
  onOpenPreview: () => void;
  onOpenSourceDrawer: () => void;
};

/**
 * Breadcrumb, product identity, and the panel triggers.
 *
 * `PageHeader` is not reused here, and deliberately: its API is
 * `title` / `description` / `actions`, and this header needs a breadcrumb,
 * a thumbnail and a status row above and below the title. Bending
 * `PageHeader` to fit one screen would degrade it for the eight screens
 * that use it correctly, so this composes the same `h1` treatment instead.
 *
 * The Readiness and Preview triggers are always rendered. On wide
 * containers those panels are already on screen and the buttons simply
 * scroll/focus them; below that they are the only way in, so hiding them
 * responsively would strand keyboard and small-screen users.
 */
export default function ProductEditorHeader({
  fixture,
  productName,
  isDirty,
  onOpenReadiness,
  onOpenPreview,
  onOpenSourceDrawer,
}: ProductEditorHeaderProps) {
  const status = presentEvaluationStatus(fixture.evaluationStatus);

  return (
    <div className="flex flex-col gap-3">
      <nav aria-label="Breadcrumb">
        <ol className="flex list-none flex-wrap items-center gap-1.5 p-0 text-xs text-muted-foreground">
          <li>
            <Link
              href="/products/pipeline?tab=ready"
              className="hover:underline"
            >
              Product Sourcing
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li>
            <Link href="/listings/new" className="hover:underline">
              Add Product
            </Link>
          </li>
          <li aria-hidden="true">/</li>
          <li aria-current="page" className="font-medium text-foreground">
            Customize &amp; List
          </li>
        </ol>
      </nav>

      <div className="flex flex-wrap items-start gap-3.5">
        <span
          aria-hidden="true"
          className="flex size-14 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-xs text-muted-foreground"
        >
          No image
        </span>

        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[22px] leading-tight font-semibold tracking-tight break-words sm:text-2xl">
            {productName}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <SupplierSourceBadge source={fixture.source} variant="compact" />
            <span className="font-mono text-xs break-all text-muted-foreground">
              {fixture.source.externalProductId}
            </span>
            <StatusPill label={status.label} tone={status.tone} />
            <EditorStatusPill
              presentation={LISTING_STATE_PRESENTATION[fixture.listingState]}
            />
            <span className="text-xs text-muted-foreground">
              Last checked {formatDateTime(fixture.lastValidatedAt)}
            </span>
            {isDirty ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-600">
                <CircleDot aria-hidden="true" className="size-3.5" />
                Unsaved changes
              </span>
            ) : null}
          </div>
        </div>

        {/* Readiness/Preview stay in the DOM at every width - keyboard and
            screen-reader users always have a way in - but visually step
            back once @min-[86.5rem] puts the same panels on screen beside
            the editor, so the header does not ask the seller to open what
            is already open. That breakpoint matches the workspace grid's
            own three-column threshold; see ProductEditorWorkspace. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="@min-[86.5rem]:hidden"
            onClick={onOpenReadiness}
          >
            <ListChecks aria-hidden="true" />
            Readiness
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="@min-[86.5rem]:hidden"
            onClick={onOpenPreview}
          >
            <Eye aria-hidden="true" />
            Preview
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenSourceDrawer}
          >
            <FileSearch aria-hidden="true" />
            Supplier Source Details
          </Button>
        </div>
      </div>
    </div>
  );
}
