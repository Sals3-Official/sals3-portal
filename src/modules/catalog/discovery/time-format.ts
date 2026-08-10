import { CJ_CREATE_TIME_TIMEZONE } from './config';

/**
 * Renders an epoch-ms instant as CJ's documented `yyyy-MM-dd hh:mm:ss` wire
 * value in the configured timezone. CJ documents only the format string -
 * the timezone interpretation is a configurable assumption gated behind the
 * pre-rollout contract probe (see `config.ts`). Uses the built-in
 * `Intl.DateTimeFormat` so no timezone dependency is added.
 */
export default function formatCjCreateTime(
  epochMs: number,
  timeZone: string = CJ_CREATE_TIME_TIMEZONE,
): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(epochMs));

  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = byType.get(type);

    if (value === undefined) {
      throw new Error(`Timestamp formatting produced no "${type}" part.`);
    }

    return value;
  };

  // `hour12: false` can still yield "24" for midnight in some ICU versions;
  // normalize to "00" so the wire value is always a valid 00-23 hour.
  const hour = get('hour') === '24' ? '00' : get('hour');

  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')}`;
}
