const FILLED = 'text-amber-600';
const EMPTY = 'text-border-strong';

const SIZES = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-[1.0625rem]',
} as const;

type StarRatingProps = {
  /** 1-5. Values outside the range render as no stars rather than clamping. */
  rating: number;
  size?: keyof typeof SIZES;
  /**
   * The accessible name. Required, because a row of five identical glyphs is
   * meaningless to a screen reader and "5 stars" is the only thing that carries
   * the information a sighted reader gets from the fill.
   */
  label: string;
};

/**
 * Five stars, filled to `rating`.
 *
 * `--color-amber-600` (`#9a6200`) rather than a marketplace orange: it is an
 * existing portal token, it clears 4.5:1 on both `--card` and `--background`,
 * and it is deliberately not the colour of the screenshot this screen was
 * modelled on.
 *
 * The stars are `aria-hidden` and the label carries the value, so colour is
 * never the only signal — the same rule `StatusPill` follows.
 */
export default function StarRating({
  rating,
  size = 'md',
  label,
}: StarRatingProps) {
  const filled =
    Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : 0;

  return (
    <span className="inline-flex items-center gap-0.5">
      <span className="sr-only">{label}</span>
      {[1, 2, 3, 4, 5].map((position) => (
        <svg
          key={position}
          viewBox="0 0 16 16"
          aria-hidden="true"
          className={`${SIZES[size]} ${position <= filled ? FILLED : EMPTY}`}
          fill="currentColor"
        >
          <path d="M8 1.6l1.9 3.9 4.3.6-3.1 3 .8 4.3L8 11.4l-3.9 2 .8-4.3-3.1-3 4.3-.6z" />
        </svg>
      ))}
    </span>
  );
}
