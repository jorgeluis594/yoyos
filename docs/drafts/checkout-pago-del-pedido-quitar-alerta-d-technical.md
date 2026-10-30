# Checkout payment step: closing screen and amount rows: technical design

**Status:** design closed, pending implementation. Based on [`docs/drafts/checkout-pago-del-pedido-quitar-alerta-d.md`](checkout-pago-del-pedido-quitar-alerta-d.md). Base: `jorgeluis594/checkout-pago-del-pedido-quitar-alerta-d` at `c824ea82` (`main` at `c4307126`).

## 1. Technical goal

Core web derives which screen the buyer checkout shows from the public checkout state and the `BuyerPaymentView` with one pure function, and every part of the page (header slot, main column, payment content, focus after **Ya pagué**) reads that result instead of re-deciding it. The buyer view gains the report date of each payment so the closing screen can list pending receipts newest first with their Lima date and time. No use case, table, route or event changes; mobile is untouched.

```text
loader ─ PublicCheckoutResponse.state ─┐
       └ BuyerPaymentView (+reportedAt) ┴─► checkoutScreen(input) ─► CheckoutStateView (app/components)
                                                                     ├ header slot: cancelled block | closing card
                                                                     ├ main: buyer details + CheckoutPayment(view) ─► BuyerPaymentContent(screen)
                                                                     └ summary: «Total del pedido», visible on phones
«Apariencia de la tienda» preview ─► CheckoutPayment(view)   (app layer; never imports orders/presentation)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Scope | Core web only: checkout route, checkout sections, buyer payment content, the «Apariencia de la tienda» preview, locales `es`/`pt`, and one field in `shared/contracts/orders.ts`. Mobile, seller screens, use cases, routes and schema are unchanged. |
| Schema | No change. Every payment that came from a report already stores `reportedAt` (`ReportData` in `orders/domain/payment.ts`). |
| Screen decision | One pure function `checkoutScreen(input)` in `orders/presentation/buyer-checkout-screen.ts` with precedence cancelled → payment not available → paid → closing → payment. Its input is a discriminated union, so a confirmed checkout cannot reach it without a view. Nothing else in the page branches on `availability`, `paymentStatus` or `payments[].status`, the header included. |
| Feature boundary | Only the app layer (`app/components/checkout-sections.tsx`, `app/components/checkout-state-view.tsx`) imports `orders/presentation/*`, as `checkout-sections.tsx` already does for `BuyerPaymentContent`. `CheckoutPayment` keeps its `{ view }` input and derives the screen itself, so the «Apariencia de la tienda» preview (`store-appearance`) keeps passing plain `BuyerPaymentView` data from `@shared/contracts/orders` and imports nothing new from orders. |
| Amount rows | One pure function `amountRows(view, place)` with `place: "payment_box" \| "amounts_card"`: a single row when `paidAmount` is zero («Monto a pagar» in the payment box, «Total del pedido» in the separate amounts card of the paid and not-available states); otherwise the three rows. It reads `paidAmount` and `balanceDue` as core computes them; the web computes no money. |
| Contract | `BuyerPaymentView.payments[]` gains `reportedAt: string (ISO datetime) \| null`, `null` only for a manual payment. No version suffix: there are no customers yet and mobile does not consume this schema. |
| Header slot | `CheckoutShell` replaces its internal `CheckoutStatus` with a `headerNotice?: ReactNode` slot under the order title. The name differs from the existing `CheckoutPayment.notice` on purpose. `CheckoutStateView` fills it from the screen: the cancelled block (`CheckoutCancelledNotice`, exported from `checkout-sections.tsx`) for `cancelled`, the closing card for `closing`, nothing otherwise. The pending route and the preview pass no `headerNotice`. The preview keeps passing `CheckoutPayment.notice` for its sample-methods note. |
| Double derivation | In a confirmed checkout the screen is derived twice per render, by `CheckoutStateView` (header and focus) and by `CheckoutPayment` (content). This is deliberate: it is the same pure function over the same view, so the two cannot disagree, and it keeps `CheckoutPayment` at its `{ view }` input for the preview. No `screen` prop is passed down and no `useMemo` is added. |
| Page composition | A new `CheckoutStateView` component renders every non-pending checkout (confirmed or cancelled). It stays mounted across the refresh after **Ya pagué**, so it owns the focus intent. |
| Focus after **Ya pagué** | `BuyerPaymentContent` calls `onReportSettled()` after the refresh it triggers. `CheckoutStateView` stores the focus intent together with the loader data identity it saw (`useLoaderData()` object) at that moment. Its effect runs on the loader data and acts only once the data differs from the stored one, that is, once the refreshed screen has rendered. It then focuses the heading named by `focusTargetFor(screen)` and clears the intent. A `null` target clears the intent without moving focus, and a run that still sees the old data does not consume it. Target headings have a stable `id` and `tabIndex={-1}`; their cards drop `role="status"`. Loading or reloading the page moves no focus. |
| Report recorded, refresh failed | After `201`, the content reads `GET /api/buyer/orders/:orderId/payment` (the existing buyer endpoint) before revalidating. If it succeeds, the content revalidates the route. If it answers `409 ORDER_CANCELLED`, it takes the cancelled path below. Any other failure replaces the upload block with the recorded-not-refreshed message and **Recargar página** (`window.location.reload()`), with no revalidation. Cost accepted: a successful **Ya pagué** costs three requests (`POST /reports`, `GET /payment`, the loader revalidation) and about 10 short read queries, against two requests and about 6 queries before. It runs a few times per order. This count is recorded in the pull request. `useRevalidator` sends loader errors to the `ErrorBoundary`, so the probe is the only way to show the product message. |
| `ORDER_CANCELLED` on report or probe | A `409 ORDER_CANCELLED` from the report or from the probe is treated as settled: the content revalidates and calls `onReportSettled()`, so the page shows «Pedido cancelado» with focus. Other report failures keep today's `reportFailed` message and the same `paymentId`. |
| Receipt date | Follows the product rule (America/Lima, medium date + short time, the seller order list's ICU patterns) with one formatter: `Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: salesTimeZone })`, locale `es-PE` or `pt-BR` from `i18n.language`. The rendered form, checked with Node ICU, is «30 oct. 2026, 6:42 p. m.» in Spanish and «30 de out. de 2026, 18:42» in Portuguese. The product's Spanish example («30 oct 2026, 18:42») is updated to the real output in the product draft. The order list prints date and time on two lines from the same patterns; here they are joined by ICU's own separator. `salesTimeZone` is exported from `shared/orders-date.ts` (today's private `limaTimeZone`). The element that holds the date has `suppressHydrationWarning`, because the server's and the browser's ICU can differ («oct» vs «oct.»), and a text mismatch would make React re-render the closing screen on the client. |
| Summary card | Its total row label and the section's `aria-label` both read `checkoutSections.total` («Total a pagar») only while pending and the new `checkoutSections.orderTotal` («Total del pedido») otherwise. The `max-lg:hidden` class for confirmed checkouts is removed; `lg:sticky` stays desktop-only. |
| Closing card style | Theme information tokens (`--info`, `--info-surface`, already in all five themes and in the contrast test), `Clock` icon from `lucide-react`, `ExternalLink` icon on each «Ver captura». |
| Screenshots | Taken in the final verification with the running app (Clásico and Noche, 390 px and desktop), uploaded for the pull request. The E2E does not write screenshot files. |
| Removed texts | `checkoutSections.confirmedTitle/confirmedBody/confirmedChanges`, `buyerPaymentContent.includesDelivery/pendingTitle/pendingBody/cancelledTitle` in `es` and `pt`. `buyerPaymentContent.cancelledTitle` goes because the `cancelled` screen never reaches the payment content. `confirmTitle`, `contactStore`, `quotePendingTitle` and `quotePendingBody` stay: the not-available card still serves `checkout_pending` and `delivery_quote_pending`. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Buyer view contract | `shared/contracts/orders.ts` `buyerPaymentViewSchema` | `payments[]` carries `id`, `status`, `amount`, `method`, `receiptImageUrl`, `rejectionReason`; no date. `availability` is always `"available"`. |
| Buyer view assembly | `apps/core/src/features/orders/composition.ts` `getBuyerPaymentView` | Builds the view from `OrderAggregate` and `orderStateMachine.getPaymentSummary`; `paidAmount` counts confirmed payments, `balanceDue` never goes below zero. A receipt whose image does not resolve gets `receiptImageUrl: null`. |
| Report date in domain | `apps/core/src/features/orders/domain/payment.ts` | `reported.data.reportedAt`, `rejected.data.report.reportedAt`, `confirmed/voided.data.evidence.report.reportedAt` when `evidence.kind === "buyer_report"`; manual payments have none. |
| Checkout route | `apps/core/app/routes/checkout.tsx` | Loader loads the payment view only for `state.kind === "confirmed"`; a cancelled order renders the shell with buyer details only. |
| Shell, status, summary | `apps/core/app/components/checkout-sections.tsx` | `CheckoutStatus` renders the green confirmed block and the cancelled block (`role="status"`). The summary is `max-lg:hidden` once confirmed and always labelled «Total a pagar». |
| Payment content | `apps/core/src/features/orders/presentation/buyer-payment-content.tsx` | Decides paid / unavailable / payment itself; shows «Incluye entrega»; shows «Pago pendiente de revisión» instead of the upload block while a report is pending; `submit` revalidates after `201`; a revalidation failure reaches the route `ErrorBoundary`. |
| Report endpoint | `apps/core/src/features/orders/presentation/buyer-payment-routes.ts` | `POST /reports` answers `201 reported` even on a replay of a rejected report, and `409 ORDER_CANCELLED` for a cancelled order; `GET /payment` returns the validated view. |
| Preview | `apps/core/src/features/store-appearance/presentation/checkout-preview-page.tsx`, `preview-fixtures.ts` | Reuses `CheckoutShell` and `CheckoutPayment` with a confirmed preview state, so it shows the confirmed block; fixture has `paidAmount` 0 and no payments. |
| Locales | `apps/core/app/locales.ts` | `checkoutSections` and `buyerPaymentContent` namespaces, `es` and `pt`. |
| Theme tokens | `shared/store-themes.ts`, `store-appearance/domain/store-themes.test.ts` | `info` and `info-surface` exist in the five themes and are covered by the contrast test. |
| Lima zone | `shared/orders-date.ts` (`limaTimeZone`, private), `app/routes/order-list.tsx` and `dispatch-label-print-dialog.tsx` (local `salesTimeZone`) | Three copies of `"America/Lima"`; no company time zone exists. |
| Tests touched | `buyer-payment-content.test.ts(x)`, `checkout-sections.test.tsx`, `checkout-preview-page.test.tsx`, `store-theme.stories.tsx`, `tests/e2e/buyer-payment.spec.ts`, `checkout.spec.ts`, `store-appearance-buyer.spec.ts` | Assert «Pedido confirmado», «Pago pendiente de revisión», «Incluye entrega» or «Total a pagar» after confirming. |
| Mobile | `apps/mobile` | Does not import `buyerPaymentViewSchema` nor render the buyer checkout. |

## 4. Gaps this design closes

1. The buyer view has no report date, so pending receipts cannot be ordered or labelled (§8).
2. The screen decision is spread over the route, `CheckoutStatus` and `BuyerPaymentContent`, and there is no closing state (§6).
3. The header slot can only render a status derived from the checkout state, not the closing card, and it decides cancellation on its own (§12).
4. Focus after **Ya pagué** cannot reach a heading that the payment content does not own, and the target cards are live regions (§12).
5. A failed refresh after a recorded report falls into the route error page instead of the recorded-not-refreshed message (§11).
6. Amount rows and the summary label do not follow the product rule, and the summary is hidden on phones (§6, §12).

## 5. Use cases

No use case is added or modified. `getBuyerPaymentView` (orders composition) changes only its projection: each item of `payments` adds `reportedAt`.

```ts
function reportedAt(payment: Payment): Date | null // reported → data.reportedAt; rejected → data.report.reportedAt;
// confirmed | voided → evidence.kind === "buyer_report" ? evidence.report.reportedAt : null
```

It sits next to the existing `receiptImageId(payment)` helper in `composition.ts` and is serialized with `toISOString()`.

## 6. Domain and typing

All new types are presentation types in `apps/core/src/features/orders/presentation/buyer-checkout-screen.ts`. They are not domain rules: they only read what core already decided (`paymentStatus`, `balanceDue`, payment statuses).

```ts
/** Why: a single discriminated result replaces three independent branches that could disagree. */
export type CheckoutScreen =
  | Readonly<{ kind: "review" }>                                   // checkout pending: the confirmation form
  | Readonly<{ kind: "cancelled" }>
  | Readonly<{ kind: "payment_unavailable"; view: BuyerPaymentView }>
  | Readonly<{ kind: "paid"; view: BuyerPaymentView }>
  | Readonly<{ kind: "closing"; receipts: ReadonlyArray<PendingReceipt> }>
  | Readonly<{ kind: "payment"; view: BuyerPaymentView; rejection: Readonly<{ reason: string | null }> | null }>;

