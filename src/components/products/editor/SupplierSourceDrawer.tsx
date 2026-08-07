'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  NOT_AVAILABLE_LABEL,
  formatCount,
  formatDateTime,
  formatMoney,
  formatMoneyRange,
} from '@/lib/seller-center/product-editor/format';
import type { ProductEditorFixture } from '@/lib/seller-center/product-editor/types';
import EditorSheet from './EditorSheet';
import EditorStatusPill from './EditorStatusPill';
import SupplierSourceBadge from './SupplierSourceBadge';
import {
  ACCEPTED_ORDER_COPY,
  MEDIA_STORAGE_LABELS,
  SOURCE_PRODUCT_STATUS_PRESENTATION,
} from './presentation';

type SupplierSourceDrawerProps = {
  fixture: ProductEditorFixture;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type DrawerRowProps = {
  label: string;
  value: string;
  mono?: boolean;
};

function DrawerRow({ label, value, mono = false }: DrawerRowProps) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-3 border-b border-border py-1.5 text-xs">
      <dt className="font-semibold text-muted-foreground">{label}</dt>
      <dd className={`m-0 break-words ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function DrawerSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-2 text-[13px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

/**
 * Read-only source sheet: everything the supplier connection says about
 * this product, and nothing it says about the connection's credentials.
 *
 * The safety property here is a *negative* one, and it is why the advanced
 * section renders from `fixture.advancedIdentifiers` rather than from the
 * connection record: that map holds opaque internal ids only. No API key,
 * access token, refresh token, encrypted secret, or full account
 * identifier is modelled anywhere in the fixture type, so none can reach
 * this drawer by accident later.
 *
 * The source URL is withheld for the same reason it is elsewhere in the
 * portal - a supplier deep link exposes sourcing to anyone with screen
 * access.
 */
export default function SupplierSourceDrawer({
  fixture,
  open,
  onOpenChange,
}: SupplierSourceDrawerProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const { source } = fixture;

  return (
    <EditorSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Supplier Source Details"
      description="Read-only. Nothing here can be edited from Sals3."
    >
      <div className="flex flex-col gap-5">
        <SupplierSourceBadge source={source} />

        <dl className="m-0">
          <DrawerRow label="Supplier" value={source.providerDisplayName} />
          <DrawerRow
            label="Connected account"
            value={source.connectionDisplayName}
          />
          <DrawerRow
            label="Supplier product ID"
            value={source.externalProductId}
            mono
          />
          <DrawerRow label="Source currency" value={source.sourceCurrency} />
          <DrawerRow
            label="Original product name"
            value={fixture.supplierProductName}
          />
          <DrawerRow
            label="Original category"
            value={fixture.supplierCategoryPath}
          />
          <DrawerRow
            label="Source URL"
            value="Not exposed — supplier links are withheld from the portal"
          />
          <DrawerRow
            label="Last successful sync"
            value={
              source.lastSuccessfulSyncAt === null
                ? 'Never'
                : formatDateTime(source.lastSuccessfulSyncAt)
            }
          />
          <DrawerRow
            label="Last attempted sync"
            value={
              source.lastAttemptedSyncAt === null
                ? 'Never'
                : formatDateTime(source.lastAttemptedSyncAt)
            }
          />
        </dl>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-semibold text-muted-foreground">
            Source product status
          </span>
          <EditorStatusPill
            presentation={
              SOURCE_PRODUCT_STATUS_PRESENTATION[fixture.sourceProductStatus]
            }
          />
        </div>

        <DrawerSection title="Supplier variants, cost and stock">
          <ul className="flex list-none flex-col gap-1.5 p-0 text-xs">
            {fixture.variants.map((variant) => (
              <li
                key={variant.id}
                className="flex flex-wrap justify-between gap-2 border-b border-border pb-1.5"
              >
                <span>{variant.optionLabel}</span>
                <span className="tabular-nums">
                  {formatMoney(variant.supplierCost)}{' '}
                  {variant.supplierCost.currency} ·{' '}
                  {formatCount(variant.supplierStock)} units ·{' '}
                  {variant.warehouseLabel}
                </span>
              </li>
            ))}
          </ul>
        </DrawerSection>

        <DrawerSection title="Shipping evidence">
          <ul className="m-0 list-disc pl-4 text-xs leading-relaxed text-ink-muted">
            {fixture.markets.map((market) => (
              <li key={market.code}>
                {market.name} — {market.routeEvidence} (
                {market.freightEstimate === null
                  ? NOT_AVAILABLE_LABEL
                  : formatMoneyRange(
                      market.freightEstimate.min,
                      market.freightEstimate.max,
                    )}
                , captured {formatDateTime(market.evidenceCapturedAt)})
              </li>
            ))}
          </ul>
        </DrawerSection>

        <DrawerSection title="Media provenance">
          <ul className="m-0 list-disc pl-4 text-xs leading-relaxed text-ink-muted">
            {fixture.media.map((item) => (
              <li key={item.id}>
                {item.label} — {MEDIA_STORAGE_LABELS[item.storageState]}
              </li>
            ))}
          </ul>
        </DrawerSection>

        <DrawerSection title="Recent supplier changes">
          {fixture.sourceChanges.length === 0 ? (
            <p className="text-xs text-muted-foreground">None recorded.</p>
          ) : (
            <ul className="m-0 list-disc pl-4 text-xs leading-relaxed text-ink-muted">
              {fixture.sourceChanges.map((change) => (
                <li key={change.id}>
                  {change.title} — {formatDateTime(change.occurredAt)}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Supplier changes affect the current listing only.{' '}
            {ACCEPTED_ORDER_COPY}
          </p>
        </DrawerSection>

        <DrawerSection title="Validation result">
          <p className="text-xs text-muted-foreground">
            Policy version {fixture.policyVersion} · evaluated{' '}
            {formatDateTime(fixture.lastValidatedAt)}
          </p>
        </DrawerSection>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5 text-[13px] font-semibold">
            Advanced identifiers
            <ChevronDown
              aria-hidden="true"
              className={`size-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`}
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <dl className="m-0 px-3 pt-2 font-mono text-[11px] leading-relaxed text-ink-muted">
              {Object.entries(fixture.advancedIdentifiers).map(
                ([key, value]) => (
                  <div key={key} className="break-all">
                    {key}: {value}
                  </div>
                ),
              )}
            </dl>
          </CollapsibleContent>
        </Collapsible>

        <p className="text-[11px] text-muted-foreground">
          No API key, token or credential is ever shown in this drawer.
        </p>
      </div>
    </EditorSheet>
  );
}
