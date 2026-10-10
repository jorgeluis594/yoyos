---
version: 1
slug: "features-products-presentation-catalog-screen-tsx"
primary_target: "apps/mobile/src/features/products/presentation/catalog-screen.tsx"
related_targets: ["apps/mobile/src/features/products/presentation/translations.ts"]
---

# Productos — Shopify-style compact list

Mode: Operate. User chose option A on 2026-10-10 after reviewing three mocks (A list with thumbnails, B inventory-first without thumbnails, C photo grid).
Approved comp: `.impeccable/mocks/products-list/option-a.png` (source `option-a.html`, `build.mjs`, `shared.css`). Sample products, counts and thumbnails are design examples, never seeded data.

## Direction

Mirror the Pedidos header recipe: company label with native symbol, 30/36 bold "Productos", printer icon button (Android only, replaces full-width "Configurar impresora") beside the caramel "+ Nuevo" pill. Full-width search (radius 12) with leading magnifier and trailing QR-scan button. Horizontal non-wrapping quick-filter pills: Todos (selected, accent + check), Con stock, Stock bajo, Agotados. Count line ("48 productos") with sort action ("Recientes").

Rows live in one flat card group with hairline separators, no shadow: 48dp thumbnail (radius 8; dashed placeholder with image symbol when no photo), name 16/22 semibold single line, second line 14/20 muted "N en stock · M variantes" (or "· SKU" when single variant). Stock word turns warning when low and error "Agotado" when zero — color plus text, never color alone. Price right-aligned, semibold, tabular, with a small muted "desde" above when variants differ in price. No per-row actions; tap opens detail.

## Decisions after approval (2026-10-10)

The user chose full implementation (app + server) and removed "Stock bajo"; quick filters are Todos / Con stock / Agotados. QR scan-to-search is not implemented: the app has no camera dependency and adding one is a native change outside this scope, so the search field keeps magnifier and clear actions only. The comp's low-stock amber state is therefore not part of the recipe.

## Implemented recipe

- Server: `GET /api/products` accepts `stock=in_stock|sold_out` (total stock across variants) and `sort=recent|name` (default recent, id tie-breaker); list items include optional `image { id, url }`. An unresolvable thumbnail is logged and omitted instead of failing the listing.
- Mobile: header lives in the FlatList header so it scrolls with enlarged text. Printer is a 48dp icon button on Android only (label "Configurar impresora"); "+ Nuevo" pill keeps the accessible name "Agregar producto". Chips are a horizontal ScrollView with selected state, check symbol and accent surface. Count line plus a sort toggle (Recientes ↔ Nombre A–Z) with an accessible "Ordenar por" label.
- Rows: grouped card (12dp outer corners, hairline separators), 48dp expo-image thumbnail or dashed placeholder with photo symbol, name up to two lines, "N en stock · M variantes / SKU" with "Agotado" in error color, right-aligned tabular price with muted "desde" above when variant prices differ.
- States: loading, error with retry, no search results (clear search), empty filter (Ver todos), empty catalog, load more and footer retry are preserved. Spanish and Portuguese strings added.

## Deployment note

The mobile app always sends `sort`; core's query schema is strict, so the server change must be deployed before this mobile build reaches users.

## Review limits

Verified with mobile Jest tests, core unit tests and core product integration tests. No device or simulator screenshots were captured for this implementation.