/** Why: the closing card needs only the link and the date, newest first; it never shows amounts. */
export type PendingReceipt = Readonly<{ id: string; url: string | null; reportedAt: string }>;

/** Why: a confirmed checkout always has its view; the union makes the missing view unrepresentable instead of a runtime branch. */
export type CheckoutScreenInput =
  | Readonly<{ state: "pending" }>
  | Readonly<{ state: "cancelled" }>
  | Readonly<{ state: "confirmed"; view: BuyerPaymentView }>;
export function checkoutScreen(input: CheckoutScreenInput): CheckoutScreen;

/** Why: the row rule depends on whether anything was confirmed, not on the delivery charge. */
export type AmountRows =
  | Readonly<{ kind: "single"; label: "amountToPay" | "orderTotal"; amount: Money }>
  | Readonly<{ kind: "breakdown"; total: Money; paid: Money; balance: Money }>;
export function amountRows(view: BuyerPaymentView, place: "payment_box" | "amounts_card"): AmountRows;

export type CheckoutHeadingId = "checkout-closing-title" | "checkout-rejected-title" | "checkout-paid-title" | "checkout-cancelled-title";
export function focusTargetFor(screen: CheckoutScreen): CheckoutHeadingId | null;
```

Rules of `checkoutScreen`, in order:

1. `pending` → `review`; `cancelled`, or `confirmed` with `view.availability === "cancelled"` → `cancelled`. The header reads this result, so both sources show the same cancelled block.
2. `availability !== "available"` → `payment_unavailable`.
3. `paymentStatus === "paid"` → `paid` (a pending receipt does not block it).
4. Any payment with `status === "reported"` → `closing`, with those payments sorted by `reportedAt` descending. The contract's refine guarantees a `reported` payment has `reportedAt`; a narrowing filter yields `PendingReceipt.reportedAt: string` with no fallback rule.
5. Otherwise `payment`, with `rejection` from `view.rejectedReport`.

The route builds the input from `PublicCheckoutResponse.state.kind` and the loader's `payment`; the loader already throws `503` when a confirmed checkout has no valid view. `CheckoutPayment` builds `{ state: "confirmed", view }` from its own `view`.

`amountRows` returns `single` when `paidAmount.amount === 0` (label `amountToPay` with `balanceDue` in `payment_box`, `orderTotal` with `total` in `amounts_card`), else `breakdown` with `total`, `paidAmount` and `balanceDue`. The payment box (inside the selected method, or after «El negocio aún no ha configurado…») uses `payment_box`; the separate amounts card of the `paid` and `payment_unavailable` screens uses `amounts_card`. A paid order with confirmed payments always has `paidAmount > 0` and shows the three rows; a zero-total order with no payments shows «Total del pedido S/ 0.00». `focusTargetFor` maps `closing`, `payment` with a rejection, `paid` and `cancelled` to their heading id; every other screen returns `null`.

| Layer | Types and authority |
| --- | --- |
| Domain (core) | `Payment`, `ReportData.reportedAt`, payment summary: the only authority for money and statuses. |
| Contract (`shared`) | `BuyerPaymentView` with `payments[].reportedAt`. |
| Presentation (core web) | `CheckoutScreen`, `PendingReceipt`, `AmountRows`, `CheckoutHeadingId`: derived, never stored. |

## 8. Contracts between applications

`shared/contracts/orders.ts`, `buyerPaymentViewSchema.payments[]`:

```ts
z.strictObject({ id: z.uuid(), status: z.enum(["reported", "confirmed", "voided", "rejected"]),
  amount: moneySchema.nullable(), method: z.enum(["digital_wallet", "bank_transfer"]).nullable(), receiptImageUrl: z.url().nullable(),
  rejectionReason: z.string().nullable(), reportedAt: z.iso.datetime().nullable() })
  .refine((payment) => payment.status !== "reported" || payment.reportedAt !== null, { message: "A reported payment has a report date" })
