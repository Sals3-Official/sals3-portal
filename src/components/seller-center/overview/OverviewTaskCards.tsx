import { Card, CardContent } from '@/components/ui/card';
import LinkButton from '@/components/portal/LinkButton';
import StatusPill from '@/components/seller-center/shared/StatusPill';
import {
  OVERVIEW_ALL_TASK_COUNT,
  OVERVIEW_TASKS,
} from '@/lib/seller-center/mock-data/overview';

/**
 * "Needs action now" - the tasks a seller must act on, never mixed with the
 * optional growth suggestions below.
 */
export default function OverviewTaskCards() {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Needs action now
        </h2>
        <p className="text-xs text-muted-foreground">
          {OVERVIEW_ALL_TASK_COUNT} tasks in total
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {OVERVIEW_TASKS.map((task) => (
          <Card key={task.id} className="border-t-2 border-t-primary">
            <CardContent className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2">
                <StatusPill label={task.tag} tone={task.tone} />
                <p className="text-xs whitespace-nowrap text-muted-foreground">
                  {task.deadline}
                </p>
              </div>
              <p className="text-2xl font-semibold tracking-tight tabular-nums">
                {task.count}
              </p>
              <p className="text-sm leading-relaxed text-ink-muted">
                {task.text}
              </p>
              <LinkButton href={task.href} variant="outline" size="sm">
                {task.ctaLabel}
              </LinkButton>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
