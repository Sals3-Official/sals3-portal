'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  createProductAction,
  updateProductAction,
} from '@/app/(portal)/products/form-actions';
import { IDLE_RESULT } from '@/lib/portal/action-result';
import type { Product } from '@/lib/products/types';
import DetailsTab from './DetailsTab';
import InventoryTab from './InventoryTab';
import MediaTab from './MediaTab';
import PricingTab from './PricingTab';
import SeoTab from './SeoTab';
import ShippingTab from './ShippingTab';
import VariantsTab from './VariantsTab';
import VisibilityTab from './VisibilityTab';

type ProductFormProps = {
  product: Product | null;
};

const TABS = [
  { value: 'details', label: 'Details' },
  { value: 'media', label: 'Media' },
  { value: 'variants', label: 'Variants' },
  { value: 'pricing', label: 'Pricing' },
  { value: 'inventory', label: 'SKU and barcode' },
  { value: 'shipping', label: 'Shipping' },
  { value: 'visibility', label: 'Visibility' },
  { value: 'seo', label: 'Search settings' },
] as const;

/**
 * Add and edit form. One form element wraps every tab, so a hidden tab still
 * submits its fields. Long input is split across tabs instead of one long page,
 * and the save bar reports the result of the submission.
 */
export default function ProductForm({ product }: ProductFormProps) {
  const editing = product !== null;
  const [result, submit, pending] = useActionState(
    editing ? updateProductAction : createProductAction,
    IDLE_RESULT,
  );
  const errors = result.fieldErrors;
  const saveLabel = editing ? 'Save changes' : 'Save as draft';

  return (
    <form action={submit} className="flex flex-col gap-4">
      {editing ? (
        <input type="hidden" name="productId" value={product.id} />
      ) : null}

      <Tabs defaultValue="details">
        <TabsList className="flex-wrap">
          {TABS.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="cursor-pointer"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="rounded-lg border border-border bg-card p-4">
          <TabsContent value="details">
            <DetailsTab product={product} fieldErrors={errors} />
          </TabsContent>
          <TabsContent value="media">
            <MediaTab product={product} fieldErrors={errors} />
          </TabsContent>
          <TabsContent value="variants">
            <VariantsTab product={product} fieldErrors={errors} />
          </TabsContent>
          <TabsContent value="pricing">
            <PricingTab product={product} fieldErrors={errors} />
          </TabsContent>
          <TabsContent value="inventory">
            <InventoryTab product={product} fieldErrors={errors} />
          </TabsContent>
          <TabsContent value="shipping">
            <ShippingTab product={product} fieldErrors={errors} />
          </TabsContent>
          <TabsContent value="visibility">
            <VisibilityTab product={product} fieldErrors={errors} />
          </TabsContent>
          <TabsContent value="seo">
            <SeoTab product={product} fieldErrors={errors} />
          </TabsContent>
        </div>
      </Tabs>

      <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 py-3 backdrop-blur">
        <Button type="submit" disabled={pending} className="cursor-pointer">
          {pending ? 'Saving…' : saveLabel}
        </Button>
        <p
          aria-live="polite"
          className={`text-sm ${
            result.status === 'error'
              ? 'font-medium text-destructive'
              : 'text-muted-foreground'
          }`}
        >
          {result.status === 'error' && result.message === ''
            ? 'Check the highlighted fields and try again.'
            : result.message}
        </p>
      </div>
    </form>
  );
}