```

The field is required (`null`, never omitted). The route `GET /api/buyer/orders/:orderId/payment` and the checkout loader already parse the view with this schema before answering, so an assembly mistake (including the new refine) is a server error. The loader answers `503` and logs `order_checkout_data_invalid`. `GET /payment` throws from `buyerPaymentViewSchema.parse` and answers `500 INTERNAL_ERROR` with the existing `buyer_payment_view_failed` event, and the post-report probe then shows the recorded-not-refreshed message. Status codes and error codes do not change. Consumers: the checkout loader, the buyer payment content, the preview fixtures and their tests; mobile does not consume it.

## 11. Transactions and concurrency

No write changes. Report retries keep today's rule: the client reuses the same `paymentId` until the report is recorded, so a retry after a lost answer replays the same report and never creates a second one.

| Situation after **Ya pagué** | Decision |
| --- | --- |
| `201` and `GET /payment` succeeds | Revalidate the route; then `onReportSettled()`; the focus goes to the target of the refreshed screen. |
| `201` and `GET /payment` answers `409 ORDER_CANCELLED` (seller cancelled in between) | Revalidate, then `onReportSettled()`: the cancelled block takes focus. |
| `201` and `GET /payment` fails otherwise (network, `5xx`, other `4xx`, invalid body) | No revalidation. The upload block is replaced by the recorded-not-refreshed message (focused, not a live region) and **Recargar página**. **Ya pagué** is not rendered. |
| `201`, `GET /payment` succeeds, revalidation then fails | The route `ErrorBoundary` shows today's load error with retry; reloading shows the real state. Accepted residual window. |
| Report answers `409 ORDER_CANCELLED` | Revalidate, then `onReportSettled()`: the cancelled block takes focus. |
| Any other failure or no answer | Today's `reportFailed` message; the file, `imageId` and `paymentId` stay for the retry. |

## 12. Code organization

| File | Change |
| --- | --- |
| `shared/contracts/orders.ts` | `payments[].reportedAt` (§8). |
| `shared/orders-date.ts` | Export the zone as `salesTimeZone`; `limaMidnightUtc` keeps using it. |
| `apps/core/src/features/orders/composition.ts` | `reportedAt(payment)` next to `receiptImageId`; add it to each projected payment. |
| `apps/core/src/features/orders/presentation/buyer-checkout-screen.ts` (new) | `checkoutScreen`, `amountRows`, `focusTargetFor`, `formatReceiptDate(iso, language)` and their types. `formatReceiptDate` reuses one `Intl.DateTimeFormat` per language, kept in a module-level `Map`, instead of building one per call. Imported only by orders presentation and the app layer, never by another feature. |
| `apps/core/src/features/orders/presentation/checkout-closing-card.tsx` (new) | The closing card: `h2#checkout-closing-title` with `tabIndex={-1}`, body, hint, one entry per pending receipt. The date is shown when there is more than one pending receipt, counting receipts, not links. An entry with a URL is a «Ver captura» link. An entry without a URL is the same label as plain muted text, with no link. A single pending receipt without a URL shows no entry. The date and the new-tab hint are visible text and an `sr-only` span inside the link, not an `aria-label`, and the date sits in its own element with `suppressHydrationWarning`. `min-h-11 min-w-11`, `target="_blank" rel="noreferrer"`, accessible name with the new-tab hint. No `role`. |
| `apps/core/src/features/orders/presentation/buyer-payment-content.tsx` | Receives `screen: Extract<CheckoutScreen, { kind: "payment" \| "paid" \| "payment_unavailable" }>` and `onReportSettled`; renders `AmountRows` from `amountRows`; drops the pending branch and its own availability checks; the paid heading and the rejection heading get their ids and `tabIndex={-1}` and their containers lose `role="status"`; adds the post-report read (§11) and the recorded-not-refreshed block. «Comprobantes enviados» stays in `payment`, `paid` and `payment_unavailable`, as today. |
| `apps/core/app/components/checkout-sections.tsx` | `CheckoutShell` drops `CheckoutStatus` and gets `headerNotice?: ReactNode` under the title; `CheckoutCancelledNotice` (exported) renders the cancelled block with `h2#checkout-cancelled-title tabIndex={-1}` and no `role`; the summary drops `max-lg:hidden` and picks `orderTotal` for both the total row and the section `aria-label` outside `pending`; `CheckoutPayment({ view, notice?, onReportSettled? })` derives `checkoutScreen({ state: "confirmed", view })`, wraps `BuyerPaymentContent` in its «Pago» section for `payment`, `paid` and `payment_unavailable`, and returns `null` for `closing` and `cancelled`, so no empty labelled region remains; the `CircleCheck` import goes. |
| `apps/core/app/components/checkout-state-view.tsx` (new) | `CheckoutStateView({ appearance, checkout, payment })`: computes the screen, renders the shell with the cancelled block or the closing card as `headerNotice`, the buyer details, and `CheckoutPayment` for a confirmed checkout (which returns `null` in `closing`); holds the focus intent with the loader data identity and the effect described in §2 «Focus after **Ya pagué**». |
| `apps/core/app/routes/checkout.tsx` | Renders `CheckoutStateView` for every non-pending checkout; the pending form is unchanged. |
| `apps/core/src/features/store-appearance/presentation/checkout-preview-page.tsx`, `preview-fixtures.ts` | No new import: the preview keeps calling `CheckoutPayment` with its fixture `BuyerPaymentView` and passes no `headerNotice` to `CheckoutShell`, so the confirmed block disappears with `CheckoutStatus`. It keeps `CheckoutPayment.notice` with the sample-methods note (`checkout-preview-page.test.tsx` already asserts it). The fixture's `payments` stays empty; any payment added to it carries `reportedAt`. |
| `apps/core/src/features/store-appearance/presentation/store-theme.stories.tsx` | Drop the confirmed block sample. |
| `apps/core/app/locales.ts` | Remove and add the keys below in `es` and `pt`, with the product's texts. |

