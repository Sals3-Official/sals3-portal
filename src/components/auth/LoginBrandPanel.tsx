import { Boxes, CircleCheck, Radar } from 'lucide-react';
import Image from 'next/image';

const CAPABILITIES = [
  {
    icon: Boxes,
    label: 'Supplier catalogue',
    description: 'Bring connected supplier products into one operational view.',
  },
  {
    icon: CircleCheck,
    label: 'Automated product evaluation',
    description:
      'See what is ready, what needs attention, and what is blocked.',
  },
  {
    icon: Radar,
    label: 'Operational visibility',
    description: 'Track evidence, exceptions, and supplier connection health.',
  },
] as const;

function BrandMark() {
  return (
    <div className="flex items-center gap-2.5">
      <Image
        src="/brand/sals3-mark.png"
        alt="Sals3"
        width={32}
        height={32}
        // Already stored at its rendered size; see README "Image delivery".
        unoptimized
        priority
        className="rounded-md"
      />
      <span className="font-display text-base font-semibold tracking-tight">
        Sals3 Portal
      </span>
    </div>
  );
}

export default function LoginBrandPanel() {
  return (
    <>
      <aside
        aria-label="About Sals3 Portal"
        className="relative hidden overflow-hidden bg-sidebar px-10 py-11 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-32 -bottom-40 size-[420px] rounded-full bg-sidebar-primary/20"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-36 -left-28 size-[320px] rounded-full bg-sidebar-accent/60"
        />

        <div className="relative">
          <BrandMark />
        </div>

        <div className="relative max-w-sm space-y-4">
          <p className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance font-display">
            Run your catalogue with confidence.
          </p>
          <p className="text-sm leading-relaxed text-sidebar-foreground/90">
            Connect suppliers, evaluate products, and manage the work that keeps
            your storefront ready.
          </p>
        </div>

        <dl className="relative space-y-5">
          {CAPABILITIES.map(({ icon: Icon, label, description }) => (
            <div key={label} className="flex gap-3">
              <Icon
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-sidebar-primary"
              />
              <div>
                <dt className="text-sm font-medium">{label}</dt>
                <dd className="mt-0.5 text-sm text-sidebar-foreground/90">
                  {description}
                </dd>
              </div>
            </div>
          ))}
        </dl>

        <p className="relative text-xs font-medium tracking-wide text-sidebar-foreground/80 uppercase">
          Secure seller operations
        </p>
      </aside>

      <div className="bg-sidebar px-6 py-6 text-sidebar-foreground lg:hidden">
        <BrandMark />
        <p className="mt-4 text-2xl leading-tight font-semibold tracking-tight font-display">
          Run your catalogue with confidence.
        </p>
        <p className="mt-1.5 text-sm text-sidebar-foreground/90">
          Connect suppliers, evaluate products, and manage the work that keeps
          your storefront ready.
        </p>
      </div>
    </>
  );
}
