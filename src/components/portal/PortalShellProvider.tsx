'use client';

import { useState, type ReactNode } from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import useIsTabletOrBelow from '@/hooks/use-tablet-or-below';

type PortalShellProviderProps = {
  children: ReactNode;
};

/**
 * Controls the rail's open state as `userWantsOpen && !isTabletOrBelow`, a
 * controlled pair the sidebar primitive already supports. This auto-collapses
 * the rail below ~1024px without touching the user's own preference, which
 * reasserts itself the moment the viewport widens back past that point -
 * no separate "forced" flag to fall out of sync with the real one.
 */
export default function PortalShellProvider({
  children,
}: PortalShellProviderProps) {
  const [userWantsOpen, setUserWantsOpen] = useState(true);
  const isTabletOrBelow = useIsTabletOrBelow();

  return (
    <SidebarProvider
      open={userWantsOpen && !isTabletOrBelow}
      onOpenChange={setUserWantsOpen}
    >
      {children}
    </SidebarProvider>
  );
}
