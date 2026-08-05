import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type LinkButtonProps = {
  href: string;
  children: ReactNode;
  variant?: 'default' | 'outline' | 'ghost' | 'secondary';
  size?: 'default' | 'sm' | 'lg';
  prefetch?: boolean;
  className?: string;
};

/**
 * A link that looks like a button.
 *
 * The Base UI `Button` warns when it is asked to render something other than a
 * native `<button>`, because doing so drops real button semantics. Navigation
 * belongs to an anchor, so this component styles a real `Link` with the button
 * variants instead of dressing a button up as a link.
 */
export default function LinkButton({
  href,
  children,
  variant = 'default',
  size = 'lg',
  prefetch,
  className,
}: LinkButtonProps) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className={cn(
        buttonVariants({ variant, size }),
        'cursor-pointer',
        className,
      )}
    >
      {children}
    </Link>
  );
}
