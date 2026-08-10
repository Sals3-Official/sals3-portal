import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { NavBadge, NavGroup, NavItem } from '@/lib/portal/navigation';
import NavCountBadge from './NavCountBadge';
import NavIcon from './NavIcon';
import PortalSidebarFlyout from './PortalSidebarFlyout';

/**
 * Reading the query string here would need `useSearchParams`, which forces this
 * client component behind a Suspense boundary and makes the server and the
 * client render the rail differently on a phone. Links that only differ by query
 * string (the review shortcut) are therefore never marked current - a small,
 * honest loss next to a hydration mismatch on every page.
 */
function isCurrent(href: string, pathname: string): boolean {
  return !href.includes('?') && href === pathname;
}

/** A parent with sub-items (e.g. "Qualified Products") reads active when any child does. */
function isCurrentOrChild(item: NavItem, pathname: string): boolean {
  if (isCurrent(item.href, pathname)) return true;

  return (item.items ?? []).some((child) => isCurrent(child.href, pathname));
}

export function groupIsCurrent(group: NavGroup, pathname: string): boolean {
  return group.items.some((item) => isCurrentOrChild(item, pathname));
}

export function isSoloGroup(group: NavGroup): boolean {
  return group.solo === true;
}

/** The 3px accent bleeding off the rail's left edge - the only "you are here" signal besides the pill/label text itself. */
function ActiveEdge({ active, inset }: { active: boolean; inset: number }) {
  if (!active) return null;

  return (
    <span
      aria-hidden="true"
      className="absolute left-[-6px] w-[3px] rounded-r-[3px] bg-sidebar-primary"
      style={{ top: inset, bottom: inset }}
    />
  );
}

export function IconWithCompactBadge({
  icon,
  badge,
  showBadge = false,
}: {
  icon: NavItem['icon'];
  badge?: NavBadge;
  /** The overlay dot only ever shows on the collapsed rail - the expanded rail shows the same count as an inline pill next to the label instead. */
  showBadge?: boolean;
}) {
  return (
    <span className="relative flex size-8 shrink-0 items-center justify-center">
      <NavIcon name={icon} />
      {showBadge && badge !== undefined && badge.tone !== 'neutral' ? (
        <span
          aria-hidden="true"
          className={cn(
            'absolute top-[5px] left-[34px] flex h-[15px] min-w-[15px] items-center justify-center rounded-full border-2 border-sidebar px-[3px] text-[9px] font-bold text-white',
            badge.tone === 'danger' ? 'bg-red-600' : 'bg-amber-600',
          )}
        >
          {badge.count}
        </span>
      ) : null}
    </span>
  );
}

/** Top-level row with no children (Overview, Supplier Apps, Orders, Inventory) - a plain link, no chevron. */
function SoloRow({
  item,
  pathname,
  collapsed,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
}) {
  const active = isCurrent(item.href, pathname);
  const link = (
    <Link
      href={item.href}
      prefetch={false}
      className="relative mx-1.5 my-0.5 flex h-10 items-center gap-3 rounded-md px-2 text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-white"
    >
      <ActiveEdge active={active} inset={8} />
      <IconWithCompactBadge
        icon={item.icon}
        badge={item.badge}
        showBadge={collapsed}
      />
      {collapsed ? null : (
        <>
          <span className="truncate">{item.label}</span>
          {item.badge === undefined ? null : (
            <NavCountBadge badge={item.badge} surface="rail" />
          )}
        </>
      )}
    </Link>
  );

  if (!collapsed) return link;

  return (
    // Scanning down the rail shouldn't pop a tooltip per icon - a longer
    // open delay than the app-wide `TooltipProvider` default (0ms, used for
    // immediate collapsed-icon tooltips elsewhere) makes it deliberate.
    <TooltipProvider delay={450}>
      <Tooltip>
        <TooltipTrigger render={link} />
        <TooltipContent side="right">{item.label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Child (52px indent) or grandchild (68px indent, Ready/Needs Attention under Qualified Products) row - never rendered while the rail is compact. */
function ChildRow({
  item,
  pathname,
  nested = false,
}: {
  item: NavItem;
  pathname: string;
  nested?: boolean;
}) {
  const active = isCurrent(item.href, pathname);

  return (
    <Link
      href={item.href}
      prefetch={false}
      className={cn(
        'relative mx-1.5 my-px flex h-[34px] items-center gap-2 rounded-md pr-2 text-[12.5px] whitespace-nowrap text-sidebar-foreground/[.82] transition-colors hover:bg-sidebar-accent hover:text-white',
        nested ? 'pl-[68px]' : 'pl-[52px]',
      )}
    >
      <ActiveEdge active={active} inset={6} />
      <span className="truncate">{item.label}</span>
      {item.badge === undefined ? null : (
        <NavCountBadge badge={item.badge} surface="rail" />
      )}
    </Link>
  );
}

function GroupChildren({
  items,
  pathname,
}: {
  items: NavItem[];
  pathname: string;
}) {
  return (
    <div className="flex flex-col">
      {items.map((item) => (
        <div key={item.href}>
          <ChildRow item={item} pathname={pathname} />
          {(item.items ?? []).map((grandchild) => (
            <ChildRow
              key={grandchild.href}
              item={grandchild}
              pathname={pathname}
              nested
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Expanded-rail parent row: the group label is itself the menu item, with a chevron disclosing its children below. */
function ExpandedParentRow({
  group,
  open,
  onToggle,
  active,
}: {
  group: NavGroup;
  open: boolean;
  onToggle: () => void;
  active: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="relative mx-1.5 my-0.5 flex h-10 w-[calc(100%-12px)] items-center gap-3 rounded-md px-2 text-left text-[13px] font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent hover:text-white"
    >
      <ActiveEdge active={active} inset={8} />
      <IconWithCompactBadge icon={group.icon} />
      <span className="truncate">{group.label}</span>
      {group.badge === undefined ? null : (
        <NavCountBadge badge={group.badge} surface="rail" />
      )}
      <ChevronDown
        aria-hidden="true"
        className={cn(
          'size-3.5 shrink-0 text-sidebar-foreground/50 transition-transform duration-200 ease-in-out',
          open ? '' : '-rotate-90',
        )}
      />
    </button>
  );
}

type NavGroupRowProps = {
  group: NavGroup;
  pathname: string;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  onForceOpen: () => void;
};

/** One group's row(s): a flat solo link, a collapsed-rail flyout trigger, or an expanded parent row plus its children. */
export default function NavGroupRow({
  group,
  pathname,
  collapsed,
  open,
  onToggle,
  onForceOpen,
}: NavGroupRowProps) {
  if (isSoloGroup(group)) {
    return (
      <SoloRow
        item={group.items[0]}
        pathname={pathname}
        collapsed={collapsed}
      />
    );
  }

  const active = groupIsCurrent(group, pathname);

  if (collapsed) {
    return (
      <PortalSidebarFlyout
        group={group}
        onExpandGroup={onForceOpen}
        triggerIcon={
          <IconWithCompactBadge
            icon={group.icon}
            badge={group.badge}
            showBadge
          />
        }
      />
    );
  }

  return (
    <>
      <ExpandedParentRow
        group={group}
        open={open}
        onToggle={onToggle}
        active={active}
      />
      {open ? <GroupChildren items={group.items} pathname={pathname} /> : null}
    </>
  );
}
