'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { QRCodeSVG } from 'qrcode.react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import authClient from '@/lib/auth/client';
import { totpCodeSchema } from '@/lib/auth/schemas';
import FieldError from './FieldError';

export default function SetupTotpForm() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState('');
  const [passwordError, setPasswordError] = useState<string>();
  const [codeError, setCodeError] = useState<string>();
  const [totpUri, setTotpUri] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  async function onEnable(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setPasswordError(undefined);

    const formData = new FormData(event.currentTarget);
    const password = String(formData.get('password') ?? '');

    if (password === '') {
      setPasswordError('Enter your password.');
      return;
    }

    setIsPending(true);
    const response = await authClient.twoFactor.enable({
      password,
      issuer: 'Sals3 Seller Center',
    });
    setIsPending(false);

    if (response.error !== null) {
      setMessage('Two-factor setup could not start. Check your password.');
      return;
    }

    setTotpUri(response.data.totpURI);
    setBackupCodes(response.data.backupCodes);
  }

  async function onVerify(event: React.FormEvent<HTMLFormElement>) {
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

    router.push('/overview');
    router.refresh();
  }

  if (totpUri !== '') {
    return (
      <div className="space-y-4">
        {message === '' ? null : (
          <div
            role="alert"
            className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
          >
            {message}
          </div>
        )}
        <div className="flex justify-center rounded-md border border-border bg-background p-3">
          <QRCodeSVG value={totpUri} size={176} />
        </div>
        <div className="rounded-md border border-border bg-muted p-3">
          <p className="text-sm font-medium">Backup codes</p>
          <div className="mt-2 grid grid-cols-2 gap-1 font-mono text-xs">
            {backupCodes.map((code) => (
              <span key={code}>{code}</span>
            ))}
          </div>
        </div>
        <form className="space-y-4" onSubmit={onVerify} noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="totp-code">Authenticator code</Label>
            <Input
              id="totp-code"
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              aria-invalid={codeError === undefined ? undefined : true}
              aria-describedby="totp-code-error"
              required
            />
            <FieldError id="totp-code-error" message={codeError} />
          </div>
          <Button
            type="submit"
            className="w-full cursor-pointer"
            disabled={isPending}
          >
            {isPending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : null}
            Verify two-factor
          </Button>
        </form>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={onEnable} noValidate>
      {message === '' ? null : (
        <div
          role="alert"
          className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
        >
          {message}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="setup-password">Current password</Label>
        <Input
          id="setup-password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={passwordError === undefined ? undefined : true}
          aria-describedby="setup-password-error"
          required
        />
        <FieldError id="setup-password-error" message={passwordError} />
      </div>
      <Button
        type="submit"
        className="w-full cursor-pointer"
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : null}
        Create authenticator setup
      </Button>
    </form>
  );
}
