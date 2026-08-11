import { FlaskConical } from 'lucide-react';
import { sectionSeverity } from '@/lib/seller-center/product-editor/derive';
import type {
  EditorLifecycle,
  ProductEditorFixture,
  VariantPricingGuidance,
} from '@/lib/seller-center/product-editor/types';
import EditorSectionCard from './EditorSectionCard';
import MarketShippingEvidence from './MarketShippingEvidence';
import PricingBasisPanel from './PricingBasisPanel';
import ProductEditorWorkspace from './ProductEditorWorkspace';

type ProductEditorProps = {
  fixture: ProductEditorFixture;
  initialLifecycle: EditorLifecycle;
  /** Server-resolved price guidance, one entry per variant — see `page.tsx`. */
  variantGuidance: VariantPricingGuidance[];
};

/**
 * Server entry point for the Product Editor.
 *
 * Markets & Shipping is pure evidence with no client state, so it is
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
  variantGuidance,
}: ProductEditorProps) {
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
          UI preview using fictional product data. Changes are not saved.
          <span className="block text-xs text-ink-muted">
            Scenario: {fixture.scenarioLabel}
          </span>
        </span>
      </p>

      <ProductEditorWorkspace
        fixture={fixture}
        initialLifecycle={initialLifecycle}
        pricingBasisSection={
          <PricingBasisPanel
            categoryPath={fixture.sals3CategoryPath}
            categoryCode={fixture.sals3CategoryCode}
            categoryMappingConfidence={fixture.categoryMappingConfidence}
            variantGuidance={variantGuidance}
            overridesAvailable={fixture.realSupplierCandidateId !== null}
          />
        }
        marketsSection={
          <EditorSectionCard
            id="markets"
            title="Markets & Shipping"
            severity={sectionSeverity(fixture.issues, 'markets')}
          >
            <MarketShippingEvidence
              markets={fixture.markets}
              marketsNotEnabledCount={fixture.marketsNotEnabledCount}
            />
          </EditorSectionCard>
        }
      />
    </div>
  );
}
