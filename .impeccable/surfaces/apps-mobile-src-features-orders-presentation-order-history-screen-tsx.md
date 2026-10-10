---
version: 1
slug: "native-orders-list"
primary_target: "apps/mobile/src/features/orders/presentation/order-history-screen.tsx"
related_targets: ["apps/mobile/src/features/orders/presentation/translations.ts", "apps/mobile/src/constants/theme.ts"]
---

# Pedidos — compact native list

2026-10-08 revision: the current entry/access/history composition is recorded in [entry-history](entry-history.md), with coordinator-approved option B. That revision replaces the horizontal filter strip and paired status pills with wrapping quick filters, a named advanced-filter action, and independent payment/delivery lines. The remaining notes below document the earlier 2026-10-06 implementation and evidence.

Mode: Operate. User explicitly approved option 1 and implementation on 2026-10-06.
Approved comp: `.impeccable/mocks/decision/pedidos-compacta.png`.

Direction: compact caramel native list, cream canvas, flat white rows, subtle separators, large Pedidos heading and rounded Nuevo action. Business label above; full-width search followed by Todos, Por cobrar, Por entregar and a filters control. Chronological day bands, customer and amount on one line, number/time beneath, textual payment/delivery pills. Preserve current native bottom tabs and real system chrome. No shadows, decorative images or per-row actions. Inter; heading 30/36 bold (700), row title and amount 16/24 bold (700), metadata and badges 14/20. Search radius12, pills fully rounded, hairline separators. Native48dp controls, safe areas, scalable text and token-based dark mode.

| Ingredient | Medium and commitment |
| --- | --- |
| Company label | Native symbol + real company name, no fictional switcher |
| Heading and primary action | Native text/Pressable, plus symbol, caramel pill |
| Search | Native TextInput and platform magnifier |
| Filters | Horizontal native pills; advanced dates/customer in native Modal |
| Date sections and list | SectionList, cream day bands and flat white rows |
| Status badges | Native text pills; semantic color plus words |
| Navigation and system chrome | Existing native tabs/system bars |
| Raster assets | None; independently confirmed by asset producer /root/assets |

Do not literalize sample names, amounts, counts, dates, phone status bar or unsupported business selector in the comp. Rows use real server snapshots. Search covers buyer name/phone and exact order number across all pages. Por cobrar excludes cancelled and requires confirmed payment coverage below current total. Por entregar excludes cancelled and includes pending/shipped. Advanced customer and Lima creation-date filters remain available. Pagination20, refresh and detail return preserve controls; error/empty/loading and uncertain-sale verification remain accessible. Spanish/Portuguese supported.

Quality bar: first viewport exposes useful orders rather than permanent filter forms; accurate independent status words; no lost functionality, no truncated customer/amount at large text, no new dependencies. Verify on connected Android in light/dark and enlarged text. iOS visual verification unavailable unless a simulator becomes available.

## Implemented recipe

The shipped header uses 16dp horizontal gutters and an 8dp gap, with the real business identity, title/action, search and quick filters above the scrollable list. The content column is centered and capped at 640dp. Day headings are non-sticky; rows use 16dp horizontal / 8dp vertical padding, a 4dp content gap, hairline dividers and no shadow. The title/action, customer/amount and badge groups wrap with enlarged text; amounts retain tabular figures and visible currency. Search has a 12dp radius, action/filter pills a 28dp radius, and status pills a 20dp radius. These measurements describe this surface, not new global tokens.

The native theme adapter consumes shared light/dark color roles from `docs/design-tokens.json`. Paid uses success/success-surface; pending payment uses warning/warning-surface; delivery uses neutral text/surface. Completed and cancelled orders show their terminal label instead of the payment/delivery pair. Enabled checkout adds its separate textual state. The existing native tabs and platform symbols remain intact.

The advanced-filter modal separates **Cliente** from **Fecha de creación**, with a labelled date range, apply/clear actions and a named close control. Detail return uses **Volver a pedidos** / **Voltar aos pedidos**. Search, refresh, page navigation and return from details retain the selected criteria; changing criteria resets the page. Screen states distinguish loading, failure, empty records and no matching results.

## Review evidence and limits

Android disposition: **ship**, after the filter hierarchy and return-label corrections. Recorded captures: `.impeccable/review/orders-compact-{light,dark,search,unpaid,filters,large-text,final}.png`; return-label evidence: `.impeccable/review/orders-compact-back-label.xml`. The approved comp remains directional; source and final rendered evidence take precedence over its sample data and earlier intended measurements.

Android light/dark, search, unpaid filtering, advanced filters and enlarged text were reviewed. iOS and tablet layouts remain unverified; the 640dp cap alone is not tablet acceptance. Spanish/Portuguese strings are implemented, but this record does not claim a complete localization or accessibility audit.
