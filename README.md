# Seller Center

Sals3's seller operations app (npm package `sals3-portal`): Overview, Orders,
Inventory, a new-listing wizard, Finances, Payouts, and Market rules, plus the
CJdropshipping supplier catalogue. Same tech stack as `sals3-ecommerce`, and
the same brand tokens, so both products look like one system.

- Next.js 16 (App Router) + React 19 + TypeScript (strict)
- PostgreSQL with Drizzle ORM + Drizzle Kit, over `postgres.js`
- Better Auth email/password sessions, verification email, database rate
  limits, and required TOTP
- Resend for auth email
- Tailwind CSS 4 (via `@tailwindcss/postcss`)
- shadcn/ui components on Base UI, with Lucide icons and `sonner` for toasts
- Zod for validation
- ESLint 9 (flat config: Airbnb + Next core-web-vitals + TypeScript + Prettier)
- Prettier
- Vitest + Testing Library (jsdom) for unit tests
- Playwright for E2E tests
- Husky + lint-staged git hooks (direct commits/pushes to `main`/`develop` are blocked)
- GitHub Actions `verify` workflow

## Setup

```bash
npm install
npx playwright install chromium
cp .env.example .env.local
```

Create the database and apply migrations (PostgreSQL must be installed and
running). Use a dedicated least-privilege role, never the `postgres`
superuser:

```bash
createuser sals3_app --pwprompt
createdb sals3 --owner sals3_app
```

Put that role's connection string in `DATABASE_URL` in `.env.local`, then:

```bash
npm run db:migrate
```

### Database-writing commands refuse a remote target

`db:migrate`, `seed:taxonomy`, `seed:taxonomy-presets`, `bootstrap:cj`,
`create:portal-user`, and `approve:portal-user` all run
`scripts/guard-remote-db.mts` first. If `DATABASE_URL` resolves to any host
other than `localhost`/`127.0.0.1`, the command stops before the real work
starts and prints the host and database it refused (never the connection
string — the password lives in there).

This exists because every one of those scripts, and `drizzle.config.ts`, reads
exactly one file: `.env.local`. Paste a production connection string in there
to run a single query and _all_ of them silently repoint at production —
`db:migrate` alters the live schema, `seed:taxonomy` inserts 1,345 rows,
`bootstrap:cj` creates a supplier connection and spends a CJ call. `db:migrate`
also succeeds quietly when there is nothing new to apply, so the mistake need
not announce itself.

**Keep a production URL out of `.env.local`.** Put it in `.env.prod-readonly`,
which `.gitignore` covers and which nothing reads — not Next.js (it loads only
`.env`, `.env.local`, `.env.$(NODE_ENV)`), not `drizzle.config.ts`, not any
script here. Use it only for an explicit read-only `pg_dump`. Do not name it
`.env.production`; `next build` and `next start` load that one.

To write to a remote database on purpose:

```bash
ALLOW_REMOTE_DB_WRITE=1 npm run db:migrate
```

Only the exact string `1` opts in, and the run prints a warning naming the
remote target. `db:generate` (offline) and `db:studio` (read/browse) are not
guarded.

Production catalogue data flows **from** Vercel to local, never the other way —
see ADR-017 in the `sals3-ecommerce` vault.

Set authentication secrets in `.env.local`:

```bash
BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
BETTER_AUTH_URL=http://localhost:3001
RESEND_API_KEY=...
RESEND_FROM_EMAIL="Sals3 Portal <auth@your-domain.example>"
```

For local development you can skip Resend: leave `RESEND_API_KEY` unset and
set `AUTH_EMAIL_CONSOLE_FALLBACK=1`. Verification and password-reset links are
then logged to the dev server console instead of being emailed. The fallback
is ignored when `NODE_ENV=production`.

Public signup creates an active `seller_manager` seller account. Seller Center
entry still requires the user to verify email and set up TOTP; after that,
`/auth/continue` re-reads the server session and sends them to their intended
portal route.

```bash
npm run approve:portal-user -- --email seller@example.com --role seller_manager
```

Use the approval script only for existing accounts that need a role change,
email-verification override, or manual repair.

Then fill in `CJ_API_KEY` in `.env.local` — used only by the one-time
bootstrap below; nothing reads it at request time anymore. `.env.local`
is ignored by git and must never be committed.

For Vercel-backed keys, use the linked project instead of copying secrets by
hand:

```bash
npx vercel env pull .env.local --environment development --yes
```

