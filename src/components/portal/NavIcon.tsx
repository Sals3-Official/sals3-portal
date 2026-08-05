import {
  BarChart3,
  ClipboardCheck,
  Package,
  Plus,
  Star,
  Upload,
} from 'lucide-react';
import type { NavItem } from '@/lib/portal/navigation';

const ICONS = {
  package: Package,
  plus: Plus,
  upload: Upload,
  clipboard: ClipboardCheck,
  chart: BarChart3,
  star: Star,
} as const;

type NavIconProps = {
  name: NavItem['icon'];
};

/** Lucide SVG icons only. Icons are decorative; the label carries the name. */
export default function NavIcon({ name }: NavIconProps) {
  const Glyph = ICONS[name];

  return <Glyph aria-hidden="true" className="size-4 shrink-0" />;
}
