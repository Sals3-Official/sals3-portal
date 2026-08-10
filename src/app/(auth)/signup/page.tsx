import Link from 'next/link';
import AuthShell from '@/components/auth/AuthShell';
import SignupForm from '@/components/auth/SignupForm';

export const metadata = {
  title: 'Create seller account | Sals3 Seller Center',
};

export default function SignupPage() {
  return (
    <AuthShell
      title="Create seller account"
      description="Verify your email, set up an authenticator, then enter Seller Center."
      footer={
        <>
          Already have an account?{' '}
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
