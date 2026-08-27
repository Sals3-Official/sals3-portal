/**
 * One sentence naming every file a photo upload run did not store.
 *
 * ## The defect this exists to close
 *
 * `ProductPhotoManager` offers its Upload control whenever *one* slot is free,
 * and the editor uploads a chosen batch one file at a time. Handing it 21 files
 * against 12 free slots therefore stored 12 and refused 9 — correctly, at the
 * server — but the client reported each refusal as its own `toast.error`. Nine
 * identical transient toasts into a stack that shows three at a time, arriving
 * between successful uploads, is not a report: the run read as silent, and the
 * only surviving evidence was a counter reading `12 of 12`. A listing looked
 * finished while nine of its variations had no photo.
 *
 * A partial success that does not say which part failed is the failure mode
 * worth engineering against here, so this is deliberately built to be *hard to
 * miss and specific*: it names the count, groups identical reasons rather than
 * repeating them, and names the files themselves so the seller can re-pick
 * exactly those.
 *
 * ## Why file names are safe to echo here
 *
 * The names come from the browser's own `File.name` for files this seller just
 * chose, and they are rendered as React text — never as HTML, never into a URL,
 * and never near the object key, which is server-generated from `randomUUID()`
 * precisely so an attacker-controlled filename can reach no path (rule 31).
 * They are truncated so one pathological name cannot push the reason offscreen.
 */

/** Longer than any real photo filename, short enough not to bury the reason. */
const MAX_NAME_LENGTH = 40;

/** Beyond this the list stops being readable and the count carries it. */
const MAX_NAMES_LISTED = 8;

export type RefusedUpload = { name: string; message: string };

function shortName(name: string): string {
  const trimmed = name.trim();
  const safe = trimmed.length === 0 ? 'Unnamed file' : trimmed;

  return safe.length <= MAX_NAME_LENGTH
    ? safe
    : `${safe.slice(0, MAX_NAME_LENGTH - 1)}…`;
}

/**
 * `a`, `a and b`, `a, b and c` — an Oxford-comma-free list, because this is
 * read mid-sentence in a toast rather than as prose.
 */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';

  const last = names[names.length - 1] ?? '';

  return `${names.slice(0, -1).join(', ')} and ${last}`;
}

function describeGroup(message: string, names: string[]): string {
  const listed = names.slice(0, MAX_NAMES_LISTED).map(shortName);
  const hidden = names.length - listed.length;
  const tail =
    hidden > 0 ? `${joinNames(listed)} and ${hidden} more` : joinNames(listed);

  return `${message} Not stored: ${tail}.`;
}

/**
 * @param refused every file the run failed to store, in the order chosen.
 * @param accepted how many files the same run did store, so a partial success
 *   states both halves rather than only the bad one.
 */
export default function describeRefusedUploads(
  refused: RefusedUpload[],
  accepted: number,
): string {
  if (refused.length === 0) return '';

  const byMessage = new Map<string, string[]>();

  refused.forEach((item) => {
    const names = byMessage.get(item.message) ?? [];

    names.push(item.name);
    byMessage.set(item.message, names);
  });

  const groups = [...byMessage.entries()].map(([message, names]) =>
    describeGroup(message, names),
  );

  // Stated first, and stated even when nothing was accepted, because "9 of 21
  // photos were not uploaded" is the fact a seller needs before the reason.
  const total = accepted + refused.length;
  const headline =
    refused.length === total
      ? `None of the ${total} photos were uploaded.`
      : `${refused.length} of ${total} photos were not uploaded.`;

  return [headline, ...groups].join(' ');
}
