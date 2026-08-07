'use client';

/* eslint-disable react/jsx-no-bind -- handler depends on the current router. */

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import authClient from '@/lib/auth/client';

export default function SignOutButton() {
  const router = useRouter();

  async function onSignOut() {
    await authClient.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="cursor-pointer"
      aria-label="Sign out"
      onClick={onSignOut}
    >
      <LogOut aria-hidden="true" />
    </Button>
  );
}
