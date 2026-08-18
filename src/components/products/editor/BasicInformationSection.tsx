import { OctagonAlert } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ProductEditorFixture } from '@/lib/seller-center/product-editor/types';
import ProductPhotoManager from './ProductPhotoManager';
import Sals3CategoryPicker, {
  type Sals3CategoryOption,
} from './Sals3CategoryPicker';

const PRODUCT_NAME_MAX = 120;
const MAX_SELLER_PHOTOS = 12;

const BRAND_OPTIONS = [
  'No brand / generic',
  'Own brand — authorisation on file',
];

type BasicInformationSectionProps = {
  fixture: ProductEditorFixture;
  productName: string;
  onProductNameChange: (value: string) => void;
  sellerSku: string;
  onSellerSkuChange: (value: string) => void;
  brandDeclaration: string;
  onBrandDeclarationChange: (value: string) => void;
  onUploadPhoto?: (files: FileList) => void;
  onDeletePhoto?: (id: string) => void;
  onMakeCoverPhoto: (id: string) => void;
  isUploadingPhoto: boolean;
  deletingPhotoId: string | null;
  sals3CategoryOptions?: Sals3CategoryOption[];
  onDecideSals3Category?: (
    code: string,
  ) => Promise<
    { ok: true; categoryPath: string } | { ok: false; message: string }
  >;
};

/**
 * The prefilled listing essentials the seller can actually change here:
 * photos, name, category, seller SKU, and brand declaration. The supplier
 * evidence they were derived from lives in the "Supplier Details" section
 * further down instead, alongside the rest of the read-only supplier facts.
 * "Product Name" is the seller-facing term throughout - the internal field
 * name is never surfaced.
 */
export default function BasicInformationSection({
  fixture,
  productName,
  onProductNameChange,
  sellerSku,
  onSellerSkuChange,
  brandDeclaration,
  onBrandDeclarationChange,
  onUploadPhoto,
  onDeletePhoto,
  onMakeCoverPhoto,
  isUploadingPhoto,
  deletingPhotoId,
  sals3CategoryOptions = [],
  onDecideSals3Category,
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
            {fixture.media.length} of {MAX_SELLER_PHOTOS} photos
          </span>
        </div>

        <div className="mt-2.5">
          <ProductPhotoManager
            media={fixture.media}
            onUpload={onUploadPhoto}
            onDelete={onDeletePhoto}
            onMakeCover={onMakeCoverPhoto}
            isUploading={isUploadingPhoto}
            deletingId={deletingPhotoId}
            maxPhotos={MAX_SELLER_PHOTOS}
          />
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          {fixture.media.length > 0
            ? 'The star sets a photo as the storefront cover.'
            : "Shown from the supplier's own photo until you upload one — see Supplier Details for the original."}{' '}
          Max 2000 × 2000 px · JPG, PNG, or WebP, up to 5 MB each · compressed
          automatically on upload.
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

        {onDecideSals3Category === undefined ? null : (
          <Sals3CategoryPicker
            options={sals3CategoryOptions}
            currentPath={fixture.sals3CategoryPath}
            declaredBySeller={fixture.sals3CategoryDeclaredBySeller}
            onSave={onDecideSals3Category}
          />
        )}

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
    </div>
  );
}
