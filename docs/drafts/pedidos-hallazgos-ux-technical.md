# Order and payment UX review fixes: technical design

**Status:** draft with open questions. Based on Todoist task `6j3CMGXwFj5GrQfV` (closed product definition, founder decisions of 2026-11-18) and the review in `docs/drafts/ux-review-2026-11-17/` (`web-pedidos/REPORT.md`, `movil-pedidos/REPORT.md`). There is no product draft. Base: `jorgeluis594/pedidos-corregir-los-hallazgos-de-la-rev` at `7b23f62c` (equal to `origin/main`).

## 1. Technical goal

Core rejects any payment that exceeds the order's pending balance, in the orders use case, for every client, with a stable error that carries the balance. Web and mobile explain the limit before sending. Voiding a payment asks for a destructive confirmation on both clients. The payment state reads the same in list, card and detail («Pago parcial · falta X»), and both clients use one shared derivation and one shared amount check. The rest are presentation fixes on web (picker Enter, list text, single rate, phone field, Departamento mark, link copy) and mobile (tabs at 390px, no checkout-link call without a store link, disabled-button reason, one close control, «Venta guardada»).

```text
web form / mobile sheet ──checkPaymentAmount (shared)──▶ explains before sending
        │
        ▼ POST /api/orders/:id/payments · web action · createCompleteOrder
registerPayment ─▶ orderStateMachine.registerPayment ─▶ PAYMENT_EXCEEDS_BALANCE { balanceDue }
        (order row FOR UPDATE)                              │
                                                            ▼
                                       409 { code, error, balanceDue } (shared contract)

GET /api/orders/:id/aggregate ─▶ { ...order, checkoutLink: "available" | "subdomain_required" }
        mobile: POST /checkout-link only when "available"
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Scope | All 15 findings, web and mobile, in this task (founder decision 3). Every finding still occurs in `origin/main` (section 3.1); none is marked «already resolved in main». |
| Where the payment rule lives | `orderStateMachine.registerPayment` in `apps/core/src/features/orders/domain/order-state-machine.ts`. Every confirmation path goes through it: `registerPayment` (manual payment, buyer report approval, web action, mobile API, `createCompleteOrder`) and `registerImmediateSale`. |
| Pending balance | `total − sum(confirmed payments)`, the existing `paymentSummary.balanceDue`. Reported payments have no amount and do not count, nor do rejected or voided ones. A payment equal to the balance is accepted; one cent above is rejected. |
| Approving a buyer report | The same rule applies: the seller types the received amount and it cannot exceed the balance. See question 1. |
| Replays | A replay of an already confirmed `paymentId` with the same data keeps returning the existing order before the rule runs, so a retry is never rejected for exceeding the balance it already filled. |
| Overpayment that comes from an edit | Unchanged. Lowering the total by editing items can still leave `overpaidAmount > 0` and «Exceso recibido» stays. The rule only blocks registering money. |
| Error | New `OrderDomainError` member `{ code: "PAYMENT_EXCEEDS_BALANCE"; message; balanceDue: Money }`. HTTP 409 (conflict with the order's current state, like `TOTAL_CHANGED`), body `{ code, error, balanceDue }`. Additive: no existing code changes. |
| Concurrency | The existing `findOrderForUpdate` (`SELECT … FOR UPDATE` on the order row) serializes two payments on the same order; the second one sees the first and is rejected with the fresh balance. No new lock. |
| Shared client rules | `shared/orders-payment.ts` gains `checkPaymentAmount` (empty, not numeric, zero, exceeds balance) and `paymentProgress` (unpaid, partial with balance, paid). Web and mobile use them; neither keeps its own copy. |
| List contract | `orderAggregateSummarySchema` gains `balanceDue`. The mobile list needs it to tell partial from unpaid; the web loader stops computing it separately. |
| Store link known from the order | `GET /api/orders/:id/aggregate` adds `checkoutLink: "available" \| "subdomain_required"`. The field is optional in `orderAggregateSchema` and only that route sends it. Mobile calls `POST /checkout-link` only when it reads `"available"`, and keeps today's behavior when the field is absent. No new endpoint. |
| Void confirmation | Web: a `Dialog` like `UndoConfirmDialog`. Mobile: the existing `showConfirmation` with `destructive: true`. The text names the amount and the order number. No new rule about which payments can be voided. |
| Web list | Payment and delivery state become visible text with a small icon, and the balance appears for a partial payment. The icons-only disclosure (`OrderStatusIndicators`) is removed. |
| Copy | New Spanish and Portuguese keys are appended next to their siblings in `apps/core/app/locales.ts` and `apps/mobile/src/features/orders/presentation/translations.ts`; no existing key is reordered (the sibling products task edits the same files). |
| Memory superseded | cc516669 (overpayment is only a notice, PR #241): registering money above the balance is now blocked. 7587256f (web list states as icons with a disclosure): the list now shows text and balance. 723aeb57 («excess is an amount»): it stays true only for edits that lower the total. a15763e0 (mobile loads the link with `POST checkout-link` when the screen opens): mobile now skips the call when the order says the store has no link. 299a6aa0 (E.164 phones, split helpers in `shared/phone.ts`) and da31218e (void rules) still apply as they are. |
| Docs | `docs/orders.md` (payment rule, error, void confirmation, list text) and `docs/order-view.md` (list and badge text) are updated in the same PR. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| `registerPayment` use case | `apps/core/src/features/orders/application/register-payment.ts:33-64` | Locks the order, confirms the payment, calls the state machine; no amount limit. |
| `orderStateMachine.registerPayment` | `apps/core/src/features/orders/domain/order-state-machine.ts:343-360` | Checks state, currency and replay; computes the summary after adding the payment; never compares the amount with the balance. |
| `paymentSummary` | `order-state-machine.ts:202-231` | Only `confirmed` payments add to `paidAmount`; returns `balanceDue` and `overpaidAmount`. |
| Order row lock | `apps/core/src/features/orders/infrastructure/order-repository.ts:312` | `SELECT id FROM "Order" … FOR UPDATE`. |
| `registerImmediateSale` | `application/register-immediate-sale.ts:27-31` | Pays exactly `created.data.total`; unaffected by the rule. |
| `createCompleteOrder` | `application/create-complete-order.ts:52-57` | Registers each initial payment in order inside one transaction; a rejected one rolls back the whole sale. |
| Error mapping | `presentation/api-routes.ts:39-70` | `operationError` maps codes to statuses; `TOTAL_CHANGED` already returns an extra field. |
| Error contracts | `shared/contracts/registration.ts:56` (`apiErrorCodeSchema`), `shared/contracts/orders.ts:208-221` (`orderApiErrorSchema`) | No over-balance code. |
| List summary contract | `shared/contracts/orders.ts:152-156`, built in `presentation/order-json.ts:56-62` | No `balanceDue`. The web loader adds it at `apps/core/app/routes/order-list.tsx:50,74`. |
| Checkout link | `apps/core/src/features/orders/composition.ts:788-796`, `api-routes.ts:291-306`, `checkoutUrl` used by the web loader at `apps/core/app/routes/order-detail.tsx:103-105` | `POST checkout-link` answers 409 `SUBDOMAIN_REQUIRED` without a subdomain. |
| Shared payment helper | `shared/orders-payment.ts:4-8` | Only `offersPartialStockDeduction`. |
| Web payment amount check | `apps/core/src/features/orders/presentation/payment-fields.tsx:13-14` | Positive with two decimals; no balance. |
| Web payment void | `presentation/order-payments-panel.tsx:256-257` | A `<Form>` submit, no confirmation. |
| Web status labels | `presentation/order-status-labels.tsx:29-61` | `pending` reads «Pago pendiente[: X]»; no partial; list uses icons in a `<details>`. |
| Mobile register sheet | `apps/mobile/src/features/orders/presentation/order-payment-parts.tsx:99-175` | Any positive amount enabled; disabled without reason; scrim and header button both «Cerrar». |
| Mobile detail | `presentation/order-detail-screen.tsx` | Void at 598, checkout link effect at 326-337, result notice only when the total changed at 446-448/526. |
| Mobile list | `presentation/order-history-screen.tsx:251` | «Pagado» or «Pago pendiente» from `paymentStatus`. |
| Mobile badge | `order-payment-parts.tsx:24,35-40` | `paymentBadgeStatus` knows partial; shows «Pago parcial» without the balance. |

No file touched by the findings changed after the review (`git log --since=2026-11-15` on them is empty).

### 3.1 Findings checked against `origin/main`

| # | Finding | Still applies | Evidence |
| --- | --- | --- | --- |
| 1 | Payment above the total is saved | Yes | `order-state-machine.ts:343-360` has no balance check; mobile sheet enables any positive amount (`order-payment-parts.tsx:127,173`); web checks only positivity (`payment-fields.tsx:13-14`). |
| 2 | «Anular pago» without confirmation | Yes | Mobile `order-detail-screen.tsx:598` calls `voidPayment` directly; web `order-payments-panel.tsx:256-257` submits the form directly. |
| 3 | Enter in the product picker does nothing | Yes | `product-picker-keyboard.ts:11`: Enter with no highlight keeps the state. |
| 4 | Web list shows states only as icons | Yes | `order-list.tsx:98` renders `OrderStatusIndicators` (`order-status-labels.tsx:51-61`, text hidden in `<details>`). |
| 5 | Badge «Pago pendiente» with a partial payment | Yes | `order-view-saved.tsx:17` passes `balanceDue: 0`; `order-status-labels.tsx:32-34` has no partial label. |
| 6 | Single rate not preselected | Yes | Web `rated-delivery-form.tsx:67-71` autoselects only a single agency; mobile `delivery-fields.tsx:68` likewise. |
| 7 | Phone format differs between customer and recipient | Yes | Customer uses `PhoneField` (`order-customer-card.tsx:59`); recipient uses a plain `Input` with the E.164 value (`order-delivery-card.tsx:88-90`). |
| 8 | Departamento not marked on a failed save | Yes | `rated-delivery-form.tsx:60-62` marks only a wrapper `div`; `PeruDistrictSelect` (`peru-district-select.tsx:90-99`) has no `invalid` input. |
| 9 | Confusing order-link copy | Yes | `locales.ts:173,176` («Pendiente de confirmación» + «Elige el link de tu tienda…»); mobile `translations.ts:118,120` and `order-detail-screen.tsx:462`. |
| 10 | Tabs cut at 390px | Yes | `apps/mobile/src/components/app-tabs.web.tsx:81-91`: the row has `flexWrap` but no `flexShrink`/`minWidth: 0`, so it never wraps and overflows centered. |
| 11 | `POST checkout-link` 409 on every visit | Yes | `order-detail-screen.tsx:326-337` calls it whenever the order is not cancelled. |
| 12 | Mobile list «Pago pendiente» with a partial payment | Yes | `order-history-screen.tsx:251`; the summary contract has no `balanceDue`. |
| 13 | Disabled register button without reason | Yes | `order-payment-parts.tsx:173`; `amountError` only comes from the parent. |
| 14 | Two accessible «Cerrar» in the sheet | Yes | `order-payment-parts.tsx:104` (scrim `accessibilityRole="button"`) and `:110`. |
| 15 | No «Venta guardada» after saving on mobile | Yes | `new-order-screen.tsx:211-216` navigates; the detail shows the result notice only when the total changed (`order-detail-screen.tsx:446-448,526`). |

## 4. Gaps this design closes

1. Core accepts a confirmed payment larger than the pending balance (5.1).
2. No stable error tells the client the balance (8).
3. Clients have no shared amount check nor a shared partial-payment derivation (6).
4. The list summary lacks `balanceDue` (8).
5. Mobile cannot know there is no store link without calling `POST checkout-link` (8, 10).
6. Void has no confirmation on either client (10, 12).
7. The web presentation gaps of findings 3-9 and the mobile ones of findings 10-15 (10, 12).

## 5. Use cases

### 5.1 `registerPayment` (modified, orders)

Signature, input, access and dependencies do not change. The error union gains the new domain member through `OrderDomainError`.

Flow, with the change in step 4:
1. Open the company transaction; `findOrderForUpdate` locks the order row.
2. `ORDER_NOT_FOUND` if absent.
3. `confirmPayment` builds the confirmed payment (unchanged).
4. `orderStateMachine.registerPayment(order, payment)`:
   1. lifecycle, cancelled, valid payment, currency (unchanged);
   2. replay of the same confirmed id returns `ok(order)` (unchanged, before the rule);
   3. voided, rejected and report checks (unchanged);
   4. **new:** `paymentSummary(order)` before adding the payment; if `compare(payment.amount)(summary.balanceDue)` says the payment is greater, return `{ code: "PAYMENT_EXCEEDS_BALANCE", message: "Payment exceeds the pending balance", balanceDue }`;
   5. add the payment and derive completion (unchanged).
5. Persist, settle completion, publish `payment_confirmed` (unchanged).

`createCompleteOrder` and `registerImmediateSale` need no change: they reach the rule through the state machine.

### 5.2 `getAggregate` route (modified presentation, orders)

`GET /api/orders/:id/aggregate` keeps calling `orders.getAggregate`; after it, it calls the existing `orders.checkoutUrl(companyId, orderId)` and adds `checkoutLink: "available"` on success, `"subdomain_required"` on `SUBDOMAIN_REQUIRED`, and omits the field on any other failure (the client then falls back to the POST). A cancelled order omits it. No new use case: the store-link fact belongs to presentation of the order, as the web loader already does.

### 5.3 `voidPayment` (unchanged)

The confirmation is client-side only (founder decision 2).

## 6. Domain and typing

```ts
// order-state-machine.ts
export type OrderDomainError =
  | Readonly<{ code: "INVALID_ORDER" | "INVALID_PAYMENT" | /* …existing… */ "ORDER_CANCELLED"; message: string }>
  | Readonly<{ code: "PAYMENT_EXCEEDS_BALANCE"; message: string; balanceDue: Money }>;
