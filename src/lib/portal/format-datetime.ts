/**
 * One deterministic timestamp format for read-only detail surfaces.
 *
 * Deliberately UTC and fixed-width rather than `toLocaleString()`. A candidate
 * detail URL is shareable, so two people opening the same link must read the
 * same instant - and a test asserting on the output must not depend on the
 * machine's timezone. The trailing `UTC` is part of the string so the reader is
 * never left guessing which zone they are looking at.
 */
export default function formatUtcDateTime(
  value: Date | string | null | undefined,
  fallback = 'Not captured',
): string {
  if (value === null || value === undefined || value === '') return fallback;

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) return fallback;

  const iso = date.toISOString();

  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}
