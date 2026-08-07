'use client';

import { toast } from 'sonner';
import { Button } from '@/components/ui/button';

type CustomizeAndListButtonProps = {
  productName: string;
  disabled?: boolean;
};

/**
 * Stub for the spec's "Customize & List" action. The Product Editor does not
 * exist yet (spec section 26), so this never claims a fake success - it
 * states the real, current limitation instead. `disabled` is used for
 * `BLOCKED` candidates, which have no override (spec's Blocked/Rejected
 * page: "Permanent block: View details only, No override").
 */
export default function CustomizeAndListButton({
  productName,
  disabled = false,
}: CustomizeAndListButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() => {
        toast(`Customize & List isn't built yet for "${productName}".`, {
          description: 'The Product Editor does not exist in this portal yet.',
        });
      }}
    >
      Customize &amp; List
    </Button>
  );
}
