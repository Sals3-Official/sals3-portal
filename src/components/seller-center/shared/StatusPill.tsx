import { cn } from '@/lib/utils';

export type StatusPillTone =
  'neutral' | 'info' | 'success' | 'warning' | 'danger';

type StatusPillProps = {
  label: string;
  tone: StatusPillTone;
  className?: string;
};

const TONE_STYLES: Record<StatusPillTone, string> = {
  neutral: 'bg-muted text-ink-muted',
  info: 'bg-brand-100 text-brand-900',
  success: 'bg-success-surface text-green-600',
  warning: 'bg-warning-surface text-amber-600',
  danger: 'bg-danger-surface text-red-600',
};

/**
 * Status badge that maps a tone to `MASTER.md`'s status-surface tokens.
 * Colour is never the only signal - the label text always states the
 * status in words, matching the mandatory "status colour also carries a
 * text label" rule.
 */
export default function StatusPill({
  label,
  tone,
  className,
}: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_STYLES[tone],
        className,
      )}
    >
      {label}
    </span>
  );
}
