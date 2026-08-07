'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  disconnectCjSupplier,
  requestCjDisconnectVerification,
} from '@/app/(portal)/supplier-apps/actions';

const REQUEST_FAILURE_MESSAGES: Record<
  Exclude<
    Awaited<ReturnType<typeof requestCjDisconnectVerification>>,
    { ok: true }
  >['reason'],
  string
> = {
  denied: 'Your account cannot manage a supplier connection.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  not_connected: 'There is no active connection to disconnect.',
  failed: 'Could not start verification. Try again in a moment.',
};

const DISCONNECT_FAILURE_MESSAGES: Record<
  Exclude<
    Awaited<ReturnType<typeof disconnectCjSupplier>>,
    { ok: true }
  >['reason'],
  string
> = {
  denied: 'Your account cannot manage a supplier connection.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  not_connected: 'There is no active connection to disconnect.',
  invalid_code: 'That code is wrong or expired. Send a new one and try again.',
  failed: 'The connection could not be disconnected. Try again in a moment.',
};

type Step = 'idle' | 'confirming' | 'code-sent';

/**
 * Disconnecting only stops the automated pipeline from sourcing new
 * products through this connection - it does not delete the connection, its
 * encrypted credential, or any product/evaluation already stored (those are
 * tenant-scoped by seller, not by live connection status). Still gated
 * behind a one-time verification code before it fires, since a single
 * accidental click would otherwise silently stop sourcing with no undo
 * prompt. See `requestCjDisconnectVerification` for why the code shows up
 * directly in this UI today (no email/SMS provider is wired yet).
 */
export default function DisconnectCjButton() {
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>('idle');
  const [code, setCode] = useState('');

  if (step === 'idle') {
    return (
      <Button
        type="button"
        variant="outline"
        onClick={() => setStep('confirming')}
      >
        Disconnect
      </Button>
    );
  }

  if (step === 'confirming') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-ink-muted">
          Stop sourcing from this connection? Already-sourced products and past
          decisions stay exactly as they are - only new sourcing through this
          connection stops. Confirming a verification code first.
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                const result = await requestCjDisconnectVerification();

                if (!result.ok) {
                  toast(REQUEST_FAILURE_MESSAGES[result.reason]);
                  setStep('idle');
                  return;
                }

                if (result.devCode !== undefined) {
                  toast(
                    `Verification code: ${result.devCode} (shown here because no email/SMS provider is wired yet)`,
                  );
                } else {
                  toast('Verification code sent.');
                }
                setStep('code-sent');
              });
            }}
          >
            {isPending ? 'Sending code…' : 'Send verification code'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={() => setStep('idle')}
          >
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          const result = await disconnectCjSupplier(code);

          if (result.ok) {
            toast('Disconnected. You can reconnect any time.');
            setStep('idle');
            setCode('');
          } else {
            toast(DISCONNECT_FAILURE_MESSAGES[result.reason]);
          }
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="disconnect-code">Verification code</Label>
        <Input
          id="disconnect-code"
          inputMode="numeric"
          autoComplete="off"
          placeholder="6-digit code"
          maxLength={6}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          required
        />
      </div>
      <div className="flex items-center gap-2">
        <Button
          type="submit"
          variant="destructive"
          disabled={isPending || code.trim() === ''}
        >
          {isPending ? 'Disconnecting…' : 'Confirm disconnect'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={isPending}
          onClick={() => {
            setStep('idle');
            setCode('');
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
