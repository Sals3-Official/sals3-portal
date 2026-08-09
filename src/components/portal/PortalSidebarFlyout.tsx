'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSidebar } from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import type { NavGroup, NavItem } from '@/lib/portal/navigation';
import NavCountBadge from './NavCountBadge';

/**
 * Long enough that crossing the gap between the icon and the panel never
 * dismisses it, short enough that moving on to the next icon doesn't leave
 * a stale panel hanging.
 */
const CLOSE_DELAY_MS = 220;

type FlyoutRow = { item: NavItem; depth: 0 | 1 };

function flattenRows(items: NavItem[]): FlyoutRow[] {
  return items.flatMap((item) => [
    { item, depth: 0 as const },
    ...(item.items ?? []).map((child) => ({ item: child, depth: 1 as const })),
  ]);
}

type PortalSidebarFlyoutProps = {
  group: NavGroup;
  triggerIcon: ReactNode;
  /** Reveals the group in the open rail instead of the flyout - fired on click. */
  onExpandGroup: () => void;
};

/**
 * Collapsed-rail hover flyout for a parent with children. Two bugs the
 * approved design explicitly calls out and this implementation exists to
 * avoid: (1) positioning from `offsetTop` lands ~64px off because the rail's
 * padding box and the overlay's containing block differ - fixed here by
 * reading `getBoundingClientRect()` on open and portaling straight to
 * `document.body`, which also escapes `SidebarContent`'s
 * `overflow-hidden` (only set while the rail is icon-only) that would
 * otherwise clip an `absolute`-positioned panel. (2) a CSS-only `:hover`
 * panel drops the instant the pointer crosses the icon-to-panel gap - fixed
 * here with real state and a shared close timer that either surface can
 * cancel.
 */
export default function PortalSidebarFlyout({
  group,
  triggerIcon,
  onExpandGroup,
}: PortalSidebarFlyoutProps) {
  const pathname = usePathname();
  const { setOpen } = useSidebar();
  const [open, setOpenState] = useState(false);
  const [previousPathname, setPreviousPathname] = useState(pathname);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };

  const openNow = () => {
    clearCloseTimer();
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect !== undefined) {
      setPosition({ left: rect.right + 4, top: rect.top });
    }
    setOpenState(true);
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpenState(false), CLOSE_DELAY_MS);
  };

  // Unmounting mid-timer would otherwise fire `setOpenState` after the
  // component is gone.
  useEffect(() => clearCloseTimer, []);

  // A menu click navigates without remounting `PortalSidebar` (it lives in a
  // persistent layout), so the panel must close itself on route change.
  // Adjusting state during render (React's documented pattern for this)
  // instead of an effect, which would fire a redundant extra render.
  if (pathname !== previousPathname) {
    setPreviousPathname(pathname);
    setOpenState(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpenState(false);
          onExpandGroup();
          setOpen(true);
        }}
        onMouseEnter={openNow}
        onMouseLeave={scheduleClose}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={group.label}
        className="flex h-10 w-full items-center justify-center rounded-md text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-white"
      >
        {triggerIcon}
      </button>
      {open && position !== null
        ? createPortal(
            <div
              role="menu"
              tabIndex={-1}
              aria-label={group.label}
              onMouseEnter={clearCloseTimer}
              onMouseLeave={scheduleClose}
              style={{ left: position.left, top: position.top }}
              className="fixed z-80 min-w-[236px] rounded-lg border border-border bg-popover py-1.5 shadow-[0_12px_32px_rgba(11,44,77,.22)]"
            >
              <p className="border-b border-muted px-3.5 pt-1.5 pb-2 text-[11px] font-semibold tracking-wide text-ink-faint uppercase">
                {group.label}
              </p>
              {flattenRows(group.items).map(({ item, depth }) => (
                <Link
                  key={`${depth}-${item.href}`}
                  href={item.href}
                  role="menuitem"
                  className={cn(
                    'flex min-h-[34px] items-center gap-2.5 px-3.5 text-[12.5px] whitespace-nowrap text-foreground transition-colors hover:bg-muted',
                    depth === 1 ? 'pl-[30px]' : 'pl-3.5',
                  )}
                >
                  <span>{item.label}</span>
                  {item.badge === undefined ? null : (
                    <NavCountBadge badge={item.badge} surface="menu" />
                  )}
                </Link>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
