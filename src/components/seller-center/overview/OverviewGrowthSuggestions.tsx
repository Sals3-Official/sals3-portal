'use client';

import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { OVERVIEW_GROWTH_SUGGESTIONS } from '@/lib/seller-center/mock-data/overview';

/**
 * Optional ideas to grow sales, kept visually and functionally separate from
 * required work above. A seller can mute these for 30 days without losing
 * access to anything they must act on.
 */
export default function OverviewGrowthSuggestions() {
  const [muted, setMuted] = useState(false);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle>Growth suggestions</CardTitle>
          <button
            type="button"
            onClick={() => setMuted((current) => !current)}
            className="cursor-pointer text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-primary hover:underline"
          >
            {muted ? 'Unmute' : 'Mute 30 days'}
          </button>
        </div>
        <CardDescription>
          Optional. Never mixed with required work.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {muted ? (
          <div className="flex items-center justify-center rounded-md border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            Suggestions are muted for 30 days.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {OVERVIEW_GROWTH_SUGGESTIONS.map((suggestion) => (
              <div
                key={suggestion.id}
                className="rounded-md border border-border bg-muted/40 px-3 py-2.5"
              >
                <p className="text-sm font-semibold">{suggestion.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-muted">
                  {suggestion.body}
                </p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
