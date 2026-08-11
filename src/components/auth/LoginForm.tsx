'use client';

import { Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import authClient, { clearAuthNext, rememberAuthNext } from '@/lib/auth/client';
import {
  authStepRedirect,
  continueAuthRedirect,
  safeAuthRedirect,
} from '@/lib/auth/redirect';
import { loginSchema } from '@/lib/auth/schemas';
import FieldError from './FieldError';
import PasswordField from './PasswordField';

type FieldErrors = Partial<Record<'email' | 'password', string>>;

type TwoFactorRedirectResponse = {
  twoFactorRedirect: true;
};

function needsTwoFactor(data: unknown): data is TwoFactorRedirectResponse {
  return (
    typeof data === 'object' &&
    data !== null &&
    'twoFactorRedirect' in data &&
    data.twoFactorRedirect === true
  );
}

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
    rememberAuthNext(callbackURL);
    const response = await authClient.signIn.email({
      email: parsed.data.email,
      password: parsed.data.password,
      rememberMe: true,
    });
    setIsPending(false);

    if (response.error !== null) {
      clearAuthNext();
      setMessage('We could not sign you in with those credentials.');
      return;
    }

    if (needsTwoFactor(response.data)) {
      router.replace(authStepRedirect('/two-factor', callbackURL));
      return;
    }

    clearAuthNext();
    router.replace(continueAuthRedirect(callbackURL));
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
          className="h-11"
          required
        />
        <FieldError id="login-email-error" message={fieldErrors.email} />
      </div>
      <PasswordField
        id="login-password"
        name="password"
        label="Password"
        autoComplete="current-password"
        errorId="login-password-error"
        errorMessage={fieldErrors.password}
        forgotPasswordHref="/reset-password"
      />
      <Button
        type="submit"
        className="h-11 w-full cursor-pointer"
        disabled={isPending}
      >
        {isPending ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : null}
        Log in
      </Button>
    </form>
  );
}
