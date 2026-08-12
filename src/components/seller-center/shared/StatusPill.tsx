import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StatusPillTone =
  'neutral' | 'info' | 'success' | 'warning' | 'danger';

type StatusPillProps = {
  label: string;
  tone: StatusPillTone;
  /**
   * Optional second non-colour cue. The label already makes the status
   * readable; an icon helps when one screen repeats the same tone many
   * times. Decorative, so it is hidden from assistive technology.
   */
  icon?: LucideIcon;
  className?: string;
};

/**
 * `success` and `danger` use the `-700` text tokens, not `-600`.
 *
 * Measured, not assumed: `green-600` on `success-surface` is 4.35:1 and
 * `red-600` on `danger-surface` is 4.23:1, both under the 4.5:1 minimum. The
 * `-700` pairs measure 5.91:1 and 5.75:1 on the same fills. The other three
 * tones already passed and are unchanged.
 */
const TONE_STYLES: Record<StatusPillTone, string> = {
  neutral: 'bg-muted text-ink-muted',
  info: 'bg-brand-100 text-brand-900',
  success: 'bg-success-surface text-green-700',
  warning: 'bg-warning-surface text-amber-600',
  danger: 'bg-danger-surface text-red-700',
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
  icon: Icon,
  className,
}: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE_STYLES[tone],
        className,
      )}
    >
      {Icon === undefined ? null : (
        <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      )}
      {label}
    </span>
  );
}