New keys: `checkoutSections.orderTotal`; `buyerPaymentContent.amountToPay`, `paidAmount`, `closingTitle`, `closingBody`, `closingHint`, `viewReceipt`, `viewReceiptAt` (`{{date}}`), `opensInNewTab`, `reportRecorded`, `reloadPage`. `buyerPaymentContent.total` («Total del pedido» / «Total do pedido») and `balanceDue` are reused. `buyerPaymentContent.status.reported` («Pendiente») stays for «Comprobantes enviados».

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `order_checkout_data_invalid` (existing) | error | `checkout.tsx` loader | `["event", "errorCode"]` with `INVALID_PAYMENT_RESPONSE` when the view, now with `reportedAt`, fails the schema |
| `buyer_payment_view_failed` (existing) | error | `buyer-payment-routes.ts` `GET /payment` | `["event", "err"]` when `buyerPaymentViewSchema.parse` throws (answers `500`) |

No new event: the change is presentational, and the buyer browser does not log. Receipt URLs, dates and amounts are never logged.

## 14. Tests

Unit, core (`buyer-checkout-screen.test.ts`):
- `test("shows the cancelled screen before any payment state, even with a pending receipt")`
- `test("shows payment not available before paid and closing when the view is not available")`
- `test("shows paid when payments cover the total, even with a receipt still pending")`
- `test("shows the closing screen while a receipt is pending and the order is not paid")`
- `test("keeps the closing screen when a confirmed payment is voided while a receipt is pending")`
- `test("lists pending receipts newest first and keeps one without an image url")`
- `test("shows the cancelled screen for a confirmed checkout whose view is marked cancelled")`
- `test("shows the payment step with the rejection when the latest report was rejected and nothing is pending")`
- `test("gives a single «Monto a pagar» row with the balance when nothing is confirmed")`
- `test("gives total, paid and balance once a payment is confirmed, with an overpayment as paid 35 and balance 0")`
- `test("gives «Total del pedido» as the single row of the amounts card when nothing is confirmed")`
- `test("gives «Monto a pagar» with the full total again after the only confirmed payment is voided")`
- `test("names the heading to focus for closing, rejected, paid and cancelled, and none otherwise")`
- `test("formats the receipt date in Lima time as «30 oct. 2026, 6:42 p. m.» and «30 de out. de 2026, 18:42» whatever the process time zone")`

