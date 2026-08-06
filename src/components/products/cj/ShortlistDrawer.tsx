'use client';

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { CheckForSals3Result } from '@/app/(portal)/products/actions';
import presentShortlistResult from './shortlist-status';

type ShortlistDrawerProps = {
  productName: string;
  result: CheckForSals3Result | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Detail panel for a shortlisted candidate.
 *
 * Spec section 8.14 describes a screening drawer with hard-gate results,
 * score components, rule version, and reason codes. None of that exists yet —
 * full preflight (section 8.3) is not implemented — so this panel shows the
 * real stored identifiers and says plainly that preflight has not run,
 * instead of rendering empty or invented score sections.
 */
export default function ShortlistDrawer({
  productName,
  result,
  open,
  onOpenChange,
}: ShortlistDrawerProps) {
  const presentation = presentShortlistResult(result);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-label={`Sals3 shortlist detail for ${productName}`}>
        <SheetHeader>
          <SheetTitle>{productName}</SheetTitle>
          <SheetDescription>{presentation.label}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 text-sm text-ink-muted">
          <p>{presentation.description}</p>

          {result?.ok === true ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
              <dt className="font-medium text-foreground">Candidate ID</dt>
              <dd className="font-mono text-xs break-all">
                {result.candidateId}
              </dd>
              <dt className="font-medium text-foreground">State</dt>
              <dd>{result.shortlistState}</dd>
            </dl>
          ) : null}

          <p>
            Hard-gate results, quality score, and a publish decision are not
            available: full preflight has not run for this candidate.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
