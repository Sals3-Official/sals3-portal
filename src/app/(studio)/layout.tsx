import type { ReactNode } from 'react';

/**
 * The full-screen editing surface, outside the portal shell.
 *
 * A route group rather than a nested layout under `(portal)`: layouts nest, so
 * a child of the portal layout can only ever add chrome to the rail and topbar,
 * never remove them. Here the rail is genuinely absent rather than hidden,
 * which is what gives the canvas the full viewport width a page-shaped preview
 * needs.
 *
 * A pass-through by design — the root layout already supplies the document,
 * the fonts, and the `noindex` the whole portal carries. Each screen inside
 * owns its own header, because a shared one would have nothing to put in it
 * that its single child does not already know better.
 */
export default function StudioLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return children;
}
