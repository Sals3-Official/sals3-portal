import { toast } from 'sonner';

/**
 * Says out loud that a control in the design preview does nothing.
 *
 * Preview-only on purpose: the real `/listings` either performs an action or
 * renders the control disabled with its reason, so it never needs this. Keeping
 * the wording in one place is what stops a "saved!" toast from ever appearing
 * over a screen with no backend behind it.
 */
export default function announceUnbuilt(message: string) {
  toast(message, {
    description: 'This design preview has no catalogue backend.',
  });
}
