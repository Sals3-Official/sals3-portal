// @vitest-environment node
import { describe, expect, it } from 'vitest';
import planSizeChartAppend, { chartCoverage } from './append-size-chart-plan';
import type { DescriptionBlock } from './description-document';

/**
 * The chart-append rules, ported from the automation client's
 * `append_size_chart.py`. Every number in a chart came off a supplier's
 * picture by eye, so the variant picker is the only independent guard the
 * transcription has.
 */

const LEAD: DescriptionBlock = {
  type: 'paragraph',
  text: 'Straight-cut trousers in mid-weight twill with a zip fly.',
};

const HEADERS = ['Size', 'Waist (cm)', 'Length (cm)'];
const ROWS = [
  ['M', '70', '100'],
  ['L', '74', '102'],
  ['XL', '78', '104'],
];

const CHART = (
  headers: string[] = HEADERS,
  rows: string[][] = ROWS,
): DescriptionBlock => ({ type: 'table', headers, rows });

const INPUT = {
  blocks: [LEAD] as DescriptionBlock[],
  selling: ['M', 'L', 'XL'],
  heading: 'Size chart (cm)',
  headers: HEADERS,
  rows: ROWS,
};

describe('chartCoverage', () => {
  it('reports missing and extra sizes separately - one warns, the other refuses', () => {
    const coverage = chartCoverage(
      [
        ['M', '70'],
        ['4XL', '98'],
      ],
      ['M', 'L'],
    );

    expect(coverage).toEqual({ missing: ['L'], extra: ['4XL'] });
  });

  it('XXL and 2XL cover each other - the chart keeps CJ’s spelling, the picker the Portal’s', () => {
    expect(chartCoverage([['XXL', '80']], ['2XL'])).toEqual({
      missing: [],
      extra: [],
    });
  });
});

describe('planSizeChartAppend', () => {
  it('appends the heading and table after the existing copy, touching nothing above', () => {
    const plan = planSizeChartAppend(INPUT);

    expect(plan).toMatchObject({ ok: true, outcome: 'append' });

    if (plan.ok && plan.outcome === 'append') {
      expect(plan.blocks[0]).toBe(INPUT.blocks[0]);
      expect(plan.blocks[1]).toEqual({
        type: 'heading',
        level: 2,
        text: 'Size chart (cm)',
      });
      expect(plan.blocks[2]).toMatchObject({ type: 'table', headers: HEADERS });
    }
  });

  it('refuses an empty description - the chart would become the lead block', () => {
    const plan = planSizeChartAppend({ ...INPUT, blocks: [] });

    expect(plan).toMatchObject({ ok: false, reason: 'no_description' });
  });

  it('a size on sale with no row WARNS but still appends - refusing the whole chart spared no one (owner decision 2026-09-02)', () => {
    const plan = planSizeChartAppend({
      ...INPUT,
      selling: ['M', 'L', 'XL', '2XL'],
    });

    expect(plan).toMatchObject({
      ok: true,
      outcome: 'append',
      warnings: ['sizes on sale with no chart row: 2XL'],
    });
  });

  it('a row for a size nobody can buy still REFUSES - that row is a false statement', () => {
    const plan = planSizeChartAppend({
      ...INPUT,
      rows: [...ROWS, ['4XL', '98', '110']],
    });

    expect(plan).toMatchObject({ ok: false, reason: 'coverage' });

    if (!plan.ok) {
      expect(plan.detail[0]).toContain('4XL');
    }
  });

  it('the same chart already present is already_done, not a duplicate', () => {
    const plan = planSizeChartAppend({
      ...INPUT,
      blocks: [LEAD, CHART()],
    });

    expect(plan).toMatchObject({ ok: true, outcome: 'already_done' });
  });

  it('a DIFFERENT table already present is a refusal, never a second chart', () => {
    const plan = planSizeChartAppend({
      ...INPUT,
      blocks: [
        LEAD,
        CHART(HEADERS, [
          ['M', '71', '100'],
          ['L', '74', '102'],
          ['XL', '78', '104'],
        ]),
      ],
    });

    expect(plan).toMatchObject({ ok: false, reason: 'different_table_exists' });
  });
});
