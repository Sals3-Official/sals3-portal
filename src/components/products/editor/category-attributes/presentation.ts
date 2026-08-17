import type { SpecificationRequirement } from '@/lib/seller-center/product-editor/types';

/** Same grouping convention as `SpecificationsSection.tsx`'s `GROUP_TITLES`/`GROUP_ORDER`. */
export const CATEGORY_ATTRIBUTE_GROUP_TITLES: Record<
  SpecificationRequirement,
  string
> = {
  REQUIRED: 'Required specifications',
  RECOMMENDED: 'Recommended specifications',
  OPTIONAL: 'Optional specifications',
};

export const CATEGORY_ATTRIBUTE_GROUP_ORDER: SpecificationRequirement[] = [
  'REQUIRED',
  'RECOMMENDED',
  'OPTIONAL',
];

/** Same severity-by-requirement copy convention as `SpecificationsSection.tsx`'s `UNRESOLVED_COPY`. */
export const CATEGORY_ATTRIBUTE_UNRESOLVED_COPY: Record<
  SpecificationRequirement,
  string
> = {
  REQUIRED:
    'Publication requires this. It is a hard blocker until a value is entered.',
  RECOMMENDED:
    'Recommended for this category. Publishing is not blocked, but buyers may see this attribute blank.',
  OPTIONAL: 'Optional. Nothing is blocked and nothing is missing.',
};
