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
import { Switch } from '@/components/ui/switch';
import { IMAGE_UPLOAD_LIMITS_COPY } from '@/lib/products/image-upload-limits';
import type {
  MediaItemFixture,
  ProductEditorFixture,
} from '@/lib/seller-center/product-editor/types';
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

function supplierPhotoCaption(
  showSupplierPhoto: boolean,
  hasOwnPhotos: boolean,
): string {
  if (showSupplierPhoto && hasOwnPhotos) {
    return "Buyers see your photos and the supplier's photo together.";
  }

  if (showSupplierPhoto) {
    return "Buyers see the supplier's photo until you upload your own.";
  }

  if (hasOwnPhotos) {
    return "Buyers see only your photos — the supplier's is hidden.";
  }

  // The storefront's fallback, stated rather than implied: the switch only
  // starts hiding the supplier photo once there is a seller photo to show
  // instead, so "off" with an empty gallery never blanks the product page.
  return "Off with nothing uploaded yet — buyers still see the supplier's photo until you upload your own.";
}

function photoManagerCaption(hasOwnPhotos: boolean): string {
  if (hasOwnPhotos) return 'The star sets a photo as the storefront cover.';

  return "Shown from the supplier's own photo until you upload one — see Supplier Details for the original.";
}

type BasicInformationSectionProps = {
  fixture: ProductEditorFixture;
  /**
   * The live media list the workspace owns — not `fixture.media`, which is the
   * server-rendered snapshot and goes stale the moment an upload or delete
   * succeeds without a full refresh.
   */
  media: MediaItemFixture[];
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
  /** Whether the supplier's own photo shows to buyers alongside any of the seller's own uploads. */
  showSupplierPhoto: boolean;
  onToggleSupplierPhoto?: (next: boolean) => void;
  isTogglingSupplierPhoto?: boolean;
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
  media,
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
  showSupplierPhoto,
  onToggleSupplierPhoto,
  isTogglingSupplierPhoto = false,
  sals3CategoryOptions = [],
  onDecideSals3Category,
}: BasicInformationSectionProps) {
  const brandBlocker = fixture.issues.find(
    (issue) => issue.reasonCode === 'COUNTERFEIT_HIGH_CONFIDENCE',
  );

  const hasOwnPhotos = media.length > 0;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-semibold">Product media</h3>
          <span className="text-xs text-muted-foreground">
            {media.length} of {MAX_SELLER_PHOTOS} photos
          </span>
        </div>

        <div className="mt-2.5 flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2.5">
          <div className="flex flex-col gap-0.5">
            <Label
              htmlFor="toggle-show-supplier-photo"
              className="text-[13px] font-medium"
            >
              Show supplier photo
            </Label>
            <p className="text-xs text-muted-foreground">
              {supplierPhotoCaption(showSupplierPhoto, hasOwnPhotos)}
            </p>
          </div>
          <Switch
            id="toggle-show-supplier-photo"
            checked={showSupplierPhoto}
            disabled={
              onToggleSupplierPhoto === undefined || isTogglingSupplierPhoto
            }
            onCheckedChange={(next) => onToggleSupplierPhoto?.(next)}
            // Sals3 brand blues (same pair as `VariantPricingTable`'s listing
            // switch), as a gradient rather than solid — this is the one
            // control on the screen that decides whether a real supplier
            // photo reaches a buyer, so it earns a little more presence.
            className="data-checked:border-transparent data-checked:bg-transparent data-checked:bg-gradient-to-r data-checked:from-[#018CC9] data-checked:to-[#002B53] data-checked:shadow-[0_0_10px_-2px_rgba(1,140,201,0.55)] data-unchecked:bg-[#002B53]/20"
          />
        </div>

        <div className="mt-2.5">
          <ProductPhotoManager
            media={media}
            onUpload={onUploadPhoto}
            onDelete={onDeletePhoto}
            onMakeCover={onMakeCoverPhoto}
            isUploading={isUploadingPhoto}
            deletingId={deletingPhotoId}
            maxPhotos={MAX_SELLER_PHOTOS}
          />
        </div>

        <p className="mt-2 text-xs text-muted-foreground">
          {photoManagerCaption(hasOwnPhotos)} {IMAGE_UPLOAD_LIMITS_COPY} ·
          compressed automatically on upload.
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
