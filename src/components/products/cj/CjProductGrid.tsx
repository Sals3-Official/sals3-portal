import type { CjProduct } from '@/lib/cj/normalize';
import type {
  CatalogFxRates,
  SupplierConnectionFixture,
} from '@/lib/products/catalog-types';
import type { EvaluatedCandidateRow } from '@/modules/catalog/candidates/queries';
import CjProductCard from './CjProductCard';

type CjProductGridProps = {
  products: CjProduct[];
  evaluations: Map<string, EvaluatedCandidateRow>;
  connection: SupplierConnectionFixture;
  rates: CatalogFxRates;
  usdToAudRate: number | null;
};

export default function CjProductGrid({
  products,
  evaluations,
  connection,
  rates,
  usdToAudRate,
}: CjProductGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
      {products.map((product, index) => (
        <div
          key={product.id}
          style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
          className="animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-300"
        >
          <CjProductCard
            product={product}
            evaluated={evaluations.get(product.id)}
            connection={connection}
            rates={rates}
            usdToAudRate={usdToAudRate}
          />
        </div>
      ))}
    </div>
  );
}