Integration, core (`apps/core/src/features/orders/presentation/api-routes.integration.test.ts`, next to the existing `GET /payment` checks):
- `test("buyer view carries the report date of reported, rejected and report-confirmed payments and null for a manual payment")`

View, core (`checkout-state-view.test.tsx`, React Testing Library with the real i18n resources):
- `test("payment step with no payments shows one «Monto a pagar» row, no confirmed block and a summary ending in «Total del pedido»")`
- `test("payment step with a partial payment shows total, «Pagado» and «Saldo pendiente» as the only amount due and keeps the upload block")`
- `test("payment step after the only payment of a paid order is voided shows «Monto a pagar S/ 30.00»")`
- `test("pending receipt shows the closing card under the title, buyer details and summary, with no payment methods, upload or amounts due")`
- `test("closing card lists two receipts with their Lima dates newest first and a new-tab accessible name")`
- `test("closing card without a resolvable receipt image shows no «Ver captura» link")`
- `test("closing card with two pending receipts, one without an image, links one and lists the other as dated text")`
- `test("closing card shows a clock icon, no check icon and no approval wording, and the page has no «Pago» region")`
- `test("cancelled checkout shows only «Pedido cancelado» under the title, with no payment content and no closing card")`
- `test("rejected report shows the reason at the start of the upload block")`
- `test("paid order shows «Pedido pagado» with total, «Pagado» and «Saldo pendiente S/ 0.00» and keeps a pending receipt as «Pendiente»")`
- `test("overpaid order shows «Pagado S/ 35.00» and «Saldo pendiente S/ 0.00» with no notice")`
- `test("manual payment covering the total while a receipt is pending shows the paid state")`
- `test("not-available view with a pending receipt shows the not-available card, not the closing screen")`
- `test("summary card is rendered without the phone-hiding class in confirmed states and is not sticky below desktop")`
- `test("summary card region is named «Total del pedido» once confirmed and «Total a pagar» while pending")`
- `test("after «Ya pagué» focus moves to «Recibimos tu comprobante» and the card is not a live region")`
- `test("after «Ya pagué» on an already rejected report focus moves to «Tu comprobante fue rechazado»")`
- `test("after «Ya pagué» focus moves to «Pedido pagado» or to the cancelled heading under the title")`
- `test("rendering or reloading a closing screen moves no focus")`
- `test("a recorded report whose refresh read fails shows the reload message with focus and no «Ya pagué»")`
- `test("a recorded report whose refresh read answers ORDER_CANCELLED shows «Pedido cancelado» with focus, not the reload message")`
- `test("a failed send keeps the screenshot, reuses the same payment id on retry and shows the closing screen once it succeeds")`
- `test("focus is not lost when the settle callback runs before the refreshed data renders")`
- `test("renders the closing screen, «Valor a pagar» and «Valor pago» in Portuguese")`

