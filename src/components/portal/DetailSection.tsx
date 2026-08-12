import type { ReactNode } from 'react';

type DetailSectionProps = {
  title: string;
  children: ReactNode;
  /**
   * A sentence about the section as a whole - typically what its absence or
   * its scope does NOT mean. Rendered under the heading, before the content,
   * so it is read before the values rather than after.
   */
  note?: string;
};

/**
 * One titled group inside a read-only detail surface. Heading at section size
 * (16px/600) per `design-system/sals3-portal/MASTER.md` §3.
 */
export default function DetailSection({
  title,
  children,
  note,
}: DetailSectionProps) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-base font-semibold">{title}</h3>
      {note === undefined ? null : (
        <p className="text-xs text-ink-subtle">{note}</p>
      )}
      {children}
    </section>
  );
}
