import { SidebarTrigger } from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { PORTAL_ROLE_LABELS, type PortalRole } from '@/lib/auth/permissions';

type PortalTopbarProps = {
  userName: string;
  role: PortalRole;
};

/**
 * Sticky top bar. Shows the signed-in identity and its role, so a user can see
 * why an action is missing from a screen.
 */
export default function PortalTopbar({ userName, role }: PortalTopbarProps) {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-card px-4">
      <SidebarTrigger className="cursor-pointer" />
      <Separator orientation="vertical" className="h-6" />
      <p className="text-sm font-medium">Catalogue management</p>
      <div className="ml-auto text-right">
        <p className="text-sm font-medium leading-tight">{userName}</p>
        <p className="text-xs text-muted-foreground leading-tight">
          {PORTAL_ROLE_LABELS[role]}
        </p>
      </div>
    </header>
  );
}
