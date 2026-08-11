'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  activateMarketProfileAction,
  suspendMarketProfileAction,
} from '@/app/(portal)/market-rules/market-profile-actions';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

type TransitionKind = 'activate' | 'suspend';

type MarketProfileTransitionDialogProps = {
  kind: TransitionKind;
  profileId: string;
  /**
   * The version this page was rendered from. Sent back as the compare-and-set
   * token so a stale tab loses the race instead of overwriting a change it
   * never saw.
   */
  expectedVersion: number;
  destinationName: string;
};

const COPY: Record<
  TransitionKind,
  { trigger: string; title: string; description: string; success: string }
> = {
  activate: {
    trigger: 'Activate',
    title: 'Activate this destination?',
    description:
      'Records that this account is set up for the destination. It does not make it a launched market — the outstanding capabilities stay outstanding.',
    success: 'Destination activated.',
  },
  suspend: {
    trigger: 'Suspend',
    title: 'Suspend this destination?',
    description:
      'Marks the destination as not in use for this account. You can set it up again later from the approved list.',
    success: 'Destination suspended.',
  },
};

export default function MarketProfileTransitionDialog({
  kind,
  profileId,
  expectedVersion,
  destinationName,
}: MarketProfileTransitionDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();
  const copy = COPY[kind];

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const action =
        kind === 'activate'
          ? activateMarketProfileAction
          : suspendMarketProfileAction;
      const result = await action({ profileId, expectedVersion, reason });

      if (!result.ok) {
        setError(
          result.reason === 'not_found'
            ? 'This destination changed since the page loaded. Refresh and try again.'
            : 'Could not complete this change. Try again.',
        );
        return;
      }

      toast.success(copy.success);
      setOpen(false);
      setReason('');
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant={kind === 'suspend' ? 'outline' : 'default'}
            size="sm"
          >
            {copy.trigger}
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {destinationName} — {copy.description}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={handleSubmit} noValidate>
          {error === null ? null : (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-reason`}>Business reason</Label>
            <Textarea
              id={`${fieldId}-reason`}
              required
              minLength={10}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this change being made?"
            />
          </div>
          <DialogFooter>
            <DialogClose
              render={
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              }
            />
            <Button type="submit" disabled={isPending} aria-busy={isPending}>
              {isPending ? 'Working…' : copy.trigger}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
