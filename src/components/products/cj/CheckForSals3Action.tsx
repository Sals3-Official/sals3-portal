'use client';

import { useState, useTransition } from 'react';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import { Button } from '@/components/ui/button';
import {
  checkForSals3Candidate,
  type CheckForSals3Result,
} from '@/app/(portal)/products/actions';
import presentShortlistResult from './shortlist-status';
import ShortlistDrawer from './ShortlistDrawer';

type CheckForSals3ActionProps = {
  externalProductId: string;
  productName: string;
};

/**
 * Row action for the CJ Candidate Explorer (spec section 8.11).
 *
 * The smallest possible `'use client'` boundary — `CjProductRow`,
 * `CjProductsTable`, and `CjCatalogueView` all stay Server Components. The
 * button is not the authorization check: `checkForSals3Candidate` calls
 * `requirePermission` on the server.
 */
export default function CheckForSals3Action({
  externalProductId,
  productName,
}: CheckForSals3ActionProps) {
  const [result, setResult] = useState<CheckForSals3Result | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const presentation = presentShortlistResult(result);

  if (result === null) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => {
          startTransition(async () => {
            setResult(await checkForSals3Candidate(externalProductId));
            setDrawerOpen(true);
          });
        }}
      >
        {isPending ? 'Checking…' : 'Check for Sals3'}
      </Button>
    );
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${presentation.label} — open detail for ${productName}`}
        className="cursor-pointer text-left"
        onClick={() => setDrawerOpen(true)}
      >
        <StatusPill label={presentation.label} tone={presentation.tone} />
      </button>
      <ShortlistDrawer
        productName={productName}
        result={result}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}
