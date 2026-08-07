'use client';

import { useState } from 'react';
import {
  Check,
  CircleDot,
  Ellipsis,
  Loader,
  OctagonAlert,
  Save,
  Upload,
} from 'lucide-react';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import type { PublishDecision } from '@/lib/seller-center/product-editor/derive';
import type {
  EditorLifecycle,
  ReadinessIssue,
} from '@/lib/seller-center/product-editor/types';
import type { StatusPillTone } from '@/components/seller-center/shared/StatusPill';

type EditorActionBarProps = {
  decision: PublishDecision;
  lifecycle: EditorLifecycle;
  isDirty: boolean;
  warnings: ReadinessIssue[];
  onSaveDraft: () => void;
  onPublish: () => void;
  onExit: () => void;
};

type SaveState = {
  label: string;
  tone: StatusPillTone;
  spinning: boolean;
};

function saveState(lifecycle: EditorLifecycle, isDirty: boolean): SaveState {
  if (lifecycle === 'SAVING') {
    return { label: 'Saving…', tone: 'neutral', spinning: true };
  }

  if (lifecycle === 'SAVED') {
    return {
      label: 'Draft saved in this tab',
      tone: 'success',
      spinning: false,
    };
  }

  if (lifecycle === 'SAVE_FAILED') {
    return {
      label: 'Save failed — changes are still in this tab',
      tone: 'danger',
      spinning: false,
    };
  }

  if (isDirty) {
    return { label: 'Unsaved changes', tone: 'warning', spinning: false };
  }

  return { label: 'No unsaved changes', tone: 'neutral', spinning: false };
}

function validationState(
  lifecycle: EditorLifecycle,
  decision: PublishDecision,
): { label: string; tone: StatusPillTone } {
  if (lifecycle === 'VALIDATING') {
    return { label: 'Checking…', tone: 'neutral' };
  }

  if (lifecycle === 'VALIDATION_FAILED') {
    return { label: 'Validation failed', tone: 'danger' };
  }

  if (lifecycle === 'CONNECTION_UNAVAILABLE') {
    return { label: 'Connection unavailable', tone: 'danger' };
  }

  if (decision.blockerCount > 0) {
    return { label: 'Blocked', tone: 'danger' };
  }

  return decision.warningCount > 0
    ? { label: 'Ready with attention', tone: 'warning' }
    : { label: 'Ready', tone: 'success' };
}

function SaveIcon({ tone }: { tone: StatusPillTone }) {
  if (tone === 'warning') {
    return <CircleDot aria-hidden="true" className="size-3.5 text-amber-600" />;
  }

  if (tone === 'danger') {
    return (
      <OctagonAlert aria-hidden="true" className="size-3.5 text-red-600" />
    );
  }

  return <Check aria-hidden="true" className="size-3.5" />;
}

/**
 * The sticky action bar: state on the left, actions on the right.
 *
 * Three things it must never do, and does not:
 *
 * - The publish button is never quietly greyed out. When it is disabled,
 *   `decision.blockedReason` is printed next to it and repeated in the
 *   button's own `title`.
 * - Nothing here confirms publication. This prototype has no server
 *   action and no endpoint, so the confirmation dialog moves the screen
 *   into "Checking…" and stops - it never claims a listing went live.
 * - Pause and delist sit behind an overflow with a divider above them, so
 *   a destructive action is never adjacent to Publish, and each confirms.
 *
 * Save and validation state share one `aria-live="polite"` region, so a
 * screen-reader user hears the change instead of discovering it later.
 */
export default function EditorActionBar({
  decision,
  lifecycle,
  isDirty,
  warnings,
  onSaveDraft,
  onPublish,
  onExit,
}: EditorActionBarProps) {
  const [publishOpen, setPublishOpen] = useState(false);
  const [destructiveAction, setDestructiveAction] = useState<string | null>(
    null,
  );

  const save = saveState(lifecycle, isDirty);
  const validation = validationState(lifecycle, decision);
  const hasWarnings = decision.warningCount > 0 && decision.blockerCount === 0;

  return (
    <div className="sticky bottom-0 z-30 -mx-4 flex flex-col gap-2.5 border-t border-border bg-card px-4 py-2.5 md:-mx-6 md:flex-row md:items-center md:px-6">
      <div
        aria-live="polite"
        className="flex min-w-0 flex-wrap items-center gap-2.5 text-xs"
      >
        <span className="inline-flex items-center gap-1.5 font-medium">
          {save.spinning ? (
            <Loader aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <SaveIcon tone={save.tone} />
          )}
          {save.label}
        </span>
        <Separator orientation="vertical" className="h-4" />
        <span className="inline-flex items-center gap-1.5">
          Validation:
          <StatusPill label={validation.label} tone={validation.tone} />
        </span>
        {decision.blockedReason === null ? null : (
          <span className="inline-flex items-center gap-1.5 text-red-600">
            <OctagonAlert aria-hidden="true" className="size-3.5" />
            {decision.blockedReason}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 md:ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="lg" aria-label="More actions">
                <Ellipsis aria-hidden="true" />
              </Button>
            }
          />
          <DropdownMenuContent align="end">
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => setDestructiveAction('Pause listing')}
            >
              Pause listing
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setDestructiveAction('Delist')}>
              Delist
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Separator orientation="vertical" className="h-6" />

        <Button type="button" variant="ghost" size="lg" onClick={onExit}>
          Exit
        </Button>
        <Button type="button" variant="outline" size="lg" onClick={onSaveDraft}>
          <Save aria-hidden="true" />
          {decision.saveLabel}
        </Button>
        <Button
          type="button"
          size="lg"
          disabled={!decision.canPublish}
          title={decision.blockedReason ?? undefined}
          onClick={() => setPublishOpen(true)}
        >
          {decision.canPublish ? (
            <Upload aria-hidden="true" />
          ) : (
            <OctagonAlert aria-hidden="true" />
          )}
          {decision.label}
        </Button>
      </div>

      <AlertDialog open={publishOpen} onOpenChange={setPublishOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {hasWarnings
                ? 'Publish with attention?'
                : 'Publish this product?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {hasWarnings
                ? `The server revalidates before anything goes live. ${decision.warningCount} warning${decision.warningCount === 1 ? '' : 's'} will stay visible on the listing until resolved. You are not asked to approve each one individually.`
                : 'The server revalidates stock, cost, route evidence and policy before this listing goes live.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {hasWarnings ? (
            <ul className="m-0 list-disc pl-8 text-[13px] leading-relaxed text-ink-muted">
              {warnings.map((warning) => (
                <li key={warning.id}>{warning.title}</li>
              ))}
            </ul>
          ) : null}

          <p className="px-4 text-xs text-muted-foreground">
            Design preview: this confirms nothing and publishes nothing. No
            listing is created and no request is sent.
          </p>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setPublishOpen(false);
                onPublish();
              }}
            >
              {decision.label}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={destructiveAction !== null}
        onOpenChange={(open) => {
          if (!open) setDestructiveAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{destructiveAction}?</AlertDialogTitle>
            <AlertDialogDescription>
              This takes the listing off the storefront. Accepted orders are not
              affected — each keeps the product representation, variant, price
              basis, image reference and supplier evidence it was accepted with.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="px-4 text-xs text-muted-foreground">
            Design preview: nothing is paused or delisted.
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => setDestructiveAction(null)}
            >
              {destructiveAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
