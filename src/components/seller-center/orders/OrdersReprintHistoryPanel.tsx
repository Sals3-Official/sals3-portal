import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { REPRINT_HISTORY } from '@/lib/seller-center/mock-data/orders';

const DOT_TONE = {
  warning: 'bg-amber-600',
  success: 'bg-green-600',
} as const;

export default function OrdersReprintHistoryPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Reprint history</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {REPRINT_HISTORY.map((entry) => (
          <div key={entry.id} className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className={`mt-1.5 size-1.5 shrink-0 rounded-full ${DOT_TONE[entry.tone]}`}
            />
            <div>
              <p className="text-sm text-ink-muted">
                <span className="font-medium text-foreground">
                  {entry.orderId}
                </span>{' '}
                — {entry.text}
              </p>
              <p className="text-xs text-muted-foreground">{entry.meta}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
