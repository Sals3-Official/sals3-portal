'use client';

import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState, type ReactNode } from 'react';
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  useSidebar,
} from '@/components/ui/sidebar';
import type { NavGroup } from '@/lib/portal/navigation';
import NavGroupRow from './PortalSidebarRows';
import PortalSidebarFooter, {
  type ConnectionSummary,
} from './PortalSidebarFooter';

export type { ConnectionSummary };

type PortalSidebarProps = {
  groups: NavGroup[];
  connectionSummary: ConnectionSummary;
};

/** Every group starts open; the user can still collapse one, and that choice survives client-side navigation because this component stays mounted across it. */
function useGroupOpenState(groups: NavGroup[]) {
  return useState<Record<string, boolean>>(() =>
    Object.fromEntries(groups.map((group) => [group.label, true])),
  );
}

function SidebarToggleButton() {
  const { state, isMobile, openMobile, toggleSidebar } = useSidebar();
  // On mobile the rail is a Sheet that ignores `state` (the desktop
  // icon/expanded concept) entirely and renders full content regardless -
  // `openMobile` is the real "is it open" answer there.
  const isOpen = isMobile ? openMobile : state !== 'collapsed';
  const label = isOpen ? 'Close sidebar' : 'Open sidebar';

  return (
    <button
      type="button"
      onClick={toggleSidebar}
      aria-expanded={isOpen}
      aria-label={label}
      title={label}
      className="ml-2 flex size-8 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-sidebar-accent"
    >
      <Image
        src="/brand/sals3-mark.png"
        alt="Sals3"
        width={28}
        height={28}
        className="rounded-md"
      />
    </button>
  );
}

/**
 * Navigation rail. A client component because it reads the current route to
 * mark the active link; the permission-filtered group list and connection
 * summary come from the server.
 */
export default function PortalSidebar({
  groups,
  connectionSummary,
}: PortalSidebarProps) {
  const pathname = usePathname();
  const { state: sidebarState } = useSidebar();
  const collapsed = sidebarState === 'collapsed';
  const [openByLabel, setOpenByLabel] = useGroupOpenState(groups);

  const rows: ReactNode[] = groups.map((group, index) => {
    const boundary =
      collapsed && index > 0 ? (
        <div
          key={`${group.label}-boundary`}
          className="mx-3 my-1 h-px bg-sidebar-border"
        />
      ) : null;

    return (
      <div key={group.label}>
        {boundary}
        <NavGroupRow
          group={group}
          pathname={pathname}
          collapsed={collapsed}
          open={openByLabel[group.label] ?? true}
          onToggle={() =>
            setOpenByLabel((current) => ({
              ...current,
              [group.label]: !(current[group.label] ?? true),
            }))
          }
          onForceOpen={() =>
            setOpenByLabel((current) => ({ ...current, [group.label]: true }))
          }
        />
      </div>
    );
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 flex-row items-center gap-0 overflow-hidden border-b border-sidebar-border px-0 pl-1.5">
        <SidebarToggleButton />
        <span className="ml-3 font-display text-[15px] font-semibold text-white transition-opacity duration-[180ms] ease-in-out group-data-[collapsible=icon]:opacity-0">
          Sals3 Portal
        </span>
      </SidebarHeader>
      <SidebarContent className="px-0 py-2">{rows}</SidebarContent>
      <PortalSidebarFooter connectionSummary={connectionSummary} />
    </Sidebar>
  );
}
