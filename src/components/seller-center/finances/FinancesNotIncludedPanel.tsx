import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { NOT_INCLUDED_IN_PROCEEDS_NOTE } from '@/lib/seller-center/disclosures';

export default function FinancesNotIncludedPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What is not in this number</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm leading-relaxed text-ink-muted">
          {NOT_INCLUDED_IN_PROCEEDS_NOTE}
        </p>
        <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
          Cost tracking is planned. Until enough sellers keep cost data, a
          margin number would be mostly empty or wrong.
        </p>
      </CardContent>
    </Card>
  );
}
