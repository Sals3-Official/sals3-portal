import { FlaskConical } from 'lucide-react';
import assignVariantMediaAction from '@/app/(portal)/listings/variant-media-actions';
import saveCategoryAttributesAction from '@/app/(portal)/listings/category-attributes-actions';
import { decideCategoryMappingAction } from '@/app/(portal)/listings/category-mapping-actions';
import {
  deleteSellerMediaAction,
  reorderProductMediaAction,
  uploadSellerMediaAction,
} from '@/app/(portal)/listings/media-actions';
import saveDescriptionAction from '@/app/(portal)/listings/description-actions';
import saveMetaDescriptionAction from '@/app/(portal)/listings/meta-description-actions';
import saveShowSupplierPhotoAction from '@/app/(portal)/listings/show-supplier-photo-actions';
import saveOptionMappingAction, {
  recoverSupplierLabelsAction,
  renameOptionMappingAction,
  saveManualOptionMappingAction,
  remapOptionMappingAction,
  restoreOptionMappingAction,
  unmapOptionMappingAction,
} from '@/app/(portal)/listings/option-mapping-actions';
import uploadDescriptionImageAction from '@/app/(portal)/listings/description-image-actions';
import {
  discardProductDraftAction,
  saveProductDraftAction,
} from '@/app/(portal)/listings/product-draft-actions';
import { publishProductAction } from '@/app/(portal)/listings/publish-actions';
import { sectionSeverity } from '@/lib/seller-center/product-editor/derive';
import type {
  EditorLifecycle,
  ProductEditorFixture,
  VariantPricingGuidance,
} from '@/lib/seller-center/product-editor/types';
import EditorSectionCard from './EditorSectionCard';
import MarketShippingEvidence from './MarketShippingEvidence';
import ProductEditorWorkspace from './ProductEditorWorkspace';

type ProductEditorProps = {
  fixture: ProductEditorFixture;
  initialLifecycle: EditorLifecycle;
  dataMode?: 'fixture' | 'database';
  /** The full Sals3 Taxonomy v1 tree, for the category picker's search. */
  sals3CategoryOptions?: { code: string; path: string }[];
  /**
   * What this account's margin rules say each variant should sell for.
   * Empty in fixture mode: a fictional product has no rule to resolve.
   */
  variantGuidance?: VariantPricingGuidance[];
};

/**
 * Server entry point for the Product Editor.
 *
 * Markets is pure evidence with no client state, so it is
 * rendered here and handed to the interactive shell as a slot - it stays
 * out of the client bundle while the shell still controls where it sits.
 * Media is not treated the same way: ordering and cover selection are real
 * local interactions, so that section lives inside the client shell.
 *
 * The development notice is not decoration. This screen renders a
 * fictional product at a real route, and a seller landing on it must be
 * able to tell that in one line before they start typing.
 */
export default function ProductEditor({
  fixture,
  initialLifecycle,
  dataMode = 'fixture',
  sals3CategoryOptions = [],
  variantGuidance = [],
}: ProductEditorProps) {
  const isDatabaseBacked = dataMode === 'database';

  return (
    <div className="flex flex-col gap-4">
      <p
        role="status"
        className="flex items-start gap-2 rounded-lg border border-primary/20 bg-accent px-3 py-2 text-sm text-brand-900"
      >
        <FlaskConical
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-primary"
        />
        <span>
          {isDatabaseBacked
            ? 'Loaded from the Sals3 catalogue database. Editor changes are not saved yet.'
            : 'UI preview using fictional product data. Changes are not saved.'}
          <span className="block text-xs text-ink-muted">
            Scenario: {fixture.scenarioLabel}
          </span>
        </span>
      </p>

      <ProductEditorWorkspace
        fixture={fixture}
        initialLifecycle={initialLifecycle}
        variantGuidance={variantGuidance}
        marketsSection={
          <EditorSectionCard
            id="markets"
            title="Markets"
            severity={sectionSeverity(fixture.issues, 'markets')}
          >
            <MarketShippingEvidence
              markets={fixture.markets}
              marketsNotEnabledCount={fixture.marketsNotEnabledCount}
            />
          </EditorSectionCard>
        }
        saveDraftAction={isDatabaseBacked ? saveProductDraftAction : undefined}
        discardDraftAction={
          isDatabaseBacked ? discardProductDraftAction : undefined
        }
        saveDescriptionAction={
          isDatabaseBacked ? saveDescriptionAction : undefined
        }
        uploadDescriptionImageAction={
          isDatabaseBacked ? uploadDescriptionImageAction : undefined
        }
        renameOptionMappingAction={
          isDatabaseBacked ? renameOptionMappingAction : undefined
        }
        publishAction={isDatabaseBacked ? publishProductAction : undefined}
        optionMappingAction={
          isDatabaseBacked ? saveOptionMappingAction : undefined
        }
        manualOptionMappingAction={
          isDatabaseBacked ? saveManualOptionMappingAction : undefined
        }
        unmapOptionMappingAction={
          isDatabaseBacked ? unmapOptionMappingAction : undefined
        }
        remapOptionMappingAction={
          isDatabaseBacked ? remapOptionMappingAction : undefined
        }
        restoreOptionMappingAction={
          isDatabaseBacked ? restoreOptionMappingAction : undefined
        }
        recoverLabelsAction={
          isDatabaseBacked ? recoverSupplierLabelsAction : undefined
        }
        sals3CategoryOptions={sals3CategoryOptions}
        decideCategoryAction={
          isDatabaseBacked ? decideCategoryMappingAction : undefined
        }
        uploadMediaAction={
          isDatabaseBacked ? uploadSellerMediaAction : undefined
        }
        deleteMediaAction={
          isDatabaseBacked ? deleteSellerMediaAction : undefined
        }
        reorderMediaAction={
          isDatabaseBacked ? reorderProductMediaAction : undefined
        }
        assignVariantMediaAction={
          isDatabaseBacked ? assignVariantMediaAction : undefined
        }
        saveCategoryAttributesAction={
          isDatabaseBacked ? saveCategoryAttributesAction : undefined
        }
        saveMetaDescriptionAction={
          isDatabaseBacked ? saveMetaDescriptionAction : undefined
        }
        saveShowSupplierPhotoAction={
          isDatabaseBacked ? saveShowSupplierPhotoAction : undefined
        }
      />
    </div>
  );
}
