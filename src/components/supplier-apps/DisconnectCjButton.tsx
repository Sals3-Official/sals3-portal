'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
 * tenant-scoped by seller, not by live connection status).
 *
 * The confirmation dialog's chrome and copy match the approved design
 * (`Sals3 Portal Screens.dc.html:1010-1026`), but the actual gate stays the
 * real one-time verification code, not the design's typed "DISCONNECT" text
 * match - a client-side word match is not a real barrier, and this app
 * already has a server-enforced one. See `requestCjDisconnectVerification`
 * for why the code shows up directly in this UI today (no email/SMS
 * provider is wired yet).
 */
export default function DisconnectCjButton() {
  const [isPending, startTransition] = useTransition();
  const [step, setStep] = useState<Step>('idle');
  const [code, setCode] = useState('');

  const close = () => {
    setStep('idle');
    setCode('');
  };

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setStep('confirming')}
      >
        Disconnect
      </Button>
      <Dialog
        open={step !== 'idle'}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect CJ Dropshipping?</DialogTitle>
            <DialogDescription>
              Sourcing, evaluation and evidence refresh stop for this account
              immediately. Live listings stay published and every accepted order
              keeps its purchased item exactly as it was - but supplier stock
              and price stop updating, so those listings will drift out of date.
            </DialogDescription>
          </DialogHeader>

          {step === 'confirming' ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-ink-muted">
                Confirming sends a one-time verification code first.
              </p>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={close}
                >
                  Keep connected
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isPending}
                  onClick={() => {
                    startTransition(async () => {
                      const result = await requestCjDisconnectVerification();

                      if (!result.ok) {
                        toast(REQUEST_FAILURE_MESSAGES[result.reason]);
                        close();
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
              </DialogFooter>
            </div>
          ) : (
            <form
              className="flex flex-col gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                startTransition(async () => {
                  const result = await disconnectCjSupplier(code);

                  if (result.ok) {
                    toast('Disconnected. You can reconnect any time.');
                    close();
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
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  disabled={isPending}
                  onClick={close}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={isPending || code.trim() === ''}
                >
                  {isPending ? 'Disconnecting…' : 'Confirm disconnect'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