Existing tests updated: `buyer-payment-content.test.ts(x)` (pending branch removed, rows changed), `checkout-sections.test.tsx` (no confirmed block, summary label), `checkout-preview-page.test.tsx` (`test("payment preview shows no confirmed block, «Monto a pagar» and «Total del pedido»")`). In review, a grep confirms that no file under `features/store-appearance` imports `features/orders/presentation`.

E2E, core web (`tests/e2e/buyer-payment.spec.ts`; the current reject journey becomes this one):
- `test("buyer confirms, sends a receipt, sees the closing screen, gets rejected, resends and sees the order paid after approval")`: confirm with S/ 20.00 + S/ 10.00 delivery → «Monto a pagar S/ 30.00» → attach PNG, **Ya pagué** → «Recibimos tu comprobante» focused → reload keeps it → seller rejects with «La captura no muestra el monto» → buyer sees the rejection and the upload block → resend → closing → seller approves S/ 30.00 → «Pedido pagado» with «Saldo pendiente S/ 0.00».
- `checkout.spec.ts`, `store-appearance-buyer.spec.ts` and the other `buyer-payment.spec.ts` journey replace «Pedido confirmado» / «Pago pendiente de revisión» waits with the payment step or closing title.

Pending manual checks (final verification): screenshots in Clásico and Noche at 390 px and desktop of the payment step without payments, with a partial payment, with a rejection, the closing screen and the paid state; a screen reader pass announcing the closing title once after **Ya pagué**.

## 15. Limits and checks during implementation

- The Spanish date reads «30 oct. 2026, 6:42 p. m.» (checked with Node ICU). If the Node 24 ICU used by CI renders it differently, the test follows the ICU output of the shared options, and the product draft example is updated to match. Browsers with an older ICU may render a variant, which `suppressHydrationWarning` absorbs.
- The focus effect keys on the loader data identity (§2), so it does not depend on when `useRevalidator().revalidate()` resolves.
- Optional, not required: `payments[]` could become a `z.discriminatedUnion("status", …)` where `reported` requires `reportedAt`. The refine already makes a dated-less reported payment unreachable, so the design keeps the single item shape.
- `salesTimeZone` stays a single Lima constant because no company time zone exists. A per-company zone is a separate decoupling (rule 5.7) and is not part of this task; `order-list.tsx` and `dispatch-label-print-dialog.tsx` keep their local copies.
- The «payment not available» branch is dormant (`availability` is always `"available"`); it is covered by unit and view tests only.
- The sibling focus-ring task (`6hrqR5H6Ch7V8GrV`) changes focus styles only. It has no behavioral conflict with the `tabIndex={-1}` headings, but it very likely edits the same class strings in `checkout-sections.tsx` and `buyer-payment-content.tsx` (see §16).

## 16. Implementation plan

