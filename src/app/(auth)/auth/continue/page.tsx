import { redirect } from 'next/navigation';
import { getPortalEntryRedirect } from '@/lib/auth/session';

export const metadata = {
  title: 'Continuing sign in | Sals3 Seller Center',
};

export const dynamic = 'force-dynamic';

type ContinueAuthPageProps = {
  searchParams: Promise<{ next?: string }>;
};

export default async function ContinueAuthPage({
  searchParams,
}: ContinueAuthPageProps) {
  const params = await searchParams;

  redirect(await getPortalEntryRedirect(params.next));
}
