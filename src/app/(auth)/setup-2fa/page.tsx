import { redirect } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import SetupTotpForm from '@/components/auth/SetupTotpForm';
import { getRawAuthSession } from '@/lib/auth/session';

export const metadata = {
  title: 'Set up two-factor | Sals3 Seller Center',
};

export const dynamic = 'force-dynamic';

export default async function SetupTwoFactorPage() {
  const data = await getRawAuthSession();

  if (data === null) {
    redirect('/login');
  }

  if (data.user.emailVerified !== true) {
    redirect('/login');
  }

  if (data.user.twoFactorEnabled === true) {
    redirect('/overview');
  }

  return (
    <AuthShell
      title="Set up two-factor"
      description="Scan the authenticator code, save your backup codes, then verify the current code."
    >
      <SetupTotpForm />
    </AuthShell>
  );
}
