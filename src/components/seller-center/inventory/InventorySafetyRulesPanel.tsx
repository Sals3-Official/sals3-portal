import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SAFETY_RULES } from '@/lib/seller-center/mock-data/inventory';

export default function InventorySafetyRulesPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Safety rules for stock changes</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {SAFETY_RULES.map((rule) => (
          <p
            key={rule}
            className="border-l-2 border-border pl-3 text-sm leading-relaxed text-ink-muted"
          >
            {rule}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}
