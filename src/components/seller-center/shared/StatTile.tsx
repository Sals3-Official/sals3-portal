import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import StatusPill, { type StatusPillTone } from './StatusPill';

type StatTileProps = {
  label: string;
  tone: StatusPillTone;
  value: string;
  note?: ReactNode;
  className?: string;
};

/**
 * A labeled amount with a status pill and an explanatory note underneath -
 * the "one number, always with its meaning" building block for money-state
 * summaries (Overview's money position, ledger totals).
 */
export default function StatTile({
  label,
  tone,
  value,
  note,
  className,
}: StatTileProps) {
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <StatusPill label={label} tone={tone} />
      <p className="text-2xl font-semibold tracking-tight text-foreground tabular-nums">
        {value}
      </p>
      {note === undefined ? null : (
        <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>
      )}
    </div>
  );
}
