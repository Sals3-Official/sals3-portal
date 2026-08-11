import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { CategoryPolicyWithCategory } from '@/modules/pricing/repository';
import CategoryPolicyFormDialog from './CategoryPolicyFormDialog';
import DeactivateCategoryPolicyButton from './DeactivateCategoryPolicyButton';

type CategoryPricingTableProps = {
  policies: CategoryPolicyWithCategory[];
  sellerAccountId: string;
  canManage: boolean;
};

function formatPercent(rate: string): string {
  return `${(Number(rate) * 100).toFixed(2)}%`;
}

export default function CategoryPricingTable({
  policies,
  sellerAccountId,
  canManage,
}: CategoryPricingTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Category</TableHead>
            <TableHead>Code</TableHead>
            <TableHead>Target margin</TableHead>
            <TableHead className="hidden md:table-cell">Rounding</TableHead>
            <TableHead className="hidden md:table-cell">Version</TableHead>
            <TableHead className="hidden md:table-cell">Updated</TableHead>
            {canManage ? (
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {policies.map((policy) => (
            <TableRow key={policy.id}>
              <TableCell className="max-w-56 truncate font-medium">
                {policy.categoryPath}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {policy.categoryCode}
              </TableCell>
              <TableCell className="tabular-nums">
                {formatPercent(policy.targetMarginRate)}
              </TableCell>
              <TableCell className="hidden md:table-cell">
                {policy.roundingRule === 'NEAREST_0_99'
                  ? 'Nearest .99'
                  : 'None'}
              </TableCell>
              <TableCell className="hidden tabular-nums md:table-cell">
                v{policy.version}
              </TableCell>
              <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                {new Date(policy.updatedAt).toLocaleDateString()}
              </TableCell>
              {canManage ? (
                <TableCell>
                  <div className="flex justify-end gap-1.5">
                    <CategoryPolicyFormDialog mode="edit" existing={policy} />
                    <DeactivateCategoryPolicyButton
                      policyId={policy.id}
                      sellerAccountId={sellerAccountId}
                      categoryPath={policy.categoryPath}
                    />
                  </div>
                </TableCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
