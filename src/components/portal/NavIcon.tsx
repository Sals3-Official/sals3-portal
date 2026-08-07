import {
  AlertTriangle,
  Ban,
  Banknote,
  BarChart3,
  Boxes,
  CircleCheck,
  ClipboardCheck,
  LayoutDashboard,
  Loader,
  Package,
  Plug,
  Plus,
  ScrollText,
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
  'layout-dashboard': LayoutDashboard,
  boxes: Boxes,
  banknote: Banknote,
  'scroll-text': ScrollText,
  'alert-triangle': AlertTriangle,
  'circle-check': CircleCheck,
  loader: Loader,
  ban: Ban,
  plug: Plug,
} as const;

type NavIconProps = {
  name: NavItem['icon'];
};

/** Lucide SVG icons only. Icons are decorative; the label carries the name. */
export default function NavIcon({ name }: NavIconProps) {
  const Glyph = ICONS[name];

  return <Glyph aria-hidden="true" className="size-4 shrink-0" />;
}
