import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

type AuthShellProps = {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
};

export default function AuthShell({
  title,
  description,
  children,
  footer,
}: AuthShellProps) {
  return (
    <main className="min-h-svh bg-background px-4 py-8 text-foreground">
      <div className="mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-md flex-col justify-center">
        <div className="mb-5 flex items-center gap-3">
          <Image
            src="/brand/sals3-mark.png"
            alt="Sals3"
            width={36}
            height={36}
            // Already stored at its rendered size; see README "Image delivery".
            unoptimized
            className="rounded-md"
            priority
          />
          <div>
            <p className="text-sm font-semibold">Sals3 Seller Center</p>
            <Link
              href="/"
              className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Back to storefront
            </Link>
          </div>
        </div>
        <section className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <div className="mb-5">
            <h1 className="text-xl font-semibold tracking-normal">{title}</h1>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
          {children}
        </section>
        {footer === undefined ? null : (
          <div className="mt-4 text-center text-sm text-muted-foreground">
            {footer}
          </div>
        )}
      </div>
    </main>
  );
}
