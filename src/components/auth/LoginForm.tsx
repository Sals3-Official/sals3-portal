'use client';

import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import authClient from '@/lib/auth/client';
import { safeAuthRedirect } from '@/lib/auth/redirect';
import { loginSchema } from '@/lib/auth/schemas';
import FieldError from './FieldError';

type FieldErrors = Partial<Record<'email' | 'password', string>>;

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, setIsPending] = useState(false);
  const [message, setMessage] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');
    setFieldErrors({});

    const formData = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: formData.get('email'),
      password: formData.get('password'),
      next: searchParams.get('next') ?? undefined,
    });

    if (!parsed.success) {
      const flattened = parsed.error.flatten().fieldErrors;
      setFieldErrors({
        email: flattened.email?.[0],
        password: flattened.password?.[0],
      });
      setMessage('Fix the highlighted fields and try again.');
      return;
    }

    setIsPending(true);
    const callbackURL = safeAuthRedirect(parsed.data.next);
    const response = await authClient.signIn.email({
      email: parsed.data.email,
      password: parsed.data.password,
      callbackURL,
      rememberMe: true,
    });
    setIsPending(false);

    if (response.error !== null) {
      setMessage('We could not sign you in with those credentials.');
      return;
    }

    router.push(callbackURL);
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
        <Label htmlFor="login-email">Email</Label>
        <Input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          aria-invalid={fieldErrors.email === undefined ? undefined : true}
          aria-describedby="login-email-error"
          required
        />
        <FieldError id="login-email-error" message={fieldErrors.email} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="login-password">Password</Label>
        <Input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={fieldErrors.password === undefined ? undefined : true}
          aria-describedby="login-password-error"
          required
        />
        <FieldError id="login-password-error" message={fieldErrors.password} />
      </div>
      <Button
        type="submit"
        className="w-full cursor-pointer"
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : null}
        Sign in
      </Button>
    </form>
  );
}
