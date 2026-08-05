# Page override — Products

Inherits `../MASTER.md`. Only the differences are listed here.

## Route map

| Route       | Purpose                                                         |
| ----------- | --------------------------------------------------------------- |
| `/products` | CJdropshipping supplier catalogue (read-only): search, paginate |

The earlier Sals3 fixture catalogue and its add/edit/import/export screens were
removed. `/products` shows the supplier feed only. Old links with `?source=cj`
still resolve; the parameter is ignored.

## Page anatomy (top to bottom)

1. **Header row** — page title `Products`, description `Supplier catalogue from CJdropshipping`. No action buttons: the view is read-only.
2. **Supplier notice** — one muted panel that says the rows are supplier products, that prices are in US dollars and not converted to pesos, and that importing for resale is not built yet.
3. **Search** — one input (debounced 400ms, English product name). Writes `?cjSearch=` to the URL and resets the page.
4. **Table** — columns: image (40×40 `next/image`, allow-listed CJ hosts only), name + SKU, category, supplier price (USD), weight, ships from, listed count, created. No selection, no row actions.
5. **Pagination** — `?cjPage=` URL-based.
6. **States** — a skeleton while the live API call runs; a plain error panel with a `Try again` link when the API fails; an empty state that suggests fewer or English search words.

## Mobile (< 768px)

The table becomes a stacked card list. The page never scrolls sideways.

## Data reality, stated plainly

No database, authentication, or file storage exists in this repository. The
rows come live from the CJdropshipping API (server-side only; the key and the
access token never reach the browser). Reads are gated by
`requirePermission('product:read')`.
