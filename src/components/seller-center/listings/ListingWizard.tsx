'use client';

import { useState } from 'react';
import type { ListingStage } from '@/lib/seller-center/mock-data/listings';
import ListingWizardStage from './ListingWizardStage';

type ListingWizardProps = {
  stages: ListingStage[];
};

/**
 * Owns which stage is expanded. This wizard shows what a filled-in listing
 * looks like - there is no product-creation backend yet, so the fields are
 * read-only and the bottom actions are disabled rather than a silent no-op.
 */
export default function ListingWizard({ stages }: ListingWizardProps) {
  const defaultOpenId =
    stages.find((stage) => stage.statusTone === 'warning')?.id ?? stages[0]?.id;
  const [openId, setOpenId] = useState<string | undefined>(defaultOpenId);

  return (
    <div className="flex flex-col gap-3">
      {stages.map((stage, index) => (
        <ListingWizardStage
          key={stage.id}
          stage={stage}
          index={index}
          isOpen={stage.id === openId}
          onToggle={() =>
            setOpenId((current) =>
              current === stage.id ? undefined : stage.id,
            )
          }
        />
      ))}
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled
          title="Publishing is not built yet"
          className="h-9 cursor-not-allowed rounded-md bg-muted px-4 text-sm font-semibold text-muted-foreground"
        >
          Continue
        </button>
        <button
          type="button"
          disabled
          title="Saving a draft is not built yet"
          className="h-9 cursor-not-allowed rounded-md border border-border px-4 text-sm font-medium text-muted-foreground"
        >
          Save as draft
        </button>
      </div>
    </div>
  );
}
