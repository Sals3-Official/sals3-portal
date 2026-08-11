'use client';

import { useId, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { beginMarketProfileSetupAction } from '@/app/(portal)/market-rules/market-profile-actions';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

export type SetupChoice = {
  destinationCountryCode: string;
  destinationName: string;
};

type BeginMarketProfileSetupDialogProps = {
  /**
   * Already narrowed server-side to destinations this account may set up.
   * The server re-checks every code on submit — this list decides what is
   * offered, never what is permitted.
   */
  choices: SetupChoice[];
};

const ERROR_MESSAGES: Record<string, string> = {
  destination_not_authorized:
    'That destination is not currently approved. Choose one from the list.',
  conflict: 'This destination is already being set up for your account.',
  denied: 'You do not have permission to change market setup.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
};

export default function BeginMarketProfileSetupDialog({
  choices,
}: BeginMarketProfileSetupDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [destination, setDestination] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await beginMarketProfileSetupAction({
        destinationCountryCode: destination,
        reason,
      });

      if (!result.ok) {
        setError(
          ERROR_MESSAGES[result.reason] ??
            'Check the highlighted fields and try again.',
        );
        return;
      }

      toast.success('Destination setup started.');
      setOpen(false);
      setDestination('');
      setReason('');
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button type="button" size="sm">
            Set up a destination
          </Button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set up a destination</DialogTitle>
          <DialogDescription>
            Records that this account is being configured to sell to an approved
            destination. It does not enable payments, freight, tax handling, or
            payouts — those are separate and still outstanding.
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
            <Label htmlFor={`${fieldId}-destination`}>Destination</Label>
            <Select
              value={destination}
              onValueChange={(value) => setDestination(value ?? '')}
            >
              <SelectTrigger id={`${fieldId}-destination`} className="w-full">
                <SelectValue placeholder="Choose an approved destination" />
              </SelectTrigger>
              <SelectContent>
                {choices.map((choice) => (
                  <SelectItem
                    key={choice.destinationCountryCode}
                    value={choice.destinationCountryCode}
                  >
                    {choice.destinationName} ({choice.destinationCountryCode})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-reason`}>Business reason</Label>
            <Textarea
              id={`${fieldId}-reason`}
              required
              minLength={10}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Why is this account being set up for this destination?"
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
            <Button
              type="submit"
              disabled={isPending || destination === ''}
              aria-busy={isPending}
            >
              {isPending ? 'Starting…' : 'Start setup'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
