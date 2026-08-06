# Seller Center — Design System (MASTER)

Global source of truth for Seller Center UI (npm package `sals3-portal`).
Page-specific files in `pages/` override this file. Storefront parity is
mandatory: the palette and type scale come from
`sals3-ecommerce/src/app/globals.css`, the code that deploys
`sals3-ecommerce.vercel.app`.

## 1. Product type and posture

| Dimension     | Decision                                                                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product type  | Seller Center — internal operations tool for order fulfillment, inventory, listings, finances, payouts, market rules, and the CJdropshipping catalogue. Not a landing page |
| Primary users | Seller staff, Sals3 catalogue reviewers, admins                                                                                                                            |
| Core job      | Scan many products fast, then edit one product precisely                                                                                                                   |
| Density       | 8/10 — dense dashboard. Spacing scale 8–32px, table row height 48px                                                                                                        |
| Variance      | 3/10 — calm, centred, predictable. No decorative asymmetry                                                                                                                 |
| Motion        | 3/10 — subtle only: 150–200ms colour/opacity transitions, no scroll choreography                                                                                           |
| Style         | Functional/utility dashboard (flat, bordered surfaces, no glass, no gradients except the shared brand gradient)                                                            |

**Rejected recommendation, recorded on purpose:** the `ui-ux-pro-max`
`--design-system` query returned _Exaggerated Minimalism_ with a generic
blue/amber palette and a `clamp(3rem, 10vw, 12rem)` display type effect. That is
a fashion/portfolio landing style and it conflicts with both the data density
this tool needs and the mandated Sals3 palette. Its UX rule set (tables,
bulk actions, forms, confirmation, accessibility) is applied; its style and
colour output is not.

## 2. Colour tokens

Defined once in `src/app/globals.css`. Never write a raw hex in a component.

| Role                         | Token                            | Value     |
| ---------------------------- | -------------------------------- | --------- |
| Page background              | `--background` / `bg-background` | `#f6f7f8` |
| Card / table surface         | `--card` / `bg-card`             | `#ffffff` |
| Body text                    | `--foreground`                   | `#14181c` |
| Secondary text               | `--muted-foreground`             | `#5d666d` |
| Primary action               | `--primary`                      | `#0a5c8a` |
| Primary action text          | `--primary-foreground`           | `#ffffff` |
| Hover / selected row surface | `--accent`                       | `#e7eef3` |
| Hairline border              | `--border`                       | `#e3e7ea` |
| Input border                 | `--input`                        | `#cfd6db` |
| Focus ring                   | `--ring`                         | `#0a5c8a` |
| Destructive                  | `--destructive`                  | `#d92d20` |
| Navigation rail              | `--sidebar`                      | `#0b2c4d` |
| Rail active accent           | `--sidebar-primary`              | `#7fd4d4` |

Status colours reuse brand tokens; each status also carries a text label, so
colour is never the only signal:

| Status           | Surface / text                     |
| ---------------- | ---------------------------------- |
| Draft            | `bg-muted` + `text-ink-muted`      |
| Pending approval | `bg-brand-100` + `text-brand-900`  |
| Published        | `text-green-600` on tinted surface |
| Rejected         | `text-red-600` on tinted surface   |
| Archived         | `bg-secondary` + `text-ink-subtle` |

Contrast: every pairing above clears 4.5:1 for text. The rail (`#e6edf3` on
`#0b2c4d`) clears 11:1.

## 3. Typography

Same two families as the storefront — no third family.

- **Plus Jakarta Sans** (`--font-sans`, weights 400/500/600/700) — all UI text.
- **Outfit** (`--font-display`, weights 500/600) — page titles and card headings only.

Scale: page title 24px/600 display, section heading 16px/600, body 14px/400,
table cell 14px/400, metadata and column headers 12px/500 uppercase-free.
Never below 12px. Line-height 1.5 for prose, 1.35 for table cells.

## 4. Layout

- App shell: fixed 256px collapsible dark rail + content column, `max-w-[1600px]`.
- Content padding: 16px mobile, 24px from `md`.
- Breakpoints exercised: 375, 768, 1024, 1440.
- Tables get an `overflow-x-auto` wrapper; below `md` the row collapses to a
  stacked card so nothing scrolls the page sideways.
- Sticky elements: table header and the bulk-action bar.

## 5. Components (shadcn/ui)

Installed set: `table`, `input`, `select`, `badge`, `card`, `dropdown-menu`,
`dialog`, `alert-dialog`, `tabs`, `checkbox`, `label`, `textarea`, `separator`,
`sidebar`, `sheet`, `tooltip`, `skeleton`, `switch`, `avatar`, `progress`,
`breadcrumb`, `button`, `sonner` (toast + undo pattern, added for Seller
Center's Orders batch-print and Inventory stock-edit flows).

Deliberately **not** installed: `form` + `react-hook-form` (Next.js server
actions with `useActionState` plus the Zod schemas already in the repo cover
validation with no extra runtime dependency), `chart`/Recharts (analytics uses
CSS bar meters until real analytics data exists), and any date library.

## 6. Interaction rules applied

1. Every clickable element: `cursor-pointer`, a visible focus ring, and a
   150–200ms colour transition.
2. Icon-only controls carry an accessible name (`aria-label` or `sr-only` text).
3. Touch targets ≥ 44×44px on the rail, row actions, and pagination.
4. Destructive actions (delete, archive, bulk delete) always confirm through
   `alert-dialog` and name the exact count.
5. Every mutation reports its result — success text or a field-level error. No
   silent success.
6. Form errors sit next to the field, not only in a summary at the top.
7. Long forms use progressive disclosure: tabbed sections, not one endless page.
8. Tables support multi-select with a checkbox column plus a sticky action bar.
9. Sort, filter, search, and page live in the URL so a view is shareable and the
   back button behaves.
10. `prefers-reduced-motion: reduce` disables transitions globally.
11. Icons: Lucide SVG only. No emoji as icons.

## 7. Anti-patterns to reject

Placeholder-only labels, hover-only affordances, gray-on-gray text, fixed-px
containers, disabled zoom, delete without confirmation, colour as the only
status signal, monolithic page components, and raw hex values in components.
