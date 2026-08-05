'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Product, ProductMedia } from '@/lib/products/types';

type MediaTabProps = {
  product: Product | null;
  fieldErrors: Record<string, string[]>;
};

/**
 * Images and videos are referenced by web address, not uploaded.
 *
 * This repository has no file storage, no upload endpoint, and no image
 * scanning, so accepting a real upload would mean shipping an unvalidated file
 * path - see rule 30 and 31 of the code rules. Addresses are stored instead,
 * and `next/config.ts` must allow-list a host before an image renders. Replace
 * this tab with a real uploader when storage exists.
 */
export default function MediaTab({ product, fieldErrors }: MediaTabProps) {
  const [items, setItems] = useState<ProductMedia[]>(product?.media ?? []);

  function update(id: string, patch: Partial<ProductMedia>) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function addItem(kind: ProductMedia['kind']) {
    setItems((current) => [
      ...current,
      { id: `media-${current.length + 1}`, kind, url: '', alt: '' },
    ]);
  }

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name="media" value={JSON.stringify(items)} />

      <p className="rounded-md border border-border bg-muted px-3 py-2 text-sm text-ink-muted">
        File upload is not built yet. Paste the web address of an image or a
        video. An image only appears after its host is allow-listed in the
        Next.js image settings.
      </p>

      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No images or videos yet.
        </p>
      ) : null}

      {items.map((item, index) => (
        <div
          key={item.id}
          className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-[1fr_1fr_auto]"
        >
          <Input
            aria-label={`Web address for ${item.kind} ${index + 1}`}
            type="url"
            value={item.url}
            placeholder="https://"
            onChange={(event) => update(item.id, { url: event.target.value })}
            className="bg-card"
          />
          <Input
            aria-label={`Image text for ${item.kind} ${index + 1}`}
            value={item.alt}
            placeholder="Describe the picture for screen readers"
            onChange={(event) => update(item.id, { alt: event.target.value })}
            className="bg-card"
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label={`Remove ${item.kind} ${index + 1}`}
            onClick={() =>
              setItems((current) =>
                current.filter((entry) => entry.id !== item.id),
              )
            }
            className="cursor-pointer"
          >
            <Trash2 aria-hidden="true" />
          </Button>
        </div>
      ))}

      {fieldErrors.media === undefined ? null : (
        <p className="text-xs font-medium text-destructive">
          {fieldErrors.media[0]}
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => addItem('image')}
          className="cursor-pointer"
        >
          <Plus aria-hidden="true" />
          Add image address
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => addItem('video')}
          className="cursor-pointer"
        >
          <Plus aria-hidden="true" />
          Add video address
        </Button>
      </div>
    </div>
  );
}
