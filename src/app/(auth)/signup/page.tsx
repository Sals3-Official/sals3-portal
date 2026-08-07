import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import SignupForm from '@/components/auth/SignupForm';

export const metadata = {
  title: 'Apply for access | Sals3 Seller Center',
};

export default function SignupPage() {
  return (
    <AuthShell
      title="Create seller application"
      description="Signup starts a pending seller application. Portal access starts only after approval."
      footer={
        <>
          Already approved?{' '}
          <Link
            href="/login"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Sign in
          </Link>
          .
        </>
      }
    >
      <SignupForm />
    </AuthShell>
  );
}
