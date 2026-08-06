import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ROLE_EXPLAINERS } from '@/lib/seller-center/mock-data/market-rules';

export default function MarketRolesExplainerPanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Roles</CardTitle>
        <CardDescription>
          Two roles today. Sensitive actions are gated by permission, not
          guessed from the role name.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ROLE_EXPLAINERS.map((role) => (
          <div
            key={role.id}
            className="rounded-lg border border-border bg-muted/30 p-3.5"
          >
            <p className="text-sm font-semibold">{role.name}</p>
            <p className="mt-2 text-sm leading-relaxed text-ink-muted">
              {role.text}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
