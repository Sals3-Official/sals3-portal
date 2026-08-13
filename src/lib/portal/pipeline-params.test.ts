import { describe, expect, it } from 'vitest';
import {
  candidateDrawerHref,
  closeCandidateHref,
  pipelineCurrentParams,
  pipelinePageQuerySchema,
} from './pipeline-params';

const CANDIDATE = '11111111-2222-4333-8444-555555555555';

describe('pipelinePageQuerySchema', () => {
  it('accepts a real candidate uuid', () => {
    expect(
      pipelinePageQuerySchema.parse({ candidate: CANDIDATE }).candidate,
    ).toBe(CANDIDATE);
  });

  /**
   * The point of `.catch('')`: a hand-typed value must never reach a uuid
   * database predicate, and must not 500 the page either.
   */
  it('degrades a non-uuid candidate to empty instead of throwing', () => {
    expect(
      pipelinePageQuerySchema.parse({ candidate: 'not-a-uuid' }).candidate,
    ).toBe('');
    expect(
      pipelinePageQuerySchema.parse({ candidate: ['a', 'b'] }).candidate,
    ).toBe('');
    expect(pipelinePageQuerySchema.parse({}).candidate).toBe('');
  });
});

describe('pipelineCurrentParams', () => {
  it('omits unset keys so no empty query pairs are emitted', () => {
    const params = pipelineCurrentParams(
      pipelinePageQuerySchema.parse({ tab: 'blocked' }),
    );

    expect(params).toEqual({ tab: 'blocked' });
  });
});

describe('candidateDrawerHref', () => {
  /**
   * The regression this file exists for. `buildQueryString` drops `page` on any
   * other change, so without an explicit `page` a row click on page 7 would
   * teleport the seller to page 1.
   */
  it('keeps the current page when opening the drawer', () => {
    const href = candidateDrawerHref(
      { tab: 'blocked', q: 'phone case', page: '7' },
      CANDIDATE,
    );

    expect(href).toContain('page=7');
    expect(href).toContain(`candidate=${CANDIDATE}`);
    expect(href).toContain('tab=blocked');
    expect(href).toContain('q=phone+case');
  });

  it('emits no page key when the list was not paged', () => {
    const href = candidateDrawerHref({ tab: 'ready' }, CANDIDATE);

    expect(href).not.toContain('page=');
    expect(href).toBe(`/products/pipeline?tab=ready&candidate=${CANDIDATE}`);
  });

  it('replaces an already-open candidate rather than appending a second one', () => {
    const href = candidateDrawerHref(
      { tab: 'all', candidate: '99999999-2222-4333-8444-555555555555' },
      CANDIDATE,
    );

    expect(new URL(href, 'https://x').searchParams.getAll('candidate')).toEqual(
      [CANDIDATE],
    );
  });
});

describe('closeCandidateHref', () => {
  it('drops only the candidate and keeps tab, search, and page', () => {
    const href = closeCandidateHref({
      tab: 'blocked',
      q: 'mug',
      page: '7',
      candidate: CANDIDATE,
    });

    expect(href).not.toContain('candidate=');
    expect(href).toContain('page=7');
    expect(href).toContain('tab=blocked');
    expect(href).toContain('q=mug');
  });
});
