import { redirect } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import SetupTotpForm from '@/components/auth/SetupTotpForm';
import { authStepRedirect, safeAuthRedirect } from '@/lib/auth/redirect';
import { getRawAuthSession } from '@/lib/auth/session';

export const metadata = {
  title: 'Set up two-factor | Sals3 Seller Center',
};

export const dynamic = 'force-dynamic';

type SetupTwoFactorPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function SetupTwoFactorPage({
  searchParams,
}: SetupTwoFactorPageProps) {
  const params = await searchParams;
  const data = await getRawAuthSession();

  if (data === null) {
    redirect(authStepRedirect('/login', params.next));
  }

  if (data.user.emailVerified !== true) {
    redirect(authStepRedirect('/login', params.next));
  }

  if (data.user.twoFactorEnabled === true) {
    redirect(safeAuthRedirect(params.next));
  }

  return (
    <AuthShell
      title="Set up two-factor"
      description="Scan the authenticator code, save your backup codes, then verify the current code."
    >
      <SetupTotpForm next={params.next} />
    </AuthShell>
  );
}
