/**
 * Formats a duration in milliseconds as a short relative label ("just now",
 * "12m", "3h", "5d"). Production-safe counterpart to the design-preview-only
 * `formatRelativeTime` in `src/lib/products/catalog-presentation.ts`, which
 * takes two ISO timestamps rather than a precomputed duration and is not
 * meant to be imported outside that fixture module.
 */
export default function formatRelativeDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);

  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}
