import { eq, notLike } from 'drizzle-orm';
import {
  productOffers,
  productVariants,
  products,
  sals3Categories,
} from '@/lib/db/schema';
import type { Executor } from '@/modules/catalog/candidates/repository';
import {
  planReprice,
  type RepriceLine,
  type RepriceScope,
  type RepriceWriteResult,
} from './reprice';

/**
 * Bringing every live price in line with today's rules, without a button that
 * says "everything".
 *
 * ## Why this is not in the Portal
 *
 * `RepriceControls` deliberately refuses to run unscoped — owner decision
 * 2026-08-29, on a catalogue heading for millions of listings: one query, one
 * preview table and one click must never stand between a seller and every price
 * they own. That decision holds, and this does not soften it. The screen still
 * covers one department in one destination at a time, reviewed before it is
 * applied.
 *
 * What the screen cannot be is a way to *finish*. Aligning the catalogue after
 * a rules change is 21 departments across every destination a seller sells to,
 * each of them several pages deep — hundreds of reviewed clicks for a job with
 * no judgement in it. So it lives here, where bulk production work already
 * lives: `CRON_SECRET`-gated, dispatched by hand, and reported in counts rather
 * than approved a page at a time.
 *
 * ## Why it is resumable rather than one long call
 *
 * A page is up to `MAX_REPRICE_OFFERS` offers and the resolver runs about six
 * queries per offer, so a single page can be thousands of queries. A serverless
 * invocation will not survive a whole catalogue. Each call works until its
 * deadline and hands back the position it reached; the workflow calls again
 * until `done`. Nothing is lost if a call dies — the next one starts from the
 * last position that was actually written.
 *
 * ## What it never does
 *
 * It never reclaims a price a person typed unless explicitly asked. That flag
 * overwrites human decisions, `product_offers` keeps no history, and a sweep is
 * exactly the wrong place for it to be on by default — a seller approving one
 * department has read that department, while nobody reads a sweep.
 */

/** One unit of work: a department, in a destination, for one seller. */
export type SweepScope = {
  sellerAccountId: string;
  categoryCode: string;
  marketCode: string;
};

export type SweepPosition = {
  /** Index into the deterministic scope list — see `listSweepScopes`. */
  scopeIndex: number;
  /** Where the last applied page of that scope ended. */
  afterSku: string | null;
};

export type SweepTotals = {
  scopesVisited: number;
  changed: number;
  unchanged: number;
  unpriceable: number;
  /** Prices a person typed and this run left alone. */
  manual: number;
  written: number;
};

export type SweepResult = {
  ok: true;
  /** `false` means call again with `position`. */
  done: boolean;
  position: SweepPosition;
  scopeCount: number;
  totals: SweepTotals;
};

/**
 * Every (seller, department, destination) with live offers behind it, in a
 * stable order.
 *
 * Derived from the offers themselves rather than from the capability list: a
 * destination a seller has never published into has nothing to reprice, and
 * walking it would spend a resolver call to learn that. The order is the
 * primary key of the position, so it is sorted explicitly — an unordered scan
 * would make `scopeIndex` mean a different scope on the next call.
 *
 * Departments only. A run covers the chosen category **and its subtree**, and
 * every product sits under a department, so the roots already reach everything.
 */
export async function listSweepScopes(
  executor: Executor,
): Promise<SweepScope[]> {
  const offerRows = (await executor
    .selectDistinct({
      sellerAccountId: products.stewardSellerAccountId,
      categoryPath: sals3Categories.path,
      marketCode: productOffers.marketCode,
    })
    .from(productOffers)
    .innerJoin(productVariants, eq(productVariants.id, productOffers.variantId))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(sals3Categories, eq(sals3Categories.id, products.categoryId))
    .where(eq(productOffers.publishState, 'PUBLISHED'))) as Array<{
    sellerAccountId: string;
    categoryPath: string;
    marketCode: string;
  }>;

  /*
    The departments, by path.

    A root is a path with no separator in it — the taxonomy carries no depth
    column, and deriving the department in SQL would mean `split_part` in a
    place where the rest of this module reads as Drizzle. Two small queries and
    a map is the same answer with nothing to misread.
  */
  const rootRows = (await executor
    .select({ code: sals3Categories.code, path: sals3Categories.path })
    .from(sals3Categories)
    .where(notLike(sals3Categories.path, '% > %'))) as Array<{
    code: string;
    path: string;
  }>;

  const codeByRootPath = new Map(rootRows.map((row) => [row.path, row.code]));
  const seen = new Map<string, SweepScope>();

  offerRows.forEach((row) => {
    const rootPath = row.categoryPath.split(' > ')[0] ?? row.categoryPath;
    const categoryCode = codeByRootPath.get(rootPath);

    // A product under a category whose department is missing from the taxonomy
    // is a data problem, not a scope. Skipped rather than repriced under a
    // guess, and visible as a shortfall in `scopeCount`.
    if (categoryCode === undefined) return;

    const key = `${row.sellerAccountId}|${categoryCode}|${row.marketCode}`;

    if (!seen.has(key)) {
      seen.set(key, {
        sellerAccountId: row.sellerAccountId,
        categoryCode,
        marketCode: row.marketCode,
      });
    }
  });

  return [...seen.values()].sort(
    (left, right) =>
      left.sellerAccountId.localeCompare(right.sellerAccountId) ||
      left.categoryCode.localeCompare(right.categoryCode) ||
      left.marketCode.localeCompare(right.marketCode),
  );
}