Set `SUPPLIER_CREDENTIAL_MASTER_KEY_BASE64` (generate with
`openssl rand -base64 32`) so supplier credentials in
[Supplier Apps](#supplier-apps-multi-tenant-provider-connections) can be
encrypted at rest, then seed the Sals3 Official Dropshipper's own CJ
connection from `CJ_API_KEY` once:

```bash
npm run bootstrap:cj
```

Set `SALS3_STOREFRONT_API_TOKEN` to a long random value if
`sals3-ecommerce` will read products from this portal. Use the same value in
`sals3-ecommerce/.env.local`.

Set `DISCOVERY_CONTROL_SECRET` to a long random value so the discovery
control routes (see
[Continuous full-catalogue discovery](#continuous-full-catalogue-discovery))
can authenticate. Set `CRON_SECRET` to a different long random value for the
**break-glass** recovery tick - that endpoint is no longer scheduled anywhere;
it exists only for manual recovery of a stalled queue chain (ADR-013 §12
forbids cron/scheduled ticks in the target runtime). Both fail closed with
`401` when unset.

In production, set `CATALOG_DISCOVERY_SWEEP_DELAY_SECONDS=300` so the
queue-chain watchdog wakes every five minutes. This does not speed up CJ's own
rate-limited supplier calls; it only reduces dead air when a partition lease or
queue delivery needs self-healing.

## Commands

| Command                                                                           | What it does                                                                    |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`                                                                     | Start dev server at http://localhost:3001 (3000 belongs to `sals3-ecommerce`)   |
| `npm run build`                                                                   | Production build                                                                |
| `npm run start`                                                                   | Serve production build                                                          |
| `npm run lint`                                                                    | ESLint                                                                          |
| `npm run format:check`                                                            | Prettier check                                                                  |
| `npm run typecheck:clean`                                                         | TypeScript check without `.next` artifacts                                      |
| `npm run test:run`                                                                | Unit tests (Vitest)                                                             |
| `npm run test:e2e`                                                                | E2E tests (Playwright)                                                          |
| `npm run verify`                                                                  | Full gate: lint + format + typecheck + build + unit + E2E                       |
| `npm run db:generate`                                                             | Generate a SQL migration from `src/lib/db/schema/`                              |
| `npm run db:migrate`                                                              | Apply pending migrations in `drizzle/` — **refuses a non-local `DATABASE_URL`** |
| `npm run db:studio`                                                               | Drizzle Studio (browse the local database)                                      |
| `npm run approve:portal-user -- --email seller@example.com --role seller_manager` | Approve/promote one verified portal user                                        |
| `npm run seed:taxonomy`                                                           | Seed Sals3 Taxonomy v0 category identities (one-time, idempotent)               |
| `npm run seed:taxonomy-presets`                                                   | Seed Sals3 Taxonomy v0 form presets (run after `seed:taxonomy`)                 |

## Deployment and performance

Production functions must run near the production database. The Neon host is
in `ap-southeast-2`, so `vercel.json` pins Vercel Functions to `syd1`. Keep
that setting in sync with the database region; do not use Next's deprecated
`preferredRegion` route export. The change takes effect on the next Vercel
deployment, then verify with `vercel inspect https://sals3-portal.vercel.app`.

Seller Center keeps authentication and authorization server-side. The shared
portal layout calls `getSession()` once, then passes the resolved seller id and
business model into the shell data loader for badge and connection health
reads. Individual pages still enforce access with `requirePermission()` or
`requireDropshipperAccount()`.

Sidebar links intentionally set `prefetch={false}`. Most Seller Center routes
are dynamic and permission-gated, so automatic prefetch created extra serverless
`MISS` requests for every visible nav item. Manual clicks still use `next/link`.

Route-level `loading.tsx` files under Seller Center use
`src/components/portal/PortalRouteLoading.tsx` for the compact loading
skeleton. This gives immediate feedback while dynamic routes wait for the
server payload; it is visual feedback only, not an auth shortcut. The loading
state is intentionally not placed at `(portal)/loading.tsx` because the Add
Product preview has a hard 404 status contract for unknown fixture keys, and a
parent streaming boundary would turn that response into a streamed 200. No
Redis, KV, or paid cache service is used for this path.

## Routes

| Route                                                      | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/`                                                        | Seller Center sign-in form                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/login`                                                   | Better Auth email/password sign-in                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/signup`                                                  | Public seller account signup (`RETAILER` or `DROPSHIPPER`), always generic success copy; new users get active `seller_manager` access after email verification and TOTP setup                                                                                                                                                                                                                                                                                                  |
| `/reset-password`                                          | Password reset request and token completion                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/setup-2fa`                                               | Required TOTP enrolment before Seller Center entry                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/two-factor`                                              | TOTP challenge after sign-in                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/auth/continue`                                           | Server-side post-auth continuation gate: checks session, verified email, TOTP, seller state, and safe `next` before redirecting                                                                                                                                                                                                                                                                                                                                                |
| `/auth/pending`                                            | Fallback for legacy or manually deactivated seller accounts that are signed in but not active/verified                                                                                                                                                                                                                                                                                                                                                                         |
| `/overview`                                                | Seller Center dashboard: needs-action tasks, money position, glance stats                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/orders`                                                  | Batch fulfillment: filter, select, print (static), handoff                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/listings`                                                | Product Catalogue. Reads persisted Sals3 Product/Variant/Offer/provider-reference rows for the seller and maps them into the existing catalogue UI. No supplier API call is made. Imported rows remain Draft/Unpublished until the real publish gates can resolve category, media, price, variant options, and revision approval.                                                                                                                                              |
| `/listings/new`                                            | Add Product. No query: the blank essentials-first wizard (read-only fields, no save yet). `?fixture=<key>`: the supplier-prefilled Product Editor design preview — see [Product Editor](#product-editor-add-product-from-a-supplier-product). `?supplierCandidateId=`: reserved for the real integration, states that it is not wired up yet                                                                                                                                   |
| `/inventory`                                               | Inline stock edits with undo and an audit record                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/finances`                                                | Itemized ledger and estimated proceeds for one example order                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/payouts`                                                 | Payout schedule, states, and destination                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/market-rules`                                            | The account's own market setup (which approved destinations it is configured for), the platform policies around it, role access, and category pricing / FX adjustment — see [Seller market configuration](#seller-market-configuration)                                                                                                                                                                                                                                        |
| `/supplier-apps`                                           | Connect / disconnect / reconnect the seller's own CJ Dropshipping account (ADR-008)                                                                                                                                                                                                                                                                                                                                                                                            |
| `/products`                                                | All Supplier Products — the raw supplier catalogue, read **entirely from the Sals3 database**. Local quick views (`?view=`), a Discovery signal filter (`?signal=`), a Category filter (`?category=`), a two-character-minimum debounced search (`?q=`), paging (`?page=`), and a read-only Supplier Source Details panel (`?source=`) with manual stock attestation. Makes **zero** CJ requests — see [Lean All Supplier Products intake](#lean-all-supplier-products-intake) |
| `/design-preview/all-supplier-products`                    | Design preview of the full multi-supplier layout against isolated fixtures (dynamic supplier/evaluation filters, duplicate detection) - `robots: noindex`, not linked from the sidebar, for review before a second real Supplier App exists                                                                                                                                                                                                                                    |
| `/products/pipeline`                                       | Product Sourcing — every candidate the automated pipeline has touched, one paged tab per decision status (`?tab=`), 100 rows a page (`?page=`), with `?q=` searching the whole tab in SQL. See [Product Sourcing paging and search](#product-sourcing-paging-and-search)                                                                                                                                                                                                       |
| `/products/qualified/ready`                                | Retired — redirects to `/products/pipeline?tab=ready` (automated `PASS` candidates)                                                                                                                                                                                                                                                                                                                                                                                            |
| `/products/qualified/needs-attention`                      | Retired — redirects to `/products/pipeline?tab=needs-attention` (automated `PASS_WITH_ATTENTION` candidates)                                                                                                                                                                                                                                                                                                                                                                   |
| `/products/evaluating`                                     | Retired — redirects to `/products/pipeline?tab=evaluating` (`QUEUED`, actively `EVALUATING`, or a technical failure still under its retry cap)                                                                                                                                                                                                                                                                                                                                 |
| `/products/blocked`                                        | Retired — redirects to `/products/pipeline?tab=blocked` (`BLOCKED` permanent and `TEMPORARILY_INELIGIBLE` retryable candidates)                                                                                                                                                                                                                                                                                                                                                |
| `/products/exception-queue`                                | Retired — redirects to `/products/pipeline?tab=exception` (dead-lettered evaluation failures only, never ordinary rejections)                                                                                                                                                                                                                                                                                                                                                  |
| `/products/shortlisted`                                    | Retired — redirects to `/products/pipeline?tab=ready`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/api/internal/catalog/evaluate-tick`                      | Protected (`CRON_SECRET` bearer token) - **break-glass recovery only**: drains the outbox, requeues due retries, evaluates one bounded batch. NOT scheduled; the manual `workflow_dispatch` in `.github/workflows/evaluate-tick.yml` or a direct authenticated call invokes it                                                                                                                                                                                                 |
| `/api/internal/catalog/discovery/start`                    | Protected (`DISCOVERY_CONTROL_SECRET` bearer, constant-time) - idempotent owner Start: creates the durable queue chain once; see [Continuous full-catalogue discovery](#continuous-full-catalogue-discovery)                                                                                                                                                                                                                                                                   |
| `/api/internal/catalog/discovery/pause`                    | Protected - idempotent pause: no new supplier calls; checkpoints and queue/database state retained                                                                                                                                                                                                                                                                                                                                                                             |
| `/api/internal/catalog/discovery/resume`                   | Protected - idempotent resume: re-enqueues every parked, unleased non-terminal partition                                                                                                                                                                                                                                                                                                                                                                                       |
| `/api/internal/catalog/discovery/status`                   | Protected - truthful coverage/budget/outbox/failure status; never claims completion while any partition is unproven                                                                                                                                                                                                                                                                                                                                                            |
| `/api/internal/catalog/evaluations/recheck-policy-version` | Protected (same `DISCOVERY_CONTROL_SECRET`) - bounded, idempotent re-evaluation of decisions taken under an obsolete policy version. Runs **while discovery is paused** and spends no CJ points; see [Re-opening decisions after a policy change](#re-opening-decisions-after-a-policy-change)                                                                                                                                                                                 |
| `/api/webhooks/cj`                                         | CJ webhook receiver: raw-body Base64 HMAC-SHA256 verification (secret = the connection's CJ `openId`, stored encrypted), size-capped, messageId-deduplicated, acknowledged in well under CJ's 3-second window; heavy work happens in the queue                                                                                                                                                                                                                                 |
| `/api/queues/catalog-discovery`                            | Private Vercel Queues push consumer (air-gapped by the platform - no public URL); every message re-validates and re-authorizes against the database                                                                                                                                                                                                                                                                                                                            |
| `/api/storefront/products`                                 | Protected product feed for `sals3-ecommerce`                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/api/storefront/products/[id]`                            | Protected single-product lookup by CJ `pid` for `sals3-ecommerce`'s PDP                                                                                                                                                                                                                                                                                                                                                                                                        |
| `/api/storefront/categories`                               | Protected category feed for `sals3-ecommerce`                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Candidate detail drawer

Clicking any row on `/products/pipeline`, in any tab, opens a read-only detail
drawer at 85% of the viewport width showing everything the database holds for
that candidate.

The open drawer lives in the URL as `?candidate=<uuid>`, alongside the page's
existing `?tab=`/`?q=`/`?page=`, so the view is shareable and the back button
behaves (`MASTER.md` §6 rule 9). It is validated with
`z.string().trim().uuid().catch('')`, so a hand-typed value degrades to "no
drawer" instead of reaching a uuid database predicate.

Five tabs, grouped by the question a reviewer is asking rather than by the table
a field lives in: **Overview** (identity, decision, reason codes, price),
**Stock** (manual attestation, inspection history, per-origin CJ inventory),
**Supplier evidence** (feed snapshot, CJ detail evidence, snapshot provenance),
**Screening & queue** (screening findings, retry/lease mechanics, discovery
signals, provider freshness), and **History** (audit trail, pricing overrides,
whether it was ever drafted into a Sals3 product).

### Three absences that must never look alike

Only **19 of 87,966** candidates have a captured `supplier_snapshots` row
(measured 2026-08-12). So most sections a reviewer opens are empty, and
`CandidateAbsentSection` keeps three different reasons structurally distinct:

| Kind             | Means                                | Treatment                                                 |
| ---------------- | ------------------------------------ | --------------------------------------------------------- |
| `not-fetched`    | We never called CJ for this          | Dashed border, `role="note"`, **no timestamp**            |
| `reported-zero`  | CJ answered, and the answer was none | Solid border, warning pill, **capture time always shown** |
| `never-recorded` | An append-only table has no rows     | Plain text, no pill                                       |

The timestamp is the discriminator: a real observation has one, a fetch that
never happened cannot. A zero from CJ is a fact about the product; an absent
fetch is a fact about our pipeline. Conflating them is how a reviewer concludes
"this has no stock" when nobody ever looked.

Two related rules: a missing scalar inside a populated section renders
`Not captured`, never `—` (a dash reads as "the value is empty"); and
`candidate_evaluations.score` is never rendered as a value at all, because the
column is reserved and always null - a `—` beside a label called "Score" reads
as "scored zero".

### The product photo

The Supplier evidence tab shows one photo at 320px, from
`candidate_evaluations.feed_snapshot.imageUrl` - **the only image address this
database holds**. `supplier_snapshots.evidence` keeps `usableImageCount` and
discards CJ's `productImageSet` inside `countUsableImages()`, and
`product_media_sources` is empty and keyed to `products.id`. So there is no
gallery, and there cannot be one until someone funds a CJ re-fetch and persists
the addresses.

Three implementation details that are easy to "fix" into a regression:

- **No `sizes`, deliberately.** Without it Next takes the `x` branch of
  `getWidths` and emits `384w` @1x + `640w` @2x for a 320px box. Add any `vw`
  token and it switches to the `w` branch, whose _smallest_ candidate is 640w -
  so the CDN gets asked for 640px to fill 320px. `CandidateFeedImage.test.tsx`
  asserts the density descriptors for exactly this reason.
- **No `priority`.** base-ui's `Tabs.Panel` defaults to `keepMounted = false`, so
  the image does not exist in the DOM until that tab is opened. Nothing to
  preload, and it is never the LCP element.
- **An absent address is a capture gap, not "no photo".** The copy names all
  three real causes, including that a non-allow-listed host is dropped and is
  therefore indistinguishable from an absent one. When evidence counted usable
  images but stored no address, the copy says so rather than leaving the reviewer
  to reconcile "3 usable images" with an empty box.

`imageUrl()` in `candidate-view.ts` now **re-checks the host on the read path.**
It previously claimed the address "was allow-listed at intake", which was an
assertion about a different code path: `feedSnapshotSchema.imageUrl` is a plain
string, `images.loader: 'custom'` means `remotePatterns` enforces nothing at
request time, and the loader passes a non-CJ address through unchanged. So any
value that reached that column - a manual `UPDATE`, a backfill, a script - became
a browser `GET` from the seller's session. Three lines close it for both call
sites.

### Open/close cost

Measured with `SALS3_DB_LOG=1 npm run dev`, one render of `/products/pipeline`:

|                             | Statements                 |
| --------------------------- | -------------------------- |
| Before                      | **12** (close) / 19 (open) |
| After `React.cache` dedup   | **10**                     |
| After the count cache, warm | **4**                      |

What was being wasted: the same `seller_accounts` row was read **three times**
per render, and `countCandidateStatusSummary` - three statements - ran **twice**,
once for the nav rail badges and once for the tab bar. Six scans for one answer,
on every navigation including every drawer open and close. With one seller
account the `sellerAccountId` filter narrows nothing, so each scan reads the whole
table.

Four changes, none of them a migration:

- `React.cache` on `getRawAuthSession`, `getSession`, and a new
  `src/lib/auth/seller-account.ts` reader. `seller-account.guard.test.ts` scans
  the auth and portal layers so a future direct repository call cannot silently
  opt out. Note what must NOT be wrapped: `findSellerAccountByIdentityId` itself
  takes an executor and is called with a transaction, so memoizing it would serve
  a pre-insert value to a read that must see its own write.
- `status-counts-cache.ts` - `unstable_cache` at 30s, tagged, wrapped in
  `React.cache`. The seller id travels as an _argument_, so it is part of the
  cache key and tenant isolation is structural. `resolveCandidateDetail` must
  never go here: the cache persists via `JSON.stringify` and its `Date` fields
  would come back as strings with a green typecheck.
- Invalidation differs by caller, and the difference matters: route handlers use
  `revalidateTag(tag, 'max')` (stale-while-revalidate, so a queue message cannot
  stall the next render), while the `recheckCandidateNow` **Server Action** uses
  `updateTag` for read-your-own-writes - the person who clicked must see the row
  leave its bucket on the response they are already waiting for. That action had
  no revalidation at all before.
- `useTransition` + `aria-busy` + a `data-pending` row tint, and an instant local
  close on the sheet. The affordance has to live on the `<tr>` itself: cells
  arrive as opaque `children` from five tables with five column counts, so a
  spinner cell would break that row's alignment.

**Known consequence of caching the counts:** the same value feeds the pipeline's
`total`, so for up to 30 seconds a tab can read "412" above 413 rows, and on a
page boundary a seller can be clamped back one page. Both self-heal. That is the
argument for the short TTL, and the reason `revalidate: false` would be wrong even
with correct invalidation.

### Notes for whoever changes this

- **The drawer is strictly read-only.** No Customize & List, no Recheck now, no
  stock attestation. Controls that already live inside a row keep working: the
  row's click handler ignores events from `a`/`button`/`input`/`select`/
  `[role=menuitem]` descendants.
- **`resolveCandidateDetail` is the authorization boundary.** Its seller filter
  is in the same `WHERE` as the lookup, and a cross-tenant or unknown id costs
  exactly one statement, so no child table - including `audit_events`, which has
  no tenant column - is ever read for an id that is not the seller's.
- **`audit_events.payload` is now rendered to a seller.** Safe today by audit,
  not by construction: every candidate-scoped writer records shallow,
  credential-free scalars. Check any new audit payload against this surface.
- **Every row click re-runs the whole page render** (`force-dynamic` plus a URL
  change), so opening the drawer re-executes the tab's count and page queries as
  well as the seven detail statements. If that latency bites, the escape hatch
  is a parallel route slot so only the drawer re-renders.
- **Middle-click and open-in-new-tab do not work on a row.** A `<tr>` cannot
  hold an anchor spanning every cell without breaking table semantics, so the
  row navigates via `router.push`. The resulting URL is still shareable.

## Product Sourcing paging and search

`/products/pipeline` is one screen with six tabs (`?tab=all|ready|needs-attention|evaluating|blocked|exception`).
Every tab is **paged server-side**: `PIPELINE_PAGE_SIZE` (100) rows a request
via `?page=`, with Previous/Next links and a `Page X of Y · N candidates`
label. The page header reports the tab's **total**, not the rows in view.

Why paging rather than one big table: a tab routinely holds tens of thousands
of candidates - a market policy that blocks the discovered feed puts the whole
feed in Blocked / Rejected - and one server-rendered table of 86,605 rows is
tens of megabytes of HTML and hundreds of thousands of DOM nodes. A request is
hard-capped at 200 rows (`MAX_ROWS_PER_REQUEST`); paging, not a bigger cap, is
how the rest is reached.

Search (`?q=`, the "Product name, ID, or SKU" box) runs **in SQL against the
whole tab**: CJ product id, captured evidence name, evidence SKU, and the
ingestion-time `feed_snapshot.name`. It used to re-filter only the rows the
page had already fetched, which reported "No matches" for a product sitting
past the first page. The term is a bind parameter and its LIKE wildcards are
escaped (`searchCondition` in `src/modules/catalog/candidates/queries.ts`,
asserted in `queries.pipeline.test.ts`).

Ready and Needs Attention rows now have a checkbox column and an
`Add to Product Catalogue` action. The action calls the existing protected
candidate-to-draft import flow, then `/listings` reads the persisted Product,
Variant, Offer, provider-reference, and snapshot data. Rows already represented
in Product Catalogue are highlighted in light blue. The import does not call CJ
and does not mark a database row live unless the real publish gates have done
so.

Two limitations worth knowing:

- **No trigram index.** The name/SKU search is a sequential ILIKE scan over
  the seller's candidate rows. Fine at ~90k rows; if a seller's pipeline grows
  by an order of magnitude, add a `pg_trgm` index (needs a migration and the
  extension) rather than accepting a slow page.
- **A row shows its CJ product id only when no name was ever captured.**
  Until 2026-08-12 every pipeline table read the name from
  `supplier_snapshots.evidence` alone, which exists only after a per-product
  detail fetch - so a screening-blocked row, decided before any CJ evidence
  call, rendered its numeric provider id. That was never a data gap: the
  ingestion-time `feed_snapshot.name` is written for every candidate from its
  `/product/list` row, which is why name _search_ already worked on rows the
  table refused to name. `displayName` now reads evidence, then the feed
  snapshot, then the id. Measured against production at the time of the fix:
  19 of 87,966 candidates had evidence, 87,966 of 87,966 had a real
  feed-snapshot name, and 87,947 rows changed from an id to a name with no
  backfill and no supplier call.

  `Supplier price` had the same defect and the same fix (`supplierPriceUsd`,
  2026-08-12): the column read `evidence.supplierPriceUsd`, while screening
  decides `INVALID_PRICE` from `feed_snapshot.priceUsdCents` - so the evaluator
  was rejecting rows on a price the table would not show. 87,966 of 87,966
  evaluations carry a feed price and 87,947 rows changed from `—` to a real
  figure. Mind the unit: evidence stores USD, the feed snapshot stores cents.

  What still legitimately reads `—` without evidence, and must not be guessed:

  - `Available stock` and `Stocked origins` come from per-variant inventory,
    which the feed row does not carry at all.
  - `Weight`, `SKU`, `imageUrl` and `providerCreatedAt` were added to
    `feedSnapshotSchema` as optional fields on 2026-08-12, so **every** row
    written before that carries `null` for them - measured: 0 of 87,966. They
    populate for newly discovered candidates only; there is no backfill,
    because the `/product/list` rows those decisions came from are gone.

Verify with:

```bash
npm run test:run
```

## Design system

`design-system/sals3-portal/MASTER.md` holds the global rules (palette,
typography, layout, interaction), and `design-system/sals3-portal/pages/` holds
page-level overrides. Colour and type tokens are defined once in
`src/app/globals.css` and taken from the storefront. Do not write a raw hex value
in a component.

## Authentication, roles, and permissions

Authentication is Better Auth backed by the portal Postgres database. Email
verification is required before login, TOTP is required before Seller Center
entry, and auth rate limits are stored in `auth_rate_limits`. Public signup
can only choose the business model; the server creates an active seller account
with the `seller_manager` role. `portalRole` remains server-owned after signup
and is changed only by owner scripts.

`src/lib/auth/permissions.ts` holds a role-to-permission allow list: `admin`,
`catalogue_reviewer`, `seller_manager`, `seller_staff`, `viewer`. Every server
action and route handler calls `requirePermission` before it reads or writes.

Every Seller Center screen calls `requirePermission` too, so this is real,
server-enforced authorization, not a UI convenience: `overview:read`,
`order:read`, `order:fulfill`, `inventory:read`, `inventory:adjust`,
`finance:read`, `payout:read`, `payout:manage`, `market_rules:read`. The new
listing wizard reuses the existing `product:create`/`product:submit`
permissions rather than adding new ones. `seller_manager` (Owner) holds all of
these; `seller_staff` (Staff) holds everything except `finance:read`,
`payout:read`, and `payout:manage` — Staff cannot open Finances or Payouts,
matching the Market rules page's own description of the two roles. See
`src/lib/auth/permissions.test.ts` for the full asserted matrix.

Two permissions gate CJ candidate work: `catalog.candidate.read` (all five
roles) and `catalog.candidate.shortlist` (`admin`, `seller_manager`,
`seller_staff` — the roles that act, not just look).

For Playwright and local smoke testing only, `PORTAL_TEST_AUTH_BYPASS=1` creates
the old development identity outside production. To try a different bypass role,
set:

```bash
PORTAL_TEST_AUTH_BYPASS=1 PORTAL_DEV_ROLE=catalogue_reviewer npm run dev
```

Accepted values are the five role names above. Anything else falls back to
`seller_manager`. Never set `PORTAL_TEST_AUTH_BYPASS` in production.

## Seller Center screens

Overview, Orders, Inventory, Add Product, Finances, Payouts, and
Market rules. All seven are real, permission-gated Next.js routes, but every
number, order, SKU, and payout on them is static, illustrative placeholder
data — there is no order, inventory, finance, or payout backend in this
repository yet. Each screen's data lives in its own file under
`src/lib/seller-center/mock-data/`, and each carries the same "data reality"
statement in its design doc under `design-system/sals3-portal/pages/`.

What is real: the permission gate on every route (see above), the on-screen
interactions (row selection, the inventory quantity stepper, the listing
wizard's stage toggling, the payout schedule chooser), and the toast +
`Undo` pattern (`sonner`) used by Orders' batch print and Inventory's
stepper — those genuinely change this browser tab's state and can genuinely
be undone, they just do not persist past a reload or reach any backend.

## Product Editor (Add Product from a supplier product)

`Add Product` in the Catalogue nav group (`/listings/new`) has two entry
modes. With no query it renders the blank essentials-first wizard. With
`?fixture=<key>` it renders the **Product Editor** — the screen a
dropshipper uses to customize an already-qualified supplier product before
publishing it, prefilled from the supplier evidence the sourcing pipeline
captured.

The editor is currently a **design preview backed by fictional fixtures**.
It reads no database, calls no supplier API, uses no server action, and
publishes nothing; every change lives in the browser tab and is lost on
reload. The screen says so in a notice at the top.

Open a state directly:

```text
/listings/new?fixture=pass            ready to publish
/listings/new?fixture=attention       publishable, with warnings
/listings/new?fixture=blocked         publishing disabled, three blockers
/listings/new?fixture=mixed-stock     3 of 6 variants out of stock
/listings/new?fixture=market-route    one market lost its route evidence
/listings/new?fixture=price-spike     supplier cost up 34%
/listings/new?fixture=delisted        published listing auto-paused
/listings/new?fixture=stale-evidence  5-day-old evidence, degraded connection
```

Both entry modes are reachable from the navigation — `Add Product` has
`Blank product` and `From a supplier product` sub-items, and the Add
Product page itself offers the same choice — so neither mode depends on
anyone typing a query string.

A second development-only parameter, `?state=`, enters the save and
validation states that a fixture-backed screen cannot otherwise reach
(there is no save to fail and no connection to drop). Combine it with a
fixture:

```text
/listings/new?fixture=pass&state=saving
/listings/new?fixture=pass&state=saved
/listings/new?fixture=pass&state=save-failed
/listings/new?fixture=pass&state=validating
/listings/new?fixture=pass&state=validation-failed
/listings/new?fixture=pass&state=connection-unavailable
/listings/new?fixture=pass&state=session-expired
```

An unrecognised `?state=` value falls back to the normal idle state rather
than erroring. Both preview modes set `robots: noindex` so fictional
content on a real route never reaches a search index.

Any other `?fixture=` value is a 404 — including a real candidate id. That
is deliberate: the editor must never render fictional data under an
identifier a seller could mistake for their own product. For the same
reason `?supplierCandidateId=` is parsed and acknowledged but never
answered with a fixture, and the live `Customize & List` button on
Qualified Products is **not** wired to this route.

Where things live:

- `src/lib/seller-center/mock-data/product-editor.ts` — the eight fixtures.
- `src/lib/seller-center/product-editor/` — types, derived figures
  (`derive.ts`), and `Intl` formatting (`format.ts`).
- `src/components/products/editor/` — the screen itself.

Three rules the code enforces rather than documents:

- **A missing figure is never a zero.** Freight with no route evidence
  reads "Needs route check"; landed cost and margin read "Not available".
  `derive.ts` propagates `null` instead of substituting `0`, and refuses to
  add two different currencies — there is no approved FX source for this
  screen.
- **Required is not the same as recommended.** A missing _required_
  attribute is a hard blocker, a missing _recommended_ one is a warning
  that still publishes, and a missing _optional_ one is a suggestion. The
  readiness panel, the section badge, the field error and the publish
  button all read the same rule.
- **Blocked never looks publishable.** The publish button stays visible and
  prints why it cannot be used; it is never quietly greyed out.

Layout responds to the editor's own **container** width, not the viewport,
so the readiness and preview panels fold into drawers when the portal rail
is expanded and there is no longer room for three columns. This route never
collapses or overrides the seller's sidebar.

## Catalog database (Drizzle + PostgreSQL)

The catalog tables live in this app, so a shortlist write is a Server Action
against the local database — no cross-service HTTP call and no shared service
credential to store or leak.

| Piece                                        | File                                                |
| -------------------------------------------- | --------------------------------------------------- |
| Table definitions                            | `src/lib/db/schema/catalog.ts`                      |
| Client (postgres.js singleton)               | `src/lib/db/client.ts`                              |
| Generated SQL migrations                     | `drizzle/`                                          |
| Drizzle Kit config                           | `drizzle.config.ts`                                 |
| Zod contracts                                | `src/modules/catalog/candidates/contracts.ts`       |
| Queries (write side)                         | `src/modules/catalog/candidates/repository.ts`      |
| Shortlist use case                           | `src/modules/catalog/candidates/shortlist.ts`       |
| Queries (read side)                          | `src/modules/catalog/candidates/queries.ts`         |
| Server Action (manual recheck)               | `src/app/(portal)/products/actions.ts`              |
| Shared CJ Zod primitives                     | `src/lib/cj/primitives.ts`                          |
| CJ enrichment schemas                        | `src/lib/cj/enrichment-schemas.ts`                  |
| CJ evidence normaliser                       | `src/lib/cj/evidence.ts`                            |
| CJ evidence fetch (per-connection adapter)   | `src/modules/suppliers/providers/cj/cj-adapter.ts`  |
| Evidence fetch + decide (automated pipeline) | `src/modules/catalog/candidates/evaluate.ts`        |
| Continuous discovery (queue-driven)          | `src/modules/catalog/discovery/`                    |
| Provider connections (ADR-006/ADR-008)       | `src/modules/suppliers/repository.ts`               |
| Encrypted credential store                   | `src/lib/secrets/postgres-supplier-secret-store.ts` |

Twenty-five tables: `supplier_candidates` (the shortlist record, unique on
`(supplier_connection_id, external_product_id)`), `idempotency_records`,
`supplier_snapshots` (one normalised CJ evidence record per candidate),
`candidate_evaluations` (one automated-evaluation record per candidate - see
[Automated candidate evaluation](#automated-candidate-evaluation)),
append-only `audit_events`, and five multi-tenant tables added for
[Supplier Apps](#supplier-apps-multi-tenant-provider-connections):
`seller_accounts`, `supplier_providers`, `supplier_connections`,
append-only `supplier_account_bindings`, and
`supplier_connection_secrets`. Continuous discovery (migration `0009`,
**not yet applied anywhere** - see
[Continuous full-catalogue discovery](#continuous-full-catalogue-discovery))
adds `discovery_run_states`, `discovery_cycles`, `discovery_partitions`,
`discovery_reconcile_pids`, `work_outbox`, append-only `discovery_failures`,
`supplier_request_budgets`, `webhook_inbox`, `product_subscriptions`, and
`supplier_webhook_secrets`. Authentication adds `auth_users`,
`auth_sessions`, `auth_accounts`, `auth_verifications`, `auth_two_factors`,
and `auth_rate_limits`.

`src/modules/catalog/candidates/shortlist.ts` and `contracts.ts` are retired
(stubbed to an empty export) - superseded by the automated pipeline. Kept as
empty files rather than deleted because of a sandbox restriction encountered
while building this; safe to delete outright.

- **Server-only.** `DATABASE_URL` has no `NEXT_PUBLIC_` prefix, and
  `src/lib/db/client.ts` throws if it is ever imported from client code.
- **Required in deployed/build environments.** Authentication is database
  backed, so `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and
  Resend env vars must be configured anywhere the app is built or served.
- **Least privilege.** Connect as an app role, not `postgres`. Any non-local
  host is connected with `ssl: 'verify-full'`.
- **Bounded.** One pooled connection set (`max: 10`) reused across dev
  hot-reloads, so editing a file does not leak pools.
- **Untrusted input.** The browser sends only a CJ `pid`, checked against an
  allow-listed character set by Zod. Seller, actor, and market context come
  from the server session — never the request.
- **Idempotent.** Every shortlist carries a key; the same key with the same
  payload replays the stored result, and with a different payload is rejected.
  Only a SHA-256 of the payload is stored, never the payload.
- **Race-safe.** Inserts use `ON CONFLICT DO NOTHING` rather than
  check-then-insert, so two concurrent clicks cannot create a duplicate.
- **Rate limited.** Per-actor token bucket (`src/lib/rate-limit.ts`), in
  process — a deliberate choice over adding Redis for a handful of employees.
  Move to a shared store if the portal ever runs more than one instance.

### CJ evidence capture

Shortlisting also fetches fresh CJ evidence and stores it as one snapshot per
candidate. Three calls per candidate, deliberately:

| Call                                        | Why this one                                                                                                                  |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `GET /product/query?pid=`                   | Detail **and** variants — the payload already embeds `variants`, so the separate `/product/variant/query` call is unnecessary |
| `GET /product/stock/getInventoryByPid?pid=` | Per-warehouse totals **and** per-variant stock in one response, instead of one call per `vid`                                 |
| `GET /product/productComments?pid=`         | Supplier-platform review evidence                                                                                             |

Two things verified against the live API on 2026-08-07 that are easy to get
wrong, and are both covered by regression tests:

- `variantInventories` comes back in a **different order** from the detail
  response's `variants`. Join on `vid`, never on array index.
- The two inventory levels use **different field names** for the same idea:
  product-level warehouse entries use `totalInventoryNum`, per-variant entries
  use `totalInventory`. Sharing one schema silently reports every variant as
  having no stock while real stock exists.

Calls run sequentially with a delay because CJ allows one request per second,
and every response's `pointsInfo` is logged so remaining quota is observable
rather than discovered through a 429.

Freight (`/logistic/freightCalculate`) is **not** called: it needs an approved
destination market, and ADR-003 has not approved one.

If CJ is unreachable, the candidate is still shortlisted and the drawer says
evidence could not be fetched — never that there is none.

### Continuous full-catalogue discovery

Discovery of CJ's catalogue runs as a **durable, self-continuing queue
chain** - Neon PostgreSQL as the authoritative state store plus private
Vercel Queues as the at-least-once transport (ADR-013 §12). There is **no
cron and no scheduled GitHub Actions tick**. When the official CJ connection
first becomes workable, or an owner-authorized recovery route heals it, the
app persists a queue intent; every later unit of work persists successor
intent in the transactional outbox before publishing it. **The owner's
browser and PC can be closed after the chain starts** - Vercel's managed
queue infrastructure delivers messages and runs the (air-gapped,
platform-invoked) consumer function.

> [!IMPORTANT] Outbox idempotency keys are consumed permanently
> `work_outbox.idempotency_key` is uniquely indexed and **no code path ever
> deletes an outbox row** - `insertOutboxIntents` uses
> `onConflictDoNothing`, so a key that has been used once can never be used
> again for the lifetime of the database. Any self-chaining handler must
> therefore key its successor on the slot the successor is scheduled **for**,
> at a resolution at least as fine as the shortest delay it can pick. Keying
> on the slot the current delivery ran in reuses the in-flight message's own
> key, the successor is silently swallowed, and the chain stops dead with no
> failure recorded anywhere - the outbox row is `DISPATCHED`, nothing is
> `FAILED`, and `.../discovery/status` looks healthy. Two live instances of
> this were found and fixed on 2026-08-12 (the accelerated freshness sweep and
> the curated-lane page walk); a third, `handleAuditUnit`, is inert only
> because its lane never starts.
>
> The rule has a second half that is easy to miss: **a periodic key cannot
> revive a chain, only continue one.** `handleCycleStart` seeds the freshness
> sweep on an hour-resolution key, which is right for something that runs every
> sweep tick - a finer key there would start a new concurrent chain each tick.
> But PAUSE kills the chain wherever it stands, and a RESUME inside that same
> hour cannot re-seed it, because the hour's key is already spent. Observed in
> production 2026-08-12: a Resume at 11:47 could not re-seed hour bucket
> 496259, first claimed at 11:38, so nothing drained the 913-row QUEUED backlog
> for the rest of that hour - while the partition chain stayed healthy and the
> intake gate kept ticking, which is exactly how a dead chain hides. Reviving
> is therefore `startOrResumeConnection`'s job, on a `randomUUID` suffix: a
> control action is not periodic and must not borrow a periodic key.

Coverage semantics (ADR-010 §12.1, ADR-013 §3):

- **Legacy endpoint only.** Discovery uses `GET /api2.0/v1/product/list` and
  never `product/listV2`. There is **no 6,000-record assumption anywhere**:
  that cap is documented for listV2 only, and on the legacy endpoint a total
  of exactly 6,000 or greater is ordinary density data.
- **Three lane semantics.** `BOOTSTRAP` is the one-time historical scan up to
  an immutable bootstrap cutoff. `INCREMENTAL` scans only creation-time
  windows after the stored cursor, with a conservative overlap. A completed
  bootstrap never creates another epoch-to-current historical cycle.
- **`AUDIT` is scaffolding, not a running lane** (verified 2026-08-12). The
  `discovery_audit_units` table, its state enum, and `handleAuditUnit` exist,
  but nothing reaches them: `resolveNextLane` returns `AUDIT` only when a
  caller passes `lane: 'AUDIT'` and no caller ever does, and
  `DISCOVERY_AUDIT_UNIT` is enqueued only by `handleAuditUnit` itself, so the
  self-chain has no first message. Do not "fix" this by seeding the chain
  from `handleCycleStart`. No code ever inserts a `discovery_audit_units`
  row, no code transitions `DUE`/`RUNNING`/`STABLE`/`CHANGED`/`UNRESOLVED`,
  and `listDueAuditUnits` filters on `discovery_audit_units.id IS NULL`
  without comparing `next_audit_due_at` to now - so a seeded chain would
  re-enqueue the same already-proven partitions every sweep forever and spend
  CJ points on repeat work that never advances any state. The audit-unit
  lifecycle has to be built before the lane is started.
- **Immutable lane windows.** Every cycle snapshots `cycleCutoff`; incremental
  cycles also snapshot `windowFrom` and `safetyOverlapSeconds`. An unresolved
  incremental range is stored as an obligation, while later windows can still
  continue from the scan cursor; the proven watermark advances only across
  fully covered ranges.
- **Category roots from the provider tree.** Bootstrap start fetches
  `GET /product/getCategory` once, persists the leaf snapshot immutably, and
  seeds two roots per leaf: an open-start sentinel (products before the
  configurable `CJ_DISCOVERY_EPOCH`) and the epoch-to-bootstrap-cutoff range.
  Incremental cycles seed only window roots; they never recreate open-start
  or epoch-to-current roots. Identity is the provider category id, never the
  label.
- **Density-driven adaptive splitting.** A partition reporting more than one
  full page (200) bisects by time, then by price at provider precision, with
  inclusive-overlap boundaries and global PID deduplication so
  inclusive/exclusive ambiguity cannot lose a boundary product.
  Non-progressing splits are refused.
- **Atomic-bucket reconciliation.** When the minimum time-and-price bucket is
  still dense, every page is enumerated under the immutable filters and fixed
  `orderBy=createAt&sort=asc` ordering, resumably and rate-limited. Coverage
  is proven only by **two consecutive complete passes with identical
  sorted-unique-PID checksums AND a unique count equal to the reported
  total**. A bucket that never converges within bounded retries becomes
  `PROVIDER_COVERAGE_UNRESOLVED` - visibly unresolved.
- **No silent omission, no false completeness.** Invalid provider pagination
  (wrong page identity, inconsistent totals, overflow, empty-with-remaining,
  malformed identities, ...) is rejected fail-closed: nothing ingests, no
  cursor advances, the exact error is recorded. A cycle becomes `COMPLETE`
  only when every partition proved coverage; any unresolved or failed
  partition forces the visible `COVERAGE_UNRESOLVED` terminal state instead.
- **Status at discovery.** Every valid new PID is upserted with its candidate
  row, its non-null `QUEUED` evaluation row, an admission audit event, and
  its `EVALUATE_CANDIDATE` outbox intent in ONE transaction - no discovered
  product can exist without a persisted lifecycle status.
- **Freshness tiers + recovery sweep.** Qualified-but-unselected decisions
  refresh within 72 hours; other operational nonterminal rows within 30
  days; permanent `BLOCKED` only on a policy/evidence version or supplier
  data change. Selected/imported/live products (once that layer exists) get
  webhook-driven updates plus daily reconciliation. The same self-chaining
  sweep also requeues every decided row whose stored policy version is
  obsolete (admission `POLICY_VERSION_CHANGED` - no historical `PASS`/
  `BLOCKED` stays silently active under an old rule pack) and re-enqueues
  evaluation messages for stranded rows (`QUEUED` gone stale, `EVALUATING`
  with an expired lease), so a lost or delivery-cap-parked message can never
  leave a product in-flight forever.
- **Budget safety.** A database-backed shared limiter enforces one supplier
  request per second per connection (the documented lowest tier) across all
  concurrent workers - discovery pages acquire a slot per request, and
  evaluation evidence calls run through a governed fetch wrapper that gates
  every HTTP call on the same limiter; `pointsInfo` from every response
  (list and evidence alike) is persisted, **except** a report whose `total`
  is absent or non-positive. CJ attaches `pointsInfo` to every response, but
  endpoints outside the points system - `GET /product/productComments`, which
  the documented cost table does not list - return
  `{total: 0, usedToday: 0, remaining: 0}`. Those zeros mean "this endpoint
  has no quota to report", never "the account is out of points", and
  persisting them deadlocked the pipeline: `getCandidateEvidence` calls
  comments last, so every successful evaluation overwrote the ledger with
  zeros, after which the budget check refused all background work until the
  next UTC reset. A stored total of `0` is likewise read back as "unobserved"
  rather than as a real quota of zero, and a `remaining` observed before the
  most recent 00:00 UTC reset is treated as unknown - it describes
  yesterday's allowance, and trusting it would refuse the very calls whose
  responses would correct it.
  Background work may spend at most 80% of known available points (20%
  reserved for selected/live/order-critical work). Low current `remaining`
  no longer parks broad work until UTC midnight by default; retry time is
  projected from current `pointsInfo`, endpoint cost, `total / 1440`
  per-minute refill, and a safety margin. HTTP 429 persists a bounded pause
  and continues via a delayed queue message - never a function kept alive
  sleeping.
- **Webhook freshness.** Product/variant/stock webhook subscriptions are
  tracked by desired/observed state and priority class. Product IDs are
  reconciled in documented batches of at most 100, never through
  `subscribeAll`. Order-linked and live products outrank selected/importing
  products, which outrank ordinary Ready products; the Ready tier respects a
  capacity buffer and leaves shortages visible instead of evicting protected
  products.

Queue operations: `DISCOVERY_CYCLE_START` (lane ensure/seed/sweep - also the
self-healing heartbeat), `DISCOVERY_PARTITION`, `DISCOVERY_AUDIT_UNIT`,
`EVALUATE_CANDIDATE`, `RECONCILE_PRODUCT` (freshness sweep + per-product
reconcile), `WEBHOOK_EVENT`, `OUTBOX_DISPATCH`. Every handler validates its
message with Zod, claims work through database leases with exact
compare-and-swap predicates (state, version, lease token, unexpired lease),
performs a bounded unit of work, persists successor intent durably, and
publishes successors before acknowledging - so duplicate and out-of-order
at-least-once deliveries can delay work but never corrupt state or
double-spend a supplier call.
Failed work lands in PostgreSQL (`discovery_failures`, outbox `FAILED` rows,
partition `FAILED`/`PROVIDER_COVERAGE_UNRESOLVED` states) because the
transport has no application dead-letter queue.

Operating it:

1. **Deploy** (owner action). Apply migrations through `0015` first -
   `npm run db:migrate` is an owner-run step and has NOT been executed by
   this implementation. Deploying the application without it is a live
   outage, not a degraded mode: on 2026-08-12 production served the
   post-`0013` build against a database migrated only through `0010` and
   `/products` returned `42703 column ... does not exist` on every request,
   while every `DISCOVERY_PARTITION` delivery threw against the missing
   `0014` intake-gate tables until the delivery cap parked it. Vercel never
   runs migrations - no workflow in `.github/` invokes `db:migrate` - so the
   application and the schema can only be kept in step by running this
   command against the production database as part of the same release.
2. **Automatic start**: the official CJ connect/reconnect path persists and
   publishes a chain intent after the connection becomes workable. The old
   "heal on the first authorized All Supplier Products page load" behaviour
   was removed on 2026-08-12: under the CJ call-budget decision a page render
   must not start background supplier work. Use the explicit Start route
   below instead.
3. **Recovery start**: `POST /api/internal/catalog/discovery/start` with
   `Authorization: Bearer $DISCOVERY_CONTROL_SECRET`. Idempotent; concurrent
   or repeated calls converge on one chain (a partial unique index allows at
   most one active cycle per connection). After bootstrap completes, recovery
   chooses incremental rather than another historical cycle.
4. **Pause / resume**: the matching `POST .../pause` and `.../resume` routes.
   Pause stops new supplier work while keeping every checkpoint; in-flight
   work finishes its local transaction only. Resume re-enqueues all parked
   work.
5. **Inspect**: `GET .../status` reports run states, lane/cycle coverage
   counts, incremental watermark, unresolved partitions with reasons,
   subscription priority counts, points/refill state, outbox depth, recent
   failures, and the storage guard - and never claims completion while any
   required partition is unproven.

### Re-opening decisions after a policy change

Raising `POLICY_VERSION` (or a composed part of it, such as the
buyer-destination policy) is meant to re-open every decision taken under the
old string. Automatically that happens inside the `RECONCILE_PRODUCT` sweep,
which returns early unless the run state is `RUNNING`. Reaching it therefore
means resuming, and resuming also restarts broad discovery - partitions and
curated lanes - which does spend CJ points. When the intent is only "re-decide
what is already stored", that is the wrong trade.

`POST /api/internal/catalog/evaluations/recheck-policy-version` does the
re-opening on its own, bounded per call:

```bash
curl -X POST "$PORTAL/api/internal/catalog/evaluations/recheck-policy-version" \
  -H "Authorization: Bearer $DISCOVERY_CONTROL_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"limit":600}'
```

It returns rows to `QUEUED` with admission `POLICY_VERSION_CHANGED`, publishes
their evaluation messages, and reports `requeued` plus `remaining` per
connection so the next call is an informed decision rather than a guess.
`limit` defaults to 600 and is capped at 600. Re-running is safe: a duplicate
message finds nothing claimable.

It runs while discovery is **paused**, deliberately, and this is only sound
because a re-evaluation spends nothing. `evaluateCandidate` screens from the
stored `feed_snapshot` and the resolved policy, records the decision, and
returns - it holds no supplier adapter and issues no CJ request, which its own
audit payload asserts as `supplierEvidenceFetched: false`.
`handleEvaluateCandidate` has no run-state gate either, so the queue drains
these with broad discovery still stopped.

Two things worth knowing before leaning on it:

- **`handleEvaluateCandidate` still runs a points-budget gate** sized for an
  evidence fetch (`PRODUCT_QUERY_POINTS_COST * 2`) that no longer happens -
  its docstring still describes a `screening -> evidence fetch ->
qualification` flow, and the `fetchImpl` it passes is unused. A low
  observed `pointsRemaining` can therefore refuse work that would have cost
  nothing. Not fixed here.
- **"Recheck now" on a single row does not currently complete.**
  `requeueForManualRecheck` sets `QUEUED` but enqueues no message, so the row
  waits for the stranded sweep (needs `RUNNING`) or the break-glass tick. The
  seller sees a success that does not finish. Not fixed here.

| Piece                           | File                                                      |
| ------------------------------- | --------------------------------------------------------- |
| Queue message contracts         | `src/modules/catalog/discovery/messages.ts`               |
| Transport boundary              | `src/modules/catalog/discovery/queue-transport.ts`        |
| Transactional outbox            | `src/modules/catalog/discovery/outbox-repository.ts`      |
| Consumer dispatcher             | `src/modules/catalog/discovery/dispatcher.ts`             |
| Cycle ensure/seed/sweep         | `src/modules/catalog/discovery/handle-cycle-start.ts`     |
| Partition prove/split/reconcile | `src/modules/catalog/discovery/handle-partition.ts`       |
| Adaptive split planning         | `src/modules/catalog/discovery/partition-plan.ts`         |
| Pagination validation matrix    | `src/modules/catalog/discovery/page-validation.ts`        |
| Coverage checksums              | `src/modules/catalog/discovery/coverage-checksum.ts`      |
| Lane/watermark/proof state      | `src/modules/catalog/discovery/lane-repository.ts`        |
| Rate/points budget              | `src/modules/catalog/discovery/budget-repository.ts`      |
| Storage guard (Neon pilot)      | `src/modules/catalog/discovery/storage-guard.ts`          |
| Webhook verification            | `src/modules/catalog/discovery/webhook-verify.ts`         |
| Subscription reconciliation     | `src/modules/catalog/discovery/subscription-reconcile.ts` |
| Owner controls                  | `src/modules/catalog/discovery/control.ts`                |

**Rollout blockers (deliberate, documented):** CJ documents the
`createTimeFrom/To` format (`yyyy-MM-dd hh:mm:ss`) but NOT its timezone, and
no provider-earliest timestamp is documented. `CJ_CREATE_TIME_TIMEZONE`
(default UTC) and `CJ_DISCOVERY_EPOCH` (default 2016-01-01, a labelled
assumption bounded by the open-start sentinel partitions) are configuration,
and a separate owner-authorized read-only sandbox probe must verify the real
timestamp interpretation, boundary inclusivity, price precision, total/page
consistency, and ordering stability before production rollout. Vercel Queues
is public beta (`queue/v2beta` trigger) and its Hobby-plan billing allotment
is not published - treat queue availability/cost on the current plan as a
deploy-time verification step.

**Development-pilot limits (not production capacity):** Vercel Hobby and
Neon Free are development-pilot constraints. Neon Free's 0.5 GB allowance
may not fit the entire CJ catalogue - the storage guard warns at ~70% of the
configured allowance (`NEON_STORAGE_ALLOWANCE_BYTES`) and pauses new broad
discovery at ~80%, and never deletes accumulated product/evidence records.
The architecture supports full scale; the free pilot must not be represented
as production-ready full-catalogue capacity. Local tests prove the logic,
not real coverage: actual full-catalogue completion requires the deployed
pilot, the contract probe, the owner-run migration, sustained queue
operation, and zero unresolved coverage partitions.

## Lean All Supplier Products intake

Owner decision 2026-08-12 (ADR-013 §1a/§1b). **CJ points and QPS are a
constrained shared operational resource**, reserved first for real
customer- and order-critical work. Discovery, browsing, review, and refresh
must conserve them.

The lean-intake tables and controls are created by
`0014_lean_supplier_intake.sql`. It follows the canonical catalog migration
`0013_cold_timeslip.sql`; apply both through the normal `npm run db:migrate`
flow on a fresh or correctly migrated database. `0016_rolling_pid_waves.sql`
then converts any existing lifetime-cap ledger into rolling 600-product waves
by freezing the current wave at the already-admitted count until active
pipeline work drains.

### What no longer calls CJ

| Action                                 | Before                                  | Now                     |
| -------------------------------------- | --------------------------------------- | ----------------------- |
| Rendering `/products`                  | live `/product/list`                    | Sals3 database read     |
| Typing in the search box               | live `/product/list` per keystroke      | Sals3 database read     |
| Changing a filter, quick view, or page | live `/product/list`                    | Sals3 database read     |
| Opening Supplier Source Details        | (drawer showed fetched evidence)        | persisted snapshot only |
| Evaluating a raw candidate             | `/product/query` + inventory + comments | local screening only    |
| The 72-hour / 30-day freshness timer   | re-fetched CJ evidence                  | retired entirely        |

`candidates/evaluate.ts` decides from the `/product/list` summary persisted
at ingestion. `nextRefreshAtFor` now returns `null` for every status: the two
real triggers stay event-driven — a supplier data change (`fingerprint`
requeue at ingestion, plus the webhook source-change path) and a
policy-version change (`requeuePolicyVersionMismatches` in the sweep, which
re-evaluates unchanged rows including `BLOCKED`).

Historical `supplier_snapshots` rows and every `audit_events` record from the
previous evidence-based implementation are **left untouched and remain
readable**. They are history, not current stock, and nothing re-fetches them.

`src/modules/catalog/no-supplier-evidence-in-raw-intake.test.ts` scans the
real runtime source (comments stripped) for `/product/query`,
`getInventoryByPid`, `productComments`, freight, and AI-service markers, and
asserts the All Supplier Products UI subtree imports no supplier client at
all. A future edit that reintroduces one fails there, not in review.

### Manual stock review

Stock is its own axis, separate from the lifecycle decision:

| State                       | Meaning                                                                        |
| --------------------------- | ------------------------------------------------------------------------------ |
| `STOCK_NOT_CHECKED`         | Honest unknown. Never rendered as "in stock", never as a failure. The default. |
| `MANUALLY_IN_STOCK`         | A person saw stock on CJ/MyCJ.                                                 |
| `MANUALLY_NO_INVENTORY`     | A person saw none. Routes to **Needs attention**; recoverable, never a block.  |
| `MANUALLY_COULD_NOT_VERIFY` | A person tried and could not establish it. Also visible attention.             |

Recording one is `recordManualStockCheck` in
`src/app/(portal)/products/actions.ts`. Server-side controls, in order: Zod
validation → authenticated dropshipper account → the new
`catalog.candidate.stock_attest` permission (admin, seller_manager,
seller_staff; **not** viewer or catalogue_reviewer) → per-actor rate limit →
exact ownership → a compare-and-set on `stock_review_version`. A cross-tenant
id, a missing row, and a stale or duplicate submit all return the identical
`not_found_or_stale`. The note is length-bounded and credential-redacted, the
observed time is server-set (a caller-supplied backdate is refused), and the
write appends to `candidate_stock_attestations` plus an `audit_events` row
recording `evidenceKind: MANUAL_SUPPLIER_WEBSITE_INSPECTION` and
`supplierApiCalled: false`.

There is deliberately **no** "check inventory through the CJ API" button. No
supplier credential or supplier deep link is exposed to seller staff.

### Rolling new-PID intake waves — active policy

`CATALOG_NEW_DISCOVERY_WAVE_SIZE` (default **600**) controls **new unique CJ
product PIDs admitted per supplier connection per wave**, not HTTP requests.
After a wave fills, discovery pauses new `product/list` calls until every
`QUEUED`, `EVALUATING`, and retryable Candidate Pipeline row settles. An unset
value means the default; a value that is present but not a positive integer
throws where discovery records it, rather than silently becoming a different
wave size.

Enforcement lives in `discovery_pid_capacities`. `limit_value` is the current
wave edge. Capacity is taken by a conditional
`UPDATE ... WHERE admitted_count < limit_value` **inside the same transaction
that inserts the candidate**, so concurrent workers and at-least-once
redelivery cannot race past it, and a database CHECK constraint backs it up.
Re-observing a known PID consumes nothing; a worker that loses an insert race
returns its unit.

Before any supplier page, a lane requires remaining wave capacity ≥ the page
size, so a page it could not fully ingest is never requested. A full wave with
active work persists `NEW_PID_WAVE_DRAIN_PENDING`, records the active count,
advances no checkpoint, claims no coverage, and leaves the unit resumable.
When active work reaches zero, the next request atomically opens the next wave
at `admitted_count + 600`.

**A wave waits only on the products that wave admitted.** The active-work count
is bounded by `discovery_backlog_gates.activation_at`, so pre-cutoff rows never
hold a wave hostage. Without that bound the first wave is the only one that can
ever open: the historical pipeline is far larger than any wave, and any row of
it returning to `QUEUED` re-blocks intake indefinitely.

### Strict curated intake priority — active policy

Owner intake priority for filling each rolling 600-PID wave (2026-08-12):

| Rank | Producer                   | Provider query                                             |
| ---- | -------------------------- | ---------------------------------------------------------- |
| 1    | `CJ_TRENDING`              | `searchType=2`                                             |
| 2    | `CJ_MOST_LISTED`           | `orderBy=listedNum&sort=desc`                              |
| 3    | `CJ_NEW_ARRIVALS`          | `orderBy=createAt&sort=desc` + bounded `createTimeFrom/To` |
| 4    | coverage partition scanner | category/time/price partitions                             |

`CURATED_LANES` is the single source of that ranking; nothing else restates it.

Arbitration happens in `assessIntakeGate`, the one pre-flight both producers
already call before any supplier request. Each caller passes an `intent`, and is
refused with `HIGHER_PRIORITY_INTAKE_PENDING` — naming the lane that holds the
floor — while anything above it can still contribute to the current wave. The
partition scanner yields to every eligible lane; `CJ_TRENDING` is never refused
for priority, so the order cannot deadlock. `CURATED_MAX_PAGES` is what
guarantees a lane eventually reports exhaustion and releases the floor, so
raising it means re-checking this.

Eligibility is **one-way and permanent** (owner decision 2026-08-13), held in
`discovery_curated_lanes.exhausted_at_wave_limit`: the wave edge at which a lane
reported it could contribute nothing more — provider pages ran out, or its one
25-page walk (`CURATED_MAX_PAGES`) completed — recorded in the same
compare-and-set as the finish it describes. **Any non-null mark means the lane
is done for good**; the value is only history. Trending runs until it can give
no more, then Most listed, then New arrivals, then the partition scanner fills
every later wave. A lane with no row yet counts as eligible, so it always gets
its first turn.

This replaced wave-scoped eligibility, under which every new wave edge re-ran
every finished lane: observed 2026-08-12, trending re-walked its whole set at
each of five wave edges to contribute 0 new products after the first, stalling
every wave transition. The accepted trade: whatever enters a sort's top 2,500
later is the partition scanner's to find, and `CJ_NEW_ARRIVALS` covers one
fixed 14-day window, once. **No code path re-arms a finished lane.** Re-opening
one someday is a deliberate manual step:

```sql
UPDATE discovery_curated_lanes SET exhausted_at_wave_limit = NULL WHERE lane = 'CJ_TRENDING';
```

Two things this deliberately costs, per the owner's decision: coverage-partition
progress pauses while curated lanes run, so the catalogue cannot be claimed
complete during a wave; and a parked partition is expected — its
`discovery_failures` detail names the lane holding the floor, so a quiet
partition chain is explicable rather than mysterious.

The curated seed key carries the wave edge **and the lane's `stateVersion`**
(`wave:{limitValue}:v{stateVersion}`), not a day bucket. The day bucket allowed
exactly one run per lane per day while the partition scanner ran thousands of
times — measured 2026-08-12 at 609 `DISCOVERY_PARTITION` messages per 20
minutes — so the curated lanes could never fill a wave before it.

The version half is not cosmetic. A wave-only key is spendable exactly once per
wave, so a worker that died holding a lane's lease left **nothing** able to
re-enqueue that lane for the rest of the wave — and because the lane still held
the intake floor, every producer behind it stalled too. Seen in production the
same day: `CJ_TRENDING` sat `RUNNING` with 0 pages fetched, its only `wave:600`
key already `DISPATCHED`, while both other lanes and the partition scanner
reported `HIGHER_PRIORITY_INTAKE_PENDING`. `stateVersion` moves on every lease,
pause, and advance, so a lane that has done anything at all yields a fresh key
while an untouched one still de-duplicates. Only eligible lanes are seeded.

`claimDispatchableOutbox` also orders claims by operation, curated lanes ahead of
partitions and evaluation/reconcile ahead of both. That is a useful tie-breaker
when the outbox holds a backlog, but it is not what enforces priority: it orders
which PENDING rows are _published_, and the outbox is normally a pass-through.

### The historical freeze line — active policy

`discovery_backlog_gates.activation_at` is the durable boundary between the
pipeline that existed when lean intake activated and everything discovered
since. Both **automatic** freshness tiers are bounded by it:
`requeueDueRefreshes` and `requeuePolicyVersionMismatches` only re-open rows
for candidates created after that instant.

This exists because two individually correct mechanisms deadlock without it.
The intake gate refuses a new `product/list` request while any evaluation work
is active; the policy-version tier returns rows whose stored policy version is
obsolete to `QUEUED`; and `QUEUED` **is** active work. Measured in production
2026-08-12 with 82,679 rows still on `buyer-destination-country-v1-disabled`:
the backlog climbed `73 → 113 → 288 → 324` while the pipeline ran,
`admitted_count` never left `0`, and the newest candidate stayed a day old.
Re-deciding those rows changed nothing anyway — their `intended_market_codes`
is `[]`, so `checkValidMarket` returns `NO_VALID_MARKET` whatever the enabled
destinations are.

Frozen rows are **not** rewritten. Their stored decision and policy version
stay exactly as recorded, honestly showing what they were judged under; they
remain visible and searchable in Blocked/Rejected.

The freeze is reversible without a deploy.
`POST /api/internal/catalog/evaluations/recheck-policy-version` passes **no**
bound, deliberately, so the owner can re-open the historical backlog in bounded
batches — which is the intended sequence once `intended_market_codes` is
backfilled. `listStrandedEvaluations` is also left unbounded: it only re-drives
rows already sitting in `QUEUED`, so it can recover a stuck pre-cutoff row
without growing the pool.

### One-time existing-backlog drain

Candidate Pipeline work that existed when the policy activated must be
reconciled before broad discovery makes a new `product/list` request.
`discovery_backlog_gates` holds one row per connection with an **immutable
activation cutoff** and a `DRAIN_COMPLETE` state recorded once — retries,
restarts, and future products cannot re-arm it.

Actionable backlog is pre-cutoff work that is still in-flight or retryable:
`QUEUED`, `EVALUATING`, `EVALUATION_FAILED` under the attempt cap, and
`TEMPORARILY_INELIGIBLE` with a retry time. Deliberately excluded so
historical rows cannot deadlock discovery forever: decided rows, settled
policy decisions with no retry clock, and exhausted dead letters (those
belong to the Exception Queue and a person).

`discovery/backlog-drain.ts` is temporary transition code. It re-admits
bounded batches to the **local** screening evaluator, so draining a large
historical backlog costs zero CJ points, and it deletes no candidate,
snapshot, evaluation, or audit event.

### Curated CJ discovery lanes

`discovery_curated_lanes` drives three lanes on legacy
`GET /api2.0/v1/product/list` only — never `listV2`:

| Lane                | Provider parameters                                           | Signal recorded  |
| ------------------- | ------------------------------------------------------------- | ---------------- |
| `CJ Trending`       | `searchType=2`                                                | `CJ_TRENDING`    |
| `Most listed on CJ` | `orderBy=listedNum`, fixed `sort=desc`                        | `CJ_HIGH_LISTED` |
| `New arrivals`      | `orderBy=createAt`, fixed sort, bounded `createTimeFrom`/`To` | `CJ_NEW_ARRIVAL` |

They wait behind the drain gate, share the same PID ledger, request limiter,
and points reserve, and live entirely outside the cycle/partition machinery —
so a curated subset is structurally incapable of marking a partition, cycle,
or catalogue complete, or of masking `PROVIDER_COVERAGE_UNRESOLVED`. A signal
observation never changes lifecycle status, market eligibility, or manual
stock state. `CJ_HIGH_LISTED` derives from `listedNum`, which CJ documents as
platform **listings**, never units sold.

**Known limitation:** a `CJ Trending — more` (`searchType=21`) lane is **not
implemented**. It was authorized only if CJ's real response contract provides
a distinct continuation/result set, and no primary source in this workspace
verifies that; building it anyway would double-report the same products as a
second signal. `searchType` itself is also outside the legacy filter set this
repository verified against CJ's documentation on 2026-08-11, so the Trending
lane's response contract is a labelled assumption until an owner-authorized
probe confirms it. A page that fails validation records an ordinary contract
error and claims nothing.

### Search behaviour

The old table searched after one typed character. Now: input is
whitespace-normalized; fewer than two meaningful characters submits nothing
and shows `Type at least 2 characters to search`, leaving the scoped result
set intact; at two or more it debounces ~350 ms; Enter submits immediately
once the minimum is met; the input is preserved while a request is pending;
clearing restores the unfiltered scoped set; and a committed search change
resets to page one. The database search stays parameterized, LIKE-escaped,
and seller-scoped in the same `WHERE` as the lookup — the debounce and
minimum are a request-volume control, never the security boundary.

### Operational visibility

`GET /api/internal/catalog/discovery/status` reports, per connection:
backlog gate state, activation cutoff, baseline and current actionable
backlog counts, drain completion time; the ceiling's enabled state,
configured limit, admitted count, remaining capacity, and cap-reached time;
and each curated lane's state, cursor, counters, and exact pause reason.

### Retired: the pilot evidence allowance

`CATALOG_PILOT_EVIDENCE_CAP` / `CATALOG_PILOT_BASELINE_COUNT` and
`POST /api/internal/catalog/discovery/pilot/admit` bounded **paid evidence
fetches**. Raw intake no longer makes any, so that gate was removed from
`candidates/evaluate.ts`; the ceiling above is the active control. The route
and its counter remain as a bounded owner-invoked re-screen of an explicit
candidate set, which now costs nothing.

### Automated candidate evaluation

Candidates are never shortlisted by clicking a row - discovery admits them
(see above) and `EVALUATE_CANDIDATE` queue messages drive evaluation. The
break-glass route `/api/internal/catalog/evaluate-tick` remains only as an
authenticated manual recovery action (outbox drain + bounded batch), invoked
by hand - never on a schedule.

```text
discovery partition proves a page of products
  -> ingest: candidate + QUEUED evaluation + admission audit + EVALUATE_CANDIDATE
     outbox intent, one durable transaction per product
  -> claim: the queue handler claims exactly that candidate (FOR UPDATE CAS:
     QUEUED, expired-lease EVALUATING, or a due retry)
  -> screen: cheap rules against feed-level data only (category/brand
     keywords, price sanity) - a hit blocks WITHOUT spending a CJ evidence call
  -> evidence: survivors call the existing CJ evidence fetch (unchanged,
     outside any transaction, ~20-30 points/candidate, budget-gated)
  -> qualify: the full rule set runs against real evidence
  -> decide + persist: one short transaction stores the snapshot, the
     decision (with its freshness deadline), and an audit event
  -> retry: a retryable failure persists a delayed EVALUATE_CANDIDATE
     continuation - the queue replaces the old cron retry scan
```

| Piece                       | File                                                                            |
| --------------------------- | ------------------------------------------------------------------------------- |
| Decision model (schema)     | `src/lib/db/schema/catalog.ts` (`candidateEvaluations`, `evaluationStatusEnum`) |
| Screening rules             | `src/modules/catalog/candidates/rules/screening.ts`                             |
| Qualification rules         | `src/modules/catalog/candidates/rules/qualification.ts`                         |
| Decision combinator         | `src/modules/catalog/candidates/rules/decide.ts`                                |
| Placeholder policy values   | `src/modules/catalog/candidates/rules/policy.ts`                                |
| Product ingest (discovery)  | `src/modules/catalog/discovery/ingest-product.ts`                               |
| Queue evaluation handler    | `src/modules/catalog/discovery/handle-evaluate.ts`                              |
| Per-candidate orchestration | `src/modules/catalog/candidates/evaluate.ts`                                    |
| Break-glass tick            | `src/modules/catalog/candidates/run-tick.ts`                                    |
| Break-glass route           | `src/app/api/internal/catalog/evaluate-tick/route.ts`                           |

Seven decision states: `QUEUED`, `EVALUATING`, `PASS`, `PASS_WITH_ATTENTION`,
`TEMPORARILY_INELIGIBLE`, `BLOCKED`, `EVALUATION_FAILED`. `BLOCKED` is
permanent (no override, e.g. a policy/counterfeit match); `TEMPORARILY_INELIGIBLE`
is retryable (e.g. no stock right now) and shares the Blocked/Rejected screen,
distinguished per row. `EVALUATION_FAILED` retries with exponential backoff and
jitter up to 5 attempts, then dead-letters into the Exception Queue - which
therefore only ever holds genuine operational failures, never ordinary
rejected products.

**No real scoring or category-required-attribute validation exists.** The
`score` column is reserved and always `null`. Image-dimension checks and
category-required-attribute checks are not implemented — CJ's modelled
endpoints return neither, and the latter needs the ADR-002 taxonomy mapping
wired up first (separate task).

**Two checks use labelled placeholders, not an approved policy:**

- The prohibited-category/counterfeit denylist reuses spec section 14.1's own
  "recommended initial exclusions" wording - not invented here - but no
  ADR-002 pilot category/market has actually been approved.
- Price bounds and the margin-floor estimate are env-configured placeholder
  numbers (`CATALOG_MIN_PRICE_USD_CENTS`, `CATALOG_MAX_PRICE_USD_CENTS`,
  `CATALOG_ESTIMATED_OVERHEAD_PERCENT`, `CATALOG_MIN_MARGIN_PERCENT`,
  `CATALOG_ABNORMAL_PRICE_CHANGE_PERCENT` in `.env.example`) — the margin
  estimate reuses the existing prototype `CJ_PRICE_MARKUP_PERCENT` minus a
  placeholder overhead percentage, and is the same for every candidate today
  (not product-differentiated), never a real per-product margin calculation.

**Destination market fixed 2026-08-10 (ADR-014):** the old hardcoded
`INGESTION_MARKET_CODES = ['PH']` / `PLACEHOLDER_MARKET_CODE = 'PH'` are gone.
`src/lib/country-policy/` now separates three concepts that a single
`marketCode` used to blur together:

- `resolveSellerOperatingCountryPolicy()` — where Sals3 the business is
  registered and may operate a seller account. Currently `AU`, enabled, per
  Bogs's 2026-08-10 decision.
- `resolveBuyerDestinationCountryPolicy()` — where customers may purchase and
  receive delivery. **Currently `['AU','PH']`, enabled**, per the owner's
  2026-08-11 decision. AU appears here because it was approved as a
  destination in its own right, _not_ because it is the seller operating
  country — the two lists are separately versioned and neither is derived
  from the other.
- `resolvePortalDisplayCurrency()` — Portal's own temporary seller-facing
  display currency (`AUD`), unrelated to either country policy and unrelated
  to the real `sals3-ecommerce` storefront checkout currency (still USD, see
  `src/lib/storefront/fx.ts`).

`rules/screening.ts`'s `checkValidMarket` runs before any CJ evidence-fetch
call and blocks with `NO_VALID_MARKET` (a recoverable
`TEMPORARILY_INELIGIBLE`, not a permanent block) whenever the market cannot
be proven. It fails closed in three distinct ways, and **the second one is
what bounds the pilot**: a candidate whose own `intended_market_codes` is
empty blocks regardless of the enabled allowlist. Every candidate ingested
while the policy was disabled stored `'{}'`, so enabling `['AU','PH']` does
not by itself admit them — each candidate's scope must be backfilled
explicitly, which is exactly how the pilot cohort is chosen.
`checkValidMarket` checks each candidate's own persisted
`intended_market_codes` against the enabled allowlist, not only whether the
global policy is on: every one of the candidate's destinations must already
be enabled, or it blocks with a detail that distinguishes "no policy
enabled," "this candidate has no destination recorded," and "this
candidate's destination isn't in the enabled set". The subset check is strict
but not narrowing: a candidate scoped `['PH']` passes under an `['AU','PH']`
allowlist, because `PH` is genuinely enabled — approving a destination
admits every candidate already scoped to it, which is the intended behaviour
and the reason widening the allowlist is an owner decision rather than a
configuration tweak. What never happens is the reverse: a candidate is never
widened to a newly enabled country it never asked for, and an unscoped
candidate is never admitted at all.

Changing the buyer-destination `policyVersion` re-opens history on purpose:
the freshness sweep's `requeuePolicyVersionMismatches` requeues every decided
row whose stored version no longer matches, including `PASS` and `BLOCKED`,
so no historical decision stays active under a superseded market policy. A
revert must therefore restore the _exact_ previous version string rather than
inventing a new one, or every row is requeued a second time. A repository guard
(`no-scattered-market-literals.test.ts`) fails the build if a bare `'PH'`/
`'AU'` market-code literal is reintroduced into this module.

The buyer-destination policy is resolved exactly once per evaluation and
composed with the catalog policy version into one stored identity
(`candidate_evaluations.policy_version`, e.g.
`catalog-eval-policy-placeholder-v1+buyer-destination:buyer-destination-country-v2-au-ph`)
via `composeEvaluationPolicyVersion()`, so a later policy-version change can
be detected by string comparison alone - no second column. Every screening
and evaluation audit event also records the catalog policy version, the
buyer-destination policy version/source/effective state/enabled codes, and
the candidate's own intended destination codes, so a decision is always
reproducible from its audit trail.

Multi-tenant as of 2026-08-07: ingestion and evaluation loop over every
seller's own `CONNECTED`/`DEGRADED` [Supplier Apps connection](#supplier-apps-multi-tenant-provider-connections)
instead of one global `CJ_API_KEY` - see that section for the schema,
encryption, and the CJ provider adapter. `dev-user` is still the one
test-only bypass identity when `PORTAL_TEST_AUTH_BYPASS=1`, but real seller
sign-in now uses Better Auth user IDs as `seller_accounts.identity_id`.
AliExpress or any second provider is still a separate, later task - only
`CJ_DROPSHIPPING` is seeded.

Two labelling rules are load-bearing in that panel: CJ review numbers are
supplier-platform evidence and never Sals3 buyer ratings, and `listedNum` is a
platform listing count and never units sold. The supplier `description` is
fetched but deliberately not rendered — it is raw supplier HTML and nothing
sanitises it yet.

`src/lib/seller-center/market-config.ts` carries 3 illustrative sample
markets (Philippines, Indonesia, Singapore) with their own currency, carrier,
tax label, and payout rail — a placeholder for a future per-seller market
configuration, and unrelated to the real `src/lib/country-policy/` seller-
operating/buyer-destination resolvers above: switching this dev display
never changes real policy or `intended_market_codes`.

```bash
PORTAL_DEV_MARKET=SG npm run dev
```

**`getActiveMarket()` returns `null` in production** (fixed after review;
it previously fell back to the `PH` fixture as if it were real
configuration) — production must never present a sample country's currency,
carrier, tax, or payout figures as a seller's actual configuration.
`/finances`, `/payouts`, and the blank listing wizard all check
for `null` and render `MarketNotConfiguredNotice` (an honest "Market
configuration is not available" state) instead of the fixture-backed
screen.

**`/market-rules` no longer uses this fixture at all** — it reads the real
per-seller profile instead; see
[Seller market configuration](#seller-market-configuration). The other
screens above are still fixture-only and have not been migrated; each needs
its own product decision about what to show when an account has no active
destination.

`/orders` is a temporary exception: it is permission-gated but deliberately
does not read or require a seller market profile, so the illustrative parcel
workspace stays available while account setup is in progress. It labels its
parcel data as illustrative and keeps currency, carrier, tax, payout, and
cutoff setup unavailable instead of borrowing fixture values. Restore the
tenant-scoped active-profile gate when the real orders backend lands.
`/finances` and `/payouts` remain deliberate follow-up work because their
fixture-ledger and fixture-payout displays require those unconfigured
commercial fields.
The catalog destination filters (`getAllMarkets()` /
`SELLER_CENTER_MARKET_CODES`) still use the fixture's
`PH`/`ID`/`SG` vocabulary, which does **not** match the real approved
destinations (`AU`/`PH`); reconciling that is open follow-up work.

In development/test, accepted `PORTAL_DEV_MARKET`
values are `PH`, `ID`, `SG`; anything else falls back to `PH`. None of the
three markets' figures (fees, tax rates, thresholds) are confirmed Sals3
business rules — they were carried over from an imported design mockup for
interface review only.

## CJ-to-Sals3 category mapping (ADR-002)

A supplier category only becomes a Sals3 category through an approved,
versioned mapping. There is no fallback that guesses one. This is the
crosswalk `product-catalog.ts` refers to when it says a CJ-sourced draft
starts `UNMAPPED`.

| Piece                                       | File                                                  |
| ------------------------------------------- | ----------------------------------------------------- |
| Tables (mapping, presets, remap review)     | `src/lib/db/schema/category-mapping.ts`               |
| Resolver (the only way to a Sals3 category) | `src/modules/catalog/taxonomy/resolver.ts`            |
| Required attributes / variation rules       | `src/modules/catalog/taxonomy/category-form.ts`       |
| Applying a decision to a product            | `src/modules/catalog/taxonomy/product-category.ts`    |
| Zod contracts                               | `src/modules/catalog/taxonomy/contracts.ts`           |
| Server-only governance operations           | `src/modules/catalog/taxonomy/governance.ts`          |
| Authorization gate (denies everyone today)  | `src/modules/catalog/taxonomy/authorization.ts`       |
| Frozen Taxonomy v0 preset extract           | `src/lib/db/seed-data/sals3-taxonomy-presets-v0.json` |

Three tables, added by migration `0015_taxonomy_mapping_pilot`, **not applied
anywhere**: `provider_category_mappings` (one versioned rule per
`(provider, external category id)`, at most one `ACTIVE` at a time by partial
unique index), `sals3_category_presets` (the workbook's variation
architecture, tier-1/2 attributes, SKU format and required attributes, keyed
by `(category_id, taxonomy_version)`), and `category_remap_review_findings`.
The Sals3-side category identity is the existing `sals3_categories` table —
nothing here declares a second taxonomy.

`resolveCategoryMapping()` takes only persisted provider-category facts and
returns one of five outcomes:

| Outcome              | Meaning                                                       |
| -------------------- | ------------------------------------------------------------- |
| `MAPPED_EXACT`       | An approved, active `EXACT` rule names a real Sals3 code      |
| `MAPPED_ACCEPTABLE`  | Same, reviewed as an acceptable rather than exact fit         |
| `AMBIGUOUS`          | A rule exists but cannot be decided automatically             |
| `UNMAPPED`           | No rule, no supplier category, or an explicit "no Sals3 home" |
| `MAPPING_SUPERSEDED` | The caller's recorded mapping version is no longer in force   |

Only the two `MAPPED_*` shapes carry a category code at all; the rest have no
such field, so a caller cannot read a "best guess" off a review outcome. Two
database check constraints enforce the same rule on the rows themselves — a
confident mapping must name a category, an ambiguous or unmapped one must
not, on both `provider_category_mappings` and `products`.

### How a product gets its category

`applyResolvedCategoryToProduct()` is the one write path. It has **no
category parameter**: it takes supplier-category facts, asks the resolver,
and writes whatever came back. `products` now also records
`category_mapping_id` and `category_mapping_version`, so a stored category
can always be traced to the exact rule and version that produced it.

A review outcome **clears** the product's category rather than leaving a
stale one standing — including when the rule a product was mapped under has
since been superseded. Losing a category is recoverable; pricing and
publishing against a withdrawn one is not.

> The `products_category_mapping_consistent` check changed shape here. It was
> `(category_id IS NULL) = (confidence = 'UNMAPPED')`, which forced an
> `AMBIGUOUS` product to name a category — the opposite of what ADR-002 means
> by ambiguous. It is now "a category is present exactly when the mapping was
> confident". Nothing wrote `AMBIGUOUS` before this change.

- **Zero supplier calls.** Mapping, resolution, the category form contract,
  the product write and the remap record are local database reads and writes.
  A repository-guard test scans this module's source and fails if a CJ
  adapter import, a `fetch`, or a workbook parse ever appears.
- **No runtime workbook.** The `.xlsx` in the sibling `sals3-ecommerce` vault
  is never read by this app. `sals3-taxonomy-presets-v0.json` is a frozen,
  checksummed extraction; a test recomputes its SHA-256 and re-checks it
  against ADR-002's verified record counts.
- **Corrections never rewrite history.** Approving a replacement supersedes
  the previous rule and opens one `category_remap_review_findings` row. No
  candidate, evaluation, snapshot, audit row, or price is modified. That row
  carries `affected_candidates_enumerated = false` — _recorded but not
  listed_, never "nothing was affected": naming the affected candidates needs
  a stable provider category id on `supplier_candidates`, which does not
  exist yet, and selecting them by a supplier category _name_ would be the
  guess this whole module refuses to make. `supplier_candidate_id` is
  nullable so per-candidate rows need no further migration once that id
  lands. **No worker consumes these rows yet.**
- **No seller-facing surface, deliberately.** ADR-014 places platform
  category governance in the Admin Portal, and this repository has no
  permission that expresses it, so `governance.ts` and
  `product-category.ts` have no Server Action, route handler or UI.
  `authorizeCategoryGovernance()` is an allow list that is currently empty —
  it denies **every** role including `admin`, with one identical message. A
  test fails if anything under `src/app/` imports those modules.

## Seller market configuration

`/market-rules` shows what the **signed-in account** is actually set up to
sell to, resolved from `session.sellerId`. It replaced a screen that could
only ever say "Market configuration is not available" in production, because
its only data source was the illustrative PH/ID/SG fixture above.

Four things are kept deliberately separate, and the page states them
separately:

| Concept                       | Where it lives                                      | What it does **not** mean                                                                                 |
| ----------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Global catalogue destinations | `lib/country-policy/buyer-destination-country.ts`   | Not a seller preference; not proof any account sells there                                                |
| Sals3 business registration   | `lib/country-policy/seller-operating-country.ts`    | Never implies a buyer destination (AU appearing in both is a coincidence of two separate owner decisions) |
| Portal reference currency     | `lib/country-policy/currency.ts`                    | Not a checkout, settlement, or FX-conversion contract                                                     |
| A seller's own market profile | `modules/market-config/` + `seller_market_profiles` | Not a launched market — see the pilot limits below                                                        |

**Setup allow list.** `modules/market-config/capabilities.ts` is the
server-owned, versioned boundary
(`seller-market-capability-v1-au-ph-bounded-pilot`) deciding which
destinations may be offered. It is fail-closed against the global policy: a
destination is offerable only if this module lists it **and** the global
policy currently permits it, so narrowing the global policy narrows setup
automatically while widening it can never silently widen what sellers may
configure. It is deliberately not reachable from candidate screening, so a
seller-facing change can never move
`candidate_evaluations.policy_version`.

**Lifecycle.** `DRAFT` → `ACTIVE` → `SUSPENDED`, each transition requiring
`market_profile:manage` (admin and seller_manager only — `market_rules:read`
is deliberately broader and does not grant it), a business reason, and a
compare-and-set on the exact status and version the page was rendered from,
so a stale tab or double submit loses the race instead of replaying. Every
accepted transition writes an `audit_events` row inside the same
transaction. Nothing activates implicitly: the AU+PH global policy makes a
destination _offerable_, never _configured_.

**Tenant isolation.** Every repository call folds the authenticated
`sellerAccountId` into the SQL, including read-one-by-id. No action accepts a
seller or owner id from the browser. A cross-tenant id, a missing row, and a
stale state all return the same `not_found`, so the result cannot be used to
probe for another account's profile.

**Pilot limits — explicitly deferred.** AU and PH are a bounded evidence
pilot, not launch markets. No payment onboarding, freight quoting, tax
treatment, or payout rail is proven for either, so every destination carries
its outstanding capabilities on screen and an active profile is labelled
"Active — pilot, capabilities incomplete". `selling_currency_code`,
`locale`, and `time_zone` are nullable and currently always null:
`authorizedSellingCurrencyCodes` is empty because no per-destination selling
currency has been authorized, and recording AUD or PHP there would invent a
commercial contract. Checkout, payouts, tax calculation, freight, real FX
conversion, and a seller-editable global allowlist all remain out of scope.

**Migration.** `drizzle/0012_flashy_penance.sql` adds the
`seller_market_profile_status` enum and the `seller_market_profiles` table
(purely additive; it writes no existing data). **It has not been applied to
any database.** Until it is, `/market-rules` renders its honest
"Market setup is not available right now" state — a backend condition, not a
statement about the account — and offers no setup control. Apply it with:

```bash
npm run db:migrate
```

## Canonical product catalog (Product / Revision / Variant / Offer)

The durable Sals3-owned product lifecycle behind a supplier candidate. Before
this, `supplier_candidates` / `candidate_evaluations` / `supplier_snapshots`
were the only persisted catalog state, and they are discovery and screening
records — not products. This section adds the tables, the domain module, and
the protected Server Actions that turn an already-screened candidate into a
real, tenant-safe, auditable **draft**.

Nothing here publishes, prices, sells, confirms stock, or reaches a customer.
Every record it creates is explicitly unpublished, and the flow reports what is
still missing instead of rounding up to "ready".

### Tables

| Table                           | What it owns                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------- |
| `products`                      | Canonical product identity, editorial columns, publication state, ADR-016 columns |
| `product_revisions`             | One editorial version; mutable only while `DRAFT`, frozen once settled            |
| `product_options`               | Sals3-owned option axes (Colour, Size) with normalized names and positions        |
| `product_option_values`         | Values on an axis, normalized and ordered                                         |
| `product_variants`              | The stable sellable identity plus its Sals3 SKU and Merchant API identifiers      |
| `product_variant_option_values` | Which value each variant carries on each axis                                     |
| `provider_product_references`   | One canonical link to one provider product (`(provider, external id)` unique)     |
| `provider_variant_references`   | The exact provider variant behind one Sals3 variant, with its raw CJ option label |
| `product_offers`                | One seller's offer for one variant, in one market, under one fulfillment mode     |
| `offer_supplier_bindings`       | The exact fulfillment authority: which seller connection, which provider variant  |
| `product_media_sources`         | Media provenance (source, checksum, rights basis, review state). No writer yet.   |

Migration `0013_cold_timeslip.sql` creates all eleven. **It has not been
applied to any database.** Apply it with:

```bash
npm run db:migrate
```

### Three ownership scopes, deliberately separate

ADR-006 settles what looks like a contradiction between "one provider product
reference per `(provider, external id)`" and "a seller cannot touch another
seller's records": _two Dropshipper accounts may source the same global
provider product while using separate credentials, wallets, orders, and
account-specific availability._ So:

- **canonical / platform-scoped** — product identity, options, variants, and
  both provider references. Re-importing the same CJ `pid` reuses them rather
  than forking a second catalog identity;
- **steward-scoped** — `product_revisions` and the editorial columns on
  `products`. Exactly one seller account (`steward_seller_account_id`) may read
  or edit that draft;
- **seller-scoped** — offers and supplier bindings.

### Invariants the database enforces, not the application

Each of these would otherwise be a read-then-write race two concurrent Server
Actions could both pass:

- a variant cannot be `ACTIVE` without a resolved option combination, and two
  active variants of one product cannot share one — a partial unique index on a
  normalized combination key, plus a check constraint that closes the hole SQL's
  NULL-ignoring unique semantics would otherwise leave open;
- one variant cannot carry the same option twice;
- at most one open `DRAFT` revision per product, so a fork cannot double;
- an `APPROVED`/`SUPERSEDED` revision must carry its frozen content snapshot;
- a `PUBLISHED` product needs a published revision and a slug; a `PUBLISHED`
  offer needs a price;
- a compare-at price cannot exist without price-history evidence;
- a supplier-dropship offer has at most one `ACTIVE` binding.

### The draft flow

`createProductDraftAction` (`src/app/(portal)/listings/product-draft-actions.ts`)
takes exactly two inputs: a candidate id and an idempotency key. Seller and
actor come from the session — no action has a field for either — and candidate
ownership is re-derived server-side through the supplier connection that owns
it, so an unknown candidate, another tenant's candidate, and a candidate
reached through someone else's connection all return one indistinguishable
`not_found`.

It makes **zero supplier calls**. Everything is read from the
`supplier_snapshots` row a previous, separately budgeted evidence fetch already
wrote, which is why a saved snapshot can be opened without spending CJ points
(ADR-013 §1a). A test walks the static import graph to prove no supplier
adapter is reachable from the flow at all, so a future helper cannot quietly
reintroduce one.

Writes and the idempotency record commit in one transaction. The same key with
the same canonical request replays the stored result; the same key with a
different request is a conflict, and the rejection is itself audited.

### What the flow reports as missing, and why

A draft is real even when it is incomplete. Rather than implying readiness, the
result carries explicit codes:

| Code                                           | Because                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `NO_PERSISTED_SUPPLIER_EVIDENCE`               | A screening-stage block never reached the evidence fetch, so there is no `vid` to build a variant from — and none is invented         |
| `NO_SUPPLIER_VARIANTS_IN_EVIDENCE`             | Evidence exists but lists no variants                                                                                                 |
| `CATEGORY_MAPPING_REQUIRED`                    | No CJ-to-Sals3 taxonomy crosswalk exists                                                                                              |
| `PRODUCT_OPTIONS_UNMAPPED`                     | CJ supplies one combined label per variant (`"Black-1XL"`), which is preserved verbatim and never split into option axes by guesswork |
| `PRICING_UNRESOLVED`                           | The ADR-015 resolver declined; its exact reason is recorded on the offer                                                              |
| `NO_ACTIVE_MARKET_PROFILE`                     | No active profile for a currently authorized destination, so no offer                                                                 |
| `SUPPLIER_CONNECTION_UNHEALTHY`                | The connection is not workable, so no fulfillment binding is truthful                                                                 |
| `MEDIA_SOURCE_NOT_RECORDED`                    | Stored evidence records a usable-image count, never the image URLs                                                                    |
| `STRUCTURED_DESCRIPTION_REQUIRED`              | Supplier description HTML is never copied into a Sals3 product                                                                        |
| `EDITORIAL_RECORD_STEWARDED_BY_ANOTHER_SELLER` | The canonical product exists and another account owns its editorial record                                                            |

### Pricing and market boundaries

Offers are created only when there is something sellable to point at **and** the
seller has an `ACTIVE` market profile whose destination
`modules/market-config/capabilities.ts` still authorizes. Narrowing the global
buyer-destination policy therefore narrows offer creation immediately, without
editing a single seller row. No market code is hardcoded anywhere in the flow.

Price is delegated to the existing ADR-015 resolver rather than recomputed, so
no second pricing formula can drift from it. Today it always declines — a
CJ-sourced product has no mapped Sals3 category and the resolver refuses to
price an unmapped one — and that refusal is stored on the offer as
`pricing_state = 'UNRESOLVED'` with the resolver's own reason. A check
constraint makes "unresolved with no reason" impossible to store.

### Editing a draft

`saveProductDraftAction` writes title and a structured description onto an open
draft. The update names the revision id, the product id, `workflow_state =
'DRAFT'`, and the expected version in one `WHERE` clause, so a stale editor, a
replayed submit, and an attempt to rewrite an already-approved revision all
match zero rows. A rejected stale write is audited rather than dropped.

The description is a structured allow-listed block format
(`paragraph`, `heading`, `bulletList`, `keyValueList`) with no raw-HTML block
and no string passthrough. Markup-shaped text is rejected at the server
boundary instead of being stored and escaped later; `a < b` still passes.

### Not wired to any screen yet

The Product Editor and `/listings` remain fixture screens. Pointing their
existing controls at partial real persistence would make unsaved fields look
saved, so this ships as a protected contract plus tests and no UI change. No
navigation item was added.

Also still absent, and not faked anywhere: publication, approval, media
storage, freight, checkout, supplier synchronization, attention issues, and any
storefront read of a Sals3 revision.

## Supplier Apps (multi-tenant provider connections)

ADR-006/ADR-008: a Dropshipper connects and owns their own supplier
credential instead of the whole app sharing one global `CJ_API_KEY`. `/supplier-apps`
is the seller-facing screen; `src/modules/suppliers/` is the provider-agnostic
boundary every screen goes through.

| Piece                                   | File                                                                                                                        |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Schema (5 tables)                       | `src/lib/db/schema/{seller-accounts,supplier-providers,supplier-connections,supplier-account-bindings,supplier-secrets}.ts` |
| Provider-agnostic interface             | `src/modules/suppliers/contracts.ts`                                                                                        |
| Tenant-scoped connection CRUD           | `src/modules/suppliers/repository.ts`                                                                                       |
| CJ adapter (implements the interface)   | `src/modules/suppliers/providers/cj/cj-adapter.ts`                                                                          |
| Per-connection CJ token cache           | `src/modules/suppliers/providers/cj/cj-auth.ts`                                                                             |
| AES-256-GCM credential encryption       | `src/lib/secrets/crypto-core.ts` (+ guarded `crypto.ts`)                                                                    |
| Encrypted credential store              | `src/lib/secrets/postgres-supplier-secret-store.ts`                                                                         |
| Seller/role guard                       | `src/lib/auth/seller-guard.ts`                                                                                              |
| Connect / Disconnect / Reconnect action | `src/app/(portal)/supplier-apps/actions.ts`                                                                                 |
| One-time bootstrap (Sals3 Official)     | `scripts/bootstrap-sals3-official-cj.mts` (`npm run bootstrap:cj`)                                                          |

- **Credentials are encrypted at rest.** AES-256-GCM, with the connection id,
  provider code, and key version bound in as AAD, so a copied ciphertext row
  cannot be decrypted against a different connection. The master key is
  `SUPPLIER_CREDENTIAL_MASTER_KEY_BASE64` in `.env.local` (generate with
  `openssl rand -base64 32`) — never committed, never logged, never returned
  to the browser.
- **Tenant-scoped everywhere.** `supplier_candidates.supplier_connection_id`
  is `NOT NULL` and every Product Sourcing query joins through
  `supplier_connections.seller_account_id` — never the legacy
  `intended_seller_id` text column, which is now unused display-only data.
- **One seller account, one supplier configuration.** Enforced by the
  `(seller_account_id, provider_id)` unique index, not by an application
  check — a seller gets at most one connection per provider.
- **One CJ account, one seller account, permanently.** `supplier_account_bindings`
  is an append-only ledger of `(provider_id, sha256(providerCode:openId)) →
seller_account_id`. `connectCjSupplier` claims the binding as the first
  statement inside its transaction, so two concurrent connects of the same CJ
  account cannot both win. The binding is never released: disconnecting frees
  the _configuration_, never the ownership, and a seller moving to a second CJ
  account of their own adds a row rather than replacing one (so they can move
  back later). `supplier_connections`' own `(provider_id, hash)` unique index
  cannot provide this — reconnecting rewrites that hash, which would free the
  old account for anyone to claim. A seller pasting a key for a CJ account
  another seller owns is refused with a distinct message and an appended
  `supplier_connection.bind_rejected` audit event. **Consequence to accept:**
  releasing a binding needs a manual database change; there is no UI for it.
- **The database is the enforcer, not the pre-check.** Every "is this taken?"
  read before a write is a race. `src/lib/db/constraint-errors.ts` maps a
  Postgres `23505` back to the right user-facing reason by constraint name
  (walking `error.cause`, because Drizzle wraps driver errors), so a violation
  under concurrency reads as a permanent, explainable refusal instead of
  "try again in a moment".
- **Connect / Disconnect / Reconnect.** Disconnecting
  (`disconnectCjSupplier`) is soft: the row and its encrypted secret stay, only
  `status` flips to `DISCONNECTED`, which is what the automation pipeline's
  `listWorkableConnections` filters on to stop sourcing from it. Reconnecting
  re-uses the same "Connect CJ" form and server action — `connectCjSupplier`
  updates the existing row in place (the `(seller_account_id, provider_id)`
  unique index allows only one connection per seller per provider) rather than
  blocking it as already-connected.
- **`CJ_API_KEY` is not read at request time at all.** It is only used by
  `npm run bootstrap:cj` to seed the one Sals3 Official Dropshipper
  connection from it once. The
  [storefront product feed](#storefront-product-feed) — the last runtime
  consumer of the legacy global-key path — now also reads through that
  seller's own connection (`src/lib/storefront/supplier-source.ts`); the
  legacy `src/services/cj/{token,products}.ts` modules are deleted.
- **Not implemented:** `subscribeProducts` on the adapter interface throws
  deliberately — no CJ webhook/subscription endpoint has been verified
  against the live API. A second provider (AliExpress or otherwise) is not
  built; only `CJ_DROPSHIPPING` is seeded.

## CJdropshipping integration

`/products` (and the rest of Product Sourcing) shows the CJdropshipping feed
through the current seller's own [Supplier Apps connection](#supplier-apps-multi-tenant-provider-connections) -
it is the portal's only product source and it is **read-only**. A seller with
no connection sees a "connect a supplier" empty state instead of the feed.
The previous in-memory Sals3 fixture catalogue and its add/edit/import/export
screens were removed. Old links with `?source=cj` still work: the parameter
is accepted and ignored.

### How it works

| Piece                          | File                                               |
| ------------------------------ | -------------------------------------------------- |
| Response schemas (Zod)         | `src/lib/cj/schemas.ts`                            |
| Mapping to the display shape   | `src/lib/cj/normalize.ts`                          |
| Per-connection token cache     | `src/modules/suppliers/providers/cj/cj-auth.ts`    |
| Connection-scoped product read | `src/modules/suppliers/providers/cj/cj-adapter.ts` |

- **Rate limit.** CJ allows one call per second per account/connection. Each
  connection gets its own in-memory token cache entry (cached until an hour
  before expiry) and its own request spacing, so one seller's CJ traffic never
  throttles another's.
- **Authorization.** `CjCatalogueView` calls `requireDropshipperAccount()`
  before resolving the seller's own connection, so the integration is not a
  way around the portal roles.
- **Untrusted upstream data.** The API's real responses differ from its own
  documentation (`sellPrice` is a string, `productWeight` a range, `createTime`
  epoch milliseconds). Every field is parsed with a fallback, so a changed value
  degrades one cell instead of breaking the page. The `remark` field is raw
  supplier HTML and is deliberately never rendered.
- **Images.** Only `cf.cjdropshipping.com` and `oss-cf.cjdropshipping.com` are
  accepted, both in `src/lib/cj/schemas.ts` and in `next.config.ts`. Keep the two
  lists in step. Any other host is dropped and the row shows a placeholder. How
  those images are actually delivered is described in
  [Image delivery](#image-delivery).
- **Currency.** Supplier prices show in US dollars. Each row also shows an
  estimated peso amount, resolved through the same live `resolveUsdToPhpRate()`
  the storefront feed uses (`src/lib/storefront/fx.ts` - ECB reference rate
  plus buffer, see [Storefront product feed](#storefront-product-feed)) -
  never a guessed rate. It is always labelled an estimate, never the final
  landed cost, and is never used to sort or compare products.
- **Provider-neutral display.** `/products`' rows and header use the same
  provider-neutral components (`src/components/products/catalog/`,
  `src/lib/products/catalog-*.ts`) a future second Supplier App would use -
  today they render one real connection (CJ Dropshipping). A design preview
  of the full multi-supplier layout (dynamic supplier filter, evaluation
  status filter, duplicate detection) against isolated fixtures lives at
  `/design-preview/all-supplier-products` for review before a second
  provider is actually integrated.

### Not built yet

Importing a supplier product for resale (there is no writable Sals3 catalogue),
variant and inventory detail per supplier product, and CJ order placement. The
MCP token in `CJ_MCP_TOKEN` is stored but unused by this REST integration.

## Storefront product feed

`sals3-ecommerce` reads home page products from the protected storefront API:

```text
GET /api/storefront/products?section=for-you&page=1&limit=14
GET /api/storefront/products?section=deals&limit=5
GET /api/storefront/products/<id>
GET /api/storefront/categories
```

Each request must send:

```text
Authorization: Bearer <SALS3_STOREFRONT_API_TOKEN>
```

The API reads the CJdropshipping supplier feed through the **Sals3 Official
Dropshipper's own supplier connection** (`src/lib/storefront/supplier-source.ts`
resolves it headlessly by the shared `SALS3_OFFICIAL_IDENTITY_ID` constant and
fetches through the same per-connection adapter `/products` uses — see
[Supplier Apps](#supplier-apps-multi-tenant-provider-connections)). The feed
therefore needs `DATABASE_URL`, `SUPPLIER_CREDENTIAL_MASTER_KEY_BASE64`, and a
one-time `npm run bootstrap:cj`; without them every feed request returns `502`
(same envelope the consumer already tolerates). The routes' own auth stays the
`SALS3_STOREFRONT_API_TOKEN` bearer check — the legacy dev-session
`requirePermission('product:read')` call was dropped from this
machine-to-machine path because it only ever read the synthetic placeholder
session. A 5-minute in-process response cache still fronts the adapter, so a
page refresh does not spend a CJ call. It
skips supplier rows with no usable price, converts the
supplier USD price to a PHP shopper price with `CJ_USD_TO_PHP_RATE` and
`CJ_PRICE_MARKUP_PERCENT`, and never exposes the supplier USD price to
`sals3-ecommerce`. The `deals` section uses CJ `listedCount` as a temporary rank
when available. Responses use `Cache-Control: private, no-store` because the
feed is protected and can change when CJ changes.

**The USD/PHP rate updates itself.** Shopper prices are no longer computed
from a hand-typed exchange rate. `src/lib/storefront/fx.ts` fetches the
European Central Bank's published reference rate (via Frankfurter, falling back
to `open.er-api.com`), caches it for 12 hours, and adds
`CJ_FX_BUFFER_PERCENT` (2.5%) on top — money-changer logic, because a mid-market rate
is not one anyone can actually transact at: paying CJ in dollars costs more
than mid once the card or wallet takes its own spread. The 2.5% is sized from
real published rail costs — a PH credit card runs about 1.85% (1% card-network
assessment plus ~0.85% issuer FX) and PayPal 3–4% — not guessed. ECB publishes
once per business day on purpose, so shopper prices change at most daily rather
than drifting all afternoon.

Lower it if the CJ wallet is topped up by wire transfer or Payoneer: CJ pays a
2–3% top-up bonus that offsets most of the FX cost, and those are the only two
methods that can top the wallet up. Paying per order by card or PayPal instead
spends that spread every time.

It fails safe and never blocks a page: each source gets a 4-second timeout, an
implausible rate (outside 30–120, or more than 10% from the last known good) is
rejected rather than priced on, and a failed refresh falls back to the last
good rate, then to `CJ_USD_TO_PHP_RATE`, logging `[storefront-fx]` when it does.
A stale rate silently costs margin, so that log matters.

**No comparison price is published.** `oldPriceMinor` always equals
`priceMinor`, so the storefront renders one price with no strikethrough and no
percent-off badge. The field remains in the contract because the consumer's
schema requires it and because a genuine value can fill it once real price
history exists. It must never be derived from the current price — a was/now
pair invented by marking the live price up is not evidence of a prior price,
and ADR-003 prohibits it. The `deals` section is therefore a ranked selection,
not a discount claim.

`/api/storefront/products/<id>` fetches exactly one product by CJ's `pid` (via
CJ's `product/list?pid=` filter — a single upstream call, one CJ rate-limit
hit) instead of paging through a section, for `sals3-ecommerce`'s product
detail page. Returns `404` when no product matches. Added after
`sals3-ecommerce`'s PDP shipped a client-side workaround that paged through
whole sections to find one product — safe at small scale, but capable of
hammering CJ's one-request-per-second limit against the real catalogue; this
endpoint replaces that workaround with one request.

## Image delivery

Every `next/image` in the portal is resolved by a custom loader,
`src/lib/images/cj-image-loader.ts`, wired through `next.config.ts`
`images.loaderFile`. The platform's built-in `/_next/image` optimizer is **not**
used.

Why: that optimizer is metered. Once the account's Image Optimization allowance
ran out it began answering `402 OPTIMIZED_IMAGE_REQUEST_PAYMENT_REQUIRED` to
every request — verified against production on 2026-08-13, including
`?url=/favicon.ico`, so the failure was the optimizer itself and not any
upstream host. Every Product Sourcing thumbnail and every brand mark rendered as
a broken image.

What the loader does:

- **CJ addresses** get an Alibaba-OSS instruction appended
  (`?x-oss-process=image/resize,w_<width>/format,webp/quality,q_<quality>`). CJ's
  CDN performs the resize and the WebP re-encode at no cost to us. Measured on a
  real product image, 2026-08-13: the original is 314,871 bytes; at
  `w_80/format,webp/quality,q_75` it is 1,380 bytes.
- **Everything else** — local `/public` paths, any non-allow-listed host — is
  returned byte-identical, so the browser fetches exactly what the component
  asked for. The loader never proxies and never rewrites a host, so it cannot be
  turned into an open image proxy.

Consequences to know before changing this:

- **Local assets are no longer resized for you.** Nothing resizes
  `public/`. `public/brand/sals3-mark.png` was a 2000×2000, 274,110-byte PNG
  rendered at 28–36 CSS px; it is now 96×96 and 5,438 bytes, which covers the
  largest use (36 px at 2× device pixel ratio) exactly. The 2000 px original is
  retained outside the served directory at
  `design-system/sals3-portal/brand/sals3-mark-2000.png`. Any new `public/` image
  must be sized to its rendered dimensions before it is committed, and should
  carry `unoptimized` on its `<Image>` — the loader returns local paths verbatim,
  and without that prop Next warns `next-image-missing-loader-width` on every
  render because the returned address ignores the requested width.
- **`remotePatterns` is documentation now, not enforcement.** A custom loader
  bypasses the optimizer that reads it. The enforcing gate is `cjImageUrl` in
  `src/lib/cj/primitives.ts`, which rejects any non-allow-listed address at
  intake, before it is stored. The host list lives once in
  `src/lib/cj/image-hosts.ts` — a dependency-free module, because the loader is
  serialized into the client bundle and must not pull Zod in with it.
- **`oss-cf.cjdropshipping.com` is unverified for `x-oss-process`.** Only
  `cf.cjdropshipping.com` was measured; no live `oss-cf` object was available to
  test against. If that host ignores the parameter it serves the unresized
  original, which displays correctly but wastes bandwidth. Re-measure when a real
  `oss-cf` address appears in the data.

Restoring the built-in optimizer is a billing decision, not a code one: raise the
Image Optimization limit on the hosting account, then drop `loader` and
`loaderFile` from `next.config.ts`.

## Important limitations

These are real gaps, not oversights. Do not treat any screen as production ready.

- **Discovery coverage is proven per partition, never assumed.** The
  queue-driven scanner (see
  [Continuous full-catalogue discovery](#continuous-full-catalogue-discovery))
  covers immutable-cutoff cycles of adaptive category/time/price partitions;
  a partition/cycle that cannot prove coverage stays visibly
  `PROVIDER_COVERAGE_UNRESOLVED`/`COVERAGE_UNRESOLVED`. Migration `0009` must
  be applied (owner-run `npm run db:migrate` - NOT executed by this change)
  and an owner-authorized read-only CJ contract probe must verify the
  timestamp/boundary/precision assumptions before production rollout. Local
  tests prove logic, not real catalogue coverage.
- **CJ product webhooks accelerate freshness; they do not discover.** The
  `/api/webhooks/cj` receiver verifies the documented raw-body HMAC and
  deduplicates by messageId; subscriptions (max 100 ids per request, never
  `subscribeAll` - unavailable to all users after July 2026) are reserved for
  selected/imported/live/accepted-order products, none of which exist yet, so
  the desired set is currently empty. CJ disables a webhook after two
  complete hours below 80% callback success; `.../discovery/status` is where
  that health surfaces.

- **Role changes are script-only.** There is no public admin UI in v1. Public
  signup grants `seller_manager` after email verification and TOTP setup; use
  `npm run approve:portal-user -- --email <email> --role <role>` from an owner
  shell only to repair or change an existing account.
- **Supplier feed is read-only.** Product Sourcing still reads the
  CJdropshipping supplier feed without writing back to CJ. Selected ready
  candidates can now be copied into the persisted Sals3 Product Catalogue draft
  flow; the underlying supplier feed remains a provider read model, not an
  editable supplier catalogue.
- **Product Catalogue publication is still gated.** Product Sourcing can import
  a selected candidate into the persisted Product Catalogue draft flow, and
  `/listings` plus `/listings/new?productId=<uuid>` read those database rows.
  Publication/resume remains unbuilt: unresolved category, media, pricing,
  variant-option, revision-approval, and storefront gates are shown as
  blockers rather than rounded up to Live.
- The portal is `robots: noindex` and publishes no structured data on purpose.
  It is an internal tool, so the SEO, GEO, and AEO work that applies to the
  storefront does not apply here.
- **Seller Center is static data, real permissions.** All 7 Seller Center
  screens are real routes with a real, server-enforced permission gate, but
  every order, SKU, ledger line, and payout is illustrative placeholder data
  — see [Seller Center screens](#seller-center-screens) above.
- **No error boundary.** There is no `error.tsx` or `not-found.tsx` anywhere
  in this app. A thrown `PermissionError` (e.g. visiting a route your role
  cannot use) surfaces as Next.js's default dev error overlay, not a plain
  in-product message. Pre-existing gap, not introduced by Seller Center.

## Running the E2E tests

Playwright starts its own dev server on port 3101 with the explicit
`PORTAL_TEST_AUTH_BYPASS=1` test bypass. If a previous test run left that port
busy, stop it and run again:

```bash
lsof -nP -iTCP:3101 -sTCP:LISTEN -t | xargs kill
```
