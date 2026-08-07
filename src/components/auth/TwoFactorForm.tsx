'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import authClient from '@/lib/auth/client';
import { safeAuthRedirect } from '@/lib/auth/redirect';
import { totpCodeSchema } from '@/lib/auth/schemas';
import FieldError from './FieldError';

type TwoFactorFormProps = {
  next?: string;
};

export default function TwoFactorForm({ next }: TwoFactorFormProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState('');
  const [codeError, setCodeError] = useState<string>();

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setCodeError(undefined);

    const formData = new FormData(event.currentTarget);
    const parsed = totpCodeSchema.safeParse({ code: formData.get('code') });

    if (!parsed.success) {
      setCodeError(parsed.error.flatten().fieldErrors.code?.[0]);
      return;
    }

    setIsPending(true);
    const response = await authClient.twoFactor.verifyTotp({
      code: parsed.data.code,
      trustDevice: false,
    });
    setIsPending(false);

    if (response.error !== null) {
      setMessage('That code was not accepted. Try the latest code.');
      return;
    }

    router.push(safeAuthRedirect(next));
    router.refresh();
  }

  return (
    <form className="space-y-4" onSubmit={onSubmit} noValidate>
      {message === '' ? null : (
        <div
          role="alert"
          className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
        >
          {message}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="two-factor-code">Authenticator code</Label>
        <Input
          id="two-factor-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          aria-invalid={codeError === undefined ? undefined : true}
          aria-describedby="two-factor-code-error"
          required
        />
        <FieldError id="two-factor-code-error" message={codeError} />
      </div>
      <Button
        type="submit"
        className="w-full cursor-pointer"
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : null}
        Verify
      </Button>
    </form>
  );
}
