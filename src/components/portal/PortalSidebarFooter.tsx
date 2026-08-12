import { Plug } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import type { SupplierConnectionRow } from '@/lib/db/schema';

/**
 * Three genuinely different things, kept apart on purpose.
 *
 * A connection row is one answer. `null` is "you have no supplier connected",
 * which is a real, actionable fact. `'UNREADABLE'` is "we could not find
 * out" - and collapsing that into `null` is what made the rail tell a seller
 * with a healthy CJ connection to go and connect one, purely because the
 * database was down.
 */
export type ConnectionSummary =
  | { status: SupplierConnectionRow['status']; providerDisplayName: string }
  | 'UNREADABLE'
  | null;

/** Mirrors `catalog-presentation.ts`'s wording, but for real connection rows - that module is a design-preview fixture and is not wired to production data. */
const CONNECTION_STATUS_TEXT: Record<
  SupplierConnectionRow['status'],
  { label: string; dotClassName: string; textClassName: string }
> = {
  CONNECTED: {
    label: 'Connected',
    dotClassName: 'bg-green-600',
    textClassName: 'text-green-600',
  },
  DEGRADED: {
    label: 'Degraded',
    dotClassName: 'bg-amber-600',
    textClassName: 'text-amber-600',
  },
  REAUTH_REQUIRED: {
    label: 'Needs reconnection',
    dotClassName: 'bg-amber-600',
    textClassName: 'text-amber-600',
  },
  PENDING: {
    label: 'Pending',
    dotClassName: 'bg-sidebar-foreground/50',
    textClassName: 'text-sidebar-foreground/70',
  },
  DISCONNECTED: {
    label: 'Disconnected',
    dotClassName: 'bg-red-600',
    textClassName: 'text-red-600',
  },
  REVOKED: {
    label: 'Revoked',
    dotClassName: 'bg-red-600',
    textClassName: 'text-red-600',
  },
};

type PortalSidebarFooterProps = {
  connectionSummary: ConnectionSummary;
};

/** Rail footer: supplier-connection health, never the user's name - that appears once, in the topbar. */
export default function PortalSidebarFooter({
  connectionSummary,
}: PortalSidebarFooterProps) {
  // Unknown is styled muted rather than amber. Amber is this rail's
  // "degraded connection" colour, and borrowing it here would assert a
  // supplier problem when the only known problem is our own read.
  const unknownTone = {
    label: 'Status unavailable',
    dotClassName: 'bg-sidebar-foreground/30',
    textClassName: 'text-sidebar-foreground/70',
  };

  let tone;
  let summary;

  if (connectionSummary === 'UNREADABLE') {
    tone = unknownTone;
    summary = 'Cannot check supplier connections right now';
  } else if (connectionSummary === null) {
    tone = {
      label: 'No supplier connected',
      dotClassName: 'bg-sidebar-foreground/50',
      textClassName: 'text-sidebar-foreground/70',
    };
    summary = 'Connect a Supplier App to start sourcing';
  } else {
    tone = CONNECTION_STATUS_TEXT[connectionSummary.status];
    summary = `${connectionSummary.providerDisplayName} · ${tone.label}`;
  }

  return (
    <div className="overflow-hidden border-t border-sidebar-border p-1.5">
      <Link
        href="/supplier-apps"
        prefetch={false}
        className="flex h-12 w-full items-center gap-3 rounded-md px-2 text-sidebar-foreground transition-colors hover:bg-sidebar-accent"
      >
        <span className="relative flex size-8 shrink-0 items-center justify-center">
          <Plug aria-hidden="true" className="size-[18px]" />
          <span
            aria-hidden="true"
            className={cn(
              'absolute top-[6px] left-[22px] size-2 rounded-full border-2 border-sidebar',
              tone.dotClassName,
            )}
          />
        </span>
        <span className="min-w-0 opacity-100 transition-opacity duration-[180ms] ease-in-out group-data-[collapsible=icon]:opacity-0">
          <span className="block truncate text-[12.5px] font-semibold">
            Supplier connections
          </span>
          <span
            className={cn('block truncate text-[11px]', tone.textClassName)}
          >
            {summary}
          </span>
        </span>
      </Link>
    </div>
  );
}
