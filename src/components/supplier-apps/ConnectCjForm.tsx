'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { connectCjSupplier } from '@/app/(portal)/supplier-apps/actions';

const SUBMIT_LABEL: Record<'connect' | 'reconnect', string> = {
  connect: 'Connect CJ',
  reconnect: 'Reconnect CJ',
};

const FAILURE_MESSAGES: Record<
  Exclude<
    Awaited<ReturnType<typeof connectCjSupplier>>,
    { ok: true }
  >['reason'],
  string
> = {
  invalid_input: 'That API key or display name was not in an expected format.',
  denied: 'Your account cannot connect a supplier - Dropshipper accounts only.',
  rate_limited: 'Too many connection attempts. Wait a moment and try again.',
  already_connected: 'A CJ account is already connected.',
  provider_unavailable: 'CJ Dropshipping is not available right now.',
  verification_failed:
    'CJ could not verify that API key. Check it and try again.',
  failed: 'The connection could not be saved. Try again in a moment.',
};

type ConnectCjFormProps = {
  /** 'reconnect' only changes copy - `connectCjSupplier` decides the actual insert-vs-update branch server-side from the seller's existing connection state. */
  mode?: 'connect' | 'reconnect';
  /** Called after a successful connect/reconnect - e.g. to close the dialog hosting this form. */
  onSuccess?: () => void;
};

/**
 * "Connect CJ" (ADR-008). The browser sends only the API key and a label -
 * everything else (seller identity, CJ verification, encryption) happens on
 * the server, per `connectCjSupplier`'s own contract. Doubles as the
 * "Reconnect" form for a disconnected/revoked/reauth-required connection -
 * same server action, same fields, just different copy.
 */
export default function ConnectCjForm({
  mode = 'connect',
  onSuccess,
}: ConnectCjFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [displayName, setDisplayName] = useState('CJ Dropshipping');
  const [isPending, startTransition] = useTransition();

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await connectCjSupplier({ apiKey, displayName });

          if (result.ok) {
            toast(`Connected: ${result.displayName}`);
            setApiKey('');
            onSuccess?.();
          } else {
            toast(FAILURE_MESSAGES[result.reason]);
          }
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cj-api-key">CJ API key</Label>
        <Input
          id="cj-api-key"
          type="password"
          autoComplete="off"
          placeholder="CJ1234567@api@..."
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          required
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="cj-display-name">Display name</Label>
        <Input
          id="cj-display-name"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          maxLength={80}
        />
      </div>
      <Button
        type="submit"
        disabled={isPending || apiKey.trim() === ''}
        className="shadow-sm transition-shadow hover:shadow-md"
      >
        {isPending ? 'Connecting…' : SUBMIT_LABEL[mode]}
      </Button>
    </form>
  );
}
