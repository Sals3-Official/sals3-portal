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

## Commands

| Command                                                                           | What it does                                                                  |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`                                                                     | Start dev server at http://localhost:3001 (3000 belongs to `sals3-ecommerce`) |
| `npm run build`                                                                   | Production build                                                              |
| `npm run start`                                                                   | Serve production build                                                        |
| `npm run lint`                                                                    | ESLint                                                                        |
| `npm run format:check`                                                            | Prettier check                                                                |
| `npm run typecheck:clean`                                                         | TypeScript check without `.next` artifacts                                    |
| `npm run test:run`                                                                | Unit tests (Vitest)                                                           |
| `npm run test:e2e`                                                                | E2E tests (Playwright)                                                        |
| `npm run verify`                                                                  | Full gate: lint + format + typecheck + build + unit + E2E                     |
| `npm run db:generate`                                                             | Generate a SQL migration from `src/lib/db/schema/`                            |
| `npm run db:migrate`                                                              | Apply pending migrations in `drizzle/`                                        |
| `npm run db:studio`                                                               | Drizzle Studio (browse the local database)                                    |
| `npm run approve:portal-user -- --email seller@example.com --role seller_manager` | Approve/promote one verified portal user                                      |

## Routes

| Route                                    | What it does                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                                      | Seller Center sign-in form                                                                                                                                                                                                                                                                                                                   |
| `/login`                                 | Better Auth email/password sign-in                                                                                                                                                                                                                                                                                                           |
| `/signup`                                | Public seller account signup (`RETAILER` or `DROPSHIPPER`), always generic success copy; new users get active `seller_manager` access after email verification and TOTP setup                                                                                                                                                                |
| `/reset-password`                        | Password reset request and token completion                                                                                                                                                                                                                                                                                                  |
| `/setup-2fa`                             | Required TOTP enrolment before Seller Center entry                                                                                                                                                                                                                                                                                           |
| `/two-factor`                            | TOTP challenge after sign-in                                                                                                                                                                                                                                                                                                                 |
| `/auth/continue`                         | Server-side post-auth continuation gate: checks session, verified email, TOTP, seller state, and safe `next` before redirecting                                                                                                                                                                                                              |
| `/auth/pending`                          | Fallback for legacy or manually deactivated seller accounts that are signed in but not active/verified                                                                                                                                                                                                                                       |
| `/overview`                              | Seller Center dashboard: needs-action tasks, money position, glance stats                                                                                                                                                                                                                                                                    |
| `/orders`                                | Batch fulfillment: filter, select, print (static), handoff                                                                                                                                                                                                                                                                                   |
| `/listings/new`                          | Add Product. No query: the blank essentials-first wizard (read-only fields, no save yet). `?fixture=<key>`: the supplier-prefilled Product Editor design preview — see [Product Editor](#product-editor-add-product-from-a-supplier-product). `?supplierCandidateId=`: reserved for the real integration, states that it is not wired up yet |
| `/inventory`                             | Inline stock edits with undo and an audit record                                                                                                                                                                                                                                                                                             |
| `/finances`                              | Itemized ledger and estimated proceeds for one example order                                                                                                                                                                                                                                                                                 |
| `/payouts`                               | Payout schedule, states, and destination                                                                                                                                                                                                                                                                                                     |
| `/market-rules`                          | Every rule applied to the account, plus role access                                                                                                                                                                                                                                                                                          |
| `/supplier-apps`                         | Connect / disconnect / reconnect the seller's own CJ Dropshipping account (ADR-008)                                                                                                                                                                                                                                                          |
| `/products`                              | All Supplier Products — the raw supplier feed browser (today: CJdropshipping), through the seller's own connection, with a live AUD reference estimate alongside each USD price (read-only status badges, no click-to-check action)                                                                                                          |
| `/design-preview/all-supplier-products`  | Design preview of the full multi-supplier layout against isolated fixtures (dynamic supplier/evaluation filters, duplicate detection) - `robots: noindex`, not linked from the sidebar, for review before a second real Supplier App exists                                                                                                  |
| `/products/qualified/ready`              | Qualified Products · Ready — automated `PASS` candidates, default Product Sourcing screen                                                                                                                                                                                                                                                    |
| `/products/qualified/needs-attention`    | Qualified Products · Needs Attention — automated `PASS_WITH_ATTENTION` candidates                                                                                                                                                                                                                                                            |
| `/products/evaluating`                   | Candidates the pipeline has `QUEUED` or is actively `EVALUATING`                                                                                                                                                                                                                                                                             |
| `/products/blocked`                      | Blocked / Rejected — `BLOCKED` (permanent) and `TEMPORARILY_INELIGIBLE` (retryable) candidates                                                                                                                                                                                                                                               |
| `/products/exception-queue`              | Dead-lettered evaluation failures only (retries exhausted) — never ordinary rejections                                                                                                                                                                                                                                                       |
| `/products/shortlisted`                  | Retired — redirects to `/products/qualified/ready`                                                                                                                                                                                                                                                                                           |
| `/api/internal/catalog/evaluate-tick`    | Protected (`CRON_SECRET` bearer token) - **break-glass recovery only**: drains the outbox, requeues due retries, evaluates one bounded batch. NOT scheduled; the manual `workflow_dispatch` in `.github/workflows/evaluate-tick.yml` or a direct authenticated call invokes it                                                               |
| `/api/internal/catalog/discovery/start`  | Protected (`DISCOVERY_CONTROL_SECRET` bearer, constant-time) - idempotent owner Start: creates the durable queue chain once; see [Continuous full-catalogue discovery](#continuous-full-catalogue-discovery)                                                                                                                                 |
| `/api/internal/catalog/discovery/pause`  | Protected - idempotent pause: no new supplier calls; checkpoints and queue/database state retained                                                                                                                                                                                                                                           |
| `/api/internal/catalog/discovery/resume` | Protected - idempotent resume: re-enqueues every parked, unleased non-terminal partition                                                                                                                                                                                                                                                     |
| `/api/internal/catalog/discovery/status` | Protected - truthful coverage/budget/outbox/failure status; never claims completion while any partition is unproven                                                                                                                                                                                                                          |
| `/api/webhooks/cj`                       | CJ webhook receiver: raw-body Base64 HMAC-SHA256 verification (secret = the connection's CJ `openId`, stored encrypted), size-capped, messageId-deduplicated, acknowledged in well under CJ's 3-second window; heavy work happens in the queue                                                                                               |
| `/api/queues/catalog-discovery`          | Private Vercel Queues push consumer (air-gapped by the platform - no public URL); every message re-validates and re-authorizes against the database                                                                                                                                                                                          |
| `/api/storefront/products`               | Protected product feed for `sals3-ecommerce`                                                                                                                                                                                                                                                                                                 |
| `/api/storefront/products/[id]`          | Protected single-product lookup by CJ `pid` for `sals3-ecommerce`'s PDP                                                                                                                                                                                                                                                                      |
| `/api/storefront/categories`             | Protected category feed for `sals3-ecommerce`                                                                                                                                                                                                                                                                                                |

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
cron and no scheduled GitHub Actions tick**: one owner-authorized
`POST /api/internal/catalog/discovery/start` creates the chain, and from
then on each unit of work persists its successor intent in a transactional
outbox, publishes it, and completed cycles enqueue the next cycle with a
points/freshness-aware queue delay. **The owner's browser and PC can be
closed after Start** - Vercel's managed queue infrastructure delivers the
messages and runs the (air-gapped, platform-invoked) consumer function.

Coverage semantics (ADR-010 §12.1, ADR-013 §3):

- **Legacy endpoint only.** Discovery uses `GET /api2.0/v1/product/list` and
  never `product/listV2`. There is **no 6,000-record assumption anywhere**:
  that cap is documented for listV2 only, and on the legacy endpoint a total
  of exactly 6,000 or greater is ordinary density data.
- **Immutable cycle cutoff.** Every cycle snapshots `cycleCutoff`; all its
  partitions cover only products created at or before it. Later products are
  the next cycle's work, so a moving catalogue never invalidates in-progress
  coverage.
- **Category roots from the provider tree.** Cycle start fetches
  `GET /product/getCategory` once, persists the leaf snapshot immutably, and
  seeds two roots per leaf: an open-start sentinel (products before the
  configurable `CJ_DISCOVERY_EPOCH`) and the epoch-to-cutoff range. Identity
  is the provider category id, never the label.
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
  (list and evidence alike) is persisted;
  background work may spend at most 80% of known available points (20%
  reserved for selected/live/order-critical work); HTTP 429 persists a pause
  aligned with CJ's documented per-minute replenishment / 00:00 UTC reset and
  continues via a delayed queue message - never a function kept alive
  sleeping.

Queue operations: `DISCOVERY_CYCLE_START` (ensure/seed/sweep - also the
self-healing heartbeat), `DISCOVERY_PARTITION`, `EVALUATE_CANDIDATE`,
`RECONCILE_PRODUCT` (freshness sweep + per-product reconcile),
`WEBHOOK_EVENT`, `OUTBOX_DISPATCH`. Every handler validates its message with
Zod, claims work through database leases with exact compare-and-swap
predicates (state, version, lease token, unexpired lease), performs a bounded
unit of work, persists successor intent durably, and publishes successors
before acknowledging - so duplicate and out-of-order at-least-once deliveries
can delay work but never corrupt state or double-spend a supplier call.
Failed work lands in PostgreSQL (`discovery_failures`, outbox `FAILED` rows,
partition `FAILED`/`PROVIDER_COVERAGE_UNRESOLVED` states) because the
transport has no application dead-letter queue.

Operating it:

1. **Deploy** (owner action; nothing auto-starts). Apply migration `0009`
   first - `npm run db:migrate` is an owner-run step and has NOT been
   executed by the implementation.
2. **Start once**: `POST /api/internal/catalog/discovery/start` with
   `Authorization: Bearer $DISCOVERY_CONTROL_SECRET`. Idempotent; concurrent
   or repeated calls converge on one chain (a partial unique index allows at
   most one active cycle per connection). A new deployment does NOT create a
   second chain for the same reason.
3. **Pause / resume**: the matching `POST .../pause` and `.../resume` routes.
   Pause stops new supplier work while keeping every checkpoint; in-flight
   work finishes its local transaction only. Resume re-enqueues all parked
   work.
4. **Inspect**: `GET .../status` reports run states, cycle/partition coverage
   counts, unresolved partitions with reasons, points budget, outbox depth,
   recent failures, and the storage guard - and never claims completion
   while any partition is unproven.

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
  receive delivery. **Currently disabled with an empty allowlist** — no
  ADR-003 market has been approved, and AU seller registration does not by
  itself approve AU (or anywhere else) as a buyer destination.
- `resolvePortalDisplayCurrency()` — Portal's own temporary seller-facing
  display currency (`AUD`), unrelated to either country policy and unrelated
  to the real `sals3-ecommerce` storefront checkout currency (still USD, see
  `src/lib/storefront/fx.ts`).

Because the buyer-destination policy is disabled, `rules/screening.ts`'s
`checkValidMarket` now fails every new candidate closed with
`NO_VALID_MARKET` (a recoverable `TEMPORARILY_INELIGIBLE`, not a permanent
block) before any CJ evidence-fetch call - **no candidate can currently reach
`Ready` until a real buyer-destination market is approved.** This replaces
the previous silent assumption that `'PH'` was a real, approved market.
`checkValidMarket` also checks each candidate's own persisted
`intended_market_codes` against the enabled allowlist, not only whether the
global policy is on: every one of the candidate's destinations must already
be enabled, or it blocks with a detail that distinguishes "no policy
enabled," "this candidate has no destination recorded," and "this
candidate's destination isn't in the enabled set" - so a historical `['PH']`
candidate never silently passes once `['AU']` is approved; it stays blocked
until its own stored scope is separately, explicitly migrated. Existing
historical `PASS`/`PASS_WITH_ATTENTION` rows are untouched; only new
evaluations are affected. A repository guard
(`no-scattered-market-literals.test.ts`) fails the build if a bare `'PH'`/
`'AU'` market-code literal is reintroduced into this module.

The buyer-destination policy is resolved exactly once per evaluation and
composed with the catalog policy version into one stored identity
(`candidate_evaluations.policy_version`, e.g.
`catalog-eval-policy-placeholder-v1+buyer-destination:buyer-destination-country-v1-disabled`)
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
`/orders`, `/finances`, `/payouts`, `/market-rules`, and the blank listing
wizard all check for `null` and render `MarketNotConfiguredNotice` (an
honest "Market configuration is not available" state) instead of the
fixture-backed screen. In development/test, accepted `PORTAL_DEV_MARKET`
values are `PH`, `ID`, `SG`; anything else falls back to `PH`. None of the
three markets' figures (fees, tax rates, thresholds) are confirmed Sals3
business rules — they were carried over from an imported design mockup for
interface review only.

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
  lists in step. Any other host is dropped and the row shows a placeholder.
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
- **Read-only catalogue.** The portal shows the CJdropshipping supplier feed
  and nothing else — there is no writable Sals3 product catalogue, no add/edit
  form, and no import/export. A real Postgres database does exist now (see
  [Catalog database](#catalog-database-drizzle--postgresql) and
  [Supplier Apps](#supplier-apps-multi-tenant-provider-connections)) for the
  shortlist/evaluation pipeline and provider connections - the earlier
  in-memory fixture catalogue was removed, not replaced with "no database".
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