### Order and parallelism

```text
Wave 1: T1 (contract + screen derivation + UI + locales + preview + tests)
Wave 2: final verification (screenshots, screen reader pass, CI)
```

One task: the contract field, the derivation and the UI all meet in `buyer-payment-content.tsx`, `checkout-sections.tsx` and their tests, and the existing E2E must change in the same commit to stay green. Splitting would make two tasks edit the same files.

Merge note for the coordinator: the sibling focus-ring task (`6hrqR5H6Ch7V8GrV`) touches class strings in `checkout-sections.tsx` and `buyer-payment-content.tsx`. Merge it into the integration branch before T1 starts, or expect a textual conflict on those lines.

### T1. Closing screen, amount rows and summary in the buyer checkout

**Scope:** `payments[].reportedAt` in `shared/contracts/orders.ts` and in `getBuyerPaymentView`; `salesTimeZone` export; `buyer-checkout-screen.ts`, `checkout-closing-card.tsx`, `checkout-state-view.tsx`; changes to `buyer-payment-content.tsx`, `checkout-sections.tsx`, `checkout.tsx`, the preview page, fixtures and stories; locale keys in `es` and `pt`; every test in §14 and the updates to existing tests and E2E.
**Out of scope:** mobile; seller payment screens; any use case, route, schema or migration; a closing state in the preview; a per-company time zone; screenshots committed to the repository.
**Acceptance criteria:**
1. Order #1001 of S/ 20.00 + S/ 10.00 delivery, just confirmed: no «Pedido confirmado» block, one row «Monto a pagar S/ 30.00», no «Incluye entrega», summary ending in «Total del pedido S/ 30.00», visible at 390 px below the main column and not sticky.
2. Seller recorded S/ 20.00: rows «Total del pedido S/ 30.00», «Pagado S/ 20.00», «Saldo pendiente S/ 10.00», with the upload block. Voiding the only payment of a paid order brings back «Monto a pagar S/ 30.00».
3. After **Ya pagué** with a PNG: closing card under the title with focus on «Recibimos tu comprobante», **Ver captura** opening the PNG in a new tab, no QR, upload, «Monto a pagar», «Pagado» or «Saldo pendiente»; reloading shows the same screen without moving focus.
4. Two pending receipts at 18:42 and 18:50 Lima on 30/10/2026, rendered with `TZ=UTC`: two links, «Ver captura · 30 oct. 2026, 6:50 p. m.» first and «… 6:42 p. m.» second; a pending receipt without an image URL shows no link and the closing screen stays.
5. Rejected with «La captura no muestra el monto»: payment step with the rejection and the upload block; resending that same rejected report focuses «Tu comprobante fue rechazado».
6. Approved S/ 30.00, or a manual S/ 30.00 while a receipt is pending: «Pedido pagado» with «Saldo pendiente S/ 0.00»; the pending receipt keeps «Pendiente» in «Comprobantes enviados». Confirmed S/ 35.00: «Pagado S/ 35.00», «Saldo pendiente S/ 0.00», no notice.
7. Cancelled while a receipt is pending: only «Pedido cancelado»; after **Ya pagué** when the report or the follow-up read answers `409 ORDER_CANCELLED`, focus is on that heading.
8. Report recorded and the refresh read failing: the recorded-not-refreshed message with focus and **Recargar página**, no **Ya pagué**.
9. In Portuguese: «Recebemos seu comprovante», «Valor a pagar», «Valor pago», «Total do pedido».
10. The «Apariencia de la tienda» payment preview shows no confirmed block, «Monto a pagar» and «Total del pedido», and `features/store-appearance` imports nothing from `features/orders/presentation`.
11. `pnpm --dir apps/core lint`, `typecheck`, `test:unit`, the integration suite and the E2E suite pass; `scripts/ci.sh` is green against the integration branch.

**Tests to leave green:** all titles in §14 plus the updated existing tests.
**Depends on:** nothing.

### Final verification

With the app running (`docker compose up --build -V`), capture Clásico and Noche at 390 px and desktop for the payment step without payments, with a partial payment, with a rejection, the closing screen and the paid state, and attach them to the pull request (a `pr-assets/<topic>` branch, not the feature branch). Run one screen reader pass of **Ya pagué** → closing title announced once. Results go in the pull request description.

## 17. Questions decided by the review gate

Architecture gate round 1 (design reviewer and performance reviewer), consolidated by the coordinator; the founder confirms them in the final pull request.

