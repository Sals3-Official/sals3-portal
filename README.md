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

Set `CLOUDFLARE_R2_ENDPOINT`, `CLOUDFLARE_R2_ACCESS_KEY_ID`,
`CLOUDFLARE_R2_SECRET_ACCESS_KEY`, `CLOUDFLARE_R2_BUCKET`, and
`CLOUDFLARE_R2_PUBLIC_BASE_URL` for a seller's own product-photo uploads (see
[Product Editor](#product-editor-add-product-from-a-supplier-product)),
stored in Cloudflare R2. Unlike the earlier Vercel Blob backend these are not
auto-injected — create an R2 bucket and an API token scoped to it from the
Cloudflare dashboard, and configure all five as deployment/GitHub/Vercel
environment secrets. `CLOUDFLARE_R2_PUBLIC_BASE_URL` must be the bucket's
public read URL or a custom domain bound to it, never the private
S3-compatible endpoint.

Set `SALS3_STOREFRONT_API_TOKEN` to a long random value if
`sals3-ecommerce` will read products or request checkout freight quotes from
this portal. Use the same value in `sals3-ecommerce/.env.local`. The checkout
quote route keeps CJ credentials server-side: ecommerce sends cart lines and a
completed delivery address, then Portal resolves the published product,
supplier connection, encrypted CJ credentials, governed CJ limiter, and current
stock/origin evidence before calling CJ.

The same bearer token protects storefront order endpoints used by Stripe
webhooks in `sals3-ecommerce`:

- `POST /api/storefront/checkout/intents` stores the immutable pending cart,
  address, freight, and supplier snapshot before Stripe payment.
- `POST /api/storefront/checkout/orders/accept` accepts verified paid Stripe
  Checkout data idempotently, creates the paid Sals3 order, and inserts a
  durable `FULFILL_ORDER` outbox intent. After the transaction commits, the
  route immediately drains that exact outbox row so order-critical fulfillment
  is not stuck behind catalogue discovery work; if publish fails, the paid order
  remains accepted and the row stays visible for recovery.

Portal owns PostgreSQL order rows, CJ credentials, the supplier adapter, the
outbox, and the queue worker. Ecommerce never stores CJ keys and cannot
reconstruct supplier order payloads from Stripe metadata.

The topic is `catalog-discovery-v2`. The `-v2` is not cosmetic: a
`queue/v2beta` subscription binds to the deployment that declared it, and
deleting that deployment orphans the topic with no way to reassign it and no
dashboard surface to repair it. Renaming the topic is the documented recovery.
`vercel.json` and `CATALOG_QUEUE_TOPIC` must always name the same topic — a
mismatch loses messages silently rather than erroring.

Accepted orders run through the queue on `CATALOG_QUEUE_TOPIC` and call CJ in
this order: `createOrderV3`, `addCart`, `addCartConfirm`,
`saveGenerateParentOrder`, then `payBalanceV2`. `CJ_ORDER_SANDBOX` defaults to
enabled for the current testing phase; keep it set to `1` in every environment
so Portal sends `isSandbox: 1` to `createOrderV3`. CJ then treats
`payBalanceV2` as simulated sandbox payment and does not deduct real balance or
generate real fulfillment. Set `CJ_ORDER_SANDBOX=0` only when production order
payment is owner-approved. `CJ_ORDER_SHOP_LOGISTICS_TYPE` optionally overrides
the CJ logistics type; otherwise Portal uses the merchant logistics default
from the current implementation. `CJ_ORDER_STORE_NAME` and `CJ_PLATFORM_TOKEN`
are optional account-specific CJ fields.

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
| `npm run extract:variation-families`                                              | Re-extract category variation families from the workbook (offline, no database) |
| `npx tsx scripts/backfill-draft-supplier-media.mts --dry-run`                     | Record the supplier photo for products imported before drafts projected media   |

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

| Route                                                      | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                                        | Seller Center sign-in form                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/login`                                                   | Better Auth email/password sign-in                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/signup`                                                  | Public seller account signup (`RETAILER` or `DROPSHIPPER`), always generic success copy; new users get active `seller_manager` access after email verification and TOTP setup                                                                                                                                                                                                                                                                                                                  |
| `/reset-password`                                          | Password reset request and token completion                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `/setup-2fa`                                               | Required TOTP enrolment before Seller Center entry                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `/two-factor`                                              | TOTP challenge after sign-in                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/auth/continue`                                           | Server-side post-auth continuation gate: checks session, verified email, TOTP, seller state, and safe `next` before redirecting                                                                                                                                                                                                                                                                                                                                                                |
| `/auth/pending`                                            | Fallback for legacy or manually deactivated seller accounts that are signed in but not active/verified                                                                                                                                                                                                                                                                                                                                                                                         |
| `/overview`                                                | Seller Center dashboard: needs-action tasks, money position, glance stats                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `/orders`                                                  | Seller Center order screen shell. Real paid storefront orders now persist in PostgreSQL for fulfillment, but this UI remains a static/illustrative operations surface until the order-management views are wired to the new tables                                                                                                                                                                                                                                                             |
| `/listings`                                                | Product Catalogue. Reads persisted Sals3 Product/Variant/Offer/provider-reference rows for the seller and maps them into the existing catalogue UI. No supplier API call is made. Imported rows remain Draft/Unpublished until the real publish gates can resolve category, media, price, variant options, and revision approval.                                                                                                                                                              |
| `/listings/new`                                            | Add Product. No query: the blank essentials-first wizard (read-only fields, no save yet). `?fixture=<key>`: the supplier-prefilled Product Editor design preview — see [Product Editor](#product-editor-add-product-from-a-supplier-product). `?productId=<uuid>`: opens a persisted Product Catalogue draft, using supplier detail evidence saved during the Add to Product Catalogue / Customize & List action. `?supplierCandidateId=` remains reserved and does not render fictional data. |
| `/listings/[productId]/description`                        | **Description full editor** — the description on its own full-viewport screen, outside the portal shell. Block palette, a canvas set to the product page's own measurements, and a per-block inspector. Saves the description alone through its own compare-and-set Server Action; requires an open `DRAFT` revision. See [Description full editor](#description-full-editor)                                                                                                                  |
| `/inventory`                                               | Inline stock edits with undo and an audit record                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `/finances`                                                | Itemized ledger and estimated proceeds for one example order                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `/payouts`                                                 | Payout schedule, states, and destination                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/market-rules`                                            | The account's own market setup (which approved destinations it is configured for), the platform policies around it, role access, and category pricing / FX adjustment — see [Seller market configuration](#seller-market-configuration)                                                                                                                                                                                                                                                        |
| `/supplier-apps`                                           | Connect / disconnect / reconnect the seller's own CJ Dropshipping account (ADR-008)                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/products`                                                | All Supplier Products — the raw supplier catalogue, read **entirely from the Sals3 database**. Local quick views (`?view=`), a Discovery signal filter (`?signal=`), a Category filter (`?category=`), a two-character-minimum debounced search (`?q=`), paging (`?page=`), and a read-only Supplier Source Details panel (`?source=`) with manual stock attestation. Makes **zero** CJ requests — see [Lean All Supplier Products intake](#lean-all-supplier-products-intake)                 |
| `/design-preview/all-supplier-products`                    | Design preview of the full multi-supplier layout against isolated fixtures (dynamic supplier/evaluation filters, duplicate detection) - `robots: noindex`, not linked from the sidebar, for review before a second real Supplier App exists                                                                                                                                                                                                                                                    |
| `/products/pipeline`                                       | Product Sourcing — every candidate the automated pipeline has touched, one paged tab per decision status (`?tab=`), 100 rows a page (`?page=`), with `?q=` searching the whole tab in SQL. See [Product Sourcing paging and search](#product-sourcing-paging-and-search)                                                                                                                                                                                                                       |
| `/products/qualified/ready`                                | Retired — redirects to `/products/pipeline?tab=ready` (automated `PASS` candidates)                                                                                                                                                                                                                                                                                                                                                                                                            |
| `/products/qualified/needs-attention`                      | Retired — redirects to `/products/pipeline?tab=needs-attention` (automated `PASS_WITH_ATTENTION` candidates)                                                                                                                                                                                                                                                                                                                                                                                   |
| `/products/evaluating`                                     | Retired — redirects to `/products/pipeline?tab=evaluating` (`QUEUED`, actively `EVALUATING`, or a technical failure still under its retry cap)                                                                                                                                                                                                                                                                                                                                                 |
| `/products/blocked`                                        | Retired — redirects to `/products/pipeline?tab=blocked` (`BLOCKED` permanent and `TEMPORARILY_INELIGIBLE` retryable candidates)                                                                                                                                                                                                                                                                                                                                                                |
| `/products/exception-queue`                                | Retired — redirects to `/products/pipeline?tab=exception` (dead-lettered evaluation failures only, never ordinary rejections)                                                                                                                                                                                                                                                                                                                                                                  |
| `/products/shortlisted`                                    | Retired — redirects to `/products/pipeline?tab=ready`                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `/api/internal/catalog/evaluate-tick`                      | Protected (`CRON_SECRET` bearer token) - **break-glass recovery only**: drains the outbox, requeues due retries, evaluates one bounded batch. NOT scheduled; the manual `workflow_dispatch` in `.github/workflows/evaluate-tick.yml` or a direct authenticated call invokes it                                                                                                                                                                                                                 |
| `/api/internal/catalog/discovery/start`                    | Protected (`DISCOVERY_CONTROL_SECRET` bearer, constant-time) - idempotent owner Start: creates the durable queue chain once; see [Continuous full-catalogue discovery](#continuous-full-catalogue-discovery)                                                                                                                                                                                                                                                                                   |
| `/api/internal/catalog/discovery/pause`                    | Protected - idempotent pause: no new supplier calls; checkpoints and queue/database state retained                                                                                                                                                                                                                                                                                                                                                                                             |
| `/api/internal/catalog/discovery/resume`                   | Protected - idempotent resume: re-enqueues every parked, unleased non-terminal partition                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/api/internal/catalog/discovery/status`                   | Protected - truthful coverage/budget/outbox/failure status; never claims completion while any partition is unproven                                                                                                                                                                                                                                                                                                                                                                            |
| `/api/internal/catalog/evaluations/recheck-policy-version` | Protected (same `DISCOVERY_CONTROL_SECRET`) - bounded, idempotent re-evaluation of decisions taken under an obsolete policy version. Runs **while discovery is paused** and spends no CJ points; see [Re-opening decisions after a policy change](#re-opening-decisions-after-a-policy-change)                                                                                                                                                                                                 |
| `/api/webhooks/cj`                                         | CJ webhook receiver: raw-body Base64 HMAC-SHA256 verification (secret = the connection's CJ `openId`, stored encrypted), size-capped, messageId-deduplicated, acknowledged in well under CJ's 3-second window; heavy work happens in the queue                                                                                                                                                                                                                                                 |
| `/api/queues/catalog-discovery`                            | Private Vercel Queues push consumer (air-gapped by the platform - no public URL); every message re-validates and re-authorizes against the database                                                                                                                                                                                                                                                                                                                                            |
| `/api/storefront/products`                                 | Protected published-catalogue feed for `sals3-ecommerce` (database only)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `/api/storefront/products/[id]`                            | Protected single-product lookup by public slug for `sals3-ecommerce`'s PDP                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `/api/storefront/categories`                               | Protected category feed for `sals3-ecommerce`                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `/api/storefront/checkout/freight-quotes`                  | Protected checkout freight quote endpoint for `sals3-ecommerce`: validates live published cart lines, resolves CJ origin/stock evidence through the governed supplier path, calls CJ `freightCalculateTip` per package, and returns buyer-safe shipping options only                                                                                                                                                                                                                           |
| `/api/storefront/checkout/intents`                         | Protected checkout intent endpoint for `sals3-ecommerce`: validates the selected freight against the current quote path and persists an immutable pending checkout snapshot before Stripe payment                                                                                                                                                                                                                                                                                              |
| `/api/storefront/checkout/orders/accept`                   | Protected Stripe-webhook handoff endpoint for `sals3-ecommerce`: idempotently creates one paid Sals3 order per Stripe Checkout Session and enqueues `FULFILL_ORDER` supplier fulfillment work                                                                                                                                                                                                                                                                                                  |

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

The fixture editor is still a **design preview backed by fictional fixtures**:
it reads no database, calls no supplier API, and every change lives in the
browser tab. A real catalogue product opens with `?productId=<uuid>` and reads
the persisted draft; `Save Draft` stores the product name, structured
description, seller-entered retail prices, and the required Basic Information
`Sals3 Category` L1 draft field through the protected draft-save Server Action.
That field starts as `None` until the seller chooses one of the approved Sals3
L1 categories; it never defaults itself from CJ's supplier category. Seller SKU,
brand, variants, and publication controls remain local/editor-only until their
dedicated persistence paths exist. The screen says which mode it loaded in the
notice at the top.

Retail prices must be at least **2.5% above** the stored supplier cost for every
listed variant. The per-row editor clamps too-low entries up to the rounded-up
minor-unit floor, the bulk price dialog refuses a value below that same floor,
and `publishProduct` refuses the value again server-side; the manual
seller-price path cannot record a zero-spread or thin-spread offer as resolved.

**A seller's own product photos persist for real (2026-08-17, Cloudflare R2 +
sharp — migrated the same day from an initial Vercel Blob backend once
durable object storage became the explicit requirement).** Basic
Information's `Product media` is a real photo manager
(`ProductPhotoManager`) - upload, delete, and set-cover, no separate Media
section any more (removed the same day; its whole reason to exist moved
here). `uploadSellerMediaAction` re-checks the file's own magic number
(JPEG/PNG/WebP only, never the browser-supplied `File.type`), refuses
anything over 2000×2000px outright (a cheap `sharp` metadata read, no
silent downscale - the seller resizes and re-uploads), then `sharp`
auto-orients from EXIF and re-encodes as WebP at quality 82 before it ever
reaches storage - a 5 MB input routinely lands under 300KB stored.
`deleteSellerMediaAction`
removes one, scoped to `sourceType = 'SELLER_UPLOAD'` in the same `WHERE` as
the ownership check, so a supplier's photo is structurally impossible to
delete through this path. The supplier's own photos stay a separate,
**read-only** small-thumbnail gallery in Basic Information's Supplier
Details (`SupplierMediaGallery`) - never reorderable, never a cover choice,
never replaced. **Supplier Details itself moved to just above Review &
Publish and is collapsible, collapsed by default** - evidence a seller
checks occasionally, not something edited on every visit; "Go to section"
expands it first if a blocker/warning lives inside, so a collapsed section
never hides one. Until a seller uploads at least one photo, the editor's
previews (header thumbnail, Product media, Draft Storefront Preview) fall
back to the supplier's photo automatically, matching what the live
storefront already does. Requires the five `CLOUDFLARE_R2_*` variables (see
[Environment setup](#setup)); with any of them unset, Upload stays visibly
disabled with an honest reason instead of a fake success.

**The storefront read model honours "Show supplier photo" and puts seller
uploads first (2026-08-20).** `modules/catalog/storefront/read-model.ts`
previously ignored `products.show_supplier_photo` and never distinguished
`SELLER_UPLOAD` from `SUPPLIER_ORIGINAL`, so nothing a seller uploaded or
toggled ever changed what a buyer saw. Both the card's `primaryImageUrl` and
the detail gallery now share one `mediaVisibleToBuyers` predicate: a seller's
own upload always shows, the supplier's original shows while the switch is
on, and switching it off hides the supplier photo **only once an approved
seller upload exists** — with nothing uploaded yet the supplier photo still
renders, exactly what the editor's own caption promises. Seller uploads
outrank supplier originals in both queries, matching the editor preview's
`[...media, ...supplierMedia]` order. The `unstable_cache` keys were bumped
(`feed` v1→v2, `product` v2→v3) so warm entries cannot keep serving a photo
the seller just hid. Same change: the editor's "N of 12 photos" counter and
photo grid now read the workspace's live media state instead of the
server-rendered fixture, so an upload appears immediately rather than after a
refresh, and the storefront contract's description block union gained the
`image` block on the consumer side (`sals3-ecommerce`), so seller-placed
description photos finally render on the product page.

**A new `Specification` section sits between Basic Information and
Description (2026-08-17)** — category-driven attribute controls
(dropdowns, multi-selects, text/number/measurement/boolean/date fields)
resolved from the finalized taxonomy workbook's attribute-controls
extraction (see
[Category-driven Specification controls](#category-driven-specification-controls-attribute-controls-workbook)
below). It is unrelated to the read-only `Supplier Details` tab further
down — that one shows CJ-supplier evidence and never changed. Required
specifications are real publish blockers, re-validated server-side on
save and again at publish; recommended ones are warnings; optional ones
are neither.

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

**Variant setup redesigned as a "Variant Matrix" inside `Variants & Pricing`
(2026-08-17).** The old `Option groups` screen rendered its own card and sat
as a sibling immediately above the variant table — a nav-unreachable
pseudo-section (`VariantOptionMappingSection.tsx`'s own `id="options"`).
It is now a presentational subsection mounted inside the `variants`
`EditorSectionCard`, directly above `VariantPricingTable`, with its own
header row and status pill rather than a nested card. Seller-facing copy no
longer says "Option groups" anywhere — the heading, button, and messages
say `Variant Matrix` — but every backend name (`saveOptionMapping`,
`product_options`, `optionMapping`, the `OPTIONS_UNMAPPED` publish gate)
is unchanged. Functional behaviour is unchanged too: the supplier value
column stays read-only, a buyer label edit never touches the supplier
token or CJ fulfillment matching, and mapping is still insert-only (no
remap/unmap). `VariantPricingTable`'s Variant column now renders a mapped
label's `Name: Value` pairs as small chips instead of one run-on string,
for readability only.

**Category-driven option-name suggestions in the Variant Matrix
(2026-08-18).** Naming the two option axes was unassisted in every
environment but a developer's own: the only suggestion source was
`sals3_category_presets`, whose sole writer is a local
`npm run seed:taxonomy-presets`, so production had the categories seeded but
not the presets and every `Option name` field rendered blank with nothing
reporting it. Suggestions now come from
`src/lib/db/seed-data/sals3-category-variation-families-v1.json` — a
committed, checksum-stamped extract of the workbook's
`Tier 1/2 Attribute Families` columns — read through
`modules/catalog/taxonomy/variation-families.ts`. **No migration and no seed
are involved**: the file ships with the app and is keyed by the
`sals3_categories.code` the editor already resolves, so the feature works in
any environment the moment it deploys. The now-unused
`sals3_category_presets` read was removed from `read-model.ts`, one fewer
query per `/listings` load; `taxonomy/repository.ts` and `category-form.ts`
still use that table for the Specification section.

Coverage is 5,563 of 5,595 categories for tier 1 and 5,425 for tier 2. The
eight family tokens map to `Colour`, `Size`, `Material`, `Capacity`,
`Model`, `Pack size`, `Variant` (`FOOD_BEAUTY`, which spans flavour and
cosmetic shade), and `Fitment`; a multi-token cell takes the first token, and
an unknown token yields no suggestion rather than a guessed label.

A suggestion is **offered, never pre-filled**. The workbook knows what a
category varies by; it cannot know which supplier token position holds which
attribute — `deriveOptionSplit` proves there are two positions, but nothing
in CJ's payload says position 0 is a colour, and on a lamp the same slot
could be plug type. So the field stays empty, the `OPTIONS_UNMAPPED` blocker
stands until a person names the axis, and the category's suggestion sits
beside it as a `Use "Colour"` button next to the actual supplier values. A
suggestion that does not fit costs a glance instead of becoming a wrong
buyer-facing attribute. The supplier column also renders as read-only text
rather than a disabled `Input`: it is data, and an input-shaped box that can
never be typed into invites the click anyway and announces extra textboxes
that lead nowhere.

Regenerate the extract only when the owner supplies a new workbook:

```bash
npm run extract:variation-families -- --discover-families  # print the distinct family tokens, write nothing
npm run extract:variation-families -- --dry-run            # validate and report coverage without writing
npm run extract:variation-families                         # write the frozen JSON
```

**Fixed in the same pass:** the Variant Matrix held its drafts in a
`useState` initializer and was not keyed, so a proposal arriving from
`router.refresh()` never reached it. After a successful **Recover supplier
labels** the form rendered zero option cards, and because `[].every()` is
vacuously `true` the Save button was enabled and submitted an empty array —
the seller saw "Those variant options could not be read" immediately after a
recovery that had worked. State is now resynced during render (React's
adjusting-state-on-prop-change pattern), keyed on the proposal's own
identity, with a regression test proven to fail without the fix.

**Meta Description added to the Description section (2026-08-17), scoped
narrowly.** A dedicated, seller-editable `products.meta_description`
column — hidden search/AI-discovery copy, persisted separately from the
buyer-visible Product Description and from the future PDP body. The field
sits directly below Product Description with a 140-160 character
guideline (a warning, never a publish blocker), a Sals3-native search
preview, and a local, non-AI auto-suggestion seeded from the product name,
category, a few specification/variant highlights, and the description's
opening sentence (`suggest-meta-description.ts`) — always editable, and
only ever saved if the seller presses `Save Meta Description`
(`meta-description-actions.ts`, `save-meta-description.ts`, its own
compare-and-set column, independent of the revisioned draft body). No URL
handle editing, no structured-data editing, and no call to an AI provider.
Migration `0021_cultured_groot.sql` adds the nullable column; nothing reads
or renders it on the storefront yet — that is later PDP/storefront work.
Applied to the local database already. Production is never migrated from a
laptop (`npm run db:migrate` only ever runs against `localhost` -
`scripts/guard-remote-db.mts` refuses anything else): the same
break-glass pattern `migrate-attribute-controls` established applies here
too — trigger the `Products Migrate Meta Description` GitHub Actions
workflow (`workflow_dispatch`, `CRON_SECRET`-authenticated), which calls
`POST /api/internal/catalog/products/migrate-meta-description` on the
deployed app itself. Idempotent; safe to run more than once.

**Brand and Country of Origin show seller-friendly defaults, not raw
workbook tokens (2026-08-17).** The Specification section's `Brand` /
`Brand / Publisher` dropdown displays the workbook's own `UNBRANDED` token
as `Generic`, and an unresolved Brand or Country of Origin field shows a
`Generic` / `Others` placeholder instead of a blank one
(`attribute-display-defaults.ts`). Display only: the value actually
submitted and stored when a seller picks the no-brand option is still the
raw `UNBRANDED` token, and an unresolved field is still unresolved for
readiness/blocker purposes — nothing here touches CJ supplier identity,
brand evidence, or order-fulfillment fields.

**The Variant Matrix can be reordered after it is saved, not only renamed
(2026-08-21).** `S, M, L, XL, XXL` is alphabetically `L, M, S, XL, XXL`, which is
what buyers were shown: the first-time mapping form had up/down arrows and the
later **Edit names** form had none, so an order set wrong (or produced by the
split) could never be corrected. Both forms now render the same row —
`VariantMatrixValueRow`, one component instead of two drifted layouts, the second
of which put the supplier token alone in a half-width column with the input
floating at the far right. `renameOptionMapping` writes
`product_option_values.position` from array order, in two passes: every value of
the axis is first lifted above its own maximum, because
`product_option_values_option_position_key` is a plain (non-deferrable) unique
index that a straight swap collides on, and
`product_option_values_position_non_negative` rules out negative sentinels. No
migration, and no identity moves — `option_combination_key` is built from
`normalized_value`, so a reorder changes only what a buyer reads. A partial axis
is now refused (`UNKNOWN_AXIS`): harmless while only labels were written, it
would otherwise leave an omitted value parked at its offset position. The
storefront read model sorts published variants by those positions too
(`compareMatrixOrder`), instead of by `sals3_sku` — a hash, which made the
portal-side order cosmetic.

**A description save says what is actually wrong with it (2026-08-21).** An
uploaded photo with no alt text passed the editor, failed
`descriptionDocumentSchema`'s `min(1)` on `alt`, and came back as _"That
description could not be read. Remove any pasted formatting and try again."_ —
naming a cause the seller never had and an action that could not fix it.
`firstBlockProblem` runs `describeBlockProblem` (which already existed, and was
already rendered for whichever block happened to be selected) over everything
about to be stored, refuses the save locally, and selects the offending block so
the inspector shows the sentence beside the field that fixes it. Blocks
`prepareBlocksForSave` drops — an image row with no file yet — are skipped, so
they stay an editing state rather than becoming a refusal. The upload panel also
states the ceiling before the picker opens; `image-upload-limits.ts` is the one
copy of it, asserted against `image-upload-pipeline`'s own constants by test,
replacing three hand-typed captions of which two had already drifted.

**Publish no longer discards unsaved specifications (2026-08-21).** The
Specification section owns its own versioned write, so a seller who typed a value
and pressed **Publish Update** without pressing **Save Specifications** published
without it — with nothing on screen saying the field was unsaved. Publish and
Save Draft now flush the specification fields first
(`flushCategoryAttributes`), and publish compare-and-sets against the
`products.version` that flush returned rather than the one the page rendered
with — otherwise the second write is refused for having done exactly what it was
asked to do. A refused flush stops the publish: a listing that contradicts the
screen is worse than no listing.

**A variant can be given one of the product's stored photos (2026-08-21).**
`product_media_sources.variant_id` has existed since the table was created
(ADR-013 §8) and the editor's read model always reported `hasImage` from it, but
no write path ever set it — so every variant in production showed _"No variant
image"_, on products whose photos were already uploaded, with the Image cell
rendering the literal string `img` for the rows that did have one. The cell is
now the photo and the control: it opens `VariantImagePicker`, which lists every
stored photo of the product — supplier original and seller upload alike, because
saying _which variant a photo depicts_ is a Sals3 editorial fact, not a change to
supplier evidence. `assignVariantMedia` moves one nullable column, matching both
the media row and the variant row on the resolved product's own id (the case a
tenant check alone lets through), reads the previous holder before writing
because Postgres `RETURNING` reports the row _after_ the statement, and records
the move in the audit trail. Clearing is the same write with `variantId: null`:
the photo stays in Product media, and no file is uploaded, copied, or deleted.
Nothing is uploaded from this dialog — that stays in Basic Information's Product
media. No migration.

**Publication confirms itself in a dialog (2026-08-21).** A successful publish
reported itself in a toast that dismissed while the seller was still reading it,
naming a storefront path and offering nowhere to go. `PublishSuccessDialog` shows
the path and the live offer count behind a frosted backdrop, with **Go to Product
Catalogue** as a real link and **Stay on this listing** beside it. The panel
itself stays near-opaque: text over a live blur cannot hold a contrast ratio,
because whatever scrolls behind it decides the ratio.

**Variants & Pricing reworked (2026-08-22).** Presentation only — no schema,
server action, validation, publish gate or read-only rule changed. Three
marketplace seller-centre patterns were taken as _ideas_, then expressed in this
editor's own vocabulary and visual language rather than transcribed; where the
reference UI and Sals3's data model disagree, the model won.

- **One card per axis, from one component.** `VariantMatrixAxisCard` renders the
  card chrome for both editing modes; the first-time mapping form and **Edit
  names** had each carried their own copy, which is how they drifted apart once
  already. The header is a gradient ordinal chip plus the axis name **once the
  seller supplies one** — a named card reads `1 · Colour`, and only an unnamed
  one falls back to `Option 1`, because the field directly below it already says
  `Option 1 name`. The word `Variation` is deliberately not used: seller-facing
  copy was moved off "Option groups" onto **Variant Matrix** on 2026-08-17, and a
  third noun for the same thing would undo that. No remove-axis control: axis
  count and which supplier token sits at which position are what variants, carts
  and accepted orders depend on, and mapping stays insert-only.
- **Option values two-up instead of one tall column.** A four-colour, four-size
  product ran the matrix down the whole viewport and pushed the variant table
  below the fold. Values are chunked **column-major** into two `flex-col`
  columns — not a grid with `grid-auto-flow: column` — so array order, which is
  the order the reorder arrows walk, still runs downwards inside each visible
  column. A row-major grid would have made ▲ move a value _left_. Three values or
  fewer stay in one column, and below `lg` both columns stack (the duplicate
  column header is `hidden` there, or it reads as a second option group).
- **The table header, count and bulk control inside the table's own box**,
  titled `Variants` to match the section it sits in. Rows are taller, and there
  are **no vertical rules** — the portal's tables are ruled horizontally, and a
  full grid draws eight lines to answer one question. Instead `Supplier cost` and
  `Supplier stock` are **recessed onto the muted surface**: they are the two
  read-only numbers sitting either side of the one number a seller does set, the
  only place in the table where read-only can be mistaken for a field, and
  `VariantMatrixValueRow` already recesses the locked supplier token this exact
  way. `Retail price` carries the editor's own dot rather than a form asterisk,
  so the table and the matrix above it use one marker language, and it is marked
  only because `publishProduct` genuinely gates on it — `Sals3 SKU` is editable
  and gates nothing, so it is unmarked. The footnote names the recess, because
  the recess is the only thing on screen saying those numbers are not fields.

Two reference patterns were **not** adopted. An inline `Price / Stock / SKU` +
Apply-to-all row: supplier stock is read-only evidence here rather than a number
a seller sets, and the bulk control is one of the three places the 2.5%
retail-over-supplier-cost floor is enforced — it states its blast radius and
disables **Apply** against the highest affected cost, so an inline field would
either duplicate that guard or ship without it. And a per-option-value
thumbnail: media attaches to a _variant_ (`product_media_sources.variant_id`,
one nullable column, with `product_media_sources_product_checksum_key` making
the same file unrepeatable within a product), so one photo cannot stand for
every variant carrying a colour. See the open question in
`VariantMatrixAxisCard`'s notes.

**Photos against Variant Matrix values, with no schema change (2026-08-22).**
Requested as "upload variation pictures here". `VariantValuePhotoStrip` renders
one row of thumbnail chips per axis in the mapped Variant Matrix, and pressing a
chip opens the **same** `VariantImagePicker` the variant table's Image column
opens — so the only write is the one that already existed,
`assignVariantMedia`'s single `UPDATE product_media_sources SET variant_id`,
inside a transaction, tenant-checked on the product's own id, audited, and
reversed by assigning `null`.

**No DDL, and deliberately so.** `product_media_sources` is written by draft
creation, publication, every seller upload and the supplier mirror; Drizzle names
every column of a table in its `INSERT`, so a new column there changes the SQL
all four emit the moment it enters the schema file — the reason that file already
carries a `Neither column may be added to this schema before its DDL is applied
to production` warning, and the reason three production outages came from
migrating out of order. Nothing was generated, nothing was applied, and the local
database was not touched.

What made it possible without a column: `product_variant_option_values` already
records which variants carry which option value, and the read model already joins
it to build `optionLabel`. One field — `optionValueId` — was added to that
existing `select`, no extra query, and `mappedAxes[].values[].variantIds` now
carries the link. `resolveVariantValuePhotos` then derives each value's photo from
`variants`, which is client state, so a chip updates the moment the picker writes
rather than waiting for `router.refresh()`.

Three honest limits, each visible on screen rather than papered over:

- **A chip is a control only where the value resolves to exactly one variant** —
  a colour-only product, the commonest shape. There the value _is_ a variant and
  the write is exactly what the chip shows.
- **A value shared by several variants is read-only and names the variant its
  photo came from.** Making it a control would set the photo on `Black / L` under
  a label reading `Black`, leaving the other three Black variants photoless on
  the storefront.
- **An axis with nothing exact in it is not rendered at all.** On a Colour × Size
  product no chip could be a control, and a `Size photos` row is noise — nothing
  about a _size_ has a picture, and Sals3 cannot know which axis carries
  appearance, the same limit that stops it naming the axes. When that empties the
  strip, one sentence points at the variant list's Image column instead.

An unmapped product gets no strip: option values are written by
`saveOptionMapping`, so before the matrix is saved there is no row for a photo to
hang from. A true per-value photo — one picture for `Black` regardless of size,
which is what a buyer-facing colour swatch would need — remains unbuilt and needs
its own column or join table, its DDL applied to production **before** the
Drizzle schema learns it, plus the storefront read model and PDP to consume it.
Recorded as an open note in `VariantMatrixAxisCard`.

**A Variant Matrix value is repositioned by one grip (2026-08-22).** Requested
as "para madali i-reposition", then "alisin mo na yung upward downward arrow kung
may drag button na", then "⋮⋮ grip - eto lang dapat meron". The up/down arrow
pair is gone and the row carries a single control.

- **Mouse:** drag the grip onto another row to take that row's position. The
  dragged row recedes to 40% while it moves and the landing row takes a
  brand-blue outline — the row is outlined rather than an insertion line drawn,
  because a drop takes over that row's position rather than sliding in beside it.
- **Keyboard:** focus the grip and press the up or down arrow key. Its accessible
  name says so, because a grip hints at nothing on its own.

**The grip is a `<span role="button">`, not a `<button>`, and that is not a
style choice.** A bare `<button draggable="true">` with nothing else on it never
fired `dragstart` in Chromium — proven by a spike — while identical markup as a
`<span>` did; Chromium treats a button's mousedown as a press rather than the
start of a drag. The same finding killed an intermediate design in which one
element was both a menu trigger and the drag source, and the menu library was not
at fault.

**Known gap, accepted with the one-control decision: the order of values cannot
be changed on a phone.** Native HTML5 drag events do not fire from a touchscreen
and a touchscreen has no arrow keys, so neither route is available there. WCAG
2.5.7 asks for a single-pointer alternative to dragging and there is none.
Closing it needs pointer-event dragging (`pointerdown`/`pointermove` with
`touch-action: none`) instead of the native API — a real change rather than a
prop. Recorded in `VariantMatrixValueRow`.

**A failure mode was removed rather than handled.**
`keepFocusOffDisabledArrow` existed because an arrow disables at its end of the
list, and `disabled` on the focused element makes a browser drop focus to
`<body>` — so a keyboard seller lost their place at the moment the move
succeeded. The grip is never disabled; a move off either end is simply ignored.
The helper is deleted. `DescriptionBlockEditor` still renders a
disabled-at-the-ends arrow pair and still has the underlying problem; it never
used this helper, and fixing it there is its own change.

No dependency was added — `draggable` plus four event handlers; no `dnd-kit`, no
`react-beautiful-dnd`. `useVariantValueDrag` holds the source row rather than
putting it in `dataTransfer`, because the browser exposes transfer contents only
on `drop`, which is too late to stop a _hover_ highlight appearing on a row in
the wrong axis card. A drag started in `Colour` therefore never highlights, and
never lands on, a row in `Size`.

Reordering needed no new write path. `move()` already lifted before it inserted,
so it accounts for the post-removal shift and handles an arbitrary from→to;
`moveValueTo` only adds a second way to say where. And `renameOptionMapping`
already writes positions in two passes — every value of the axis is lifted above
its own maximum before final positions are assigned, which empties the whole
`0..n-1` range — so it accepts any permutation, not only the adjacent swaps the
arrows could produce.

## Product Catalogue: narrower table, Live landing tab (2026-08-22)

Four owner-reported changes to `/listings`. Presentation and default state only —
no schema, migration, server action, publish gate, permission, or supplier call
changed, and no CJ request was added.

- **Row actions collapsed into `More`.** The Actions cell was `Edit` +
  a `Publish to storefront` / `Pause listing` button + a `More` menu, which made
  it the widest column on a nine-column table and pushed it past the right edge
  at anything below 100% browser zoom. It is now `Edit` + `More`, with publish and
  pause as the menu's first item. The cell moved into its own
  `CatalogueRowActions` component, which owns the transition: a
  `DropdownMenuItem` unmounts the instant the menu closes on click, and
  dispatching a transition from a component unmounting in the same commit is the
  defect that reached production on 2026-08-19. That is also why the outcome
  arrives as a toast rather than a pending label — the menu is gone by the time
  the server answers. **One row now has one meaning of Pause**: a persisted row
  (`productVersion` present, the compare-and-set token the action requires)
  pauses through `unpublishProductAction` and genuinely leaves the storefront; an
  illustrative fixture row pauses in memory and says so. Both used to be offered
  on the same row at once, the real one as a button and the preview one as a menu
  item.
- **The `Availability` column and its `Any availability` select are gone.** The
  derived state itself is untouched: `deriveProductAvailability` still runs for
  the `Out of stock (N)` quick filter and its count, and the expanded variant rows
  still show availability per variant with the supplier-observed quantity and
  last-checked time beside it — which is the level the evidence is observed at,
  and costs the header no width. This narrows what ADR-013 §5 and the 2026-08-10
  dropshipping correction put on the screen as separate dimensions; the dimension
  is still separate in the data and still filterable by stock, just not as its own
  parent column.
- **`Media` reads `Supplier photo`, not ADR-011's `Supplier fallback`.** The code
  and meaning are unchanged. "Fallback" names the resolution rule, and reads to a
  seller as a fault in their listing — while `mediaStatusOf` returns
  `SUPPLIER_FALLBACK` for any published product carrying only the supplier's
  photo, which is nearly every row in production. Its badge tone dropped from
  `warning` to `info` for the same reason: an amber pill on the ordinary case
  trains sellers to ignore the column. Recorded on `MEDIA_STATUS_LABELS` so it is
  not reconciled back to the ADR's wording. Note `SUPPLIER_PICTURES` still reads
  `Supplier pictures` and now sits close to it in the media filter — the real read
  model never produces that status (only fixtures do), so the two never appear
  together on a production row.
- **The screen opens on `Live`, not `All`.** `All` is still the leftmost tab and
  the counts are unchanged. Consequence accepted deliberately: a seller whose
  catalogue is entirely drafts lands on the empty state and has to pick a tab —
  preferred over a data-dependent landing tab that would silently change the
  first time a listing went live.

## Product reviews — schema and DDL only (2026-08-22)

Migration `0028_icy_sally_floyd.sql` creates `sals3_product_reviews` and
`sals3_product_review_replies` (`src/lib/db/schema/reviews.ts`). **Nothing reads
or writes either table yet.** The review domain, its server actions, the Seller
Center screen, and the storefront surfaces are separate changes that follow only
once the DDL has actually run against production — the ordering PR #102 got wrong
when it 404'd the whole Product Catalogue by shipping a feature whose migration
had only ever run locally.

Apply it the way every other post-`0019` migration is applied: trigger the
`Reviews Migrate Product Reviews` GitHub Actions workflow (`workflow_dispatch`,
`CRON_SECRET`-authenticated), which calls
`POST /api/internal/reviews/migrate-product-reviews` on the deployed app itself.
`GET` on the same route reports table existence without writing. Both are
idempotent and safe to run more than once; the workflow fails the run unless the
response proves both tables exist afterwards. Production is never migrated from a
laptop — `npm run db:migrate` only ever reaches `localhost`, and
`scripts/guard-remote-db.mts` refuses anything else.

Design decisions worth knowing before building on it:

- **Eligibility is derived, never stored.** A buyer may review an item when that
  item's own `fulfillment_groups.parcel_state` is `DELIVERED`. There is no
  invitation table and no flag on the order line. `TRACKING_CONFLICT` is
  deliberately **not** eligible: ADR-004 §5 gives that state to a carrier
  "delivered" the supplier disputes, so nobody yet knows the item arrived.
- **One review per `sals3_order_lines` row**, enforced by
  `sals3_product_reviews_line_key`. Not per product, not per order, and not per
  unit — quantity 2 on one line is still one review.
- **Nothing was added to `sals3_order_lines`.** The relationship lives on the
  review side only, because Drizzle names every column of a schema in an
  `INSERT` and both order-line readers use a bare `.select()` — see
  `src/modules/orders/migrate-order-line-snapshot.ts` and
  `order-line-columns.test.ts`. New tables cannot do that to an existing writer,
  which is why this migration ships its schema, its `drizzle/` file, and its
  ledger row together where the snapshot column could not.
- **Each DDL statement runs in its own transaction with a 5s `lock_timeout`.**
  Three of the six foreign keys reference `sals3_order_lines`, `sals3_orders`,
  and `products`; `ADD CONSTRAINT ... FOREIGN KEY` takes a `SHARE ROW EXCLUSIVE`
  lock on the referenced table, so a lock it cannot get must abort the run rather
  than queue paid checkout behind DDL. Every statement is individually
  idempotent, so a retry resumes instead of restarting.
- **A rating gates nothing.** ADR-010 reserves `products.score` and leaves it
  unwritten. Nothing here writes to `products`, and a rating must not become a
  publication input, an evaluation signal, or a ranking key without its own
  owner decision.
- **Supplier reviews are not these reviews.** CJ's `listedNum` and
  `/product/productComments` are evidence about CJ's own marketplace, not Sals3
  ratings (ADR-013 §7). No row here can originate from a supplier and no supplier
  call produces one (ADR-017).
- **`buyer_email` is authorisation data**, stored lower-cased and matched the way
  `buyer-read.ts` matches it. It is never projected to the storefront or to the
  Seller Center. `display_name` stores the **already-masked** string the buyer
  consented to ("Hezekiah A."), so no read path can leak a surname it was never
  given; `null` means they chose to stay anonymous.
- **A seller can answer a review, never hide one.** `HIDDEN_BY_PLATFORM` exists
  for a holder of `review:moderate` (a permission that already existed in
  `PORTAL_PERMISSIONS`); ADR-014 puts platform moderation in the Admin Portal.
  Replies are versioned with `supersedes_id` and a partial unique index rather
  than updated in place — PR #80 shipped the opposite on pricing overrides, and
  the history a dispute would be settled from never recorded the replacement.

## Description: simple text or a designed layout

The Description section offers two editors and the seller picks with a toggle.

| Mode                | Surface                                          | Where it saves                                    |
| ------------------- | ------------------------------------------------ | ------------------------------------------------- |
| **Simple text**     | One box on the listing page                      | `Save Draft`, like every other field on that form |
| **Designed layout** | A summary card linking to the full-screen editor | That screen's own narrow description save         |

**Both write the same stored document.** Simple text is a _view_ over the
allow-listed block format, not a second schema: paragraphs split on blank lines,
images appended after them. One stored format means one renderer, one validator,
and no mode flag that can disagree with the content it describes.

The shape simple text can hold is `[paragraph…][image…]`. Paragraphs because
blank lines separate them — a single newline stays _inside_ a paragraph, which is
how sellers actually write a features list in a plain box. Images trail because a
textarea cannot express interleaved order; there is nowhere in a string to say
"and here, between these two paragraphs, a photo". That is what designed mode is
for.

### The mode is stored on the document, but still needs no migration

`descriptionDocumentSchema` carries an optional `mode: 'simple' | 'design'`. It
lives in the same JSONB column as the blocks, so adding it was a code-only
change — the same non-event `runs` was.

It is stored rather than derived because **the content can no longer answer the
question.** Simple text publishes only its paragraphs but _retains_ photos saved
in the designed layout, so a simple document holding photos is indistinguishable
by content from a designed one. That ambiguity is the whole reason the field
exists.

This is a flag that could in principle disagree with the content, which earlier
versions of this feature avoided on purpose. The trade is deliberate: a flag that
decides _what publishes_ records a seller's stated intent, and honouring it costs
less than deleting photos they spent time uploading.

A document with no `mode` predates the field. `initialDescriptionMode` infers one
for those — text-only opens simple, anything holding a photo opens designed,
which is where that photo is visible — so no stored description changes what it
publishes.

### Photos are retained across a switch, never deleted

Owner decision, and it is the point of the stored mode:

| Seller does                          | What happens                                                      |
| ------------------------------------ | ----------------------------------------------------------------- |
| Uses simple text                     | Only the paragraphs reach the product page                        |
| Switches to simple with photos saved | Photos stay in the document, unpublished, and are named on screen |
| Switches back to the designed layout | Photos come back whole, in order                                  |

`publishableBlocks(blocks, mode)` is the **only** place the mode changes an
outcome, and the storefront read model is its only caller — so the rule lives
once instead of being re-derived by every consumer that renders a description.

Simple mode states what it is holding (_"One photo from the designed layout is
saved with this description…"_) rather than showing a strip it cannot let the
seller place. A photo that is neither visible nor mentioned reads as one that was
thrown away.

### Switching to simple text names what it costs, first

Simple → designed is lossless and silent: every paragraph and image is already a
valid block, so that direction adds capability without touching content.

Designed → simple asks only when text _structure_ would change.
`describeSimpleModeLoss` counts what will flatten and says so in the seller's
words ("Simple text cannot hold 2 headings and 1 bullet list…"), and
`flattenToSimpleMode` runs only on confirmation. **Every word survives** — a
heading becomes its own paragraph, lists become one line per entry, emphasis is
dropped. Photos are not listed as a loss because they are not one: they are
carried through untouched, and the message says so.

A document that is already plain paragraphs plus photos switches with no dialog
at all, because nothing about it changes.

This is not politeness. `descriptionBlocksToPlainText` carries a comment
recording that this exact round trip once "silently downgraded headings,
bullets, and detail lists into paragraphs". Naming the loss before it happens is
the difference between a conversion the seller chose and one that happened to
them.

### Simple text is only the box

No upload button and no prompt chips, by owner decision. An upload here could
only ever produce "the photos you uploaded, in that order, after the text", a
worse version of what the designed layout does properly — placement is that
mode's whole point. A row of suggestions around an empty box is furniture rather
than help.

Photos a document already holds are **named** in simple mode rather than shown as
an editable strip, because simple mode cannot place one and does not publish one.
Adding or placing a photo means switching to the designed layout.

### The character counter is guidance, never a limit

`SIMPLE_TEXT_SOFT_MAX` (3,000) turns the counter amber and explains itself. It
cannot refuse a save and never truncates — a seller who arrives over it by
switching from a long designed document keeps every word. Truncating a seller's
copy to satisfy a counter would be the worst possible reading of "guidance".

### One bug worth recording

The field holds its own text in state rather than deriving it from the document
each render. Deriving it made **a trailing space impossible to type**: storing
trims each paragraph, so a space at the end round-tripped away in the same
keystroke that produced it and the seller watched it vanish. The reconciliation
compares the incoming document against the field's _own projection_
(`normalizeSimpleText`), never against its raw value, so the parent's faithful
echo is not mistaken for a change made elsewhere. The trim belongs at save time,
where `prepareBlocksForSave` already does it.

### Not built: AI Polish

A "polish this description" action needs an AI provider, a per-call cost, and a
decision about rewriting a seller's own words on their behalf. None of those are
approved, so there is no button — a control that cannot work is worse than its
absence.

## Description full editor

`/listings/[productId]/description` is the description editor on its own
full-viewport screen. It replaced the inline block form inside the listing
editor's Description section, which is now a read-only summary plus an
`Open full editor` link. A fixture preview (`?fixture=`) has no revision to
compare-and-set against, so it keeps the inline form instead of linking to a
screen whose save could never succeed.

### Why a separate route, and a separate save

The screen owns the description and nothing else. `Save Draft` on the listing
editor writes a whole draft — title, category, and every variant retail price —
so a second screen saving through that action would let a description edit
quietly revert a price changed in another tab. This screen calls
`saveDescriptionAction`, which compare-and-sets the exact revision version the
canvas rendered and touches no other column, following the same single-concern
pattern as `saveMetaDescription`, `saveShowSupplierPhoto`, and
`renameOptionMapping`.

Because nothing else on the listing is held there, leaving needs no
are-you-sure prompt. And because the revision version moves on save, a stale
listing-editor tab that later presses `Save Draft` is **refused** with
`version_conflict` rather than overwriting what was written here.

It lives in an `(studio)` route group with its own pass-through layout. Layouts
nest, so a child of `(portal)` could only add chrome to the rail and topbar,
never remove them; here the rail is genuinely absent, which is what gives the
canvas the width a page-shaped preview needs.

### The canvas is calibrated to the product page, not to today's storefront

Text sits in a 70ch measure at 15px/1.7, headings are Outfit, captions are
12.5px, and images break out past the measure with their aspect ratio reserved —
16:9 for a single image, 4:3 once two or more sit consecutively. These are the
PDP v3.1 target measurements. The deployed storefront currently renders
descriptions at 14px and has no `image` branch at all, so calibrating to what
ships today would mean rebuilding this the week the redesign lands.

The 70ch measure is **drawn** on the canvas as a hairline guide, and image
blocks visibly cross it. Text staying narrow while images run wide is a property
of the page a seller otherwise cannot see until it is live.

Image layout stays derived from adjacency and is never stored: "Two images side
by side" inserts two plain `image` blocks. A stored group would be a container a
delete can leave half-empty.

### Emphasis is stored as marks, never as markup

Paragraphs support bold and italic. There is still no sanitiser anywhere in this
system, and `MARKUP_OPENER` still rejects markup-shaped input at the server
boundary, so emphasis is **not** HTML. A paragraph carries an optional
`runs: { text, marks }[]` alongside its `text`, `marks` is a closed enum
(`strong`, `em`), and `InlineRunsText` maps each mark to a real React element.
Nothing is ever handed to a parser, and there is no `dangerouslySetInnerHTML` on
this path.

Two properties make this safe to add before the storefront reads it:

- **`text` stays canonical and `runs` stays optional.** A consumer that knows
  nothing about marks renders every word and loses only the emphasis. Contrast
  the `image` block, which the storefront's four-member union drops whole — an
  additive-optional field degrades, an additive-required one disappears.
- **`runs` must join to exactly `text`,** enforced by `descriptionDocumentSchema`
  at the document level. Without it the two fields could describe different
  sentences, and which one a buyer saw would depend on whether their renderer
  understood marks. `prepareBlocksForSave` trims runs together with the text so
  the invariant holds by construction rather than by two matching `.trim()`
  calls.

The editing surface is a `<textarea>` styled to the page's own type, not
`contentEditable`. A textarea cannot hold markup, so the allow-list posture
survives every paste; its selection API is plain integer offsets, which is what
`inline-runs.ts` operates on; and `contentEditable="plaintext-only"` — the
obvious future move — only reached Firefox in 136, which is not a version to
gate a seller workflow on. Offsets are treated as UTF-16 code units to match
`selectionStart`/`selectionEnd`, and a selection is widened rather than allowed
to split a surrogate pair.

**No new dependency was added for any of this.** No Tiptap, ProseMirror, Lexical,
or Slate: the editor is the existing block document plus one pure module
(`src/lib/products/inline-runs.ts`). Bundle and cost impact is neutral.

### Known gap

Description images do not reach buyers yet. `sals3-ecommerce`'s
`ProductDescriptionBlock` union has four members with no `image`, and its
`salvagedArray` parse drops any block that fails — silently, with no error and no
log. Images authored here are stored correctly and will appear once the
storefront reads them; the storefront change is deliberately a separate task.

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

> **Superseded in part, 2026-08-14 (owner decision, Bogs): the CJ category IS
> the Sals3 category.** When no reviewed rule covers a supplier category,
> `src/modules/catalog/taxonomy/cj-mirror.ts` automatically creates a 1:1
> mirror — a `sals3_categories` row (`code = CJ-<external id>`, `path` = the
> observed CJ name) plus an `ACTIVE`, `APPROVED`, `EXACT` `EXTERNAL_ID_RULE`
> mapping — at draft creation and, for older `UNMAPPED` drafts, inside the
> publish transaction (`products/category-mirror.ts`). The Basic Information
> composer field is labelled **Sals3 Category** and stores only a seller-facing
> Sals3 taxonomy L1 draft/display value (`products.sals3_category_l1`). It does
> **not** write `products.category_id`, which still requires a stable leaf
> category identity. `Category & Specifications` continues to show **CJ
> Category** as supplier evidence. The old "Sals3 category is not mapped"
> blocker survives only as "CJ category is missing", raised when a product has
> no CJ category on record at all. A reviewed mapping that names a category
> still outranks the mirror, guessing from category _names_ is still
> unrepresentable, and pricing still requires a per-category margin policy
> before a price resolves.

A supplier category otherwise becomes a Sals3 category through an approved,
versioned mapping. This is the crosswalk `product-catalog.ts` refers to when
it says a CJ-sourced draft starts `UNMAPPED`.

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

## Category-driven Specification controls (attribute controls workbook)

A second, independent extraction from a different sheet of the same
finalized taxonomy workbook (`Category_Attribute_Controls` +
`Attribute_Control_Dictionary`) adds per-category **specification**
controls on top of the already-live, locked v1 category hierarchy: 53,625
(category, attribute) rows across the 5,595 v1 categories, plus a
149-entry canonical attribute dictionary. This is purely additive — it
does not touch `sals3_categories`, and it does not touch the older,
dormant `sals3_category_presets`/`CategoryFormContract` system above
(that one still exists for variation-tier/SKU-format suggestions and is
untouched).

| Piece                                              | File                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------- |
| Reference tables (controls, dictionary)            | `src/lib/db/schema/category-attribute-controls.ts`                            |
| Seller-answer table                                | `product_category_attribute_values` in `src/lib/db/schema/product-catalog.ts` |
| Extraction script (the only place `.xlsx` is read) | `scripts/extract-category-attribute-controls.mts`                             |
| Seed script                                        | `scripts/seed-category-attribute-controls.mts`                                |
| Frozen extraction JSON                             | `src/lib/db/seed-data/sals3-category-attribute-controls-v1.json`              |
| Contract + validation                              | `src/modules/catalog/taxonomy/attribute-contract.ts`                          |
| Domain write path                                  | `src/modules/catalog/products/save-category-attributes.ts`                    |
| Server Action                                      | `src/app/(portal)/listings/category-attributes-actions.ts`                    |
| Product Editor UI                                  | `src/components/products/editor/category-attributes/`                         |

Versioned independently from the category tree: `controlsVersion`
(`ACTIVE_ATTRIBUTE_CONTROLS_VERSION = 'sals3-attribute-controls-v1'`) is a
free-text string on its own axis from `ACTIVE_TAXONOMY_VERSION`, because
the category hierarchy is locked forever but attribute controls are
expected to be revised — a corrected extraction lands beside the old one
under a new version string rather than overwriting it.

Seven input control types (`SINGLE_SELECT_DROPDOWN`,
`MULTI_SELECT_DROPDOWN`, `TEXT_INPUT`, `NUMBER_INPUT`,
`MEASUREMENT_INPUT`, `BOOLEAN_TOGGLE`, `DATE_PICKER`) — the workbook only
actually uses the first four today, but the Product Editor renders all
seven so a future extraction using the other three needs no UI change.
Three requirement levels (`REQUIRED`/`RECOMMENDED`/`OPTIONAL`) drive
severity exactly like the existing Supplier Details specifications:
`REQUIRED` unresolved is a hard publish blocker
(`publish.ts`'s `requiredCategoryAttributesMissing`), `RECOMMENDED`
unresolved is a warning, `OPTIONAL` is neither.

`validateCategoryAttributeSubmission` (`attribute-contract.ts`) is the
single source of truth for what counts as valid, re-run server-side on
every save (`saveCategoryAttributes`) and again at publish
(`publish.ts`) — never trusted from client state. A dropdown value
outside `Allowed Values` is rejected unless the control permits a custom
value, in which case it is accepted and flagged `isCustomValue: true`. An
attribute name the contract does not recognize is preserved verbatim for
review, never silently dropped — the same guarantee the older
`validateCategoryAttributes` already held for required-attribute names.

SEO/AEO/GEO visibility and compliance-review-flag metadata are extracted
and persisted but **not** yet surfaced as PDP structured data — reference
metadata only, pending a future PDP/schema mapping task, consistent with
this repo's standing rule against fabricated structured-data fields.

Extraction re-asserts every invariant already verified true of the
source workbook as a regression guard (exact sheet names/counts, zero
duplicate `(category, attribute)` pairs, the dropdown/allowed-values
invariant, dictionary↔controls 1:1, cross-sheet hierarchy match against
the **live** `sals3_categories` table) and aborts loudly on any
unrecognized enum value rather than guessing — same discipline as
`readVariationTiers`'s allow-listed prefix match. The workbook's own XML
parts use a nonstandard `x:`-prefixed OOXML namespace that `exceljs` does
not recognize; the extraction script repairs a temporary in-memory copy
via `jszip` before reading it — the file on disk is never modified.

```bash
npm run extract:attribute-controls -- --discover-enums   # print distinct values for every enum-shaped column
npm run extract:attribute-controls -- --dry-run          # validate without writing the JSON
npm run extract:attribute-controls                       # write the frozen JSON
npm run seed:attribute-controls -- --dry-run              # validate without writing to the DB
npm run seed:attribute-controls                            # seed the reference tables
```

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
| `CATEGORY_MAPPING_REQUIRED`                    | No `ACTIVE`, `APPROVED` crosswalk mapping covers this product's provider category — the crosswalk itself is asked on every import     |
| `PRODUCT_OPTIONS_UNMAPPED`                     | CJ supplies one combined label per variant (`"Black-1XL"`), which is preserved verbatim and never split into option axes by guesswork |
| `PRICING_UNRESOLVED`                           | The ADR-015 resolver declined; its exact reason is recorded on the offer                                                              |
| `NO_ACTIVE_MARKET_PROFILE`                     | No active profile for a currently authorized destination, so no offer                                                                 |
| `SUPPLIER_CONNECTION_UNHEALTHY`                | The connection is not workable, so no fulfillment binding is truthful                                                                 |
| `MEDIA_SOURCE_NOT_RECORDED`                    | The database holds no supplier image address for this candidate at all                                                                |
| `STRUCTURED_DESCRIPTION_REQUIRED`              | Supplier description HTML is never copied into a Sals3 product                                                                        |
| `EDITORIAL_RECORD_STEWARDED_BY_ANOTHER_SELLER` | The canonical product exists and another account owns its editorial record                                                            |

### What the import carries over from Product Sourcing

Added 2026-08-14, after the owner reported that a draft created from a Ready
candidate arrived nearly empty — no category, and no photo above Basic
Information. The data was never missing. `create-draft.ts` read exactly one
field (`name`) out of the thirteen in
`candidate_evaluations.feed_snapshot`, and the media projection ran only at
publication. Both are fixed, and still with **zero supplier calls** — every
value below is a stored row:

- **The product photo.** `projectSupplierMediaForProduct()` now runs inside the
  draft transaction, the same call `publish.ts` makes, under the one shared
  `SUPPLIER_MEDIA_RIGHTS` declaration (`SUPPLIER_TERMS` / `APPROVED`, owner
  decision 2026-08-13). It prefers the detail snapshot's full `imageUrls` set
  and falls back to the discovery snapshot's single `imageUrl`, so a candidate
  that only ever went through screening still gets the one honest photo the
  database holds. Product Catalogue rows, the Product Editor Basic Information
  strip, Media, and the Draft Storefront Preview all render that same stored
  supplier image; a tile with no address stays a labelled placeholder.
- **The Sals3 category.** The draft flow asks the ADR-002 crosswalk
  (`resolveCategoryMapping` → `assignProductCategory`, inside the same
  transaction) instead of hard-coding `UNMAPPED`. It has no category parameter,
  so an unmapped, ambiguous, or superseded answer leaves the product `UNMAPPED`
  and reports `CATEGORY_MAPPING_REQUIRED` — a correct outcome, never a guess.
  Approving a mapping remains a platform action in
  `scripts/approve-cj-category-mapping.mts`.
- **The supplier's own facts**, shown as evidence and never as Sals3 decisions:
  CJ's category name, supplier SKU, packed weight (verbatim, including a range
  like `1180.00-1300.00 g` — never parsed into one number), ships-from origins,
  and the feed's lowest variant price as a labelled "from" reference.

The supplier evidence block previously printed the _Sals3_ category where CJ's
own category name belonged, so an unmapped draft claimed the supplier had said
"Unmapped category". The two are now separate fields.

The Sals3 category field in Basic Information is **read-only**. It was a
dropdown over three hard-coded example paths, which for a real catalogue product
offered options its actual value was never among — and a seller choosing their
own category is a seller choosing which pricing policy applies to their product,
which `modules/catalog/taxonomy/authorization.ts` denies to every portal role
including `admin`.

#### Backfilling products imported before this

```bash
npx tsx scripts/backfill-draft-supplier-media.mts --dry-run
```

Reports, per product, which source would be used and how many addresses it would
record; it runs the real projection inside a transaction it always rolls back,
so the dry run cannot disagree with the apply. Re-run with
`ALLOW_REMOTE_DB_WRITE=1` and no `--dry-run` to write. Idempotent — the
projection dedupes by URL, so a second run inserts nothing.

Category backfill needs no new script: `approve-cj-category-mapping.mts` already
re-resolves every `UNMAPPED` product sourced from the category it approves.

> Neither the photo nor the category makes a draft complete. Verified against
> production on 2026-08-14: `sals3_categories` and
> `provider_category_mappings` are both empty, so no category can resolve until
> `npm run seed:taxonomy` and one approved mapping have run;
> `seller_market_profiles` and `pricing_category_policies` are both empty, so no
> offer and no price exist yet; and none of the four existing drafts has a
> `supplier_snapshots` row, so they have zero variants and no description —
> only a CJ detail fetch (evidence capture, which spends CJ points) can supply
> those. Each of these is stated on the screen rather than hidden.

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

`saveProductDraftAction` writes title, Sals3 L1 category, structured
description, and seller-entered retail prices onto an open draft. The revision
update names the revision id, the product id, `workflow_state = 'DRAFT'`, and
the expected version in one `WHERE` clause, so a stale editor, a replayed
submit, and an attempt to rewrite an already-approved revision all match zero
rows. Retail price updates are seller-scoped and product-variant-scoped before
they touch offers. A rejected stale write is audited rather than dropped.

The description is a structured allow-listed block format
(`paragraph`, `heading`, `bulletList`, `keyValueList`) with no raw-HTML block
and no string passthrough. Markup-shaped text is rejected at the server
boundary instead of being stored and escaped later; `a < b` still passes.

### What is wired, and what still is not

`/listings` reads real catalogue rows, and
`/listings/new?productId=<uuid>` renders one of them in the Product Editor
(`dataMode="database"`), so the photo gallery, supplier facts, variants, offers,
and readiness issues on that screen are database values rather than fixtures.
Saved CJ `productImageSet` addresses render in Media, and the selected cover
renders in Draft Storefront Preview. Every other entry mode — no query, or
`?fixture=<key>` — is still the fictional design preview, and says so in a
banner.

Also still absent, and not faked anywhere: approval, media storage, freight,
checkout, and supplier synchronization. Publication now exists
(`publish.ts` + the storefront read model) but is gated on facts most drafts do
not have yet — see the note at the end of the draft-flow section above.

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
  `npm run bootstrap:cj` to seed the one Sals3 Official Dropshipper connection
  from it once; the legacy `src/services/cj/{token,products}.ts` modules are
  deleted. The [storefront product feed](#storefront-product-feed) used to be the
  last runtime consumer of that path, resolving a headless connection through
  `src/lib/storefront/supplier-source.ts`. Both that module and the feed's CJ
  cache were **deleted on 2026-08-13**: the storefront now reads the published
  catalogue from the database, and its import graph is forbidden from reaching a
  supplier adapter at all.
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

`sals3-ecommerce` reads products from the protected storefront API:

```text
GET /api/storefront/products?section=for-you&page=1&limit=14
GET /api/storefront/products?section=deals&limit=5
GET /api/storefront/products/<slug>
GET /api/storefront/categories
```

Each request must send:

```text
Authorization: Bearer <SALS3_STOREFRONT_API_TOKEN>
```

### It reads the database, and nothing else

Owner decision, 2026-08-13. Every value comes from the Sals3 catalogue tables
via `src/modules/catalog/storefront/read-model.ts`; no supplier adapter is
reachable from the routes' import graph, which
`src/modules/catalog/storefront/no-supplier-calls.test.ts` asserts by walking
that graph rather than by spying on one code path.

What this replaced, and why it mattered:

- **The storefront was down.** The old feed resolved a headless CJ connection by
  the shared `SALS3_OFFICIAL_IDENTITY_ID` constant — the literal `'dev-user'`.
  That seller's connection was purged, so every buyer request answered
  `502 CJ supplier feed unavailable`. No request path reads that constant now.
- **Nothing a seller did ever reached a buyer.** The feed served a live CJ
  `/product/list` response, so `products`, `product_variants`, `product_offers`,
  and `product_media_sources` had no effect on the shop at all.
- **Every uncached page view spent CJ points** on the most points-expensive route
  CJ documents — the budget ADR-013 §5 reserves for checkout and accepted-order
  protection.

### Publication is the gate, in the `WHERE` clause

Five conditions hold together before a row is public, listed once in
`publishedScope()` and shared by the page query and its count:
`products.publication_state = 'PUBLISHED'`, a non-null slug, an `ACTIVE`
variant, and an offer that is `PUBLISHED` with `pricing_state = 'RESOLVED'` and
a non-null amount. Approved media with a recorded rights basis is what supplies
the image (ADR-011 §6).

Two things are deliberately **not** filtered. There is no tenant filter — the
public catalogue is cross-seller, and scoping it to one seller would hide
another's genuinely live product with no rule saying so. There is no
`market_code` filter either; adding one means validating a request parameter
against `resolveBuyerDestinationCountryPolicy()`, not hardcoding a constant.

### Pagination and caching

Real `LIMIT`/`OFFSET` on the caller's own `limit`. The old feed passed `page`
straight to CJ while slicing to `limit`, so at `limit=14` items 15–20 of every
CJ page of 20 were unreachable on any page, and `totalPages` used a different
denominator than the one being served (finding 1 of the 2026-08-06 code review).

`src/lib/storefront/catalog-cache.ts` memoises reads per request (`React.cache`)
and across requests (`unstable_cache`, 30 s, tag `storefront-catalog`), matching
`status-counts-cache.ts` so this repository has one caching idiom rather than
three. Publishing or pausing a product calls `updateTag` on that tag, so a
change is visible immediately rather than up to 30 seconds later. The
unbounded module-level `Map` the CJ feed used — keyed partly by a
buyer-controlled `pid`, evicted only on a same-key hit (finding 3) — is gone with
it. Responses stay `Cache-Control: private, no-store`: the payload sits behind a
bearer token.

### Prices are USD, resolved once at publish time

`product_offers.price_amount_minor` is set by
`src/modules/pricing/resolver.ts` inside the publish transaction, with its
policy layers and resolver version frozen onto the row (ADR-015 §7). A buyer
request performs no FX and no markup arithmetic. ADR-003 phase 1 is USD, and
`modules/pricing/reference-fx.ts` resolves only the identity rate, so USD is the
only currency that can currently be produced — see
`modules/market-config/capabilities.ts` for what AUD would additionally require.

The response carries an explicit `currency` field so the consumer never has to
assume one. `src/lib/storefront/fx.ts` (USD→PHP) no longer prices anything
customer-facing and is forbidden to the storefront's import graph.

### The contract is additive-only

`sals3-ecommerce`'s Zod schema **rejects the entire page** if a legacy key is
missing or empty. So every legacy key stays, every new key is optional, and the
portal ships first. `ratingLine` and `shipLine` are kept as deprecated
non-claims — "No reviews yet" and "Delivery quoted at checkout" — because the
consumer requires non-empty strings, and Sals3 has neither buyer reviews nor a
delivery estimate. They leave this contract once the consumer makes them
optional. `src/lib/storefront/catalog-feed.test.ts` locks the required key set.

New fields: `currency`, `availability`, `categoryName`, and — on the single
product endpoint — `publishedAt`, `categoryPath`, `images[]`, `description`
blocks from the frozen published revision, `variants[]` with their options, and
`specs`. Each is **omitted** when its rows do not exist, never defaulted: an
absent description means nobody has written one, which is a different fact from
an empty one.

#### `specification` is not `specs`

Added 2026-08-21 for the PDP v3.1 shell, alongside `metaDescription`. They look
like two more optional keys and they are, but the first one carries a boundary
worth stating once:

- **`specs`** is what the **supplier reported** and Sals3 repeats — weight,
  dimensions, GTIN, MPN, condition. The consumer labels it "as reported by the
  supplier."
- **`specification`** is what the **seller declared themselves**, against the
  attribute set their Sals3 category defines. `{ label, value }` pairs from
  `product_category_attribute_values`, ordered `REQUIRED` → `RECOMMENDED` →
  `OPTIONAL` and alphabetically within each group — the same order the editor's
  Specification section asks for them in.

The consumer renders them as two sections with two provenance lines. Merging
them into one table under one footnote would attribute the seller's own
declaration to CJ, which is why they are separate keys rather than a merged bag.

Three filters decide what reaches a buyer, all in
`src/modules/catalog/storefront/specification.ts`:

1. The attribute must be **recognised under the product's current category** —
   the join is on `products.category_id`, not on the `controls_version` the
   value was saved against. A stored value survives a category change on
   purpose, so a row can outlive the contract that asked for it.
2. `seo_visibility = 'ATTRIBUTE_CONTEXT_ONLY'` **never reaches a buyer**. The
   workbook classifies every attribute; that column decides, not this code.
3. An **empty value produces no row**. This is also what keeps a defaulted
   `Others` country of origin off the page: the editor shows `Others` as a
   _placeholder_ for an undecided field, so an undecided origin has no stored
   value and therefore no row — and no data-quality claim is made to Google
   about a fact nobody established.

The workbook's `UNBRANDED` token is display-mapped to `Generic` here, through
the same `categoryAttributeValueDisplayLabel` the editor uses, so the raw token
never reaches a buyer while what is stored stays the seller's actual pick.

`metaDescription` is the seller-edited `<meta name="description">` from
`products.meta_description`, trimmed, and **omitted when blank** — an empty
string would beat the consumer's own fallback chain and leave the page with no
meta description at all. It is hidden metadata: the consumer must never render
it in the page body.

No migration: every column and table these read already existed. The
`storefront-catalog-product` cache key moved `v3` → `v4`, because a warm `v3`
entry would keep serving rows without either field for up to 30 seconds after
deploy — which reads as "the feature did not ship". The feed key stays on `v2`;
a card row carries neither field.

`shipsFrom` is omitted in v1 on purpose. No product, variant, or offer column
holds a stock-origin country, and the only source is seller-scoped screening
evidence a public query must not join to. Adding it properly is a migration.

**No comparison price is published.** `oldPriceMinor` equals `priceMinor`, so
the storefront renders one price with no strikethrough and no percent-off badge.
It must never be derived from the current price — a was/now pair invented by
marking the live price up is not evidence of a prior price, and ADR-003
prohibits it. `product_offers_compare_at_requires_evidence` enforces the same
rule at the database level. The `deals` section is an ordering (cheapest first),
not a discount claim.

### Failure envelopes

`401` without a valid bearer. `404` from the single-product route for a
non-slug, an unknown slug, and an unpublished product — one indistinguishable
answer, so a caller cannot enumerate drafts. `503 Catalog temporarily
unavailable` for anything unexpected, logged server-side and never returned in
the body. The old handler collapsed a missing credential, a rate limit, and an
unreachable upstream into one opaque `502` and rethrew everything else —
including `PermissionError` — into an unhandled 500 (finding 7).

### Getting a product into the shop

The storefront shows only published products, and publication has its own
prerequisites:

1. `npm run seed:taxonomy` and `npm run seed:taxonomy-presets` — `sals3_categories`
   starts empty.
2. `tsx scripts/approve-cj-category-mapping.mts --external-category-id … --sals3-code … --confidence EXACT --reason "…"`
   — approves one CJ→Sals3 mapping and applies it. A **script**, not a screen:
   category governance is platform authority, denied to every portal role
   including `admin` (ADR-014), and `taxonomy/boundaries.test.ts` forbids any
   `src/app` import of those modules.
3. Activate a market profile, a category margin policy, and a funding buffer in
   **Market Rules** — all three already have UI.
4. Fetch supplier evidence for the candidate from the Product Sourcing detail
   drawer's "CJ detail evidence" section. This is the one place in the sourcing
   UI that spends CJ points (three requests per candidate), so it always takes a
   press, is `product:import`-gated, rate-limited, and audited.
5. Re-run the draft flow so variants, per-variant costs, and supplier bindings
   materialise, then choose **Publish to storefront** from the Product Catalogue
   row's **More** menu (it was a button in the row until 2026-08-22).

`publishProduct` refuses with a specific reason rather than a constraint error
whenever a fact is missing: `NO_ACTIVE_VARIANT`, `CATEGORY_UNMAPPED`,
`NO_APPROVED_MEDIA`, `PRICING_UNRESOLVED` (carrying the resolver's own reason),
`NO_ACTIVE_MARKET_PROFILE`, `CURRENCY_NOT_AUTHORIZED`, `NO_SUPPLIER_COST`,
`NO_ACTIVE_SUPPLIER_BINDING`, `NO_PUBLISHABLE_REVISION`, `SLUG_UNAVAILABLE`.
Nothing is fabricated to get past a gate. `unpublishProduct` pauses a live
product and keeps its slug, so a republish keeps the same public URL.

Slugs come from `products.title` — the Sals3-owned editorial field — never from
the CJ `pid` the old feed leaked into every public URL. The slug and the
publication flip are one statement, because
`products_public_slug_key` is a partial index over `PUBLISHED` rows and a
separately written slug could not conflict.

## Buyer orders API and status sync

The storefront's `/orders` pages read these two endpoints, added 2026-08-19:

```text
GET /api/storefront/orders                       # every order on one buyer account
GET /api/storefront/orders/S3-YYYYMMDD-XXXXXXXXXX  # one order, if that buyer owns it
```

Both take the same `Authorization: Bearer <SALS3_STOREFRONT_API_TOKEN>` as the
product feed, plus `X-Buyer-Email: <verified email>` — the storefront server
puts its **session-verified** email there, never anything a request supplied,
because that header is the authorisation. The detail endpoint answers the same
404 for an unknown number and for a number another buyer owns, so whether a
number exists is not learnable from it. The payload (assembled in
`src/modules/orders/buyer-read.ts`) carries minor amounts + currency —
formatting is the storefront's job — and deliberately never includes supplier
connection ids, CJ order/shipment/pay ids, or `supplier_status_raw`.

### Where the status and tracking come from

`src/modules/orders/status-sync.ts` pulls each in-flight fulfillment group's
CJ order detail (`/shopping/order/getOrderDetail`) and carrier scans
(`/logistic/getTrackInfo`), translates them through the ADR-004 state machine
(`parcelStateFromCj` + `reconcileDelivery` — a carrier "delivered" CJ disputes
becomes `TRACKING_CONFLICT`, never a silent downgrade), and persists:

- `fulfillment_groups.parcel_state`, `.tracking_number`,
  `.supplier_status_raw`, `.carrier_delivered_at`, `.last_synced_at`
- `parcel_tracking_events` — append-only, deduped by a hash of
  (source, occurred-at, label), so re-syncing is idempotent

The sync runs as a bounded batch (25 stale groups, terminal parcels skipped)
behind `POST /api/internal/orders/status-sync`, `CRON_SECRET`-gated, called
every 30 minutes by `.github/workflows/orders-status-sync.yml`
(`workflow_dispatch` for a manual kick). Buyer reads never call CJ.

Migration `0025` adds the columns above, the events table, and
`sals3_order_lines.variant_label` — the option label frozen at intent
creation from the provider variant reference, so a supplier rename never
rewrites what an old order says was bought. **0025 is hand-edited to be
idempotent**: it was applied to production on 2026-08-19 under an earlier
number before `0024_spicy_nemesis` took that slot on `develop`, so its journal
`when` is pinned to the production row and every statement is guarded.
Production migrations remain manual: run `npm run db:migrate` against
production **before** deploying code that reads these columns.

### Per-order listing snapshot (`sals3_order_lines.listing_snapshot`)

Owner decision 2026-08-21: **an order must freeze every buyer-visible listing
detail, not only its name.** A seller may rename a product, replace its photos,
rewrite its description, or reorder its option axes — and must be able to — but
that has to apply to new orders only. A customer looking at an order from last
month has to see what they actually bought.

`title`, `variant_label`, and `image_url` were already frozen per line. Nothing
else was: the option axes as the seller had named and ordered them, the rest of
the gallery, the published description, the specification answers, the category
path, and the brand were all read live, so a "360 degree" edit to a live listing
rewrote a past buyer's order history. `listing_snapshot` is the nullable `jsonb`
column that closes that, written once at intent creation exactly where
`variant_label` and `image_url` already freeze.

The bytes are copied rather than a `product_revisions` id referenced. A pointer
is cheaper and would freeze the description exactly, but it makes a two-year-old
order depend on a revision row and an R2 object still existing — so a future
media cleanup would blank the very history the column exists to protect.

**What is captured, and from where.** `checkout/listing-snapshot.ts` reads
`findPublishedProductBySlug` — the exact projection `/api/storefront` served the
buyer — rather than re-deriving the same facts from the catalogue tables. Two
queries meant to agree about what a product page says would drift, and the one
that drifted would be this one, silently, because nothing renders it until
someone opens an old order. The snapshot therefore holds: the option axes in the
seller's own words and order (`Colour: Army Green`, `Size: L` — not the
supplier's `army green-L` token, which stays in `variant_label`), the whole
gallery, the published description blocks, the seller's specification answers,
the category path, the brand, the condition, and the physical facts. One read per
_distinct product_, so three sizes of one shirt is one read.

It is captured at **intent creation**, where `variant_label` and `image_url`
already freeze, and acceptance only copies it. That ordering is the point: a
seller edit landing between payment and webhook delivery must not decide what the
order says was bought. `snapshot-at-intent.test.ts` pins that, because
`createCheckoutIntent` has no behavioural test in this repository (it reaches CJ
freight, the token manager and a governed fetch, and nothing fakes that chain
today).

`GET /api/storefront/orders` and `/orders/{orderNumber}` return it as an optional
`listing` on each line. Optional, and read with `safeParse`: an order accepted
before the column existed has none, and a document this deployment cannot read
degrades to `title` / `variantLabel` / `imageUrl` rather than failing the page of
a buyer who has already paid. **The storefront does not render it yet** — that is
`sals3-ecommerce` work, and until it lands the API carries the record while the
order page still shows the three frozen fields.

**The DDL ships one release ahead of any code that names the column — including
the Drizzle schema itself.** `sals3_order_lines` is the order table, and the
constraint is stronger than "do not query it yet": **Drizzle names every column
of the schema in an `INSERT`**, filling omitted ones with `default`, so adding
`listingSnapshot` to `schema/orders.ts` alone makes order acceptance emit
`insert into sals3_order_lines (..., "listing_snapshot", ...)` and fail every
paid checkout with `column ... does not exist`. Verified with `toSQL()` and
pinned by `order-line-columns.test.ts`. So the first change carries the raw DDL,
the break-glass route and the workflow and _no_ schema change; the column enters
the Drizzle table in the same change as the code that reads it, which deploys
only after a run has reported `columnExistsAfter: true`. The `drizzle/` migration
file and its `__drizzle_migrations` bookkeeping travel with that schema change,
because a ledger row pointing at a file that does not exist yet is worse than no
row. Production is never migrated from a laptop — `npm run db:migrate` only
ever reaches `localhost`, and `scripts/guard-remote-db.mts` refuses anything
else. Apply it with the **Orders Migrate Line Snapshot** GitHub Actions workflow
(`workflow_dispatch`, `CRON_SECRET`-authenticated), which calls
`POST /api/internal/orders/migrate-order-line-snapshot` on the deployed app
itself and fails the run unless the response proves
`columnExistsAfter: true`. Idempotent; safe to run more than once. `GET` on the
same route reports the column's state without writing anything.

### Durable copies of supplier photos (`stored_url` / `stored_at`)

ADR-007's `Media locking` promises that if a supplier replaces or removes a file
at the same URL, an order keeps showing the media it was accepted with. **That is
false for a supplier original today**, and the per-order listing snapshot did not
change it: `source_url` on a `SUPPLIER_ORIGINAL` row is a CJ CDN address, and the
snapshot freezes the _address_, not the bytes. If CJ replaces that file, a
two-year-old order's gallery silently changes — the exact failure that section
exists to prevent, in the one case nobody sees until a dispute.

`product_media_sources.stored_url` and `stored_at` are where the Sals3-hosted
copy's address and capture time go. `source_url` is left untouched: it is
provenance (ADR-011 §6 — where the asset came from), and overwriting it would
trade one gap for another.

**How the copy is taken.** `mirror-supplier-media.ts` fetches each approved
supplier photo once, re-encodes it through the **same** pipeline every seller
upload passes (`prepareUploadedImage` — magic-byte check, 2000 px ceiling, WebP
at q82, which also strips whatever metadata rode along), stores it in R2 under
`supplier-media/<productId>/<sha256>.webp`, and records `stored_url`,
`stored_at`, and the checksum/dimensions the projection deliberately left null
because no bytes had been read. It only fetches addresses `cjImageUrl` accepts:
a stored URL is still an address this server is about to open, and being in our
own database is not a reason to skip the host check. Bounded at 12 images per
product with a 10 s timeout, sequential, and **no CJ API call — no points**
(ADR-017); this reads CJ's CDN.

Two photos that re-encode to identical bytes share one object: the second row
points at the first's `stored_url` and leaves `checksum` null, which is also what
keeps the `(product_id, checksum)` unique index from turning a duplicated photo
into a failure.

**When it runs.** On publication, through `after()` so the seller's publish
response never waits on a dozen CDN reads — and best-effort, not a publish gate:
a listing that is otherwise ready should not become unpublishable because a CDN
blinked. For everything published before this existed, the **Products Backfill
Media Copies** workflow sweeps in bounded batches, oldest listing first, and
reports `remaining` so it is obvious whether to run it again. A run that mirrors
nothing while work remains fails the workflow rather than reading as success.

**What still falls back.** Until a copy exists, `coalesce(stored_url,
source_url)` serves the supplier address — on the card, in the PDP gallery, and
on the thumbnail frozen onto an order line. That is the old behaviour, so nothing
regresses; it just means the guarantee holds for mirrored media, and the sweeper
is how "mirrored" becomes "all of it". A product published and ordered in the
seconds before its mirror finishes keeps a CJ address on that line.

**This DDL ships with no Drizzle schema change**, for the reason the order-line
snapshot column established: Drizzle names every column of the schema in an
`INSERT`, so adding `storedUrl` to `schema/product-catalog.ts` alone would make
every media write name a column the database may not have — and
`product_media_sources` is written by draft creation, by publication, and by
every seller upload, so that breaks importing and publishing rather than one
page. Apply it with the **Products Migrate Media Stored Copy** workflow
(`workflow_dispatch`, `CRON_SECRET`-authenticated), which calls
`POST /api/internal/catalog/products/migrate-media-stored-copy` on the deployed
app and fails the run unless the response proves `columnsExistAfter: true`. Both
`ALTER TABLE`s run in one transaction, so the table can never be left with
`stored_url` and no `stored_at`. Idempotent; safe to run more than once.

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
- **Seller Center screens still use static order UI data.** All 7 Seller
  Center screens are real routes with a real, server-enforced permission gate.
  Paid storefront orders now have a real database/fulfillment backend, but the
  visible `/orders`, ledger, and payout screens still show illustrative data
  until those views are wired to the new tables.
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
