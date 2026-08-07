import { FilePlus2, PackageSearch } from 'lucide-react';
import LinkButton from '@/components/portal/LinkButton';

/**
 * Add Product has two entry modes, and this is where the seller picks one.
 *
 * Without it the supplier-prefilled editor is only reachable by typing a
 * query string, which makes a whole half of this screen invisible from the
 * navigation that is supposed to lead to it.
 *
 * The supplier route is labelled as a design preview because that is what
 * it currently is: fictional fixture data, nothing saved. When the real
 * `?supplierCandidateId=` integration lands, this card points at that
 * instead and the wording drops.
 */
export default function AddProductModeChooser() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
        <FilePlus2 aria-hidden="true" className="size-5 text-primary" />
        <h2 className="font-display text-base font-semibold">Blank product</h2>
        <p className="text-sm text-muted-foreground">
          An empty form for a product you are adding yourself. This is the form
          below.
        </p>
      </div>

      <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-4">
        <PackageSearch aria-hidden="true" className="size-5 text-primary" />
        <h2 className="font-display text-base font-semibold">
          From a supplier product
        </h2>
        <p className="text-sm text-muted-foreground">
          The Product Editor: a qualified supplier product, prefilled from its
          validated supplier evidence. Currently a design preview on fictional
          data — nothing is saved.
        </p>
        <LinkButton
          href="/listings/new?fixture=attention"
          variant="outline"
          className="mt-auto"
        >
          Open the Product Editor
        </LinkButton>
      </div>
    </div>
  );
}
