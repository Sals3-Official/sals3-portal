// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { listCatalogueFixtures } from '@/lib/seller-center/mock-data/product-catalogue';
import adaptFixtureRows from './adapt-fixture';
import type { CatalogueRowView, Tracked } from './view';

/**
 * The design preview must stay a complete fictional world: every field resolves
 * to a value, so no "Not tracked yet" pill can ever appear at
 * `/design-preview/product-catalogue`. That is what makes the preview a design
 * artifact and the real page an honest one, out of the same components.
 */

const TRACKED_ROW_FIELDS = [
  'hasImage',
  'categoryPath',
  'supplierProviderName',
  'supplierReference',
  'supplierConnectionHealth',
  'sellingPrice',
  'availability',
  'mediaStatus',
  'contentReadiness',
  'attentionReasons',
] as const;

const TRACKED_VARIANT_FIELDS = [
  'optionLabel',
  'sellerSku',
  'supplierVariantId',
  'hasImage',
  'sellingPrice',
  'supplierCost',
  'availability',
  'lastCheckedAt',
] as const;

describe('adapt-fixture', () => {
  const fixtures = listCatalogueFixtures();
  const rows = adaptFixtureRows(fixtures);

  it('adapts every fixture', () => {
    expect(rows).toHaveLength(fixtures.length);
  });

  it('resolves every tracked field to a value', () => {
    rows.forEach((row) => {
      TRACKED_ROW_FIELDS.forEach((field) => {
        expect((row[field] as Tracked<unknown>).kind).toBe('value');
      });

      row.variants.forEach((variant) => {
        TRACKED_VARIANT_FIELDS.forEach((field) => {
          expect((variant[field] as Tracked<unknown>).kind).toBe('value');
        });
      });
    });
  });

  /**
   * The one exception, and it is not an exception to the rule above: a fixture
   * quantity is explicitly `number | null`, and `null` there means the supplier
   * reported nothing - a recorded absence the preview always showed as
   * "unknown", never as zero.
   */
  it('keeps an unknown supplier quantity absent rather than zero', () => {
    const absentQuantities = rows
      .flatMap((row) => row.variants)
      .filter((variant) => variant.supplierObservedQuantity.kind === 'absent');

    absentQuantities.forEach((variant) => {
      expect(variant.supplierObservedQuantity).toEqual({
        kind: 'absent',
        label: 'Supplier-reported quantity: unknown',
      });
    });
  });

  it('invents no supplier-evidence notes', () => {
    rows.forEach((row) => {
      expect(row.evidenceNotes).toEqual([]);
    });
  });

  it('links Edit to the editor fixture, not the real product route', () => {
    rows.forEach((row, index) => {
      expect(row.actions.editHref).toBe(
        `/listings/new?fixture=${fixtures[index].editorFixtureKey}`,
      );
    });
  });

  it('hides Pause unless the row is live, matching the previous markup', () => {
    const byId = new Map<string, CatalogueRowView>(
      rows.map((row) => [row.id, row]),
    );

    fixtures.forEach((fixture) => {
      const isLive =
        fixture.status === 'LIVE' || fixture.status === 'LIVE_NEEDS_ATTENTION';

      expect(byId.get(fixture.id)?.actions.pause.kind).toBe(
        isLive ? 'enabled' : 'hidden',
      );
    });
  });

  it('disables View Live Page with the previous wording when not live', () => {
    fixtures.forEach((fixture, index) => {
      const canViewLive =
        (fixture.status === 'LIVE' ||
          fixture.status === 'LIVE_NEEDS_ATTENTION') &&
        fixture.storefrontUrl !== null;

      expect(rows[index].actions.viewLive).toEqual(
        canViewLive
          ? { kind: 'enabled' }
          : { kind: 'disabled', suffix: ' (not live)' },
      );
    });
  });
});