```
Justification: the client must show the balance, and the error is the only place that knows the balance at the locked read.

```ts
// shared/orders-payment.ts
export type PaymentAmountProblem = "empty" | "not_numeric" | "zero" | "exceeds_balance";
/** `typed` is already normalized to a dot decimal; at most two decimals; compares in cents. */
export function checkPaymentAmount(typed: string, balanceDue: Money): Result<Money, Readonly<{ problem: PaymentAmountProblem; balanceDue: Money }>>;

export type PaymentProgress =
  | Readonly<{ kind: "unpaid" }>
  | Readonly<{ kind: "partial"; balanceDue: Money }>
  | Readonly<{ kind: "paid" }>;
/** Partial: payment pending and a balance smaller than the total. */
export function paymentProgress(order: Readonly<{ paymentStatus: "pending" | "paid"; total: Money; balanceDue: Money }>): PaymentProgress;
```
Justification: the same two questions are answered today in four places with different results (findings 5, 12, 13); one pure function per question ends the drift. `checkPaymentAmount` replaces web `isValidPaymentAmount` and the mobile inline parse.

| Layer | Types and authority |
| --- | --- |
| Core domain | `PAYMENT_EXCEEDS_BALANCE` decided under the row lock; the only authority. |
| Shared | `checkPaymentAmount`, `paymentProgress`: guidance for clients, never a substitute for the core rule. |
| Web / mobile | Show the problem before sending; on a 409 show the server's `balanceDue`. |

## 7. Persistence

No schema change, no migration.

## 8. Contracts between applications

`shared/contracts/registration.ts`: `apiErrorCodeSchema` gains `"PAYMENT_EXCEEDS_BALANCE"`.

`shared/contracts/orders.ts`:
- `orderApiErrorSchema.code` gains `"PAYMENT_EXCEEDS_BALANCE"`; the object gains `balanceDue: moneySchema.optional()` (sent only with that code).
- `orderAggregateSummarySchema` gains `balanceDue: moneySchema` (required; built from `toOrderAggregateJson` in `toOrderAggregateListJson`).
- `orderAggregateSchema` gains `checkoutLink: z.enum(["available", "subdomain_required"]).optional()`; documented as «only sent by `GET /api/orders/:id/aggregate`».

| Route | Code | Status | Body extra |
| --- | --- | --- | --- |
| `POST /api/orders/:id/payments` | `PAYMENT_EXCEEDS_BALANCE` | 409 | `balanceDue` |
| `POST /api/orders` (complete order with payments) | `PAYMENT_EXCEEDS_BALANCE` | 409 | `balanceDue` (balance seen by the payment that failed) |

Mobile adds the code to the `payment` and `create` entries of `httpErrorSchema` in `apps/mobile/src/features/orders/infrastructure/order-api.ts`. There is no production yet, so no versioning (memory «No customers/prod data yet»).

## 9. Events and cross-feature integration

None. `payment_confirmed` is not published when the rule rejects (the transaction returns before persisting).

## 10. Mobile

| File | Change |
| --- | --- |
| `features/orders/infrastructure/order-api.ts` | Accept `PAYMENT_EXCEEDS_BALANCE` (with `balanceDue`) for `payment` and `create`; parse the optional `checkoutLink`. |
| `features/orders/application/order-operations.ts` | Payment failure outcome carries `{ kind: "exceeds_balance"; balanceDue }`. |
| `features/orders/presentation/order-payment-parts.tsx` | Sheet uses `checkPaymentAmount` for «Otro monto»: below the field, a `FieldError` per problem (empty, not numeric, zero, «Supera el saldo pendiente de S/ 40.00»), button disabled while there is a problem and `accessibilityHint` with the same text. Scrim: `accessible={false}`, `importantForAccessibility="no"` (touch still closes); the header button is the only accessible close. `PaymentBadge` uses `paymentProgress`: partial reads «Pago parcial · falta S/ 35.00». `paymentBadgeStatus` is removed. |
| `features/orders/presentation/order-payment-card.tsx` | Uses `paymentProgress` instead of `paymentBadgeStatus`. |
| `features/orders/presentation/order-detail-screen.tsx` | Void asks `showConfirmation({ title: «¿Anular el pago de S/ 20.00?», description: «Pedido #1006 · <cliente>. El monto vuelve al saldo pendiente.», confirmLabel: «Anular pago», cancelLabel: «Mantener pago», destructive: true })`. A 409 over balance shows its message with the server balance and reloads the order. `checkoutAvailability` state taken from every aggregate load that carries `checkoutLink`; the link effect calls `enableOrderCheckout` only when it is `"available"`, sets `subdomain_required` without a request when it says so, and calls as today when unknown. With `subdomain_required`, `checkoutState` («Pendiente de confirmación») is hidden. When `notice?.id === order.id` and the total did not change, a polite status «Venta guardada.» shows at the top and is announced once. |
| `features/orders/presentation/order-history-screen.tsx` | Payment text from `paymentProgress`: «Pagado», «Pago parcial · falta S/ 35.00», «Pago pendiente». |
| `features/orders/presentation/delivery-fields.tsx` | When the quotation offers exactly one rate for the method and none is chosen, it is selected (with its single agency, as today). |
| `features/orders/domain/order-draft.ts` and the new-sale review | Each draft payment is checked with `checkPaymentAmount` against the balance left by the previous rows; the save button explains the problem. |
| `features/orders/presentation/translations.ts` | New keys (es, en, pt) appended: over-balance, empty, not numeric, zero, void confirmation, partial label, list partial, «Venta guardada.», new link copy «Para compartir este pedido, elige primero el link de tu tienda en Apariencia de la tienda.». |
| `components/app-tabs.web.tsx` | `innerContainer` gets `flexShrink: 1, minWidth: 0` so the row wraps inside 390px; the brand keeps its width. |

No local SQLite change. The pending-order sync is unchanged: the draft check prevents queuing a sale whose payments exceed the total; a server rejection follows the existing failure path.

## 11. Transactions and concurrency

1. `paymentTransaction(companyId)` opens the company-scoped transaction (unchanged).
2. `findOrderForUpdate` takes `FOR UPDATE` on the order row.
3. The state machine computes the balance from the locked aggregate and applies the rule.
4. Save payment, completion, `payment_confirmed` in-transaction event, commit.

Two payments on the same order at once: the second waits on the lock, reads the first, and gets `PAYMENT_EXCEEDS_BALANCE` with the remaining balance if it no longer fits. A retry of the same `paymentId` after a lost answer returns the stored order (replay check before the rule). A payment racing an item edit is ordered by the same row lock.

## 12. Code organization

| File | Change |
| --- | --- |
| `apps/core/src/features/orders/domain/order-state-machine.ts` | New error member; rule in `registerPayment`. |
| `apps/core/src/features/orders/presentation/api-routes.ts` | `operationError` maps the code to 409 with `balanceDue`; `GET /:id/aggregate` adds `checkoutLink`. |
| `apps/core/src/features/orders/composition.ts` | `registerPayment` wrapper logs the rejection (13). |
| `apps/core/src/features/orders/presentation/order-json.ts` | Summary includes `balanceDue`. |
| `shared/contracts/registration.ts`, `shared/contracts/orders.ts`, `shared/orders-payment.ts` | Section 6 and 8. |
| `apps/core/app/routes/order-detail.tsx` | Payment action returns `{ error: "PAYMENT_EXCEEDS_BALANCE", balanceDue }`. |
| `apps/core/app/routes/order-new.tsx` | Maps the code to «Un pago supera el saldo pendiente de S/ X.». |
| `apps/core/app/routes/order-list.tsx` | Drops its own `balanceDue` computation; renders `OrderStatusText`. |
| `apps/core/src/features/orders/presentation/order-status-labels.tsx` | Labels from `paymentProgress` («Pagada», «Pago parcial · falta X», «Pago pendiente»); `OrderStatusIndicators` replaced by `OrderStatusText` (icon + visible text per state). |
| `apps/core/src/features/orders/presentation/order-view-saved.tsx` | Passes the order's real `balanceDue`. |
| `apps/core/src/features/orders/presentation/payment-fields.tsx`, `payment-decision-form.tsx`, `order-payments-panel.tsx` | `checkPaymentAmount` against the balance (detail) or the balance left by earlier rows (new sale); inline error and disabled submit; void opens `VoidPaymentDialog` (amount and order number; «Anular pago» / «Mantener pago»); `paymentErrorKey` handles the new code with the balance. |
| `apps/core/src/features/orders/presentation/product-picker-keyboard.ts` | Enter without highlight acts on row 0 as if highlighted. |
| `apps/core/src/features/orders/presentation/rated-delivery-form.tsx` | Single rate for the method is selected when none is; passes `invalid` to the district select. |
| `apps/core/app/components/peru-district-select.tsx` | `invalid` input marks the first empty level (Departamento, Provincia, Distrito) with `aria-invalid` and the destructive border. |
| `apps/core/src/features/orders/presentation/order-delivery-card.tsx` | Recipient phone uses `PhoneField` like the customer. |
| `apps/core/app/components/order-link-card.tsx` | With `subdomain_required`, no confirmation-state line; the new one-sentence copy above the existing button. |
| `apps/core/app/locales.ts` | New keys appended (es, pt). |

Existing rule 5.7 debt: `PeruDistrictSelect` is a Peru component inside the general order form. This task only adds `invalid`; decoupling is out of scope.

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `payment_exceeds_balance` | info | `orders/composition.ts` `registerPayment` wrapper | `["event", "paymentId", "source", "userId", "errorCode"]` |
| `enable_checkout` request outcome | unchanged | `composition.ts:788-796` | unchanged; fewer `unavailable` outcomes from mobile is the expected effect |

Never logged: amounts, balances, customer data.

## 14. Tests

### Core unit (Vitest)
- `order-state-machine.test.ts`: `test("rejects a payment above the pending balance with the balance in the error")`, `test("accepts a payment equal to the pending balance")`, `test("ignores reported, rejected and voided payments when computing the balance")`, `test("returns the order unchanged for a replay of a payment that already filled the balance")`, `test("rejects any payment on an order that is already paid")`.
- `register-payment.test.ts`: `test("rejects S/ 999 on a S/ 60 order and saves nothing")`, `test("rejects approving a buyer report for more than the balance and keeps the report")`.
- `create-complete-order.test.ts`: `test("refuses a new sale whose initial payments exceed the total and creates nothing")`.
- `register-immediate-sale.test.ts`: `test("an immediate sale still pays exactly its total")`.
- `api-routes.test.ts`: `test("answers 409 PAYMENT_EXCEEDS_BALANCE with the pending balance")`.
- `order-json.test.ts` / `order-list-json.test.ts`: `test("list summary carries the balance due")`.
- `product-picker-keyboard.test.ts`: `test("Enter without a highlight adds the first result")`, `test("Enter without a highlight on a product with options highlights its first option")`.
- `order-status-labels.test.tsx`: `test("a partially paid order reads «Pago parcial · falta S/ 35.00»")`, `test("an order with no payment reads «Pago pendiente»")`.
- `order-payments-panel.test.tsx`: `test("voiding a payment asks for confirmation naming the amount and order")`, `test("cancelling the void confirmation leaves the payment confirmed")`, `test("the amount above the balance shows the balance and disables saving")`.
- `order-delivery-card.test.tsx`: `test("the recipient phone shows the same country and number format as the customer")`, `test("a failed save marks an empty Departamento as invalid")`.
- `rated-delivery-form` (in `order-view.test.tsx`): `test("a single rate for the district is selected without a click")`.
- `order-detail.view.test.tsx`: `test("without a store link the card says what is missing and where in one sentence")`, `test("the detail badge reads «Pago parcial · falta S/ 35.00»")`.
- `order-list.test.ts`: `test("the list shows payment and delivery as text and the balance of a partial payment")`.
- Shared (`shared/orders-payment.spec.mjs`): `test("checkPaymentAmount reports empty, not numeric, zero and over balance")`, `test("paymentProgress tells unpaid, partial and paid")`.

### Core integration
- `api-routes.integration.test.ts`: `test("two payments at once on one order: the second is rejected with the remaining balance")`, `test("GET aggregate tells whether the store has a checkout link")`.

### Mobile (Jest + RNTL)
- `order-detail-screen.test.tsx`: `test("voiding a payment asks for confirmation and cancelling keeps it")`, `test("does not request the checkout link when the order says the store has none")`, `test("requests the checkout link when the store has one")`, `test("shows «Venta guardada.» after a new sale opens its detail")`, `test("an over-balance rejection shows the pending balance")`.
- `order-payment-parts` (in `order-detail-screen.test.tsx`): `test("the disabled register button explains empty, non-numeric, zero and over-balance amounts")`, `test("the register sheet exposes one close control to screen readers")`.
- `order-history-screen.test.tsx`: `test("a partially paid order reads «Pago parcial · falta S/ 35.00» in the list")`.
- `order-delivery-screen.test.tsx`: `test("a single rate for the district is selected")`.
- `order-draft.test.ts`: `test("a draft whose payments exceed the total is invalid")`.
- `order-api.test.ts`: `test("parses PAYMENT_EXCEEDS_BALANCE with its balance")`.

### Web E2E
None new: the happy paths do not change.

### Pending manual checks
- Expo web at 390px: «Yoyos» and «Configuración» fully visible (capture in the PR).
- Expo web: open a detail five times on a store without a link; the console shows no 409.
- Web at 1280px and 390px: list rows show the text states (capture in the PR).

## 15. Limits and checks during implementation

- Out of scope (task): payment method, reconciliation, receipts, payment reports, «Marcar enviado con pago parcial», advanced filters, pagination, agency/pickup, list or detail redesign.
- Verify that `compare` from `shared/money` orders by cents for amounts like 0.1 + 0.2 (the rule must not reject a payment equal to the balance).
- Verify in Expo web that `importantForAccessibility="no"` removes the scrim from the accessibility tree (on web it maps to `aria-hidden`); if not, add `aria-hidden` through the web prop.
- The web new-sale total is an estimate until saved; if the server total drops below the payments, the save returns the new error with the balance and the form shows it. Not designed further.

## 16. Implementation plan

### Order and parallelism

```text
Wave 1:  T0  core rule + shared contract + shared helpers + aggregate checkoutLink + docs
Wave 2:  T1 web   ∥   T2 mobile        (both depend only on T0; files do not overlap)
Wave 3:  Final verification
```

### T0. Payment rule, contract and shared helpers

**Scope:** sections 5.1, 5.2, 6, 8, 11, 13; files: `order-state-machine.ts`, `api-routes.ts`, `composition.ts` (log), `order-json.ts`, `shared/contracts/registration.ts`, `shared/contracts/orders.ts`, `shared/orders-payment.ts`, core tests of those files, `docs/orders.md` (payment rule and error).
**Out of scope:** any `apps/core/app/**` file, any web component, any mobile file.
**Acceptance criteria:**
1. `POST /api/orders/:id/payments` with S/ 999 on a S/ 60 order answers 409 `{ code: "PAYMENT_EXCEEDS_BALANCE", balanceDue: { amount: 60, currency: "PEN" } }` and no payment row is created.
2. S/ 60 on the same order is accepted; a replay of it with the same `paymentId` returns 200.
3. Two concurrent S/ 40 payments on a S/ 60 order: one succeeds, the other gets 409 with balance S/ 20.
4. `GET /api/orders/:id/aggregate` returns `checkoutLink: "subdomain_required"` for a company without subdomain and `"available"` with one.
5. The list response carries `balanceDue` for each item.
**Tests:** core unit and integration titles of section 14 for the state machine, use cases, routes, JSON and shared helpers.
**Depends on:** nothing.

### T1. Web fixes (findings 1, 2, 3, 4, 5, 6, 7, 8, 9 on web)

**Scope:** `apps/core/app/**` and `apps/core/src/features/orders/presentation/**` except `api-routes.ts` and `order-json.ts`; `apps/core/app/locales.ts` (append only); `docs/order-view.md`.
**Out of scope:** core domain/application, shared, mobile.
**Acceptance criteria:**
1. On a S/ 60 order, typing 999 in «Registrar pago» shows «Supera el saldo pendiente de S/ 60.00» and disables saving; if the server still rejects, the dialog shows the server balance.
2. «Anular pago» opens a dialog naming «S/ 20.00» and «#1001»; «Mantener pago» leaves the payment confirmed and the order state unchanged.
3. In «Agregar producto», typing «Polo» and pressing Enter adds the first result.
4. The list row of #1001 (S/ 20 of S/ 55) reads «Pago parcial · falta S/ 35.00» and «Entrega pendiente» as text; the detail badge reads the same.
5. With one rate for the district, saving does not return «Selecciona una tarifa».
6. Recipient and customer phone show the same «PE +51 / 987654321» format.
7. Saving with Departamento empty marks it red like Dirección, Nombre and Teléfono.
8. Without a store link the card reads one sentence that says what to do and where, with the existing button.
**Tests:** web unit titles of section 14.
**Depends on:** T0.

### T2. Mobile fixes (findings 1, 2, 6, 9 on mobile and 10-15)

**Scope:** `apps/mobile/**` (section 10).
**Out of scope:** core and shared files.
**Acceptance criteria:**
1. «Otro monto» 999 on a S/ 60 order: inline «Supera el saldo pendiente de S/ 60.00», button disabled; 0 and «abc» each show their reason.
2. «Anular pago» asks for a destructive confirmation naming the amount and order; cancelling keeps the payment.
3. Opening a detail five times on a store without a link sends no `POST checkout-link`; with a link the link loads as today.
4. The list row of a S/ 30 of S/ 90 order reads «Pago parcial · falta S/ 60.00»; the detail badge reads the same.
5. The register sheet exposes one «Cerrar» to screen readers.
6. After «Guardar pedido» the detail shows «Venta guardada.».
7. At 390px on Expo web the tab bar shows «Yoyos» and «Configuración» in full.
8. A single rate is preselected in the delivery fields; the link copy matches web.
**Tests:** mobile titles of section 14.
**Depends on:** T0.

### Final verification

Walk the review journeys of both reports on web (1280px, 390px) and Expo web (390px), check every criterion of section 18, and run `pnpm --dir apps/core test:unit`, `pnpm --dir apps/core typecheck`, `pnpm --dir apps/mobile test`, `pnpm --dir apps/mobile typecheck`, plus core integration for the payment routes. Captures for findings 4, 9, 10 and 15 go in the PR. Note in the Todoist task what stayed out.

## 17. Open items and questions

```
Questions (answer with the option number):

1. Approving a buyer's transfer report when the buyer paid more than the balance.
   (1) Same rule: the seller can approve at most the balance or reject the report. Recommended: it is what «todas las superficies» says and keeps one rule; the extra money is settled outside Yoyos.
   (2) Exempt report approvals from the rule: the real amount received is recorded and «Exceso recibido» shows. One more branch in the state machine and a second message on both clients.

Decided unless objected:
- The rule lives in orderStateMachine.registerPayment and covers manual payments, report approvals, new sales with payments and immediate sales.
- Pending balance = total − confirmed payments; reported, rejected and voided payments do not count; a payment equal to the balance is accepted.
- New code PAYMENT_EXCEEDS_BALANCE, HTTP 409, body carries balanceDue; no existing code changes.
- Concurrency relies on the existing FOR UPDATE on the order row; a replay of the same paymentId is never rejected.
- «Exceso recibido» stays for edits that lower the total.
- checkPaymentAmount and paymentProgress live in shared/orders-payment.ts and replace isValidPaymentAmount and paymentBadgeStatus.
- The list summary contract gains balanceDue.
- GET /api/orders/:id/aggregate adds optional checkoutLink ("available" | "subdomain_required"); mobile calls POST checkout-link only when "available" or unknown.
- Void confirmation text: «¿Anular el pago de S/ 20.00?» + «Pedido #1006 · <cliente>. El monto vuelve al saldo pendiente.», buttons «Anular pago» / «Mantener pago», on web and mobile.
- Web list replaces the icons-only disclosure with icon + text and shows «Pago parcial · falta X».
- Single-rate preselection also applies on mobile (same defect there).
- Enter without a highlight acts on the first result.
- Link copy on web and mobile: «Para compartir este pedido, elige primero el link de tu tienda en Apariencia de la tienda.», without the «Pendiente de confirmación» line while there is no link.
- Three tasks: T0 first, then T1 and T2 in parallel.
```

## 18. Criterios de aceptación de producto

| # | Scope item | Verifiable criterion | Surface | Use case / screen change | Test title | Task |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Payment above the balance is rejected with how much is pending; button disabled once it exceeds | S/ 999 on a S/ 60 order is rejected on web, mobile and the API with «S/ 60.00» in the message; no payment is saved; the button is disabled as soon as the amount exceeds the balance | API, web, mobile | `orderStateMachine.registerPayment`; web payment form; mobile register sheet | `rejects S/ 999 on a S/ 60 order and saves nothing`; `the amount above the balance shows the balance and disables saving`; `the disabled register button explains empty, non-numeric, zero and over-balance amounts` | T0, T1, T2 |
| 2 | «Anular pago» confirms with amount and customer or order number; cancel does nothing | Tapping «Anular pago» opens a confirmation naming the amount and the order; «Mantener pago» leaves the payment confirmed and the order state unchanged | web, mobile | `VoidPaymentDialog`; `showConfirmation` in the mobile detail | `voiding a payment asks for confirmation naming the amount and order`; `cancelling the void confirmation leaves the payment confirmed`; `voiding a payment asks for confirmation and cancelling keeps it` | T1, T2 |
| 3 | Enter in the product picker adds the highlighted (or only) result | Typing «Polo» and pressing Enter adds it without ↓ | web | `pickerKey` | `Enter without a highlight adds the first result` | T1 |
| 4 | Order list says payment and delivery state as text and shows the balance of a partial payment | Row of S/ 20 of S/ 55 reads «Pago parcial · falta S/ 35.00» and «Entrega pendiente» without opening anything | web | `OrderStatusText` in `order-list.tsx` | `the list shows payment and delivery as text and the balance of a partial payment` | T1 |
| 5 | Same payment state in list, card and detail | S/ 20 of S/ 55 reads «Pago parcial · falta S/ 35.00» in the web list, the web detail badge and card, the mobile list and the mobile detail | web, mobile | `paymentProgress`; `order-view-saved.tsx`; `order-history-screen.tsx`; `PaymentBadge` | `a partially paid order reads «Pago parcial · falta S/ 35.00»`; `the detail badge reads «Pago parcial · falta S/ 35.00»`; `a partially paid order reads «Pago parcial · falta S/ 35.00» in the list` | T0, T1, T2 |
| 6 | A single rate for the district is selected | With one rate, saving never returns «Selecciona una tarifa» | web, mobile | `rated-delivery-form.tsx`; `delivery-fields.tsx` | `a single rate for the district is selected without a click`; `a single rate for the district is selected` | T1, T2 |
| 7 | Same phone format for customer and recipient | Both read «PE +51 · 987654321» | web | `order-delivery-card.tsx` uses `PhoneField` | `the recipient phone shows the same country and number format as the customer` | T1 |
| 8 | All required fields marked on a failed save, including Departamento | Saving with Departamento empty shows it red with `aria-invalid` like Dirección | web | `PeruDistrictSelect` `invalid` | `a failed save marks an empty Departamento as invalid` | T1 |
| 9 | Link copy says what is missing and where, in one sentence | Without a store link the card reads «Para compartir este pedido, elige primero el link de tu tienda en Apariencia de la tienda.» and no «Pendiente de confirmación» | web, mobile | `order-link-card.tsx`; mobile detail link card | `without a store link the card says what is missing and where in one sentence` | T1, T2 |
| 10 | Tabs fit at 390px | «Yoyos» and «Configuración» fully visible at 390px | mobile (Expo web) | `app-tabs.web.tsx` | PR capture (visual) | T2 |
| 11 | No checkout-link call when the store has no link; still loaded when it has one | Five openings of a detail without a store link: zero `POST checkout-link`, zero 409; with a link the URL loads | API, mobile | `GET /aggregate` `checkoutLink`; mobile link effect | `GET aggregate tells whether the store has a checkout link`; `does not request the checkout link when the order says the store has none`; `requests the checkout link when the store has one` | T0, T2 |
| 12 | Disabled register button explains why | Empty, «abc», 0 and above balance each show their own message | mobile (and web) | `checkPaymentAmount` in the sheet and the web form | `checkPaymentAmount reports empty, not numeric, zero and over balance`; `the disabled register button explains empty, non-numeric, zero and over-balance amounts` | T0, T2, T1 |
| 13 | One accessible close in «Registrar pago» | A screen reader finds one «Cerrar» | mobile | scrim hidden from accessibility | `the register sheet exposes one close control to screen readers` | T2 |
| 14 | Saving a new order confirms visibly, then navigates to the detail | After «Guardar pedido» the detail shows «Venta guardada.» | mobile | result notice in the detail | `shows «Venta guardada.» after a new sale opens its detail` | T2 |