1. **Can the «Apariencia de la tienda» preview derive the checkout screen itself?** Decided: no. `CheckoutPayment` (app layer) keeps its `{ view }` input and derives the screen, so `store-appearance` imports nothing from `orders/presentation`. Decided by the design reviewer (blocker) and the coordinator. Reason: `docs/architecture.md` forbids importing another feature's internal files. Discarded: the preview calling `checkoutScreen` directly, and moving the function into `shared/`, which would put orders' presentation rules in a cross-app folder.
2. **Who draws the cancelled block?** Decided: `CheckoutStateView` passes it as the shell's `headerNotice` from the screen, and `CheckoutStatus` goes. Decided by the design reviewer and the coordinator. Reason: the header must read the same result as the rest of the page, so `focusTargetFor` never points at a heading that is not there. Discarded: dropping the `availability === "cancelled"` clause and leaving the header on `state.kind`.
3. **Spanish receipt date.** Decided: keep the product rule (America/Lima, medium date + short time) and show what ICU renders, «30 oct. 2026, 6:42 p. m.»; the product draft examples were updated. Decided by the design reviewer and the coordinator. Reason: one formatter with the seller's patterns, with no hand-written format. Discarded: a custom 24-hour pattern for `es-PE` to match the old example.
4. **`ORDER_CANCELLED` from the read after `201`.** Decided: it takes the cancelled path (revalidate, focus «Pedido cancelado»), not «Recargar página». Decided by both reviewers. Reason: the refreshed state decides what the buyer sees.
5. **Extra read per «Ya pagué».** Decided: accepted (about 4–5 queries, a few times per order). Decided by the performance reviewer. Reason: `useRevalidator` gives no error to the caller, so the read is the only way to show the product's recorded-not-refreshed message.
6. **Hydration of the receipt date.** Decided: `suppressHydrationWarning` on the date element. Decided by the performance reviewer. Reason: the server's and the browser's ICU can differ. Discarded: rendering the date only after mount, which adds a flash and a second render.
7. **Other routine corrections, all adopted:** `checkoutScreen` takes a discriminated input (no confirmed state without a view); the `null reportedAt` fallback is dropped because the contract refine already rejects it; the summary card's `aria-label` follows the total label; `amountRows` places are `payment_box` and `amounts_card`, and the paid card uses `amounts_card`; the integration test lives in `api-routes.integration.test.ts`; the view titles cover AC10 (upload block after a partial approval) and AC11 (void back to «Monto a pagar»); `buyerPaymentContent.cancelledTitle` is removed and the not-available keys stay. Decided by the design reviewer.

Architecture gate round 2 (design reviewer and performance reviewer, both approved with no blockers), consolidated by the coordinator:

8. **Shell slot name.** Decided: `CheckoutShell.headerNotice`. The preview keeps `CheckoutPayment.notice` for its sample-methods note. Decided by the design reviewer. Reason: two props named `notice` invited deleting the preview's note. Discarded: keeping `notice` with a clarifying sentence only.
9. **`CheckoutPayment` in `closing`.** Decided: it returns `null`, with no «Pago» section. Decided by the design reviewer. Reason: an empty labelled region is announced by screen readers. Discarded: skipping only the inner content.
10. **Pending receipts with and without an image.** Decided: dates appear when there is more than one pending receipt, counting receipts and not links. A receipt without a URL is listed as the same label in plain text, with no link. A single one without a URL shows nothing. Decided by the design reviewer. Reason: the product says such a receipt «is listed without a link». Discarded: omitting it, which hides a receipt the seller still has to review.
11. **Focus timing.** Decided: the intent is cleared only once the loader data differs from the data seen at settle time; a `null` target then clears without moving focus. Decided by the design reviewer. Reason: an effect that runs before the refresh would otherwise consume the intent and drop focus to `body`. Discarded: relying on the `revalidate()` promise order.
12. **Schema failure on `GET /payment`.** Decided: documented as `500 INTERNAL_ERROR` with the existing `buyer_payment_view_failed` (§8, §13). Decided by the design reviewer. Reason: that is the route's real behavior.
13. **«Comprobantes enviados» in the not-available card.** Decided: it stays, as today. Decided by the design reviewer. Reason: the product keeps that branch in place.
14. **Discriminated `payments[]` item.** Decided: not adopted. Decided by the design reviewer (marked optional) and the coordinator. Reason: the refine already makes it unreachable, and reshaping every item for one field adds churn to the contract.
15. **Extra view titles** for AC13 (retry ends on the closing screen), AC15 (cancelled shows only the cancelled block) and AC17 (clock icon, no check icon, no approval wording). Decided: adopted. Decided by the design reviewer.
16. **Sibling merge order.** Decided: the plan carries a merge note (§16). Decided by the design reviewer and the coordinator.
17. **Intl formatter.** Decided: one cached formatter per language. Decided by the performance reviewer. Reason: building `Intl.DateTimeFormat` is the costly step and the card re-renders. Discarded: a new formatter per call.
18. **Double screen derivation.** Decided: kept on purpose (§2). Decided by the performance reviewer and the coordinator. Reason: it is a pure function over the same data, so it cannot disagree, and it keeps the preview's `{ view }` input. Discarded: passing the screen down as an extra prop, which gives `CheckoutPayment` two inputs that could disagree.
19. **Request count and reusing the probe's view.** Decided: record three requests and about 10 queries per successful **Ya pagué** in the pull request, and keep the revalidation. Decided by the performance reviewer. Reason: using the probe's response as page data would create a second client source of truth and contradict «the refreshed loader view decides». Discarded: local state over the loader data.

## 18. Deferred items

- A per-company time zone for receipt dates (rule 5.7): today one `salesTimeZone` constant is shared with the order list. Risk is low while every company sells in Peru. The founder asks for a Todoist task if wanted.
- Memory `ec1599bc` («refreshed view decides») still mentions the pending notice and the plain revalidation. It is updated when T1 merges.

