'use client';

import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import authClient from '@/lib/auth/client';
import { emailOnlySchema } from '@/lib/auth/schemas';
import FieldError from './FieldError';

type ResetPasswordFormProps = {
  token?: string;
};

export default function ResetPasswordForm({ token }: ResetPasswordFormProps) {
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState('');
  const [fieldError, setFieldError] = useState<string>();

  async function onRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setFieldError(undefined);

    const formData = new FormData(event.currentTarget);
    const parsed = emailOnlySchema.safeParse({ email: formData.get('email') });

    if (!parsed.success) {
      setFieldError(parsed.error.flatten().fieldErrors.email?.[0]);
      setMessage('Fix the highlighted field and try again.');
      return;
    }

    setIsPending(true);
    await authClient.requestPasswordReset({
      email: parsed.data.email,
      redirectTo: '/reset-password',
    });
    setIsPending(false);
    setMessage(
      'Check your email. If the address can receive Sals3 Portal mail, reset instructions are on the way.',
    );
  }

  async function onReset(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setFieldError(undefined);

    const formData = new FormData(event.currentTarget);
    const newPassword = String(formData.get('password') ?? '');

    if (newPassword.length < 12) {
      setFieldError('Password must be at least 12 characters.');
      setMessage('Fix the highlighted field and try again.');
      return;
    }

    setIsPending(true);
    const response = await authClient.resetPassword({
      newPassword,
      token,
    });
    setIsPending(false);

    if (response.error !== null) {
      setMessage('This reset link could not be used. Request a new one.');
      return;
    }

    setMessage('Your password has been reset. You can sign in now.');
  }

  if (token !== undefined && token !== '') {
    return (
      <form className="space-y-4" onSubmit={onReset} noValidate>
        {message === '' ? null : (
          <div
            role="alert"
            className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
          >
            {message}
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="reset-password">New password</Label>
          <Input
            id="reset-password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            maxLength={128}
            aria-invalid={fieldError === undefined ? undefined : true}
            aria-describedby="reset-password-error"
            required
          />
          <FieldError id="reset-password-error" message={fieldError} />
        </div>
        <Button
          type="submit"
          className="w-full cursor-pointer"
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : null}
          Reset password
        </Button>
      </form>
    );
  }

  return (
    <form className="space-y-4" onSubmit={onRequest} noValidate>
      {message === '' ? null : (
        <div
          role="alert"
          className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
        >
          {message}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="reset-email">Email</Label>
        <Input
          id="reset-email"
          name="email"
          type="email"
          autoComplete="email"
          aria-invalid={fieldError === undefined ? undefined : true}
          aria-describedby="reset-email-error"
          required
        />
        <FieldError id="reset-email-error" message={fieldError} />
      </div>
      <Button
        type="submit"
        className="w-full cursor-pointer"
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : null}
        Send reset email
      </Button>
    </form>
  );
}
