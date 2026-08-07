'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import ConnectCjForm from './ConnectCjForm';

const CJ_DEVELOPER_URL = 'https://developers.cjdropshipping.com';

type ConnectCjDialogProps = {
  mode?: 'connect' | 'reconnect';
  triggerLabel: string;
  triggerVariant?: 'default' | 'outline';
};

/**
 * A new Dropshipper's first "connect a supplier" moment, and the same flow
 * for reconnecting later - both need more than a bare API-key input, since a
 * seller who has never done this before does not know where a CJ API key
 * even comes from. The guided steps live here, next to the form, instead of
 * always sitting inline on the page (see `SupplierAppsPage`'s own card,
 * which stays a scannable status summary either way).
 */
export default function ConnectCjDialog({
  mode = 'connect',
  triggerLabel,
  triggerVariant = 'default',
}: ConnectCjDialogProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant={triggerVariant} />}>
        {triggerLabel}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'reconnect'
              ? 'Reconnect CJ Dropshipping'
              : 'Connect CJ Dropshipping'}
          </DialogTitle>
          <DialogDescription>
            Your API key is encrypted the moment you submit it and is never
            shown again, even to you - Sals3 never sees your CJ password.
          </DialogDescription>
        </DialogHeader>

        <ol className="flex list-inside list-decimal flex-col gap-2 rounded-lg border border-border bg-muted px-4 py-3 text-sm text-ink-muted">
          <li>
            No CJ Dropshipping account yet?{' '}
            <a
              href={CJ_DEVELOPER_URL}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-2"
            >
              Create one
            </a>{' '}
            first - it&apos;s free.
          </li>
          <li>Sign in and open your API settings to copy your API key.</li>
          <li>Paste it below.</li>
        </ol>

        <ConnectCjForm mode={mode} onSuccess={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
