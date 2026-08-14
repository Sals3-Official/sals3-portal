import {
  LogOut,
  OctagonAlert,
  PlugZap,
  SaveOff,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import type {
  EditorBanner,
  EditorLifecycle,
} from '@/lib/seller-center/product-editor/types';

type EditorStateBannersProps = {
  banner: EditorBanner | null;
  lifecycle: EditorLifecycle;
  onRetry: () => void;
};

type BannerModel = {
  key: string;
  tone: 'warning' | 'danger';
  icon: LucideIcon;
  title: string;
  body: string;
  retryLabel: string | null;
};

/**
 * Every failure state says the same four things: what happened, what it
 * affects, what to do next, and - critically - what was *not* lost.
 *
 * "Save failed" in particular must state that the changes are still in the
 * tab. A seller who believes their edits are gone will retype them or
 * abandon the draft; the one thing the message must not do is leave that
 * ambiguous.
 */
function lifecycleBanner(lifecycle: EditorLifecycle): BannerModel | null {
  if (lifecycle === 'SESSION_EXPIRED') {
    return {
      key: 'session-expired',
      tone: 'danger',
      icon: LogOut,
      title: 'Your session expired',
      body: 'Draft changes in this tab were kept and nothing was sent to the server. Sign in again to continue editing and to publish.',
      retryLabel: null,
    };
  }

  if (lifecycle === 'SAVE_FAILED') {
    return {
      key: 'save-failed',
      tone: 'danger',
      icon: SaveOff,
      title: 'Draft could not be saved',
      body: 'The save was rejected. Your changes are still here in this tab and will not be lost by staying on the page.',
      retryLabel: 'Try saving again',
    };
  }

  if (lifecycle === 'VALIDATION_FAILED') {
    return {
      key: 'validation-failed',
      tone: 'danger',
      icon: OctagonAlert,
      title: 'Validation could not complete',
      body: "The readiness check failed before it finished, so this product's status is unknown rather than ready. Nothing was published.",
      retryLabel: 'Run validation again',
    };
  }

  if (lifecycle === 'CONNECTION_UNAVAILABLE') {
    return {
      key: 'connection-unavailable',
      tone: 'danger',
      icon: PlugZap,
      title: 'Supplier connection unavailable',
      body: 'The supplier connection could not be reached, so stock, cost and market evidence cannot be refreshed. The values below are the last successfully captured evidence.',
      retryLabel: 'Retry connection',
    };
  }

  return null;
}

export default function EditorStateBanners({
  banner,
  lifecycle,
  onRetry,
}: EditorStateBannersProps) {
  const models: BannerModel[] = [];
  const fromLifecycle = lifecycleBanner(lifecycle);

  if (fromLifecycle !== null) models.push(fromLifecycle);

  if (banner !== null) {
    models.push({
      key: 'fixture-banner',
      tone: banner.tone,
      icon: banner.tone === 'danger' ? OctagonAlert : TriangleAlert,
      title: banner.title,
      body: banner.body,
      retryLabel: null,
    });
  }

  if (models.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      {models.map((model) => {
        const Icon = model.icon;
        const isDanger = model.tone === 'danger';

        return (
          <div
            key={model.key}
            role="alert"
            className={`flex flex-wrap items-start gap-2.5 rounded-lg border p-3 ${
              isDanger
                ? 'border-red-600/30 bg-danger-surface'
                : 'border-amber-600/30 bg-warning-surface'
            }`}
          >
            <Icon
              aria-hidden="true"
              className={`mt-0.5 size-4 shrink-0 ${isDanger ? 'text-red-600' : 'text-amber-600'}`}
            />
            <div className="min-w-56 flex-1">
              <p
                className={`text-[13px] font-semibold ${isDanger ? 'text-red-600' : 'text-amber-600'}`}
              >
                {model.title}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-muted">
                {model.body}
              </p>
            </div>
            {model.retryLabel === null ? null : (
              <Button
                type="button"
                variant="outline"
                size="lg"
                onClick={onRetry}
              >
                {model.retryLabel}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
