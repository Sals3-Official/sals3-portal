'use client';

import { useState } from 'react';
import saveDescriptionAction from '@/app/(portal)/listings/description-actions';
import uploadDescriptionImageAction from '@/app/(portal)/listings/description-image-actions';
import type { DescriptionBlock } from '@/lib/products/description-blocks';
import DescriptionStudio from './DescriptionStudio';

/**
 * Binds the studio to its two Server Actions.
 *
 * Split from `DescriptionStudio` so that component takes plain callbacks and
 * stays testable without mocking a server action or a router. It is also where
 * the revision version lives after the first save: the server returns the new
 * version, and holding it here means a second save from the same open screen
 * compare-and-sets against what actually exists rather than against the version
 * the page rendered with — otherwise every save after the first would report a
 * conflict with itself.
 */

type DescriptionStudioClientProps = {
  productName: string;
  productId: string;
  revisionId: string;
  expectedRevisionVersion: number;
  backHref: string;
  initialBlocks: DescriptionBlock[];
};

export default function DescriptionStudioClient({
  productName,
  productId,
  revisionId,
  expectedRevisionVersion,
  backHref,
  initialBlocks,
}: DescriptionStudioClientProps) {
  const [revisionVersion, setRevisionVersion] = useState(
    expectedRevisionVersion,
  );

  return (
    <DescriptionStudio
      productName={productName}
      backHref={backHref}
      initialBlocks={initialBlocks}
      uploadImage={async (file) => {
        const formData = new FormData();

        formData.set('productId', productId);
        formData.set('file', file);

        const result = await uploadDescriptionImageAction(formData);

        return result.ok
          ? { ok: true, url: result.url }
          : { ok: false, message: result.message };
      }}
      onSave={async ({ descriptionDocument }) => {
        const result = await saveDescriptionAction({
          productId,
          revisionId,
          expectedRevisionVersion: revisionVersion,
          descriptionDocument,
        });

        if (!result.ok) return { ok: false, message: result.message };

        setRevisionVersion(result.revisionVersion);

        return { ok: true, revisionVersion: result.revisionVersion };
      }}
    />
  );
}
