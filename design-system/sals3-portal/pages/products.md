# Page override — Products

Inherits `../MASTER.md`. Only the differences are listed here.

## Route map

| Route                 | Purpose                                                         |
| --------------------- | --------------------------------------------------------------- |
| `/products`           | Product list: search, filter, sort, paginate, bulk actions      |
| `/products/new`       | Add product (tabbed form)                                       |
| `/products/[id]`      | Product detail: overview, variants, analytics, reviews, history |
| `/products/[id]/edit` | Edit product (same tabbed form, pre-filled)                     |
| `/products/import`    | CSV import and export                                           |

## List page anatomy (top to bottom)

1. **Header row** — page title `Products`, product count, `Add product` primary button, `Import`/`Export` secondary buttons.
2. **Status tabs** — All / Draft / Pending approval / Published / Rejected / Archived, each with a count. Tabs write `?status=` to the URL.
3. **Toolbar** — search input (debounced 300ms, searches name, SKU, barcode), category select, brand select, sort select. A `Clear filters` link appears only when a filter is active.
4. **Bulk action bar** — replaces the toolbar row when ≥1 row is selected. Shows `N selected` and the actions: Publish, Unpublish, Archive, Update price, Delete. Sticky. Destructive entries confirm.
5. **Table** — columns: checkbox, image (40×40 `next/image`), name + SKU, status, category/brand, price, stock, updated, row-action menu. Sortable headers: name, price, stock, updated.
6. **Pagination** — reuses `buildPageList` from `src/lib/pagination.ts`, 20 rows per page.
7. **Empty states** — two distinct messages: "no products yet" (offers Add product) versus "no products match these filters" (offers Clear filters). Never one generic message.

## Mobile (< 768px)

The table becomes a stacked card list: image and name on the first line, status
badge and price on the second, stock and updated date muted on the third, the
action menu on the right. Selection checkboxes stay available.

## Form anatomy (add / edit)

Tabs, in this order: **Details** (name, description, category, brand, status) ·
**Media** (images and video URLs) · **Variants** (per-variant SKU, price, stock) ·
**Pricing** (regular, sale, cost, scheduled discount window) · **Inventory**
(SKU, UPC, EAN, barcode) · **Shipping** (weight, dimensions, class, restrictions) ·
**Visibility** (publish switch, sales channels, availability dates) · **SEO**
(page title, meta description, slug, with character counters).

Each tab is its own component under `src/components/products/form/`. The save
bar is fixed to the bottom of the form and reports success or error text.

## Detail page tabs

**Overview** (key facts + status workflow actions) · **Variants** · **Analytics**
(views, add-to-cart, units sold, conversion rate, revenue — CSS meters, no chart
library) · **Reviews** (list, reply, report) · **History** (audit trail: who,
what changed, old value, new value, when).

## Data reality, stated plainly

No database, authentication, or file storage exists in this repository yet. The
catalogue is a typed in-memory fixture, mutations are validated server-side
against the Zod schemas and gated by a role permission check, and writes do not
survive a server restart. Every screen is built so the fixture can be swapped
for a real repository without touching component code.
