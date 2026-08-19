'use client';

import { LayoutTemplate, TriangleAlert, Type } from 'lucide-react';
import { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import type { DescriptionBlock } from '@/lib/products/description-blocks';
import {
  describeSimpleModeLoss,
  flattenToSimpleMode,
  type DescriptionMode,
} from '@/lib/products/simple-description';
import { cn } from '@/lib/utils';

/**
 * Which description editor the seller wants.
 *
 * Simple text and the designed layout are two views of one stored document, so
 * this is a presentation choice rather than a format choice — nothing is
 * converted when the document already fits both.
 *
 * When it does not fit, the switch to simple is a real conversion and says so
 * before doing it. That is not politeness: `descriptionBlocksToPlainText` carries
 * a comment recording that this exact round trip once "silently downgraded
 * headings, bullets, and detail lists into paragraphs", and a confirmation is the
 * difference between a conversion the seller chose and one that happened to them.
 *
 * Simple to design never warns, because every paragraph and image is already a
 * valid block — that direction adds capability without touching content.
 */

const OPTIONS: {
  mode: DescriptionMode;
  label: string;
  hint: string;
  icon: typeof Type;
}[] = [
  {
    mode: 'simple',
    label: 'Simple text',
    hint: 'One box. Type the description; it publishes as plain paragraphs.',
    icon: Type,
  },
  {
    mode: 'design',
    label: 'Designed layout',
    hint: 'Headings, lists, and photos placed between the text.',
    icon: LayoutTemplate,
  },
];

type DescriptionModeToggleProps = {
  mode: DescriptionMode;
  blocks: DescriptionBlock[];
  onModeChange: (mode: DescriptionMode) => void;
  /**
   * Applies the flattened document. Required because switching to simple can
   * change the content, and the owner of that content is the caller.
   */
  onFlatten: (blocks: DescriptionBlock[]) => void;
};

export default function DescriptionModeToggle({
  mode,
  blocks,
  onModeChange,
  onFlatten,
}: DescriptionModeToggleProps) {
  const [pendingLoss, setPendingLoss] = useState<string | null>(null);

  function choose(next: DescriptionMode) {
    if (next === mode) return;

    if (next === 'design') {
      onModeChange('design');

      return;
    }

    const loss = describeSimpleModeLoss(blocks);

    if (loss === null) {
      onModeChange('simple');

      return;
    }

    setPendingLoss(loss);
  }

  const active = OPTIONS.find((option) => option.mode === mode);

  return (
    <div className="flex flex-col gap-1.5">
      <div
        role="group"
        aria-label="Description editor"
        className="inline-flex w-fit rounded-lg border border-border bg-background p-0.5"
      >
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const isActive = option.mode === mode;

          return (
            <Button
              key={option.mode}
              type="button"
              variant="ghost"
              size="sm"
              aria-pressed={isActive}
              onClick={() => choose(option.mode)}
              className={cn(
                'gap-1.5 rounded-md text-[13px]',
                isActive
                  ? 'border border-sals3-bright bg-card font-semibold text-sals3-deep shadow-none hover:bg-card'
                  : 'border border-transparent text-ink-muted',
              )}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              {option.label}
            </Button>
          );
        })}
      </div>

      {active === undefined ? null : (
        <p className="text-xs text-ink-subtle">{active.hint}</p>
      )}

      <AlertDialog
        open={pendingLoss !== null}
        onOpenChange={(open) => {
          if (!open) setPendingLoss(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <TriangleAlert
                aria-hidden="true"
                className="size-4 text-amber-600"
              />
              Switch to simple text?
            </AlertDialogTitle>
            <AlertDialogDescription>{pendingLoss}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep the designed layout</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onFlatten(flattenToSimpleMode(blocks));
                onModeChange('simple');
                setPendingLoss(null);
              }}
            >
              Switch and flatten
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
