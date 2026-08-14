import Image from 'next/image';
import { OctagonAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatDateTime } from '@/lib/seller-center/product-editor/format';
import { SALS3_CATEGORY_L1_OPTIONS } from '@/lib/seller-center/product-editor/sals3-category-l1';
import type { ProductEditorFixture } from '@/lib/seller-center/product-editor/types';
import SupplierEvidenceBlock, {
  SupplierEvidenceField,
} from './SupplierEvidenceBlock';
import SupplierSourceBadge from './SupplierSourceBadge';

const PRODUCT_NAME_MAX = 120;

const BRAND_OPTIONS = [
  'No brand / generic',
  'Own brand — authorisation on file',
];

type BasicInformationSectionProps = {
  fixture: ProductEditorFixture;
  productName: string;
  onProductNameChange: (value: string) => void;
  sals3CategoryL1: string;
  onSals3CategoryL1Change: (value: string) => void;
  sellerSku: string;
  onSellerSkuChange: (value: string) => void;
  brandDeclaration: string;
  onBrandDeclarationChange: (value: string) => void;
  onOpenSourceDrawer: () => void;
};

/**
 * The prefilled listing essentials, plus the supplier evidence they were
 * derived from.
 *
 * The split is the point of the whole screen: everything above the grey
 * block is the seller's to change and everything inside it is the
 * supplier's, shown as-is. "Product Name" is the seller-facing term
 * throughout - the internal field name is never surfaced.
 */
export default function BasicInformationSection({
  fixture,
  productName,
  onProductNameChange,
  sals3CategoryL1,
  onSals3CategoryL1Change,
  sellerSku,
  onSellerSkuChange,
  brandDeclaration,
  onBrandDeclarationChange,
  onOpenSourceDrawer,
}: BasicInformationSectionProps) {
  const brandBlocker = fixture.issues.find(
    (issue) => issue.reasonCode === 'COUNTERFEIT_HIGH_CONFIDENCE',
  );

  const rejectedMediaCount = fixture.media.filter(
    (item) => item.rightsCheck === 'REJECTED',
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold">Product media</h3>
          <span className="text-xs text-muted-foreground">
            {fixture.media.length} images · minimum 3 · recommended 5
          </span>
        </div>

        {/* A summary only - each image's rights check and storage state are
            full detail that belongs in the Media section, not repeated here
            as a second copy that could drift from it.

            The thumbnails carry the real address when there is one. They used
            to be empty 44px squares in every case, so a product whose photo the
            catalogue genuinely stored still showed nothing above this section. */}
        <ul className="mt-2.5 flex list-none flex-wrap gap-1.5 p-0">
          {fixture.media.map((item) => (
            <li
              key={item.id}
              className={`relative flex size-11 items-center justify-center overflow-hidden rounded-md border text-center text-xs font-medium text-muted-foreground ${
                item.rightsCheck === 'REJECTED'
                  ? 'border-2 border-red-600 bg-danger-surface/40'
                  : 'border-border bg-muted'
              }`}
            >
              {item.sourceUrl === null ? (
                <span aria-hidden="true">{item.isCover ? 'Cover' : ''}</span>
              ) : (
                <Image
                  src={item.sourceUrl}
                  alt={item.altText}
                  width={44}
                  height={44}
                  loading="lazy"
                  className="size-full object-cover"
                />
              )}
            </li>
          ))}
        </ul>

        {fixture.media.length === 0 ? (
          <p className="mt-2 text-xs text-muted-foreground">
            No image address is recorded for this product yet, so there is
            nothing to show. Nothing was fetched from the supplier to fill this
            in.
          </p>
        ) : null}

        {rejectedMediaCount > 0 ? (
          <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-red-600">
            <OctagonAlert aria-hidden="true" className="size-3.5 shrink-0" />
            {rejectedMediaCount} image{rejectedMediaCount === 1 ? '' : 's'} need
            attention — see Media section.
          </p>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            The first image is the storefront cover. Full media management,
            including video, is in the Media section below.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 @2xl:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="editor-product-name">Product Name</Label>
          <Input
            id="editor-product-name"
            value={productName}
            maxLength={PRODUCT_NAME_MAX}
            aria-describedby="editor-product-name-help"
            onChange={(event) => onProductNameChange(event.target.value)}
          />
          <p
            id="editor-product-name-help"
            className="flex justify-between gap-2 text-xs text-muted-foreground"
          >
            <span>Shown to customers. Editable.</span>
            <span className="tabular-nums">
              {productName.length}/{PRODUCT_NAME_MAX}
            </span>
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="editor-sals3-category">Sals3 Category</Label>
          <Select
            value={sals3CategoryL1}
            onValueChange={(value) => onSals3CategoryL1Change(value ?? '')}
          >
            <SelectTrigger
              id="editor-sals3-category"
              className="w-full bg-card"
            >
              <SelectValue placeholder="Choose a Sals3 category" />
            </SelectTrigger>
            <SelectContent>
              {SALS3_CATEGORY_L1_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Draft L1 category shown in Sals3. Leaf category, pricing, and
            publication mapping stay unchanged.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="editor-seller-sku">Seller SKU (optional)</Label>
          <Input
            id="editor-seller-sku"
            value={sellerSku}
            onChange={(event) => onSellerSkuChange(event.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Internal only. Never shown to customers.
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="editor-brand">Brand declaration</Label>
          <Select
            value={brandDeclaration}
            onValueChange={(value) => onBrandDeclarationChange(value ?? '')}
          >
            <SelectTrigger
              id="editor-brand"
              className="w-full bg-card"
              aria-invalid={brandBlocker === undefined ? undefined : true}
              aria-describedby={
                brandBlocker === undefined ? undefined : 'editor-brand-error'
              }
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BRAND_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {brandBlocker === undefined ? (
            <p className="text-xs text-muted-foreground">
              Declaring a brand you cannot evidence is a policy breach and
              blocks publication.
            </p>
          ) : (
            <p
              id="editor-brand-error"
              role="alert"
              className="flex gap-1.5 text-xs text-red-600"
            >
              <OctagonAlert
                aria-hidden="true"
                className="mt-0.5 size-3.5 shrink-0"
              />
              {brandBlocker.explanation} This blocker cannot be cleared from
              this screen.
            </p>
          )}
        </div>
      </div>

      {/* Compact by design: this is a source summary, not the evidence
          itself. Supplier status, source currency and the original
          supplier product name still exist - they are one click away in
          the drawer - rather than competing here with the fields the
          seller actually edits above. */}
      <SupplierEvidenceBlock>
        <div className="flex flex-col gap-3">
          <SupplierSourceBadge source={fixture.source} />

          <div className="grid grid-cols-1 gap-3 @lg:grid-cols-3">
            <SupplierEvidenceField
              label="Supplier product ID"
              value={fixture.source.externalProductId}
              mono
            />
            <SupplierEvidenceField
              label="Original category"
              value={fixture.supplierCategoryPath}
            />
            <SupplierEvidenceField
              label="Last updated"
              value={
                fixture.source.lastSuccessfulSyncAt === null
                  ? 'Never synced successfully'
                  : formatDateTime(fixture.source.lastSuccessfulSyncAt)
              }
            />
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={onOpenSourceDrawer}
          >
            View Supplier Source Details
          </Button>
        </div>
      </SupplierEvidenceBlock>
    </div>
  );
}
