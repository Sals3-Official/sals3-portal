/**
 * `navigator.clipboard.writeText` rejects in several ordinary situations -
 * an insecure context, a denied permission, a background tab in some
 * browsers - and every catalogue copy action used to call it unguarded,
 * which is an unhandled promise rejection on any of those paths. Centralized
 * here so every "Copy" control fails safely and reports the same way.
 */
export default async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);

    return true;
  } catch {
    return false;
  }
}
