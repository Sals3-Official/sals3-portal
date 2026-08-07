'use client';

import { FlaskConical } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { buildHref } from '@/lib/portal/search-params';
import type { SupplierCatalogWorld } from '@/lib/products/catalog-types';

type SupplierCatalogScenarioSwitcherProps = {
  basePath: string;
  worlds: SupplierCatalogWorld[];
  value: string;
};

/**
 * Preview-harness only - NOT part of the shipped design. Lets one running
 * route demonstrate every required state from spec section 10 (healthy,
 * degraded, partial failure, reauth, all-unavailable, no suppliers) without
 * needing a screenshot per case. Visually marked as a dev tool (dashed
 * border, "Preview scenario" label) so it reads as scaffolding, not a real
 * seller-facing control.
 */
export default function SupplierCatalogScenarioSwitcher({
  basePath,
  worlds,
  value,
}: SupplierCatalogScenarioSwitcherProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-border bg-muted/60 px-3 py-2 text-xs text-ink-muted">
      <FlaskConical aria-hidden="true" className="size-3.5" />
      <span className="font-medium">
        Preview scenario (not part of the design):
      </span>
      <Select
        value={value}
        onValueChange={(next) => {
          router.push(
            buildHref(basePath, searchParams, {
              scenario: String(next),
              page: null,
            }),
          );
        }}
      >
        <SelectTrigger
          aria-label="Preview scenario"
          className="h-7 bg-card text-xs"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {worlds.map((world) => (
            <SelectItem key={world.key} value={world.key}>
              {world.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
