import type { ParcelLine } from '@/modules/orders/contracts';

type ParcelLineTitleProps = {
  line: ParcelLine;
  /**
   * Size and weight only — never a colour.
   *
   * The two surfaces differ in typography (13px medium on the list, 14px
   * semibold on the detail) and agree on everything else, so the caller owns
   * the part that differs and this component owns the part that must not.
   *
   * Colour is excluded deliberately rather than by convention. Passing
   * `text-ink` alongside this component's `text-primary` puts two `color`
   * utilities of equal specificity on one element, and Tailwind resolves that
   * by stylesheet order, not by the order they appear in the class attribute —
   * so the link colour would apply or not depending on which utility Tailwind
   * happened to emit last. Keeping colour out of the caller removes the race
   * instead of betting on it.
   */
  typographyClassName: string;
};

/**
 * An ordered item's name, linked to its product page when there is one.
 *
 * One component for both order surfaces, because this is one rule. It first
 * shipped on the detail card alone, on the reasoning that "the list card's
 * whole row is already a link to the parcel" — which was simply wrong. The
 * list card is an `<article>`; its only link is the order reference in the
 * header, beside a View parcel button. There was never a row-wide target for
 * this to compete with, so the list quietly kept plain text while the detail
 * linked, for no reason a seller could see.
 *
 * ## Why it looks like a link rather than revealing itself on hover
 *
 * The house style for an in-card link here is dark text that underlines when
 * pointed at. Applied to an item name it read as a plain label — the owner
 * could not tell it was clickable, which is the one thing an affordance has to
 * do. A seller scanning a parcel should see the way through to the listing
 * without hunting for it, so the link carries the primary colour and a
 * standing underline.
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
  typographyClassName,
}: ParcelLineTitleProps) {
  if (line.storefrontUrl === null) {
    return (
      <span className={`${typographyClassName} text-ink`}>{line.title}</span>
    );
  }

  return (
    <a
      href={line.storefrontUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={`${typographyClassName} text-primary underline underline-offset-2 hover:no-underline`}
    >
      {line.title}
    </a>
  );
}
