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
import type { ProductEditorFixture } from '@/lib/seller-center/product-editor/types';
import EditorStatusPill from './EditorStatusPill';
import SupplierEvidenceBlock, {
  SupplierEvidenceField,
} from './SupplierEvidenceBlock';
import {
  MEDIA_RIGHTS_PRESENTATION,
  SOURCE_PRODUCT_STATUS_PRESENTATION,
} from './presentation';

const PRODUCT_NAME_MAX = 120;

const CATEGORY_OPTIONS = [
  'Bags & Travel / Backpacks / Daypacks',
  'Bags & Travel / Backpacks / Hiking packs',
  'Outdoor / Hiking / Packs',
];

const BRAND_OPTIONS = [
  'No brand / generic',
  'Own brand — authorisation on file',
];

type BasicInformationSectionProps = {
  fixture: ProductEditorFixture;
  productName: string;
  onProductNameChange: (value: string) => void;
  sals3Category: string;
  onSals3CategoryChange: (value: string) => void;
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
  sals3Category,
  onSals3CategoryChange,
  sellerSku,
  onSellerSkuChange,
  brandDeclaration,
  onBrandDeclarationChange,
  onOpenSourceDrawer,
}: BasicInformationSectionProps) {
  const brandBlocker = fixture.issues.find(
    (issue) => issue.reasonCode === 'COUNTERFEIT_HIGH_CONFIDENCE',
  );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold">Product media</h3>
          <span className="text-xs text-muted-foreground">
            {fixture.media.length} images · minimum 3 · recommended 5
          </span>
        </div>
        <ul className="mt-2.5 grid list-none grid-cols-[repeat(auto-fill,minmax(6rem,1fr))] gap-2.5 p-0">
          {fixture.media.map((item) => (
            <li key={item.id} className="flex flex-col gap-1.5">
              <span
                aria-hidden="true"
                className={`flex aspect-square items-center justify-center rounded-md border text-center font-mono text-[10px] text-muted-foreground ${
                  item.rightsCheck === 'REJECTED'
                    ? 'border-2 border-red-600'
                    : 'border-border'
                } bg-muted`}
              >
                {item.isCover ? 'cover' : 'image'}
              </span>
              <EditorStatusPill
                presentation={MEDIA_RIGHTS_PRESENTATION[item.rightsCheck]}
              />
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          The first image is the storefront cover. Full media management,
          including video, is in the Media section below.
        </p>
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
          <Label htmlFor="editor-category">Sals3 category</Label>
          <Select
            value={sals3Category}
            onValueChange={(value) => onSals3CategoryChange(value ?? '')}
          >
            <SelectTrigger id="editor-category" className="w-full bg-card">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORY_OPTIONS.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            Mapped from the supplier category. Changing it may change which
            specifications are required.
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

      <SupplierEvidenceBlock>
        <div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2">
          <SupplierEvidenceField
            label="Supplier product ID"
            value={fixture.source.externalProductId}
            mono
          />
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-semibold text-ink-muted">
              Supplier status
            </span>
            <span className="min-h-9 rounded-lg border border-dashed border-border-strong bg-background px-2.5 py-2">
              <EditorStatusPill
                presentation={
                  SOURCE_PRODUCT_STATUS_PRESENTATION[
                    fixture.sourceProductStatus
                  ]
                }
              />
            </span>
          </div>
          <SupplierEvidenceField
            label="Source currency"
            value={fixture.source.sourceCurrency}
          />
          <SupplierEvidenceField
            label="Original supplier product name"
            value={fixture.supplierProductName}
          />
          <SupplierEvidenceField
            label="Original supplier category"
            value={fixture.supplierCategoryPath}
          />
          <SupplierEvidenceField
            label="Source updated"
            value={
              fixture.source.lastSuccessfulSyncAt === null
                ? 'Never synced successfully'
                : formatDateTime(fixture.source.lastSuccessfulSyncAt)
            }
          />
          <div className="flex items-end">
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={onOpenSourceDrawer}
            >
              Open Supplier Source Details
            </Button>
          </div>
        </div>
      </SupplierEvidenceBlock>
    </div>
  );
}
