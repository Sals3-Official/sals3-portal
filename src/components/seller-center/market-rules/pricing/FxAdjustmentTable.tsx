import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { PricingFxAdjustmentPolicyRow } from '@/lib/db/schema';
import DeactivateFxAdjustmentPolicyButton from './DeactivateFxAdjustmentPolicyButton';
import FxAdjustmentFormDialog from './FxAdjustmentFormDialog';

type FxAdjustmentTableProps = {
  policies: PricingFxAdjustmentPolicyRow[];
  sellerAccountId: string;
  canManage: boolean;
};

const FUNDING_RAIL_LABELS: Record<string, string> = {
  CJ_WALLET_WIRE_TRANSFER: 'CJ Wallet — wire transfer',
  CJ_WALLET_PAYONEER: 'CJ Wallet — Payoneer',
  OTHER: 'Other',
};

function formatSignedPercent(rate: string): string {
  const value = Number(rate) * 100;
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export default function FxAdjustmentTable({
  policies,
  sellerAccountId,
  canManage,
}: FxAdjustmentTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Pair</TableHead>
            <TableHead>Funding rail</TableHead>
            <TableHead>Adjustment</TableHead>
            <TableHead className="hidden md:table-cell">Version</TableHead>
            <TableHead className="hidden md:table-cell">
              Effective through
            </TableHead>
            {canManage ? (
              <TableHead>
                <span className="sr-only">Actions</span>
              </TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {policies.map((policy) => {
            const pairLabel = `${policy.sourceCurrency} → ${policy.targetCurrency}`;

            return (
              <TableRow key={policy.id}>
                <TableCell className="font-medium">{pairLabel}</TableCell>
                <TableCell>
                  {FUNDING_RAIL_LABELS[policy.fundingRail] ??
                    policy.fundingRail}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatSignedPercent(policy.adjustmentRate)}
                </TableCell>
                <TableCell className="hidden tabular-nums md:table-cell">
                  v{policy.version}
                </TableCell>
                <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
                  {policy.effectiveTo === null
                    ? 'No end date'
                    : new Date(policy.effectiveTo).toLocaleDateString()}
                </TableCell>
                {canManage ? (
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      <FxAdjustmentFormDialog mode="edit" existing={policy} />
                      <DeactivateFxAdjustmentPolicyButton
                        policyId={policy.id}
                        sellerAccountId={sellerAccountId}
                        pairLabel={pairLabel}
                      />
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
