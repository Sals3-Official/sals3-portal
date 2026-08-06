# Seller Center

Sals3's seller operations app (npm package `sals3-portal`): Overview, Orders,
Inventory, a new-listing wizard, Finances, Payouts, and Market rules, plus the
CJdropshipping supplier catalogue. Same tech stack as `sals3-ecommerce`, and
the same brand tokens, so both products look like one system.

- Next.js 16 (App Router) + React 19 + TypeScript (strict)
- PostgreSQL with Drizzle ORM + Drizzle Kit, over `postgres.js`
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

Then fill in `CJ_API_KEY` in `.env.local`. See
[CJdropshipping integration](#cjdropshipping-integration) below. `.env.local` is
ignored by git and must never be committed.

Set `SALS3_STOREFRONT_API_TOKEN` to a long random value if
`sals3-ecommerce` will read products from this portal. Use the same value in
`sals3-ecommerce/.env.local`.

## Commands

| Command                   | What it does                                                                  |
| ------------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`             | Start dev server at http://localhost:3001 (3000 belongs to `sals3-ecommerce`) |
| `npm run build`           | Production build                                                              |
| `npm run start`           | Serve production build                                                        |
| `npm run lint`            | ESLint                                                                        |
| `npm run format:check`    | Prettier check                                                                |
| `npm run typecheck:clean` | TypeScript check without `.next` artifacts                                    |
| `npm run test:run`        | Unit tests (Vitest)                                                           |
| `npm run test:e2e`        | E2E tests (Playwright)                                                        |
| `npm run verify`          | Full gate: lint + format + typecheck + build + unit + E2E                     |
| `npm run db:generate`     | Generate a SQL migration from `src/lib/db/schema/`                            |
| `npm run db:migrate`      | Apply pending migrations in `drizzle/`                                        |
| `npm run db:studio`       | Drizzle Studio (browse the local database)                                    |

## Routes

| Route                           | What it does                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------- |
| `/`                             | Placeholder home page ("Hello world") — outside the Seller Center shell                      |
| `/overview`                     | Seller Center dashboard: needs-action tasks, money position, glance stats                    |
| `/orders`                       | Batch fulfillment: filter, select, print (static), handoff                                   |
| `/listings/new`                 | New-listing wizard preview (read-only fields, no save yet)                                   |
| `/inventory`                    | Inline stock edits with undo and an audit record                                             |
| `/finances`                     | Itemized ledger and estimated proceeds for one example order                                 |
| `/payouts`                      | Payout schedule, states, and destination                                                     |
| `/market-rules`                 | Every rule applied to the account, plus role access                                          |
| `/products`                     | CJ Candidate Explorer — CJdropshipping supplier catalogue: search, paging, "Check for Sals3" |
| `/products/shortlisted`         | Shortlisted CJ candidates, read from Postgres                                                |
| `/products/exception-queue`     | Review/hold/blocked candidates — empty until preflight exists                                |
| `/api/storefront/products`      | Protected product feed for `sals3-ecommerce`                                                 |
| `/api/storefront/products/[id]` | Protected single-product lookup by CJ `pid` for `sals3-ecommerce`'s PDP                      |
| `/api/storefront/categories`    | Protected category feed for `sals3-ecommerce`                                                |

## Design system

`design-system/sals3-portal/MASTER.md` holds the global rules (palette,
typography, layout, interaction), and `design-system/sals3-portal/pages/` holds
page-level overrides. Colour and type tokens are defined once in
`src/app/globals.css` and taken from the storefront. Do not write a raw hex value
in a component.

## Roles and permissions

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

To try a different role locally, set a server-side variable before `npm run dev`:

```bash
PORTAL_DEV_ROLE=catalogue_reviewer npm run dev
```

Accepted values are the five role names above. Anything else falls back to
`seller_manager`.

## Seller Center screens

Overview, Orders, Inventory, the new-listing wizard, Finances, Payouts, and
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

## Catalog database (Drizzle + PostgreSQL)

The catalog tables live in this app, so a shortlist write is a Server Action
against the local database — no cross-service HTTP call and no shared service
credential to store or leak.

| Piece                          | File                                                 |
| ------------------------------ | ---------------------------------------------------- |
| Table definitions              | `src/lib/db/schema/catalog.ts`                       |
| Client (postgres.js singleton) | `src/lib/db/client.ts`                               |
| Generated SQL migrations       | `drizzle/`                                           |
| Drizzle Kit config             | `drizzle.config.ts`                                  |
| Zod contracts                  | `src/modules/catalog/candidates/contracts.ts`        |
| Queries (write side)           | `src/modules/catalog/candidates/repository.ts`       |
| Shortlist use case             | `src/modules/catalog/candidates/shortlist.ts`        |
| Queries (read side)            | `src/modules/catalog/candidates/queries.ts`          |
| Server Action                  | `src/app/(portal)/products/actions.ts`               |
| Shared CJ Zod primitives       | `src/lib/cj/primitives.ts`                           |
| CJ enrichment schemas          | `src/lib/cj/enrichment-schemas.ts`                   |
| CJ evidence normaliser         | `src/lib/cj/evidence.ts`                             |
| CJ enrichment fetch            | `src/services/cj/enrichment.ts`                      |
| Evidence capture use case      | `src/modules/catalog/candidates/capture-evidence.ts` |

Four tables: `supplier_candidates` (the shortlist record, unique on
`(supplier, external_product_id)`), `idempotency_records`,
`supplier_snapshots` (one normalised CJ evidence record per candidate), and
the append-only `audit_events`.

- **Server-only.** `DATABASE_URL` has no `NEXT_PUBLIC_` prefix, and
  `src/lib/db/client.ts` throws if it is ever imported from client code.
- **Lazy, so a build never needs a database.** The connection is created on the
  first query, never at module evaluation. Next.js imports every route module
  during `next build`'s "Collecting page data" phase — including
  `force-dynamic` routes — so connecting at import time fails the whole build
  wherever `DATABASE_URL` is unset (a Vercel preview, CI, a fresh clone).
  Pages that read the database check `isDatabaseConfigured()` and render an
  honest "no database configured in this environment" state instead of a 500.
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

### What "Check for Sals3" does and does not do

It persists the **Shortlist** step and captures CJ evidence. It does **not**
run preflight: the hard gates, quality score, and compliance gate are not
implemented, so the app never produces a `PASS`, `PASS_WITH_ATTENTION`,
`REVIEW`, `HOLD`, or `BLOCKED` decision. The evidence panel shows facts only —
no verdict is derived from them. The Exception Queue is therefore empty by
construction, not by missing data, and the drawer says so explicitly rather
than showing blank score sections.

Two labelling rules are load-bearing in that panel: CJ review numbers are
supplier-platform evidence and never Sals3 buyer ratings, and `listedNum` is a
platform listing count and never units sold. The supplier `description` is
fetched but deliberately not rendered — it is raw supplier HTML and nothing
sanitises it yet.

`src/lib/seller-center/market-config.ts` carries 3 illustrative sample
markets (Philippines, Indonesia, Singapore) with their own currency, carrier,
tax label, and payout rail — a placeholder for a future per-seller market
configuration, in the same spirit as `PORTAL_DEV_ROLE`:

```bash
PORTAL_DEV_MARKET=SG npm run dev
```

Accepted values are `PH`, `ID`, `SG`. Anything else falls back to `PH`. None
of the three markets' figures (fees, tax rates, thresholds) are confirmed
Sals3 business rules — they were carried over from an imported design mockup
for interface review only.

## CJdropshipping integration

`/products` shows the CJdropshipping supplier feed. It is the portal's only
product source and it is **read-only**. The previous in-memory Sals3 fixture
catalogue and its add/edit/import/export screens were removed. Old links with
`?source=cj` still work: the parameter is accepted and ignored.

### Configuration

Set `CJ_API_KEY` in `.env.local` (format `CJ<userNumber>@api@<32 characters>`,
from the CJ dashboard). It is server-side only — no `NEXT_PUBLIC_` prefix — so
the key and the access token it buys never reach the browser. With no key set,
the page shows a setup message instead of failing.

### How it works

| Piece                        | File                          |
| ---------------------------- | ----------------------------- |
| Response schemas (Zod)       | `src/lib/cj/schemas.ts`       |
| Mapping to the display shape | `src/lib/cj/normalize.ts`     |
| Access-token cache           | `src/services/cj/token.ts`    |
| Authorized product read      | `src/services/cj/products.ts` |

- **Rate limit.** CJ allows one call per second per account. The access token is
  cached in memory until an hour before it expires, concurrent callers share one
  in-flight token request, and list responses are cached for five minutes, so a
  page refresh does not spend an upstream call.
- **Permission.** `fetchCjProducts` calls `requirePermission('product:read')`
  before any upstream request, so the integration is not a way around the portal
  roles.
- **Untrusted upstream data.** The API's real responses differ from its own
  documentation (`sellPrice` is a string, `productWeight` a range, `createTime`
  epoch milliseconds). Every field is parsed with a fallback, so a changed value
  degrades one cell instead of breaking the page. The `remark` field is raw
  supplier HTML and is deliberately never rendered.
- **Images.** Only `cf.cjdropshipping.com` and `oss-cf.cjdropshipping.com` are
  accepted, both in `src/lib/cj/schemas.ts` and in `next.config.ts`. Keep the two
  lists in step. Any other host is dropped and the row shows a placeholder.
- **Currency.** Supplier prices show in US dollars and are never converted to
  pesos: no approved exchange-rate source exists yet, and a guessed rate on a
  price someone could act on would be a made-up number.

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

The API reads the same CJdropshipping supplier feed shown at `/products`. It
skips supplier rows with no usable price, converts the
supplier USD price to a PHP shopper price with `CJ_USD_TO_PHP_RATE` and
`CJ_PRICE_MARKUP_PERCENT`, and never exposes the supplier USD price to
`sals3-ecommerce`. The `deals` section uses CJ `listedCount` as a temporary rank
when available. Responses use `Cache-Control: private, no-store` because the
feed is protected and can change when CJ changes.

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

- **No authentication.** `src/lib/auth/session.ts` returns one development
  identity. It is a placeholder shaped so a real session lookup can replace it
  without touching any caller. Do not expose this portal to untrusted users.
- **Read-only catalogue.** The portal shows the CJdropshipping supplier feed
  and nothing else. There is no Sals3 product catalogue, no add/edit form, no
  import/export, and no database — the earlier in-memory fixture catalogue was
  removed.
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

Playwright reuses a dev server that is already listening on port 3001. If the
tests fail in a way that looks like the client-side JavaScript never ran, a stale
server from an earlier run is usually the cause. Stop it and run again:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN -t | xargs kill
```
