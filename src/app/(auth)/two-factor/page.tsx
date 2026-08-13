import { redirect } from 'next/navigation';
import AuthShell from '@/components/auth/AuthShell';
import TwoFactorForm from '@/components/auth/TwoFactorForm';
import {
  authStepRedirect,
  resolvePortalEntryRedirect,
} from '@/lib/auth/redirect';
import { getPortalAccessState } from '@/lib/auth/session';

export const metadata = {
  title: 'Two-factor verification | Sals3 Seller Center',
};

type TwoFactorPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function TwoFactorPage({
  searchParams,
}: TwoFactorPageProps) {
  const params = await searchParams;
  const accessState = await getPortalAccessState();
  const destination = resolvePortalEntryRedirect(accessState, params.next);

  if (destination !== authStepRedirect('/two-factor', params.next)) {
    redirect(destination);
  }

  return (
    <AuthShell
      title="Two-factor verification"
      description="Enter the current code from your authenticator app."
    >
      <TwoFactorForm next={params.next} />
    </AuthShell>
  );
}
