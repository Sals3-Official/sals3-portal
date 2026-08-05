/**
 * List views keep search, filter, sort, and page in the URL. A view is then
 * shareable, the back button behaves, and the server can render the page
 * without client state.
 */

export type ParamPatch = Record<string, string | number | null>;

/**
 * Applies a patch to the current parameters and returns a query string. A
 * `null` value removes the key. Any change other than `page` itself resets the
 * page, so a new filter never lands the user on an empty page 7.
 */
export function buildQueryString(
  current: URLSearchParams | Record<string, string>,
  patch: ParamPatch,
): string {
  const next = new URLSearchParams(
    current instanceof URLSearchParams ? current.toString() : current,
  );

  Object.entries(patch).forEach(([key, value]) => {
    if (value === null || value === '') {
      next.delete(key);

      return;
    }

    next.set(key, String(value));
  });

  const changedOtherThanPage = Object.keys(patch).some((key) => key !== 'page');

  if (changedOtherThanPage && patch.page === undefined) {
    next.delete('page');
  }

  const query = next.toString();

  return query === '' ? '' : `?${query}`;
}

export function buildHref(
  pathname: string,
  current: URLSearchParams | Record<string, string>,
  patch: ParamPatch,
): string {
  return `${pathname}${buildQueryString(current, patch)}`;
}
