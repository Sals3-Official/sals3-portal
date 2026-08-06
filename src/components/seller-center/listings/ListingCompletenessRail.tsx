import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { RemainingRequirement } from '@/lib/seller-center/mock-data/listings';

type ListingCompletenessRailProps = {
  completePct: number;
  completeFields: number;
  totalFields: number;
  remaining: RemainingRequirement[];
};

export default function ListingCompletenessRail({
  completePct,
  completeFields,
  totalFields,
  remaining,
}: ListingCompletenessRailProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Completeness</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Progress value={completePct} />
        <p className="text-sm text-ink-muted">
          {completeFields} of {totalFields} fields done. One market requirement
          is still missing and will block publishing.
        </p>
        <div className="flex flex-col gap-2.5 border-t border-border pt-3">
          {remaining.map((item) => (
            <div key={item.id} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className={`mt-0.5 size-3.5 shrink-0 rounded-[4px] border-2 ${
                  item.required ? 'border-amber-600' : 'border-border'
                }`}
              />
              <div>
                <p className="text-sm text-foreground">{item.label}</p>
                <p className="text-xs text-muted-foreground">{item.why}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
