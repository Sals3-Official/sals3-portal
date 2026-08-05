import { ShieldAlert } from 'lucide-react';
import { PORTAL_ROLE_LABELS, type PortalRole } from '@/lib/auth/permissions';
import LinkButton from './LinkButton';

type NoAccessProps = {
  role: PortalRole;
  action: string;
};

/**
 * Shown when a role opens a page it cannot use. The message names the role, so
 * the user can ask for the right access instead of guessing. The server action
 * behind the page refuses the same request on its own - this screen is only the
 * explanation.
 */
export default function NoAccess({ role, action }: NoAccessProps) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-16 text-center">
      <ShieldAlert aria-hidden="true" className="size-8 text-ink-faint" />
      <h1 className="font-display text-lg font-semibold">
        You cannot {action}
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Your role is {PORTAL_ROLE_LABELS[role]}. Ask an administrator if you
        need this access.
      </p>
      <LinkButton href="/products" variant="outline">
        Back to products
      </LinkButton>
    </div>
  );
}
