import Link from 'next/link';
import { Suspense } from 'react';
import LoginBrandPanel from '@/components/auth/LoginBrandPanel';
import LoginForm from '@/components/auth/LoginForm';

export const metadata = {
  title: 'Log in | Sals3 Portal',
};

export default function LoginPage() {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <LoginBrandPanel />
      <main className="flex flex-col bg-card px-6 py-8 sm:px-10 lg:px-12 lg:py-10">
        <div className="flex justify-end">
          <p className="text-sm text-muted-foreground">
            New to Sals3?{' '}
            <Link
              href="/signup"
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              Create an account
            </Link>
          </p>
        </div>
        <div className="flex flex-1 items-center justify-center py-8">
          <div className="w-full max-w-sm space-y-6">
            <div className="space-y-1.5">
              <h1 className="font-display text-2xl font-semibold tracking-tight">
                Log in to Sals3 Portal
              </h1>
              <p className="text-sm text-muted-foreground">
                Use your seller email and password.
              </p>
            </div>
            <Suspense fallback={null}>
              <LoginForm />
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}