export type SweepOptions = {
  /** `false` plans and counts without writing anything. */
  apply: boolean;
  /** Off unless explicitly asked — see the module header. */
  reclaimSellerPriced: boolean;
  /** Where a previous call stopped. */
  position: SweepPosition;
  /** Stop starting new pages after this many milliseconds. */
  budgetMs: number;
  /**
   * Commits one page. Injected rather than imported so this module needs
   * neither a database handle nor the audit writer, which is what lets its
   * tests drive a whole sweep without one.
   */
  write: (
    sellerAccountId: string,
    lines: RepriceLine[],
  ) => Promise<RepriceWriteResult>;
};

const EMPTY_TOTALS: SweepTotals = {
  scopesVisited: 0,
  changed: 0,
  unchanged: 0,
  unpriceable: 0,
  manual: 0,
  written: 0,
};

/**
 * Works through the scope list from `position` until the budget runs out.
 *
 * The budget is checked **between** pages, never inside one: a page is a single
 * plan and a single write, and abandoning it half-written is the one outcome
 * this must not produce. So a call can overrun its budget by one page, which is
 * the price of never leaving a scope in a state the next call cannot reason
 * about.
 */
export async function runRepriceSweep(
  executor: Executor,
  scopes: SweepScope[],
  options: SweepOptions,
  now: () => number = Date.now,
): Promise<SweepResult> {
  const startedAt = now();
  const totals = { ...EMPTY_TOTALS };

  let { scopeIndex, afterSku } = options.position;

  while (scopeIndex < scopes.length) {
    if (now() - startedAt >= options.budgetMs) {
      return {
        ok: true,
        done: false,
        position: { scopeIndex, afterSku },
        scopeCount: scopes.length,
        totals,
      };
    }

    const scope = scopes[scopeIndex] as SweepScope;
    const repriceScope: RepriceScope = {
      categoryCode: scope.categoryCode,
      marketCode: scope.marketCode,
      afterSku,
    };

    // eslint-disable-next-line no-await-in-loop
    const plan = await planReprice(
      executor,
      scope.sellerAccountId,
      repriceScope,
      { reclaimSellerPriced: options.reclaimSellerPriced },
    );

    totals.changed += plan.counts.changed;
    totals.unchanged += plan.counts.unchanged;
    totals.unpriceable += plan.counts.unpriceable;
    totals.manual += plan.counts.manual;

    if (options.apply && plan.counts.changed > 0) {
      /*
        One transaction per page, not one for the sweep.

        A sweep can run for minutes across many scopes; holding a single
        transaction open for all of it would lock nothing useful and block
        everything else, and a failure in the last scope would roll back work
        that was already correct. Each page is independently committed, which is
        also what makes the position resumable — the next call starts after the
        last page that actually landed.
      */
      // eslint-disable-next-line no-await-in-loop
      const result = await options.write(scope.sellerAccountId, plan.lines);

      if (!result.ok) {
        /*
          A version conflict means an offer moved between the plan and the
          write — a publish, or somebody using the dialog at the same time.
          Stopping is the honest response: the position is still the last page
          that committed, so a re-run picks up cleanly, and continuing would
          plan the rest against a catalogue that just changed underneath it.
        */
        return {
          ok: true,
          done: false,
          position: { scopeIndex, afterSku },
          scopeCount: scopes.length,
          totals,
        };
      }

      totals.written += result.written;
    }

    /*
      A dry run must not advance within a scope.

      `nextAfterSku` is where an *applied* page ended. On a plan-only pass
      nothing was written, so resuming past it would report a later page as
      covered while the earlier one still holds whatever it holds. A dry run
      therefore reads the first page of every scope and says so in `changed`,
      which is what makes it a lower bound rather than a wrong number.
    */
    const more = options.apply && plan.nextAfterSku !== null;

    if (more) {
      afterSku = plan.nextAfterSku;
    } else {
      scopeIndex += 1;
      afterSku = null;
      totals.scopesVisited += 1;
    }
  }

  return {
    ok: true,
    done: true,
    position: { scopeIndex, afterSku: null },
    scopeCount: scopes.length,
    totals,
  };
}

/** The position a first call starts from. */
export const SWEEP_START: SweepPosition = { scopeIndex: 0, afterSku: null };
