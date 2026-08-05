export type PageItem = number | { ellipsisAfter: number };

/**
 * Classic truncated pagination range: always shows the first and last page,
 * the current page and its siblings, collapsing any gap into a single
 * ellipsis marker. Mirrors the standard GitHub/Google-style pattern.
 */
export function buildPageList(
  currentPage: number,
  totalPages: number,
  siblingCount = 1,
): PageItem[] {
  if (totalPages <= 0) {
    return [];
  }

  const totalNumbers = siblingCount * 2 + 5;

  if (totalPages <= totalNumbers) {
    return Array.from({ length: totalPages }, (_, i) => i + 1);
  }

  const leftSibling = Math.max(currentPage - siblingCount, 2);
  const rightSibling = Math.min(currentPage + siblingCount, totalPages - 1);
  const showLeftEllipsis = leftSibling > 2;
  const showRightEllipsis = rightSibling < totalPages - 1;

  const items: PageItem[] = [1];

  if (showLeftEllipsis) {
    items.push({ ellipsisAfter: 1 });
  } else {
    for (let page = 2; page < leftSibling; page += 1) {
      items.push(page);
    }
  }

  for (let page = leftSibling; page <= rightSibling; page += 1) {
    items.push(page);
  }

  if (showRightEllipsis) {
    items.push({ ellipsisAfter: rightSibling });
  } else {
    for (let page = rightSibling + 1; page < totalPages; page += 1) {
      items.push(page);
    }
  }

  items.push(totalPages);

  return items;
}
