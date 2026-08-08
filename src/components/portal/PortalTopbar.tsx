import { SidebarTrigger } from '@/components/ui/sidebar';
import { PORTAL_ROLE_LABELS, type PortalRole } from '@/lib/auth/permissions';
import SignOutButton from '../auth/SignOutButton';
import PortalTopbarSection from './PortalTopbarSection';

type PortalTopbarProps = {
  userName: string;
  role: PortalRole;
};

/**
 * Sticky top bar. Shows the signed-in identity and its role, so a user can see
 * why an action is missing from a screen.
 *
 * On desktop the rail's own logo is the sole open/close control - no trigger
 * here (removed on design review; do not re-add it for `md` and up). Mobile
 * is different: the rail becomes an off-screen drawer with nothing visible
 * to click until it opens, so the approved prototype's own mobile topbar
 * (`Sals3 Portal Shell.dc.html`, "Mobile drawer" reference) keeps a
 * hamburger trigger there - hence `md:hidden` rather than removing it
 * outright.
 */
export default function PortalTopbar({ userName, role }: PortalTopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card px-4">
      <SidebarTrigger className="cursor-pointer md:hidden" />
      <PortalTopbarSection />
      <div className="ml-auto text-right">
        <p className="text-sm font-medium leading-tight">{userName}</p>
        <p className="text-xs text-muted-foreground leading-tight">
          {PORTAL_ROLE_LABELS[role]}
        </p>
      </div>
      <SignOutButton />
    </header>
  );
}
