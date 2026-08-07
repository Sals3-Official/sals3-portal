import Link from 'next/link';
import { Suspense } from 'react';
import AuthShell from '@/components/auth/AuthShell';
import LoginForm from '@/components/auth/LoginForm';

export const metadata = {
  title: 'Sign in | Sals3 Seller Center',
};

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in"
      description="Use your approved seller email and password."
      footer={
        <>
          Need seller access?{' '}
          <Link
            href="/signup"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Apply here
          </Link>
          .
        </>
      }
    >
      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>
      <Link
        href="/reset-password"
        className="mt-4 block text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
      >
        Reset password
      </Link>
    </AuthShell>
  );
}
