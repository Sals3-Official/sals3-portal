'use client';

import { useState } from 'react';
import { SEO_DESCRIPTION_MAX, SEO_TITLE_MAX } from '@/lib/products/constants';
import type { Product } from '@/lib/products/types';
import TextField from './TextField';
import TextareaField from './TextareaField';

type SeoTabProps = {
  product: Product | null;
  fieldErrors: Record<string, string[]>;
};

/**
 * Search settings. The counters are live, so a writer sees the limit before
 * submitting instead of after. This is a client component only for the two
 * counters; every other tab stays server-rendered.
 */
function readLength(event: React.FormEvent<HTMLDivElement>): number {
  const { target } = event;

  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    return target.value.length;
  }

  return 0;
}

export default function SeoTab({ product, fieldErrors }: SeoTabProps) {
  const seo = product?.seo;
  const [titleLength, setTitleLength] = useState(seo?.pageTitle.length ?? 0);
  const [descriptionLength, setDescriptionLength] = useState(
    seo?.metaDescription.length ?? 0,
  );

  return (
    <div className="flex flex-col gap-4">
      <div onInput={(event) => setTitleLength(readLength(event))}>
        <TextField
          name="seoTitle"
          label="Page title"
          required
          defaultValue={seo?.pageTitle}
          hint={`${titleLength} of ${SEO_TITLE_MAX} characters used.`}
          errors={fieldErrors.seoTitle}
        />
      </div>
      <div onInput={(event) => setDescriptionLength(readLength(event))}>
        <TextareaField
          name="seoDescription"
          label="Meta description"
          required
          rows={3}
          maxLength={SEO_DESCRIPTION_MAX}
          defaultValue={seo?.metaDescription}
          hint={`${descriptionLength} of ${SEO_DESCRIPTION_MAX} characters used.`}
          errors={fieldErrors.seoDescription}
        />
      </div>
      <TextField
        name="slug"
        label="Product web address"
        required
        defaultValue={seo?.slug}
        hint="Lowercase letters, numbers, and dashes. Example: quiet-tower-air-cooler."
        errors={fieldErrors.slug}
      />
    </div>
  );
}
