# Sals3 Portal

The Sals3 seller portal: a read-only view of the CJdropshipping supplier
catalogue. Same tech stack as
`sals3-ecommerce`, and the same brand tokens, so both products look like one
system.

- Next.js 16 (App Router) + React 19 + TypeScript (strict)
- Tailwind CSS 4 (via `@tailwindcss/postcss`)
- shadcn/ui components on Base UI, with Lucide icons
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

## Routes

| Route                        | What it does                                                  |
| ---------------------------- | ------------------------------------------------------------- |
| `/`                          | Placeholder home page ("Hello world")                         |
| `/products`                  | CJdropshipping supplier catalogue (read-only): search, paging |
| `/api/storefront/products`   | Protected product feed for `sals3-ecommerce`                  |
| `/api/storefront/categories` | Protected category feed for `sals3-ecommerce`                 |

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
Only `product:read` is exercised today (by the supplier catalogue read); the
rest of the allow list is kept as the authorization surface for a future
writable catalogue.

To try a different role locally, set a server-side variable before `npm run dev`:

```bash
PORTAL_DEV_ROLE=catalogue_reviewer npm run dev
```

Accepted values are the five role names above. Anything else falls back to
`seller_manager`.

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

## Running the E2E tests

Playwright reuses a dev server that is already listening on port 3001. If the
tests fail in a way that looks like the client-side JavaScript never ran, a stale
server from an earlier run is usually the cause. Stop it and run again:

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN -t | xargs kill
```
