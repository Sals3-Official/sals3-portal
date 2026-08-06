import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { MarketRule } from '@/lib/seller-center/mock-data/market-rules';

type MarketRulesTableProps = {
  rules: MarketRule[];
};

export default function MarketRulesTable({ rules }: MarketRulesTableProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Rule</TableHead>
            <TableHead className="hidden md:table-cell">Scope</TableHead>
            <TableHead className="hidden md:table-cell">Source</TableHead>
            <TableHead className="hidden md:table-cell">Effective</TableHead>
            <TableHead className="text-right">Version</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((rule) => (
            <TableRow
              key={rule.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-3 md:table-row md:px-0 md:py-0"
            >
              <TableCell className="block w-full p-0 font-medium whitespace-normal md:table-cell md:w-auto md:p-2">
                {rule.name}
              </TableCell>
              <TableCell className="hidden p-0 text-sm text-ink-muted md:table-cell md:p-2">
                {rule.scope}
              </TableCell>
              <TableCell className="hidden p-0 text-sm text-ink-muted md:table-cell md:p-2">
                {rule.source}
              </TableCell>
              <TableCell className="hidden p-0 text-sm text-ink-muted md:table-cell md:p-2">
                {rule.effectiveDate}
              </TableCell>
              <TableCell className="block p-0 text-right text-xs text-muted-foreground md:table-cell md:p-2">
                {rule.version}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
