import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { CjProduct } from '@/lib/cj/normalize';
import CjProductRow from './CjProductRow';

type CjProductsTableProps = {
  products: CjProduct[];
};

const COLUMNS = [
  { label: 'Product', className: '' },
  { label: 'Supplier price', className: 'text-right whitespace-nowrap' },
  { label: 'Weight', className: 'hidden md:table-cell' },
  { label: 'Ships from', className: 'hidden lg:table-cell' },
  { label: 'Listings', className: 'hidden text-right xl:table-cell' },
  { label: 'Added', className: 'whitespace-nowrap' },
  { label: 'Sals3', className: 'whitespace-nowrap' },
];

/**
 * Supplier catalogue table. A Server Component: the rows are read-only, so no
 * client JavaScript is needed to show them. Rows restack into cards below 768px
 * through CSS.
 */
export default function CjProductsTable({ products }: CjProductsTableProps) {
  return (
    <div className="rounded-lg border border-border bg-card">
      <Table className="block md:table">
        <TableHeader className="hidden md:table-header-group">
          <TableRow>
            {COLUMNS.map((column) => (
              <TableHead key={column.label} className={column.className}>
                {column.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="block md:table-row-group">
          {products.map((product) => (
            <CjProductRow key={product.id} product={product} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
