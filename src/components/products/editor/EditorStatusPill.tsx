import StatusPill from '@/components/seller-center/shared/StatusPill';
import type { Presentation } from './presentation';

type EditorStatusPillProps = {
  presentation: Presentation;
  /** Overrides the wording while keeping the state's tone and icon. */
  label?: string;
  className?: string;
};

/**
 * Renders one `Presentation` as a `StatusPill`. Exists so a caller passes
 * the state itself rather than re-picking a label, a tone and an icon at
 * every call site - which is how three components end up describing the
 * same status three different ways.
 */
export default function EditorStatusPill({
  presentation,
  label,
  className,
}: EditorStatusPillProps) {
  return (
    <StatusPill
      label={label ?? presentation.label}
      tone={presentation.tone}
      icon={presentation.icon}
      className={className}
    />
  );
}
