# Order and payment UX review fixes: technical design

**Status:** design closed, pending implementation (question 1 decided by the architecture review gate, section 17). Based on Todoist task `6j3CMGXwFj5GrQfV` (closed product definition, founder decisions of 2026-11-18) and the review in `docs/drafts/ux-review-2026-11-17/` (`web-pedidos/REPORT.md`, `movil-pedidos/REPORT.md`). There is no product draft. Base: `jorgeluis594/pedidos-corregir-los-hallazgos-de-la-rev` at `7b23f62c` (equal to `origin/main`).

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

GET /api/orders/:id/aggregate ─▶ { ...order, checkoutLink?: { kind: "ready"; url } | { kind: "subdomain_required" } }
        (company subdomain read in parallel with the aggregate)
        mobile: the link card reads it from the aggregate; POST /checkout-link only when the field is missing (unknown)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Scope | All 15 findings, web and mobile, in this task (founder decision 3). Every finding still occurs in `origin/main` (section 3.1); none is marked «already resolved in main». |
| Where the payment rule lives | `orderStateMachine.registerPayment` in `apps/core/src/features/orders/domain/order-state-machine.ts`. Every confirmation path goes through it: `registerPayment` (manual payment, buyer report approval, web action, mobile API, `createCompleteOrder`) and `registerImmediateSale`. |
| Pending balance | `total − sum(confirmed payments)`, the existing `paymentSummary.balanceDue`. Reported payments have no amount and do not count, nor do rejected or voided ones. A payment equal to the balance is accepted; one cent above is rejected. |
| Approving a buyer report | The same rule applies: the seller types the received amount and it cannot exceed the balance (question 1, decided by the review gate). The approval form checks the amount before sending on both clients: web `payment-decision-form.tsx`, mobile `PaymentEditor` in the «Revisar pago» modal. |
| Report pending on an order with zero balance | Approval stays disabled with «El pedido ya está pagado: no queda saldo por aprobar. Si el comprobante no corresponde, recházalo.», and **Rechazar** stays available. No new action. |
| Replays | A replay of an already confirmed `paymentId` with the same data keeps returning the existing order before the rule runs, so a retry is never rejected for exceeding the balance it already filled. |
| Overpayment that comes from an edit | Unchanged. Lowering the total by editing items can still leave `overpaidAmount > 0` and «Exceso recibido» stays. The rule only blocks registering money. |
| Error | New `OrderDomainError` member `{ code: "PAYMENT_EXCEEDS_BALANCE"; message; balanceDue: Money }`. HTTP 409 (conflict with the order's current state, like `TOTAL_CHANGED`), body `{ code, error, balanceDue }`. Additive: no existing code changes. |
| Concurrency | The existing `findOrderForUpdate` (`SELECT … FOR UPDATE` on the order row) serializes two payments on the same order; the second one sees the first and is rejected with the fresh balance. No new lock. |
| Shared client rules | `shared/orders-payment.ts` gains `checkPaymentAmount` (empty, not numeric, zero, exceeds balance) and `paymentProgress` (unpaid, partial with balance, paid). Web and mobile use them; neither keeps its own copy. |
| List contract | `orderAggregateSummarySchema` gains `balanceDue`. The mobile list needs it to tell partial from unpaid; the web loader stops computing it separately. |
| Store link known from the order | `GET /api/orders/:id/aggregate` returns the link itself: `checkoutLink: { kind: "ready"; url } \| { kind: "subdomain_required" }`, optional in `orderAggregateSchema`, sent only by that route, and omitted for a cancelled order, an order without `checkoutEnabledAt` or a failed subdomain read. A missing field means «unknown», never «no link». Mobile's link card reads it from every aggregate load (the screen already reloads the aggregate on every focus), so returning from «Apariencia de la tienda» after choosing a link shows it with no extra request and no ordering between two requests. Mobile calls `POST /checkout-link` only when the field is missing. Chosen over a status enum plus the POST because it removes one request per open and the race between the focus reload and the link request; the URL is a read-only fact (`enableOrderCheckout` writes nothing), so the GET can carry it. No new endpoint. |
| Cost of the link on the aggregate | The company subdomain read (one primary-key lookup, `composition.ts:535-539`) starts in parallel with `orders.getAggregate`, and the URL is built with the existing `checkoutUrlFor` without another query. Every caller of `GET /aggregate` (cancellation check, delivery screen, refreshes, dispatch print review once per order) pays that lookup. Accepted on purpose: it is a primary-key read; no cache and no opt-in flag. |
| Paid word | «Pagado» everywhere (web list, web detail badge, web «Pagos» card, mobile list, mobile badge). The web key `orderView.labels.paid` changes from «Pagada» to «Pagado» (pt «Pago»). |
| Enter in the product picker | Enter adds the highlighted result. With no highlight it adds the result only when there is exactly one; with several results and none highlighted it does nothing. |
| Recipient phone on web | Home delivery and agency use `PhoneField` like the customer, shown as country «PE +51» plus national number «987654321». Store pickup keeps its free-text phone, consistent with mobile (memory c495dcdc). |
| Void confirmation | Web: a `Dialog` like `UndoConfirmDialog`. Mobile: the existing `showConfirmation` with `destructive: true`. The text names the amount and the order number, plus the buyer's name when there is one; an order without buyer shows only the number (no dangling « · »). No new rule about which payments can be voided. |
| Web list | Payment and delivery state become visible text with a small icon, and the balance appears for a partial payment. The icons-only disclosure (`OrderStatusIndicators`) is removed. |
| Copy | New Spanish and Portuguese keys are appended next to their siblings in `apps/core/app/locales.ts` and `apps/mobile/src/features/orders/presentation/translations.ts`; no existing key is reordered (the sibling products task edits the same files). |
| Memory superseded | cc516669 (overpayment is only a notice, PR #241): registering money above the balance is now blocked. 7587256f (web list states as icons with a disclosure): the list now shows text and balance. 723aeb57 («excess is an amount»): it stays true only for edits that lower the total. a15763e0 (mobile loads the link with `POST checkout-link` when the screen opens, «Elige el link de tu tienda…» copy): mobile now reads the link from the aggregate and the copy changes on both clients. 299a6aa0 (E.164 phones, split helpers in `shared/phone.ts`) and da31218e (void rules) still apply as they are. |
| Docs | Updated in the same PR, each change owned by one task (section 16): T0 owns `docs/orders.md` payment rule, error, the `POST /:id/payments` line, line 137 («Approve and a manual payment always record the payment», plus «A report can still be approved with a zero balance» in the manual-payment paragraph) and line 223 («Exceso recibido» only after an edit lowers the total), and `docs/checkout.md:30` (mobile reads the link from the aggregate, POST only as fallback). T1 owns `docs/orders.md` web «Pagos» card (void confirmation, amount check, zero-balance approval) and list text, `docs/order-view.md` (list, badge, «Pagado», link copy at 138) and `docs/checkout.md:28` (link copy). T2 owns `docs/orders.md` «Mobile» paragraphs (153-163: void confirmation, amount reasons, one close control, «Venta guardada.», link copy). |

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
| Mobile detail | `presentation/order-detail-screen.tsx` | Void at 598, checkout link effect at 326-337 (re-run on every focus through `linkRefresh`), result notice only when the total changed at 446-448/526. |
| Mobile report approval | `order-detail-screen.tsx:809-818` (`PaymentEditor` in the «Revisar pago» modal) | Prefills the balance; «Confirmar pago» enabled for any amount. |
| Mobile error status table | `apps/mobile/src/features/orders/infrastructure/order-api.ts:30` | `statusByCode: Record<OrderApiError["code"], number>` must list every code of the shared enum. |
| Web new-sale error | `apps/core/app/routes/order-new.tsx:56-62`, `orderActionErrorSchema` (`shared/contracts/orders.ts:223`) | Strict object; only `currentPrice` and `variantId` as extras. |
| Mobile list | `presentation/order-history-screen.tsx:251` | «Pagado» or «Pago pendiente» from `paymentStatus`. |
| Mobile badge | `order-payment-parts.tsx:24,35-40` | `paymentBadgeStatus` knows partial; shows «Pago parcial» without the balance. |

No file touched by the findings changed after the review (`git log --since=2026-11-15` on them is empty).

### 3.1 Findings checked against `origin/main`

| # | Finding | Still applies | Evidence |
| --- | --- | --- | --- |
| 1 | Payment above the total is saved | Yes | `order-state-machine.ts:343-360` has no balance check; mobile sheet enables any positive amount (`order-payment-parts.tsx:127,173`) and so does the mobile report approval (`order-detail-screen.tsx:817`); web checks only positivity (`payment-fields.tsx:13-14`). |
| 2 | «Anular pago» without confirmation | Yes | Mobile `order-detail-screen.tsx:598` calls `voidPayment` directly; web `order-payments-panel.tsx:256-257` submits the form directly. |
| 3 | Enter in the product picker does nothing | Yes | `product-picker-keyboard.ts:11`: Enter with no highlight keeps the state. |
| 4 | Web list shows states only as icons | Yes | `order-list.tsx:98` renders `OrderStatusIndicators` (`order-status-labels.tsx:51-61`, text hidden in `<details>`). |
| 5 | Badge «Pago pendiente» with a partial payment | Yes | `order-view-saved.tsx:17` passes `balanceDue: 0`; `order-status-labels.tsx:32-34` has no partial label; the paid word is «Pagada» there (`locales.ts:393`) and «Pagado» on the card (`locales.ts:420`) and mobile. |
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
5. Mobile cannot get the store link from the order it already loads, so it calls `POST checkout-link` on every visit (8, 10).
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

`GET /api/orders/:id/aggregate` starts `orders.getAggregate(id, access)` and `orders.checkoutUrl(companyId, id)` together (`Promise.all`; the URL needs only the company and the id). Then:
1. aggregate failure → same error as today;
2. order cancelled or without `checkoutEnabledAt` → no `checkoutLink` (same cases where `POST checkout-link` refuses);
3. `checkoutUrl` success → `checkoutLink: { kind: "ready", url }`;
4. `SUBDOMAIN_REQUIRED` → `checkoutLink: { kind: "subdomain_required" }`;
5. any other failure → no `checkoutLink` (unknown; the client falls back to the POST).

No new use case: the store link belongs to the presentation of the order, as the web loader already does (`order-detail.tsx:103-105`). `POST /checkout-link` stays unchanged for the fallback and for older builds.

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
- `orderActionErrorSchema` (web action errors) gains `balanceDue: moneySchema.optional()`, so the «Nueva venta» action returns the balance of the payment that failed as data, not inside the `error` string.
- `orderAggregateSchema` gains `checkoutLink: z.discriminatedUnion("kind", [z.strictObject({ kind: z.literal("ready"), url: z.url() }), z.strictObject({ kind: z.literal("subdomain_required") })]).optional()`, with the comment «Only sent by GET /api/orders/:id/aggregate. Missing means unknown, never "no link": the client falls back to POST /checkout-link.».

| Route | Code | Status | Body extra |
| --- | --- | --- | --- |
| `POST /api/orders/:id/payments` | `PAYMENT_EXCEEDS_BALANCE` | 409 | `balanceDue` |
| `POST /api/orders` (complete order with payments) | `PAYMENT_EXCEEDS_BALANCE` | 409 | `balanceDue` (balance seen by the payment that failed) |

Mobile adds the code to `statusByCode` (409, done in T0 so mobile typecheck stays green) and to the `payment` and `create` entries of `httpErrorSchema` (T2) in `apps/mobile/src/features/orders/infrastructure/order-api.ts`. There is no production yet, so no versioning (memory «No customers/prod data yet»).

## 9. Events and cross-feature integration

None. `payment_confirmed` is not published when the rule rejects (the transaction returns before persisting).

## 10. Mobile

| File | Change |
| --- | --- |
| `features/orders/infrastructure/order-api.ts` | Accept `PAYMENT_EXCEEDS_BALANCE` (with `balanceDue`) for `payment` and `create`; parse the optional `checkoutLink`. |
| `features/orders/application/order-operations.ts` | Payment failure outcome carries `{ kind: "exceeds_balance"; balanceDue }`. |
| `features/orders/presentation/order-payment-parts.tsx` | Sheet uses `checkPaymentAmount` for «Otro monto»: below the field, a `FieldError` per problem (empty, not numeric, zero, «Supera el saldo pendiente de S/ 40.00»), button disabled while there is a problem and `accessibilityHint` with the same text. Scrim: `accessible={false}`, `importantForAccessibility="no"` (touch still closes); the header button is the only accessible close. `PaymentBadge` uses `paymentProgress`: partial reads «Pago parcial · falta S/ 35.00». `paymentBadgeStatus` is removed. |
| `features/orders/presentation/order-payment-card.tsx` | Uses `paymentProgress` instead of `paymentBadgeStatus`. |
| `features/orders/presentation/order-detail-screen.tsx` | Void asks `showConfirmation({ title: «¿Anular el pago de S/ 20.00?», description: «Pedido #1006 · Ana Pérez. El monto vuelve al saldo pendiente.» (without buyer: «Pedido #1006. El monto vuelve al saldo pendiente.»), confirmLabel: «Anular pago», cancelLabel: «Mantener pago», destructive: true })`. A 409 over balance shows its message with the server balance and reloads the order. `PaymentEditor` («Revisar pago» modal) uses `checkPaymentAmount` against the balance: a `FieldError` per problem and «Confirmar pago» disabled while there is one; with a zero balance it shows «El pedido ya está pagado: no queda saldo por aprobar. Si el comprobante no corresponde, recházalo.» and **Rechazar** stays enabled. Link card: the link state comes from `checkoutLink` of every aggregate load that carries it (`ready` → URL and actions; `subdomain_required` → the new copy and **Ir a Apariencia de la tienda**); write responses without the field keep the last known value. Since the focus reload already fetches the aggregate, returning from Apariencia after choosing a link shows it with no other request. Only while no load has carried the field does the existing effect call `enableOrderCheckout`. With `subdomain_required`, `checkoutState` («Pendiente de confirmación») is hidden. When `notice?.id === order.id` and the total did not change, a polite status «Venta guardada.» shows at the top and is announced once. |
| `features/orders/presentation/order-history-screen.tsx` | Payment text from `paymentProgress`: «Pagado», «Pago parcial · falta S/ 35.00», «Pago pendiente». |
| `features/orders/infrastructure/order-api.ts` fixtures and list fixtures | T0 adds the `statusByCode` entry and `balanceDue` to existing summary fixtures; T2 does the rest. |
| `features/orders/presentation/delivery-fields.tsx` | When the quotation offers exactly one rate for the method and none is chosen, it is selected (with its single agency, as today). |
| `features/orders/domain/order-draft.ts` and the new-sale review | Each draft payment is checked with `checkPaymentAmount` against the balance left by the previous rows; the save button explains the problem. |
| `features/orders/presentation/translations.ts` | New keys (es, en, pt) appended: over-balance, empty, not numeric, zero, zero-balance approval, void confirmation (with and without buyer), partial label, list partial, «Venta guardada.», new link copy «Para compartir este pedido, elige primero el link de tu tienda en Apariencia de la tienda.». |
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
| `apps/core/src/features/orders/presentation/api-routes.ts` | `operationError` maps the code to 409 with `balanceDue`; `GET /:id/aggregate` reads the aggregate and the checkout URL in parallel and adds `checkoutLink` (5.2). |
| `apps/core/src/features/orders/composition.ts` | One local `logPaymentExceedsBalance` used by the `registerPayment` wrapper (`composition.ts:854`) and by the `registerPayment` dependency handed to `createCompleteOrder` (`composition.ts:395`), so manual payments, report approvals and new sales log the rejection (13). |
| `apps/mobile/src/features/orders/infrastructure/order-api.ts` (T0, minimum) | `statusByCode` entry `PAYMENT_EXCEEDS_BALANCE: 409`. |
| Existing list-summary fixtures in core, web and mobile tests (T0, minimum) | Add `balanceDue` so the strict summary schema parses. |
| `apps/core/src/features/orders/presentation/order-json.ts` | Summary includes `balanceDue`. |
| `shared/contracts/registration.ts`, `shared/contracts/orders.ts`, `shared/orders-payment.ts` | Section 6 and 8. |
| `apps/core/app/routes/order-detail.tsx` | Payment action returns `{ error: "PAYMENT_EXCEEDS_BALANCE", balanceDue }`. |
| `apps/core/app/routes/order-new.tsx` | Returns `{ code: "PAYMENT_EXCEEDS_BALANCE", balanceDue, error }` through `orderActionErrorSchema` (T0 adds the field); the form renders «Un pago supera el saldo pendiente de S/ X.» from `balanceDue`. |
| `apps/core/app/routes/order-list.tsx` | Drops its own `balanceDue` computation; renders `OrderStatusText`. |
| `apps/core/src/features/orders/presentation/order-status-labels.tsx` | Labels from `paymentProgress` («Pagado», «Pago parcial · falta X», «Pago pendiente»); `OrderStatusIndicators` replaced by `OrderStatusText` (icon + visible text per state). |
| `apps/core/src/features/orders/presentation/order-view-saved.tsx` | Passes the order's real `balanceDue`. |
| `apps/core/src/features/orders/presentation/payment-fields.tsx`, `payment-decision-form.tsx`, `order-payments-panel.tsx` | `checkPaymentAmount` against the balance (detail, register and approve) or the balance left by earlier rows (new sale); one inline error per problem (empty, not numeric, zero, over balance) and disabled submit; approving with a zero balance shows the zero-balance line and keeps **Rechazar**; void opens `VoidPaymentDialog` (amount, order number and buyer name when present; «Anular pago» / «Mantener pago»); `paymentErrorKey` handles the new code with the balance. |
| `apps/core/src/features/orders/presentation/product-picker-keyboard.ts` | Enter without highlight acts on row 0 only when `rows.length === 1`; with several rows it keeps the state. |
| `apps/core/src/features/orders/presentation/rated-delivery-form.tsx` | Single rate for the method is selected when none is; passes `invalid` to the district select. |
| `apps/core/app/components/peru-district-select.tsx` | `invalid` input marks the first empty level (Departamento, Provincia, Distrito) with `aria-invalid` and the destructive border. |
| `apps/core/src/features/orders/presentation/order-delivery-card.tsx` | Recipient phone uses `PhoneField` like the customer for home delivery and agency; store pickup keeps its free-text input. |
| `apps/core/app/components/order-link-card.tsx` | With `subdomain_required`, no confirmation-state line; the new one-sentence copy above the existing button. |
| `apps/core/app/locales.ts` | New keys appended (es, pt). |

Existing rule 5.7 debt: `PeruDistrictSelect` is a Peru component inside the general order form. This task only adds `invalid`; decoupling is out of scope.

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `payment_exceeds_balance` | info | `orders/composition.ts`: the `registerPayment` wrapper (manual payment, report approval) and the `registerPayment` dependency of `createCompleteOrder` (new sale with payments) | `["event", "operation", "paymentId", "source", "userId", "errorCode"]`, `operation` = `"confirm"` or `"create_order"` |
| `enable_checkout` request outcome | unchanged | `composition.ts:788-796` | unchanged; mobile calls it only as fallback, so far fewer requests is the expected effect |

`registerImmediateSale` pays exactly the total and cannot hit the rule; it is intentionally not logged.

Never logged: amounts, balances, customer data.

## 14. Tests

### Core unit (Vitest)
- `order-state-machine.test.ts`: `test("rejects a payment above the pending balance with the balance in the error")`, `test("accepts a payment equal to the pending balance")`, `test("ignores reported, rejected and voided payments when computing the balance")`, `test("returns the order unchanged for a replay of a payment that already filled the balance")`, `test("rejects any payment on an order that is already paid")`.
- `register-payment.test.ts`: `test("rejects S/ 999 on a S/ 60 order and saves nothing")`, `test("rejects approving a buyer report for more than the balance and keeps the report")`.
- `create-complete-order.test.ts`: `test("refuses a new sale whose initial payments exceed the total and creates nothing")`.
- `register-immediate-sale.test.ts`: `test("an immediate sale still pays exactly its total")`.
- `api-routes.test.ts`: `test("answers 409 PAYMENT_EXCEEDS_BALANCE with the pending balance")`.
- `order-json.test.ts` / `order-list-json.test.ts`: `test("list summary carries the balance due")`.
- `product-picker-keyboard.test.ts`: `test("Enter adds the highlighted result")`, `test("Enter without a highlight adds the only result")`, `test("Enter without a highlight does nothing when there are several results")`, `test("Enter without a highlight on the only product with options highlights its first option")`.
- `order-status-labels.test.tsx`: `test("a partially paid order reads «Pago parcial · falta S/ 35.00»")`, `test("an order with no payment reads «Pago pendiente»")`, `test("a paid order reads «Pagado» in the list and the badge")`.
- `order-payments-panel.test.tsx`: `test("voiding a payment asks for confirmation naming the amount, order and buyer")`, `test("the void confirmation of an order without buyer names only the order")`, `test("cancelling the void confirmation leaves the payment confirmed")`, `test("the amount above the balance shows the balance and disables saving")`, `test("an empty, non-numeric or zero amount shows its own reason and disables saving")`.
- `payment-decision-form.test.tsx`: `test("approving a report above the balance shows the balance and disables approving")`, `test("a report on a paid order cannot be approved and can still be rejected")`.
- `order-new` action (`order-new-action.test.ts`): `test("a new sale whose payments exceed the total returns the balance in the action error")`.
- `order-delivery-card.test.tsx`: `test("the home or agency recipient phone shows «PE +51» and «987654321» like the customer")`, `test("the store pickup recipient phone stays free text")`, `test("a failed save marks an empty Departamento as invalid")`.
- `rated-delivery-form` (in `order-view.test.tsx`): `test("a single rate for the district is selected without a click")`.
- `order-detail.view.test.tsx`: `test("without a store link the card says what is missing and where in one sentence")`, `test("the detail badge reads «Pago parcial · falta S/ 35.00»")`.
- `order-list.test.ts`: `test("the list shows payment and delivery as text and the balance of a partial payment")`.
- Shared (`shared/orders-payment.spec.mjs`): `test("checkPaymentAmount reports empty, not numeric, zero and over balance")`, `test("paymentProgress tells unpaid, partial and paid")`.

### Core integration
- `api-routes.integration.test.ts` (real PostgreSQL, two concurrent requests; never a fake transaction, since only this proves the rule runs after the row lock): `test("two payments at once on one order: the second is rejected with the remaining balance")`. Also `test("GET aggregate returns the checkout URL when the store has a link")`, `test("GET aggregate says subdomain_required when the store has no link")`, `test("GET aggregate omits the link of a cancelled order")`.
- `composition` (in `api-routes.integration.test.ts`): `test("a rejected new sale logs payment_exceeds_balance without amounts")`.

### Mobile (Jest + RNTL)
- `order-detail-screen.test.tsx`: `test("voiding a payment asks for confirmation and cancelling keeps it")`, `test("the void confirmation of an order without buyer names only the order")`, `test("shows the link from the order without requesting checkout-link")`, `test("without a store link shows the one-sentence copy and no checkout-link request")`, `test("after the store chooses its link in Apariencia, returning to the order shows the link without reopening it")`, `test("requests checkout-link only when the order does not say whether there is a link")`, `test("shows «Venta guardada.» after a new sale opens its detail")`, `test("an over-balance rejection shows the pending balance")`, `test("approving a report above the balance shows the balance and disables «Confirmar pago»")`, `test("a report on a paid order cannot be approved and can still be rejected")`, `test("a paid order reads «Pagado» in the badge")`.
- `order-payment-parts` (in `order-detail-screen.test.tsx`): `test("the disabled register button explains empty, non-numeric, zero and over-balance amounts")`, `test("the register sheet exposes one close control to screen readers")`.
- `order-history-screen.test.tsx`: `test("a partially paid order reads «Pago parcial · falta S/ 35.00» in the list")`, `test("a paid order reads «Pagado» in the list")`.
- `order-delivery-screen.test.tsx`: `test("a single rate for the district is selected")`.
- `order-draft.test.ts`: `test("a draft whose payments exceed the total is invalid")`.
- `order-api.test.ts`: `test("parses PAYMENT_EXCEEDS_BALANCE with its balance")`.

### Web E2E
None new: the happy paths do not change.

### Pending manual checks
Run in the Orca browser (web and Expo web), so the session can be recorded.
- Expo web at 390px: «Yoyos» and «Configuración» fully visible (capture in the PR).
- Expo web: open a detail five times on a store without a link; the network panel shows no `POST checkout-link` and the console no 409; the card shows the new one-sentence copy (capture in the PR). Then choose a link in Apariencia, return, and the link shows.
- Web at 1280px and 390px: list rows show the text states, «Pagado» and «Pago parcial · falta X» (capture in the PR).
- Mobile: after «Guardar pedido» the detail shows «Venta guardada.» (capture in the PR).

## 15. Limits and checks during implementation

- Out of scope (task): payment method, reconciliation, receipts, payment reports, «Marcar enviado con pago parcial», advanced filters, pagination, agency/pickup, list or detail redesign.
- Verify that `compare` from `shared/money` orders by cents for amounts like 0.1 + 0.2 (the rule must not reject a payment equal to the balance).
- Verify in Expo web that `importantForAccessibility="no"` removes the scrim from the accessibility tree (on web it maps to `aria-hidden`); if not, add `aria-hidden` through the web prop.
- The web new-sale total is an estimate until saved; if the server total drops below the payments, the save returns the new error with the balance and the form shows it. Not designed further.
- Existing tests of payments, order detail and lists on both clients are updated, never deleted without a replacement (Todoist criterion 9).

## 16. Implementation plan

### Order and parallelism

```text
Wave 1:  T0  core rule + shared contracts/helpers + aggregate checkoutLink + minimum compile/fixture fixes + its docs
Wave 2:  T1 web   ∥   T2 mobile        (both depend only on T0; files do not overlap)
Wave 3:  Final verification
```

Every wave leaves the branch green: `scripts/ci.sh` runs mobile and web checks when `shared/` changes, so T0 includes the minimum edits the shared contract forces outside core.

### T0. Payment rule, contract and shared helpers

**Scope:** sections 5.1, 5.2, 6, 8, 11, 13; files: `order-state-machine.ts`, `api-routes.ts`, `composition.ts` (log in both wrappers), `order-json.ts`, `shared/contracts/registration.ts`, `shared/contracts/orders.ts` (error code, `balanceDue` on `orderApiErrorSchema`, `orderActionErrorSchema` and the summary, `checkoutLink`), `shared/orders-payment.ts`, core tests of those files. Minimum outside core, only to keep checks green: the `statusByCode` entry in `apps/mobile/src/features/orders/infrastructure/order-api.ts` and `balanceDue` in existing list-summary fixtures of core, web and mobile tests. Docs: `docs/orders.md` payment rule, error, line 137 and the zero-balance sentence of the manual-payment paragraph, line 223, and `docs/checkout.md:30`.
**Out of scope:** any other `apps/core/app/**` file, web components, any other mobile file or behavior.
**Acceptance criteria:**
1. `POST /api/orders/:id/payments` with S/ 999 on a S/ 60 order answers 409 `{ code: "PAYMENT_EXCEEDS_BALANCE", balanceDue: { amount: 60, currency: "PEN" } }` and no payment row is created.
2. S/ 60 on the same order is accepted; a replay of it with the same `paymentId` returns 200.
3. Two concurrent S/ 40 payments on a S/ 60 order, against real PostgreSQL: one succeeds, the other gets 409 with balance S/ 20.
4. `GET /api/orders/:id/aggregate` returns `checkoutLink: { kind: "ready", url }` for a company with subdomain, `{ kind: "subdomain_required" }` without one, and no field for a cancelled order.
5. The list response carries `balanceDue` for each item.
6. A new sale whose payments exceed the total is refused, nothing is created and `payment_exceeds_balance` is logged with `operation: "create_order"`.
7. `pnpm --dir apps/core typecheck`, `pnpm --dir apps/core test:unit`, `pnpm --dir apps/mobile typecheck` and `pnpm --dir apps/mobile test` are green.
**Tests:** core unit and integration titles of section 14 for the state machine, use cases, routes, JSON, composition log and shared helpers.
**Depends on:** nothing.

### T1. Web fixes (findings 1, 2, 3, 4, 5, 6, 7, 8, 9 on web)

**Scope:** `apps/core/app/**` and `apps/core/src/features/orders/presentation/**` except `api-routes.ts` and `order-json.ts`; `apps/core/app/locales.ts` (append; the only changed value is `orderView.labels.paid` → «Pagado»/«Pago»). Docs: `docs/orders.md` web «Pagos» card (void confirmation, amount reasons, zero-balance approval) and list text, `docs/order-view.md` (list, badge, «Pagado», link copy at 138), `docs/checkout.md:28`.
**Out of scope:** core domain/application, shared, mobile.
**Acceptance criteria:**
1. On a S/ 60 order, typing 999 in «Registrar pago» or in **Aprobar** shows «Supera el saldo pendiente de S/ 60.00» and disables saving; empty, «abc» and 0 each show their own reason; if the server still rejects, the dialog shows the server balance.
2. A report on a paid order shows the zero-balance line, **Aprobar** stays disabled and **Rechazar** works.
3. «Anular pago» opens a dialog naming «S/ 20.00», «#1001» and the buyer (only «#1001» without buyer); «Mantener pago» leaves the payment confirmed and the order state unchanged.
4. In «Agregar producto», typing a search with one result and pressing Enter adds it; with several results Enter adds only after ↓ highlights one.
5. The list row of #1001 (S/ 20 of S/ 55) reads «Pago parcial · falta S/ 35.00» and «Entrega pendiente» as text; the detail badge reads the same; a paid order reads «Pagado» in list, badge and card.
6. With one rate for the district, saving does not return «Selecciona una tarifa».
7. Home and agency recipient phone show «PE +51» and «987654321» like the customer; store pickup keeps free text.
8. Saving with Departamento empty marks it red like Dirección, Nombre and Teléfono.
9. Without a store link the card reads «Para compartir este pedido, elige primero el link de tu tienda en Apariencia de la tienda.» with the existing button and no «Pendiente de confirmación».
10. A «Nueva venta» whose payments exceed the total shows «Un pago supera el saldo pendiente de S/ X.» and does not answer 500.
**Tests:** web unit titles of section 14; existing web list, detail and payment tests updated, none deleted without a replacement.
**Depends on:** T0.

### T2. Mobile fixes (findings 1, 2, 6, 9 on mobile and 10-15)

**Scope:** `apps/mobile/**` (section 10). Docs: `docs/orders.md` «Mobile» paragraphs (void confirmation, amount reasons, zero-balance approval, one close control, «Venta guardada.», link copy and reading the link from the order).
**Out of scope:** core and shared files.
**Acceptance criteria:**
1. «Otro monto» 999 on a S/ 60 order: inline «Supera el saldo pendiente de S/ 60.00», button disabled; empty, 0 and «abc» each show their reason.
2. «Revisar pago» on a S/ 60 order: «Confirmar pago» with 999 shows the balance and stays disabled; on a paid order it shows the zero-balance line and **Rechazar** stays available.
3. «Anular pago» asks for a destructive confirmation naming the amount, the order and the buyer (only the order without buyer); cancelling keeps the payment.
4. Opening a detail five times on a store without a link sends no `POST checkout-link` and shows the new copy; choosing a link in Apariencia and returning shows the link without reopening the order.
5. The list row of a S/ 30 of S/ 90 order reads «Pago parcial · falta S/ 60.00»; the detail badge reads the same; a paid order reads «Pagado» in both.
6. The register sheet exposes one «Cerrar» to screen readers.
7. After «Guardar pedido» the detail shows «Venta guardada.».
8. At 390px on Expo web the tab bar shows «Yoyos» and «Configuración» in full.
9. A single rate is preselected in the delivery fields.
**Tests:** mobile titles of section 14; existing mobile payment, detail and list tests updated, none deleted without a replacement.
**Depends on:** T0.

### Final verification

Walk the review journeys of both reports in the Orca browser on web (1280px, 390px) and Expo web (390px) and check every criterion of section 18. Run `pnpm --dir apps/core test:unit`, `pnpm --dir apps/core typecheck`, `pnpm --dir apps/mobile test`, `pnpm --dir apps/mobile typecheck`, plus core integration for the payment routes. Confirm that the existing payment, detail and list tests were updated and none was deleted without a replacement (`git diff --stat` on test files). The PR lists the 15 findings, each with its evidence: test title or capture (captures for findings 4, 9 web and mobile, 10, 15), and states that none was «ya resuelto en main». Note in the Todoist task what stayed out.

## 17. Questions decided by the review gate

1. **Approving a buyer's transfer report when the buyer paid more than the balance.**
   - Answer: (1) same rule. The seller approves at most the pending balance or rejects the report; the excess is settled with the buyer outside Yoyos.
   - Decided by: architecture review gate, unanimous (design, performance and product reviewers), round 1.
   - Reason: founder decision 1 applies the block on every surface; one rule and one message on both clients; option (2) would bring back «Exceso recibido» through the most common path.
   - Discarded: (2) exempt report approvals and record the real amount with «Exceso recibido» (one more branch in the state machine and a second message on both clients).

Decided unless objected:
- The rule lives in `orderStateMachine.registerPayment` and covers manual payments, report approvals, new sales with payments and immediate sales.
- Pending balance = total − confirmed payments; reported, rejected and voided payments do not count; a payment equal to the balance is accepted.
- New code `PAYMENT_EXCEEDS_BALANCE`, HTTP 409, body carries `balanceDue`; `orderActionErrorSchema` gains `balanceDue` for the web new-sale action; no existing code changes.
- Concurrency relies on the existing `FOR UPDATE` on the order row; a replay of the same `paymentId` is never rejected.
- A report on a paid order cannot be approved; the form says so and **Rechazar** stays available.
- «Exceso recibido» stays for edits that lower the total.
- `checkPaymentAmount` and `paymentProgress` live in `shared/orders-payment.ts` and replace `isValidPaymentAmount` and `paymentBadgeStatus`.
- The list summary contract gains `balanceDue`.
- `GET /api/orders/:id/aggregate` returns the link itself (`ready` with URL or `subdomain_required`), reading the subdomain in parallel; missing means unknown and mobile falls back to `POST checkout-link`. Every caller of that route pays one primary-key read, on purpose.
- «Pagado» is the paid word on every surface (web «Pagada» changes).
- Void confirmation text: «¿Anular el pago de S/ 20.00?» + «Pedido #1006 · Ana Pérez. El monto vuelve al saldo pendiente.» (without buyer, only «Pedido #1006.»), buttons «Anular pago» / «Mantener pago», on web and mobile.
- The web list replaces the icons-only disclosure with icon + text and shows «Pago parcial · falta X».
- Single-rate preselection also applies on mobile (same defect there).
- Enter adds the highlighted result, or the only one; with several results and none highlighted it does nothing.
- The web recipient phone uses `PhoneField` for home and agency; store pickup keeps free text, like mobile.
- Link copy on web and mobile: «Para compartir este pedido, elige primero el link de tu tienda en Apariencia de la tienda.», without the «Pendiente de confirmación» line while there is no link.
- `payment_exceeds_balance` is logged for manual payments, report approvals and new sales; immediate sales cannot hit the rule and are not logged.
- Three tasks: T0 first (with the minimum mobile/web compile and fixture fixes), then T1 and T2 in parallel.

## 18. Criterios de aceptación de producto

| # | Scope item | Verifiable criterion | Surface | Use case / screen change | Test title | Task |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Payment above the balance is rejected with how much is pending; button disabled once it exceeds | S/ 999 on a S/ 60 order is rejected on web, mobile and the API with «S/ 60.00» in the message; no payment is saved; the button is disabled as soon as the amount exceeds the balance, in the register form and in the report approval on both clients | API, web, mobile | `orderStateMachine.registerPayment`; web payment and approval forms; mobile register sheet and `PaymentEditor` | `rejects S/ 999 on a S/ 60 order and saves nothing`; `the amount above the balance shows the balance and disables saving`; `approving a report above the balance shows the balance and disables approving`; `approving a report above the balance shows the balance and disables «Confirmar pago»`; `the disabled register button explains empty, non-numeric, zero and over-balance amounts` | T0, T1, T2 |
| 2 | «Anular pago» confirms with amount and customer or order number; cancel does nothing | Tapping «Anular pago» opens a confirmation naming the amount, the order and the buyer when there is one; «Mantener pago» leaves the payment confirmed and the order state unchanged | web, mobile | `VoidPaymentDialog`; `showConfirmation` in the mobile detail | `voiding a payment asks for confirmation naming the amount, order and buyer`; `the void confirmation of an order without buyer names only the order`; `cancelling the void confirmation leaves the payment confirmed`; `voiding a payment asks for confirmation and cancelling keeps it` | T1, T2 |
| 3 | Enter in the product picker adds the highlighted (or only) result | With one result, Enter adds it; with a highlighted result, Enter adds that one; with several results and none highlighted, Enter adds nothing | web | `pickerKey` | `Enter adds the highlighted result`; `Enter without a highlight adds the only result`; `Enter without a highlight does nothing when there are several results` | T1 |
| 4 | Order list says payment and delivery state as text and shows the balance of a partial payment | Row of S/ 20 of S/ 55 reads «Pago parcial · falta S/ 35.00» and «Entrega pendiente» without opening anything | web | `OrderStatusText` in `order-list.tsx` | `the list shows payment and delivery as text and the balance of a partial payment` | T1 |
| 5 | Same payment state in list, card and detail | S/ 20 of S/ 55 reads «Pago parcial · falta S/ 35.00», and a paid order reads «Pagado», in the web list, the web detail badge and card, the mobile list and the mobile detail | web, mobile | `paymentProgress`; `order-view-saved.tsx`; `orderView.labels.paid`; `order-history-screen.tsx`; `PaymentBadge` | `a partially paid order reads «Pago parcial · falta S/ 35.00»`; `a paid order reads «Pagado» in the list and the badge`; `the detail badge reads «Pago parcial · falta S/ 35.00»`; `a partially paid order reads «Pago parcial · falta S/ 35.00» in the list`; `a paid order reads «Pagado» in the list`; `a paid order reads «Pagado» in the badge` | T0, T1, T2 |
| 6 | A single rate for the district is selected | With one rate, saving never returns «Selecciona una tarifa» | web, mobile | `rated-delivery-form.tsx`; `delivery-fields.tsx` | `a single rate for the district is selected without a click`; `a single rate for the district is selected` | T1, T2 |
| 7 | Same phone format for customer and recipient | Customer and home or agency recipient both read country «PE +51» and number «987654321»; store pickup keeps free text | web | `order-delivery-card.tsx` uses `PhoneField` | `the home or agency recipient phone shows «PE +51» and «987654321» like the customer`; `the store pickup recipient phone stays free text` | T1 |
| 8 | All required fields marked on a failed save, including Departamento | Saving with Departamento empty shows it red with `aria-invalid` like Dirección | web | `PeruDistrictSelect` `invalid` | `a failed save marks an empty Departamento as invalid` | T1 |
| 9 | Link copy says what is missing and where, in one sentence | Without a store link the card reads «Para compartir este pedido, elige primero el link de tu tienda en Apariencia de la tienda.» and no «Pendiente de confirmación» | web, mobile | `order-link-card.tsx`; mobile detail link card | `without a store link the card says what is missing and where in one sentence`; `without a store link shows the one-sentence copy and no checkout-link request`; PR capture on both clients | T1, T2 |
| 10 | Tabs fit at 390px | «Yoyos» and «Configuración» fully visible at 390px | mobile (Expo web) | `app-tabs.web.tsx` | PR capture (visual) | T2 |
| 11 | No checkout-link call when the store has no link; still loaded when it has one | Five openings of a detail without a store link: zero `POST checkout-link`, zero 409; with a link the URL shows; choosing a link in Apariencia and returning shows it without reopening | API, mobile | `GET /aggregate` `checkoutLink`; mobile link card | `GET aggregate returns the checkout URL when the store has a link`; `GET aggregate says subdomain_required when the store has no link`; `shows the link from the order without requesting checkout-link`; `after the store chooses its link in Apariencia, returning to the order shows the link without reopening it` | T0, T2 |
| 12 | Disabled register button explains why | Empty, «abc», 0 and above balance each show their own message, on mobile and on web | mobile, web | `checkPaymentAmount` in the mobile sheet and the web form | `checkPaymentAmount reports empty, not numeric, zero and over balance`; `the disabled register button explains empty, non-numeric, zero and over-balance amounts`; `an empty, non-numeric or zero amount shows its own reason and disables saving` | T0, T1, T2 |
| 13 | One accessible close in «Registrar pago» | A screen reader finds one «Cerrar» | mobile | scrim hidden from accessibility | `the register sheet exposes one close control to screen readers` | T2 |
| 14 | Saving a new order confirms visibly, then navigates to the detail | After «Guardar pedido» the detail shows «Venta guardada.» | mobile | result notice in the detail | `shows «Venta guardada.» after a new sale opens its detail`; PR capture | T2 |

Also checked by the final verification (Todoist criteria 7 and 9): each of the 15 findings has a test or a PR capture listed in the PR, none was «ya resuelto en main», and the existing payment, detail and list tests on web, mobile and the payment use case were updated, none deleted without a replacement.
