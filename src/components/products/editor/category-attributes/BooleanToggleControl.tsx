'use client';

import { Switch } from '@/components/ui/switch';

type BooleanToggleControlProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
};

const STATE_LABELS: Record<'true' | 'false' | 'unset', string> = {
  true: 'Yes',
  false: 'No',
  unset: 'Not set',
};

export default function BooleanToggleControl({
  id,
  value,
  onChange,
}: BooleanToggleControlProps) {
  const stateKey = value === 'true' || value === 'false' ? value : 'unset';

  return (
    <div className="flex items-center gap-2">
      <Switch
        id={id}
        checked={value === 'true'}
        onCheckedChange={(checked) => onChange(checked ? 'true' : 'false')}
      />
      <span className="text-sm text-ink-muted">{STATE_LABELS[stateKey]}</span>
    </div>
  );
}
