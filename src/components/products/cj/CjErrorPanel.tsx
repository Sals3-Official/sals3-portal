import { CloudOff } from 'lucide-react';
import LinkButton from '@/components/portal/LinkButton';
import { CJ_ERROR_MESSAGES, type CjErrorReason } from '@/services/cj/config';

type CjErrorPanelProps = {
  reason: CjErrorReason;
};

/**
 * Shown when the supplier catalogue cannot be read. The message says what to do
 * next and carries no upstream response body, URL, or credential - that detail
 * stays in the server log.
 */
export default function CjErrorPanel({ reason }: CjErrorPanelProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-16 text-center">
      <CloudOff aria-hidden="true" className="size-8 text-ink-faint" />
      <h2 className="font-display text-lg font-semibold">
        The supplier catalogue did not load
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {CJ_ERROR_MESSAGES[reason]}
      </p>
      <LinkButton href="/products" variant="outline">
        Try again
      </LinkButton>
    </div>
  );
}
