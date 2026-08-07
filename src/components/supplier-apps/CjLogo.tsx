import Image from 'next/image';
import { cn } from '@/lib/utils';

type CjLogoProps = {
  className?: string;
};

/**
 * CJdropshipping's own mark - saved locally from CJ's public asset host
 * (`frontend.cjdropshipping.com`) rather than hotlinked, so this renders
 * without depending on a third-party host or needing it allow-listed in
 * `next.config.ts`. It's a white-on-transparent mark, so it needs a dark
 * chip behind it on this app's light card background - `bg-sidebar` reuses
 * the same navy token the rail already uses, in both themes. Purely
 * decorative branding, not a control - no hover/press affordance, since
 * nothing happens when it's clicked.
 */
export default function CjLogo({ className }: CjLogoProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md bg-sidebar px-3 py-2',
        className,
      )}
    >
      <Image
        src="/suppliers/cj-dropshipping-logo-white.svg"
        alt="CJ Dropshipping"
        width={132}
        height={32}
      />
    </span>
  );
}
