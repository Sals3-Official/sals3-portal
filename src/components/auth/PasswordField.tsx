'use client';

import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import FieldError from './FieldError';

type PasswordFieldProps = {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  errorId: string;
  errorMessage?: string;
  forgotPasswordHref?: string;
};

export default function PasswordField({
  id,
  name,
  label,
  autoComplete,
  errorId,
  errorMessage,
  forgotPasswordHref,
}: PasswordFieldProps) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {forgotPasswordHref === undefined ? null : (
          <Link
            href={forgotPasswordHref}
            className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Forgot password?
          </Link>
        )}
      </div>
      <div className="relative">
        <Input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          aria-invalid={errorMessage === undefined ? undefined : true}
          aria-describedby={errorId}
          className="h-11 pr-10"
          required
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? 'Hide password' : 'Show password'}
          className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          {visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
      <FieldError id={errorId} message={errorMessage} />
    </div>
  );
}
