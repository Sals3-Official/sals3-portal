import type { ReactNode } from 'react';

type SourcingInfoBannerProps = {
  children: ReactNode;
};

/**
 * Persistent "what is this screen for" banner - unlike `SourcingEmptyState`,
 * it stays visible once the list has rows too, since staff need the
 * explanation regardless of whether anything is in the list right now.
 */
export default function SourcingInfoBanner({
  children,
}: SourcingInfoBannerProps) {
  return (
    <p className="animate-in fade-in slide-in-from-top-1 rounded-md border border-border bg-muted px-3 py-2 text-sm text-ink-muted duration-300">
      {children}
    </p>
  );
}
