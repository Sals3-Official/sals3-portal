import Link from 'next/link';
import { redirect } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import SignOutButton from '@/components/auth/SignOutButton';
import { authStepRedirect } from '@/lib/auth/redirect';
import { getPortalAccessState } from '@/lib/auth/session';

export const metadata = {
  title: 'Application pending | Sals3 Seller Center',
};

export const dynamic = 'force-dynamic';

export default async function PendingPage() {
  const state = await getPortalAccessState();

  if (!state.hasSession) {
    redirect(
      state.hasPendingTwoFactor
        ? authStepRedirect('/two-factor', '/overview')
        : authStepRedirect('/login', '/overview'),
    );
  }

  if (!state.emailVerified) {
    redirect(authStepRedirect('/login', '/overview'));
  }

  if (!state.twoFactorEnabled) {
    redirect('/setup-2fa');
  }

  if (state.sellerApproved) {
    redirect('/overview');
  }

  return (
    <AuthShell
      title="Application pending"
      description="Your seller application is waiting for owner review. Portal tools unlock after approval."
    >
      <div className="flex items-center justify-between rounded-md border border-border bg-muted px-3 py-2 text-sm">
        <span>Signed in securely</span>
        <SignOutButton />
      </div>
      <Link
        href="/reset-password"
        className="mt-4 inline-flex h-8 w-full cursor-pointer items-center justify-center rounded-lg border border-border bg-background px-2.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        Manage password
      </Link>
    </AuthShell>
  );
}
