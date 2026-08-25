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
 * the revision the screen is writing to lives after the first save.
 *
 * Both halves of that matter. The *version* moves on every save, so holding it
 * here means a second save compare-and-sets against what actually exists
 * rather than against the version the page rendered with — otherwise every
 * save after the first would report a conflict with itself. The *id* moves
 * too, but only once and only on a published product: the first save forks a
 * new draft off the published revision, because a settled revision is never
 * rewritten in place. A screen that kept the id from its props would name the
 * settled revision again on the next save and be refused — the same
 * conflict-with-itself, one level up.
 */

type DescriptionStudioClientProps = {
  productName: string;
  productId: string;
  revisionId: string;
  expectedRevisionVersion: number;
  backHref: string;
  initialBlocks: DescriptionBlock[];
  /**
   * The revision buyers are served, when this product is live. `null` for a
   * product that has never been published, which has nothing pending.
   */
  publishedRevision: { id: string; isCurrent: boolean } | null;
};

export default function DescriptionStudioClient({
  productName,
  productId,
  revisionId,
  expectedRevisionVersion,
  backHref,
  initialBlocks,
  publishedRevision,
}: DescriptionStudioClientProps) {
  const [currentRevisionId, setCurrentRevisionId] = useState(revisionId);
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
          revisionId: currentRevisionId,
          expectedRevisionVersion: revisionVersion,
          descriptionDocument,
        });

        if (!result.ok) return { ok: false, message: result.message };

        setCurrentRevisionId(result.revisionId);
        setRevisionVersion(result.revisionVersion);

        return {
          ok: true,
          revisionVersion: result.revisionVersion,
          // On a live product the save landed on a draft, and the storefront
          // is still serving the published revision. A bare "Description
          // saved." would be true and still leave the seller expecting a
          // change on their listing that is not there.
          message:
            publishedRevision === null
              ? undefined
              : 'Description saved to a new draft. Your storefront still shows the published version until you press Publish Update.',
        };
      }}
    />
  );
}
