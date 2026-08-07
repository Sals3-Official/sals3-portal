import AuthShell from '@/components/auth/AuthShell';
import TwoFactorForm from '@/components/auth/TwoFactorForm';

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

  return (
    <AuthShell
      title="Two-factor verification"
      description="Enter the current code from your authenticator app."
    >
      <TwoFactorForm next={params.next} />
    </AuthShell>
  );
}
