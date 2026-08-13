import { redirect } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import SetupTotpForm from '@/components/auth/SetupTotpForm';
import {
  authStepRedirect,
  resolvePortalEntryRedirect,
} from '@/lib/auth/redirect';
import { getPortalAccessState } from '@/lib/auth/session';

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
  const accessState = await getPortalAccessState();
  const destination = resolvePortalEntryRedirect(accessState, params.next);

  if (destination !== authStepRedirect('/setup-2fa', params.next)) {
    redirect(destination);
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
