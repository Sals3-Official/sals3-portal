import type { ReactNode } from 'react';
import PortalSidebar from '@/components/portal/PortalSidebar';
import PortalTopbar from '@/components/portal/PortalTopbar';
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { can } from '@/lib/auth/permissions';
import { getSession } from '@/lib/auth/session';
import { NAV_GROUPS } from '@/lib/portal/navigation';

type PortalLayoutProps = Readonly<{ children: ReactNode }>;

/**
 * Portal shell. A Server Component: it reads the session on the server and
 * passes only the navigation the role may use into the client rail.
 */
export default async function PortalLayout({ children }: PortalLayoutProps) {
  const session = await getSession();
  const groups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => can(session.role, item.permission)),
  })).filter((group) => group.items.length > 0);

  return (
    <TooltipProvider>
      <SidebarProvider>
        <PortalSidebar groups={groups} />
        {/* `min-w-0` matters: a flex child defaults to `min-width: auto`, so a
            wide table would push this column past the viewport and scroll the
            whole page sideways instead of scrolling inside its own container. */}
        <SidebarInset className="min-w-0">
          <PortalTopbar userName={session.displayName} role={session.role} />
          <div className="mx-auto w-full max-w-[1600px] px-4 py-6 md:px-6">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
