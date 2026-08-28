import type { ParcelLine } from '@/modules/orders/contracts';

type ParcelLineTitleProps = {
  line: ParcelLine;
  /** Typography for the surface. The list sets 13px, the detail 14px. */
  className: string;
};

/**
 * An ordered item's name, linked to its product page when there is one.
 *
 * One component for both order surfaces, because this is one rule. It first
 * shipped on the detail card alone, on the reasoning that "the list card's
 * whole row is already a link to the parcel" — which was simply wrong. The
 * list card is an `<article>`; its only link is the order reference in the
 * header, beside a Check details button. There was never a row-wide target for
 * this to compete with, so the list quietly kept plain text while the detail
 * linked, for no reason a seller could see.
 *
 * ## Why it opens a new tab
 *
 * The product page is the public storefront, a different origin. A seller
 * checking a listing mid-fulfilment should not lose the parcel they were
 * working on. `rel="noopener"` goes with it: `target="_blank"` alone hands the
 * opened page a live `window.opener` handle back into an authenticated portal
 * session.
 *
 * `storefrontUrl` is `null` when the product is not currently live, and then
 * this renders plain text. Offering a link the storefront would 404 is the
 * failure these screens have already removed twice.
 */
export default function ParcelLineTitle({
  line,
  className,
}: ParcelLineTitleProps) {
  if (line.storefrontUrl === null) {
    return <span className={className}>{line.title}</span>;
  }

  return (
    <a
      href={line.storefrontUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`${className} hover:text-primary hover:underline`}
    >
      {line.title}
    </a>
  );
}
