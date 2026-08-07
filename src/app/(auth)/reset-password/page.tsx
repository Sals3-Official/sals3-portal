import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import ResetPasswordForm from '@/components/auth/ResetPasswordForm';

export const metadata = {
  title: 'Reset password | Sals3 Seller Center',
};

type ResetPasswordPageProps = {
  searchParams: Promise<{ token?: string }>;
};

export default async function ResetPasswordPage({
  searchParams,
}: ResetPasswordPageProps) {
  const params = await searchParams;

  return (
    <AuthShell
      title="Reset password"
      description="Use a reset email to set a new password for your seller account."
      footer={
        <Link
          href="/login"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Back to sign in
        </Link>
      }
    >
      <ResetPasswordForm token={params.token} />
    </AuthShell>
  );
}
