---
version: 1
slug: "apps-core-app-routes-order-detail-tsx"
primary_target: "apps/core/app/routes/order-detail.tsx"
related_targets: ["apps/core/src/features/orders/presentation/delivery-form.tsx"]
---

# Order detail

## Delivery implementation history

The review scopes below describe earlier delivery work; the completed redesign and its current review scope follow.

Operate, web only; inherits compact caramel. Editable orders choose enabled store/home/agency delivery, preserving shared recipient/identity/charge fields and per-method drafts. Agency-only configuration defaults to agency. Home requires address/district; instructions are optional. Agency offers only active couriers, requires destination text (max500) and national_id/passport/foreign_id plus document; document strings preserve leading zeros. Server-authored historical courier/destination snapshots and recorder attribution remain immutable. Stale courier deactivation recovers through real action revalidation without overwriting the prior snapshot. Assignment is restricted to pending, noncancelled, incomplete orders. Historical recipient text wraps long unbroken values without new length restrictions. Controlled delivery/configuration fields wait for client hydration before accepting edits. Cost/charge remain separate; production cost resolution defaults unavailable without a zero-placeholder tariff.

Store/home/agency assignment E2E injects only cost capability via fresh server context, exercising real authentication/configuration/persistence. `apps/core/tests/e2e/store-delivery.spec.ts` covers store→home, missing district, unavailable draft retention, cleared pickup, Portuguese reopening, and shipped locks.

Reviewer requested 48px mobile selects; `max-md:min-h-touch` applied. Reviewer scored the select-target fix resolved in both mobile recaptures (ship at that scope). Core lint/typecheck/unit passed; full Chromium E2E passed (20 tests) before final wrapping/duplicate-hint cleanup. Focused `apps/core/tests/e2e/agency-delivery.spec.ts` passed afterward, including long-text overflow and repeated stock deduction once. Detector ran once on both sources with no findings. Reviewer `agency_order_web_review`: ship, no material fixes; actual scope light mode 1280/390, with document-top/fullpage agency captures inspected. Dark/uncaptured states remain unapproved. Native agency UI was not implemented in this unit.

Captures: `.impeccable/review/agency-order-desktop.png`, `.impeccable/review/agency-order-mobile.png`, `.impeccable/review/home-order-desktop.png`, `.impeccable/review/home-order-mobile.png`, `.impeccable/review/store-order-desktop.png`, `.impeccable/review/store-order-mobile.png`.

Editable pending orders without a delivery snapshot show “Entrega por definir” / “Entrega a definir”; completed null-snapshot orders do not. `apps/core/tests/e2e/delivery-without-tariffs.spec.ts` starts real `src/server.ts` on port4174 with normal composition and no injected resolver. Authenticated UI configuration save/reload followed by rejected assignment preserves null delivery, total10, stock3, and the label after reopening—no fictional cost. Focused E2E and core lint/typecheck/unit passed.

Reviewer `undefined_delivery_web_review`: SHIP, no fixes, captured light-mode 1280/390 scope only. Root inspected document-top/fullpage `.impeccable/review/undefined-delivery-desktop.png` and `.impeccable/review/undefined-delivery-mobile.png`. Detector ran once on the route with no findings. Portuguese is source-only evidence; dark/uncaptured states remain unapproved.


## Approved order workspace redesign — 2026-10-06

User approved option A: `.impeccable/mocks/order-detail/a-commercial.png`.
Operate, web only. Preserve business behavior and the shared Caramelo sobrio identity.
THESIS: understand the sale before entering an edit form.
OWN-WORLD: existing Inter, cream canvas, white/charcoal cards, caramel actions, discreet borders.
STORY: identify order and independent statuses; inspect products and money; consult customer and destination; edit delivery explicitly.
LAYOUT: order number/date and independent order, payment and delivery badges. At `xl`, 3:2 columns place products, payments and buyer confirmation left; customer, delivery and internal details right. Below `xl`, the visual sequence is products, payments, customer, delivery, buyer confirmation, internal details. Small-screen product rows retain quantity labels and aligned amounts without horizontal table scrolling.
FORM: user-pinned Shopify-inspired commercial summary, option A (no random concept selection).
FINISH: implemented and reviewed; the existing global `DESIGN.md` identity remains authoritative. This surface brief records the completed composition and evidence.

| Ingredient | Implementation |
| --- | --- |
| Navigation and typography | Existing app shell and Inter, semantic links |
| Order header/statuses | HTML headings, existing semantic tokens, lucide icons |
| Product rows and financial summary | Semantic table and definition list; tabular amounts |
| Customer/delivery panels | Existing Card; labeled text; recipient only in delivery |
| Edit delivery | Existing form, inline disclosure controlled by explicit button |
| Payment/checkout controls | Existing actions and Button/Field/Input |
| Technical attribution | Native details disclosure with wrapped identifiers |

Grammar: 8px cards, 6px controls, one discreet border, no shadows; 24px page heading, 18px section headings, 14px dense data, 16px primary content. Shared tokens remain authoritative over raster generation variance. Generated duplicate customer/recipient fields and misleading checkout text are not literalized. Use actual order number, original status terminology and buyer confirmation semantics; no invented fulfillment actions. No shipping raster assets are needed; all UI remains semantic code.

### Implemented interactions

- Products show variant/SKU, unit price, quantity and line subtotal. Payments separate merchandise subtotal, customer delivery charge, total, received amount, balance and any overpayment warning. History retains receipts, reported-payment confirmation and confirmed-payment voiding; manual payment remains available for a noncancelled order with a balance.
- Customer identity remains separate from the delivery recipient. Delivery shows the saved store/home/agency destination, recipient and internal delivery cost. The initially closed inline editor opens through Assign/Edit delivery and closes through Close editing; its button exposes `aria-expanded`. Existing eligibility, draft retention, validation and delivery-cost behavior remain in force. Missing settings link to configuration; locked orders explain the restriction.
- Buyer confirmation retains its actual disabled/pending/confirmed/cancelled state, link generation, selectable read-only URL, copy feedback/manual fallback and separate buyer payment link. It does not imply payment completion.
- Native `details` keeps stock state, seller ID and delivery recorder attribution collapsed until requested. Long identifiers wrap. Inline errors and success feedback retain alert/status semantics. Spanish and Portuguese strings are supplied; currency follows the active locale.
- Status badges consume the existing shared badge radius through the theme adapter's `--radius-badge`; no new global token or visual identity was introduced.

### Validation and review scope

Parent-reported validation on Node 24: core lint, typecheck, unit tests and 13 E2E tests passed, covering orders, payments, checkout and all delivery variants. The agency E2E rerun passed after screenshot capture animations were disabled. The Impeccable detector ran once and returned no findings.

Independent `finish_review` inspected the approved comp, all six final captures and sampled code, finding no material fidelity or craft issues. Its sole requested fix was persistence of the hero reproduction; the subsequent fix-only pass marked that resolved and returned **ship**. Test outcomes were parent-reported; the reviewer did not independently execute browser keyboard, zoom or Portuguese checks. This is visual approval of the captured web states, not a complete accessibility audit or native-app approval.

Final captures: `.impeccable/review/order-redesign-{wide,desktop,mobile}-{light,dark}.png` (six files). These extend visual evidence to both themes at the three captured widths; earlier light-only review limitations above remain historical.

Final reproduction evidence: `.impeccable/review/hero-repro.png` is an exact copy of the final 1504×1045 wide-light capture, persisted after implementation for the comp comparison. It is not evidence of an earlier staged reproduction checkpoint. No catalog QUALITY BAR card was generated for this user-pinned direction.
