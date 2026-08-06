import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type DisclosureBannerProps = {
  tone?: 'info' | 'warning';
  children: ReactNode;
  className?: string;
};

const TONE_STYLES = {
  info: 'border-border bg-muted text-ink-muted',
  warning: 'border-amber-600/25 bg-warning-surface text-amber-600',
} as const;

/**
 * Muted plain-language disclosure panel, reused everywhere a screen must
 * state a limit, an estimate's uncertainty, or a friction-by-design
 * behavior instead of letting a number speak for itself.
 */
export default function DisclosureBanner({
  tone = 'info',
  children,
  className,
}: DisclosureBannerProps) {
  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2 text-sm leading-relaxed',
        TONE_STYLES[tone],
        className,
      )}
    >
      {children}
    </div>
  );
}
