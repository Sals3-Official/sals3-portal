import { toast } from 'sonner';
import copyToClipboard from './clipboard';

/**
 * Copy one identifier and say whether it worked.
 *
 * Shared by the catalogue's product and variant rows, which each print several
 * copyable identities. The failure path is announced rather than swallowed:
 * `navigator.clipboard` is permission-gated, so a silent no-op would leave a
 * seller pasting a stale buffer into a support ticket.
 */
export default async function copyIdentity(value: string, label: string) {
  const ok = await copyToClipboard(value);

  toast(
    ok
      ? `Copied ${label} to clipboard.`
      : `Couldn't copy ${label} to clipboard.`,
  );
}
