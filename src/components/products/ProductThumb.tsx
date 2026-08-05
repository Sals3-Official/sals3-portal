import Image from 'next/image';
import type { PlaceholderTone, ProductMedia } from '@/lib/products/types';

const TONE_GRADIENTS: Record<PlaceholderTone, string> = {
  ocean: 'linear-gradient(142deg, #9ad9e6 0%, #6aa9d4 46%, #4f7fc0 100%)',
  dusk: 'linear-gradient(142deg, #f3c6a0 0%, #e08a8a 46%, #b45f8e 100%)',
  meadow: 'linear-gradient(142deg, #bfe6b0 0%, #7fc199 46%, #3f8f7c 100%)',
  clay: 'linear-gradient(142deg, #f0d3a8 0%, #d9a05f 46%, #a86b3e 100%)',
};

type ProductThumbProps = {
  tone: PlaceholderTone;
  media: ProductMedia[];
  name: string;
  size?: number;
};

/**
 * Product thumbnail. When a real image exists it renders through `next/image`
 * with fixed dimensions and lazy loading, so the row never shifts. With no
 * image, a decorative gradient stands in - it carries no `<img>` and no alt
 * text, because the product name is already beside it.
 */
export default function ProductThumb({
  tone,
  media,
  name,
  size = 40,
}: ProductThumbProps) {
  const image = media.find((item) => item.kind === 'image');

  if (image !== undefined) {
    return (
      <Image
        src={image.url}
        alt={image.alt === '' ? name : image.alt}
        width={size}
        height={size}
        // No `sizes`: the box is a fixed pixel size, and passing `sizes` makes
        // Next build a srcset across every device width, so the fallback `src`
        // asks the optimizer for a full-width render of a thumbnail.
        loading="lazy"
        className="shrink-0 rounded-md border border-border object-cover"
      />
    );
  }

  return (
    <div
      aria-hidden="true"
      className="shrink-0 rounded-md border border-border"
      style={{
        width: size,
        height: size,
        background: TONE_GRADIENTS[tone],
      }}
    />
  );
}
