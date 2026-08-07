'use client';

import { Loader2 } from 'lucide-react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { signupSellerAction, type SignupActionState } from '@/lib/auth/actions';
import FieldError from './FieldError';

const INITIAL_STATE: SignupActionState = {
  status: 'idle',
  message: '',
};

function SubmitButton() {
  const status = useFormStatus();

  return (
    <Button
      type="submit"
      className="w-full cursor-pointer"
      disabled={status.pending}
    >
      {status.pending ? (
        <Loader2 className="animate-spin" aria-hidden="true" />
      ) : null}
      Create seller application
    </Button>
  );
}

export default function SignupForm() {
  const [state, formAction] = useActionState(signupSellerAction, INITIAL_STATE);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.message === '' ? null : (
        <div
          role="alert"
          className="rounded-md border border-border bg-muted px-3 py-2 text-sm"
        >
          {state.message}
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="signup-name">Full name</Label>
        <Input
          id="signup-name"
          name="name"
          autoComplete="name"
          aria-invalid={
            state.fieldErrors?.name === undefined ? undefined : true
          }
          aria-describedby="signup-name-error"
          required
        />
        <FieldError id="signup-name-error" message={state.fieldErrors?.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="signup-email">Email</Label>
        <Input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          aria-invalid={
            state.fieldErrors?.email === undefined ? undefined : true
          }
          aria-describedby="signup-email-error"
          required
        />
        <FieldError
          id="signup-email-error"
          message={state.fieldErrors?.email}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          aria-invalid={
            state.fieldErrors?.password === undefined ? undefined : true
          }
          aria-describedby="signup-password-error"
          required
        />
        <FieldError
          id="signup-password-error"
          message={state.fieldErrors?.password}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="signup-business-model">Business model</Label>
        <Select name="businessModel" defaultValue="DROPSHIPPER">
          <SelectTrigger
            id="signup-business-model"
            className="w-full cursor-pointer"
            aria-invalid={
              state.fieldErrors?.businessModel === undefined ? undefined : true
            }
            aria-describedby="signup-business-model-error"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DROPSHIPPER">Dropshipper</SelectItem>
            <SelectItem value="RETAILER">Retailer</SelectItem>
          </SelectContent>
        </Select>
        <FieldError
          id="signup-business-model-error"
          message={state.fieldErrors?.businessModel}
        />
      </div>
      <SubmitButton />
    </form>
  );
}
