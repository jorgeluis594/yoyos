# Payments always accepted and automatic stock deduction: technical design

**Status:** design closed, pending implementation. Based on [`docs/drafts/pagos-siempre-aceptados-y-descuento-auto.md`](pagos-siempre-aceptados-y-descuento-auto.md) (closed product definition). Base: `jorgeluis594/pagos-siempre-aceptados-y-descuento-auto` at `46e50391`. Todoist `6hrgMcPP6mp8CPF3`. Approved by the review gate in round 3; the gate's answers and each round's blockers are recorded in §18 for the founder to confirm in the pull request.

## 1. Technical goal

No payment operation fails because of stock. Three things publish a domain event inside their own transaction:

- confirming a payment;
- changing an order's delivery;
- increasing a variant's stock.

One orders listener reacts to those events. It deducts, all or nothing, the stock of every order that is due and fits the stock available at that moment, and it serves waiting orders oldest first. Because the listener runs inside the producer's transaction:

- a payment response is already deducted when stock is enough;
- a stock increase and the deduction of the waiting orders it covers commit as one step.

Errors stay contained per order. Only a failure that ends the whole transaction (Prisma's interactive timeout, a lost connection) rolls back the producer. Statement-level failures (lock timeout, statement timeout, deadlock) and every stock or data fault roll back to the savepoint and are left to recovery: none of them can reject a payment or block a restoration.

A recovery job in the worker runs once a minute and makes three passes, about 20 seconds apart. Each pass re-publishes the orders that are due, fit the stock and are still undeducted. No order is stranded for more than a minute, and no outbox is needed.

Core exposes the derived `stockDue` state on the order. Web and mobile use it to show «Esperando stock» or «Descontando stock».

```text
registerPayment ──┐ payment_confirmed            ┌─────────────────────────────┐
set delivery /    ├─ order_delivery_changed ───▶ │ orders: deductDueOrderStock │──▶ products: lock + bulk deduct
checkout          │                              └─────────────────────────────┘    orders: stockDeducted = true
recovery job ─────┘ order_stock_deduction_overdue    (savepoint inside the producer's transaction)

restoreCancelledOrderStock ── product_stock_increased ──▶ orders: serveWaitingOrders (set-based, oldest first, budgeted)
(future stock editing)

shipOrder ── deducts itself in the ship transaction (rule unchanged)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Event mechanism | A small synchronous **in-transaction event publisher**, `apps/core/src/shared/events/application/in-transaction-events.ts`. It runs the event's handler inside the producer's open transaction and returns the handler's outcome. It is an explicit exception to guide rule 6.7 ("events after commit") and to `docs/event-bus.md`. The exception covers only handlers that write to the same database, are idempotent under the row locks they take, and perform no external I/O. Everything else stays on pg-boss after commit. T1 writes the exception into both documents. |
| Events | Orders publishes `payment_confirmed { companyId, orderId, paymentId }` and `order_delivery_changed { companyId, orderId }`. Products publishes `product_stock_increased { companyId, variantIds }`. The orders recovery job publishes `order_stock_deduction_overdue { companyId, orderId }`. There is one event per fact and one handler per event; payloads carry identifiers only. |
| Listener | Orders owns `application/deduct-due-stock.ts`: `deductDueOrderStock` handles the three order events and `serveWaitingOrders` handles `product_stock_increased`. Payments, deliveries, checkout and products only publish. |
| Registry location | `orders/composition.ts` builds the publisher and its registry, because every handler belongs to orders. `composition/event-handlers.ts` passes it to the products restoration. There is no import cycle. |
| Error containment | Each handler runs inside a savepoint (`withinSavepoint`, contract in §7). Errors are split in two classes by `classifyPersistenceFailure` (`persistence-error.ts`). **Transaction-ending**: Prisma's interactive transaction timeout (P2028), a lost or closed connection, or a scope already aborted outside the savepoint; it is returned and rolls back the producer, so the retry is safe and atomic. **Everything else is contained**: statement-level PostgreSQL errors (lock timeout 55P03, statement timeout 57014, deadlock 40P01, serialization 40001, any other SQLSTATE), a domain error, invalid stored data and an unexpected row count. A contained error rolls back to the savepoint, is logged as `stock_deduction_failed` and returns outcome `failed` with its `errorCode`; the producer commits and the order is left to recovery. In `serveWaitingOrders`, a candidate with invalid data is skipped and the others are still served. |
| Who owns the deduction | Orders: the due rule, the `stockDeducted` flag and the waiting-order queries are orders data. Products exposes stock capabilities (`lockVariantStock`, `deductStockBulk`, `findVariantStock`) and knows nothing about orders. |
| Due rule | Pure domain function `isStockDeductionDue(order)`. An order is due when it is not cancelled, its stock is not deducted, its delivery is pending, and either its confirmed payments cover the total or a confirmed payment has `deductStockIfPartial = true`. The SQL prefilters implement the same rule in full: they only narrow the set, and they never admit an order that is not due. |
| Persisted partial request | New column `Payment.deductStockIfPartial` (default `false`) stores the seller's choice on the confirmation. Nothing new is stored on `Order`. |
| All or nothing | The listener locks the stock rows, plans with the pure `planDueStockDeduction`, and writes with one guarded bulk statement that decrements every row or none. |
| Restock in one step | `serveWaitingOrders` runs in the restoration transaction after the increment, while the increased rows are still locked. |
| Restock cost bound | `serveWaitingOrders` runs a fixed number of statements, whatever the number of candidates: list, lock orders, load, lock stock, one bulk decrement, one bulk flag update. Limits (initial values, adjustable): at most 100 candidates (`WAITING_ORDERS_BATCH_SIZE`) and 500 ms of work (`WAITING_ORDERS_BUDGET_MS`). The budget is a hard bound, not only a check between statements: before each statement the handler sets `statement_timeout` and `lock_timeout` to the time left in the budget (minimum 50 ms) with one `SELECT set_config('statement_timeout', $1, true), set_config('lock_timeout', $2, true)`, as `withinTransaction` already does. A setting made inside a savepoint is undone by `ROLLBACK TO SAVEPOINT` but survives `RELEASE`, so after the savepoint ends the publisher restores the restoration's values explicitly in both cases; without it, `saveStockRestoration` would run with a budget-sized timeout. A statement that runs out of budget raises 57014 or 55P03, which is contained: the savepoint rolls back, the outcome reports `budgetExhausted`, and the restoration commits. Serving therefore adds at most about 550 ms to a restoration. The restoration transaction runs with `timeout` 5000 ms, `lockTimeoutMs` 2000 and `statementTimeoutMs` 2000; its own increments, before the savepoint, are the only statements whose failure is retried by pg-boss. |
| No waiting during a restock or recovery | After the increment, the restock transaction never waits: orders and stock rows locked elsewhere are skipped (`SKIP LOCKED`) and left to recovery. Recovery takes its order with `SKIP LOCKED` and locks stock rows in `skip_locked` mode too (outcome `skipped_locked`), so it never holds an order lock while waiting on a seller's operation. Only the payment and delivery paths lock stock rows in `wait` mode, bounded by their `lockTimeoutMs`. |
| Guarantee (bounded recovery) | pg-boss 12.35 sends at most one cron job per 60-second slot (`OCCURRENCE_WINDOW_SECONDS = 60`, `throttleSlot()` in `timekeeper.js`), so sub-minute cadence comes from passes inside one job. Scheduled job `recover-due-stock-deductions`, worker only, cron `* * * * *` (`STOCK_DEDUCTION_RECOVERY_CRON`, adjustable). Each run makes up to three **passes** at offsets 0, 20 and 40 s from its start (`STOCK_DEDUCTION_RECOVERY_PASS_OFFSETS`, adjustable), waiting between them with the job's `AbortSignal`; a pass is capped at 10 s and 200 orders, and a pass whose offset is already past 45 s is skipped. The queue uses the `stately` policy (one active, one queued), so runs never overlap across replicas; `retryLimit` 0 because the next minute is the retry; `expireInSeconds` 58. What keeps it alive is the pg-boss schedule row itself (persistent across deploys, `missed: "once"` on restart); there is no self-rescheduling chain. `cronMonitorIntervalSeconds` goes from 30 to 10. Worst case, see §5.7: about 42 s from the moment an order becomes overdue to its deduction, under the product's minute. T1 measures it (criterion 6). |
| No outbox | The events commit or roll back with the fact they describe. Recovery closes the remaining windows: a skipped locked order, a contained failure, a budget cut, and orders saved before this feature. |
| Response consistency | Use cases that publish return `OrderWithStockDue`, with `stockDue` computed inside their transaction from the listener's outcome and the stock it locked. Other order responses and loaders compute it inside `withinReadSnapshot`. |
| Producer timeouts | Every transaction that publishes a stock event (payment, report approval, delivery, checkout, creation, immediate sale) runs with `lockTimeoutMs` 2000 and `statementTimeoutMs` 3000, below the 5000 ms Prisma timeout, so a lock wait ends as a contained 55P03 instead of an uncontainable P2028. A lock wait before the savepoint (the order row) still fails the operation as today. |
| Ship | `shipOrder` keeps deducting inside the ship transaction (rule unchanged). Ship is neither a payment nor an inventory change; stock is a precondition of the shipment, and `docs/event-bus.md` keeps operation invariants inside the operation's transaction. It now uses the same `lockVariantStock` + `deductStockBulk` capabilities, so the all-or-nothing behavior is identical. Creation with `shipImmediately` reaches the same `shipOrder`. |
| Deliver | Unchanged: it never deducts. Creation with `deliverImmediately` and `registerImmediateSale` confirm their payment through `payment_confirmed`. If the order is still undeducted, the creation rolls back and answers by outcome: `short` → `INSUFFICIENT_STOCK` with the first short `variantId`; `failed` with `INVALID_STORED_DATA` or `UNEXPECTED_ROW_COUNT` → `INVALID_STORED_DATA` (500 `INTERNAL_ERROR`); `failed` with a statement-level database error → `PERSISTENCE_UNAVAILABLE` (503, the seller retries). The seller never reads «No hay stock suficiente» when stock is enough. |
| Standalone deduction | Removed: `deductStock`, `orders.deductStock`, `POST /api/orders/:id/deduct-stock`, and mobile's `deductStock` client. |
| `deferStockDeduction` | Removed from the use cases. `createOrderSchema` keeps it optional and core ignores it, so a sale queued before the update is saved as a plain save. |
| Order contract | `orderAggregateSchema` gains `stockDue: null \| { kind: "waiting"; shortItems: [{ variantId, available }] } \| { kind: "deducting" }`. `stockDeducted` stays. List summaries never compute it; dispatch labels compute it once per batch. |
| Payment response | `registerPaymentResponseSchema` becomes `{ order }` and `stockOutcomeSchema` is removed. |
| Client blocks | `shared/orders-fulfillment.ts` adds `stockFulfillmentBlock` and the combined `orderFulfillmentBlock`, the only function clients call. `fulfillmentBlock` itself does not change. |
| Existing orders | Already paid and undeducted orders become due with no data migration (no production). The first recovery runs deduct those that fit. |
| Docs | T1 updates `docs/event-bus.md` (new "In-transaction events" section) and guide rule 6.7 in `.agents/skills/architecture/architecture-guide.md`. The two drafts are promoted on merge (Documentation skill). |
| Copy and UI | Exactly as in the product draft. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| `registerPayment` | `apps/core/src/features/orders/application/register-payment.ts` | Locks the order, confirms the payment, plans with `planStockDeduction`, deducts each item, and answers `INSUFFICIENT_STOCK` by rolling everything back. It accepts `deferStockDeduction` and returns `{ order, stock }`. Used by the payment route, report approval and `createCompleteOrder`. |
| `persistDeliveryChange` | `application/set-delivery.ts` | Shared by `setOrderDelivery` and buyer `confirmCheckout` (`application/checkout.ts`). Deducts when the change makes the order paid; otherwise answers `INSUFFICIENT_STOCK`. |
| `createCompleteOrder` | `application/create-complete-order.ts` | One transaction: create, delivery, payments through `registerPayment`, then `ship` or `deliver`. Validates `deferStockDeduction`. |
| `registerImmediateSale` | `application/register-immediate-sale.ts` | Creates the order, confirms the full payment, deducts directly and delivers. |
| `deductStock` | `application/deduct-stock.ts`, `POST /:id/deduct-stock` in `presentation/api-routes.ts` | Standalone deduction. Mobile `order-api.ts` calls it through `deductStock`. |
| `shipOrder` | `application/fulfill-order.ts` | Deducts pending stock with `planStockDeduction(order, true)` and one `deductProductStock` per item. `registerDelivery` requires `stockDeducted`. |
| `voidPayment` | `application/void-payment.ts` | Never restores stock. Unchanged. |
| `ConfirmedPayment` | `domain/payment.ts`, `Payment` table | Does not store `deductStockIfPartial`. |
| Stock capabilities | `products/infrastructure/order-stock.ts` | One conditional `UPDATE … WHERE quantity >= n` per variant; `restoreProductStock`. |
| Restore listener | `products/application/restore-cancelled-order-stock.ts`, wired in `composition/event-handlers.ts` | Locks the cancelled order, increments each item, clears `stockDeducted`. Only `PERSISTENCE_UNAVAILABLE` is retryable; any other error fails permanently. Runs with default transaction options. |
| Chat item edits | `findOpenChatOrderCandidate` in `order-repository.ts` | Excludes orders with a `confirmed` or `reported` payment, so a chat message never edits the items of a paid order and never makes an order due. |
| `cancelOrder` | `application/cancel-order.ts` | Publishes `order_cancelled` after commit and ignores the result (accepted gap, memory f4d3c120). |
| Event bus | `apps/core/src/shared/events/`, [event-bus.md](../event-bus.md) | pg-boss 12.35, publishes after commit, no outbox. |
| Scheduler | `pg-boss-provider.ts` `schedule()`, `composition/scheduled-jobs.ts` | Queue policy fixed to `retryLimit: 3, retryDelay: 300`. Cron runs through `cron-parser` 5.10, but `timekeeper.js` throttles every schedule to one job per 60-second slot (`OCCURRENCE_WINDOW_SECONDS = 60`). `cronMonitorIntervalSeconds` default 30, `cronWorkerIntervalSeconds` default 5. |
| Cross-company listing | `list_companies_with_expired_catalog_orders` (migration `20261017051040_…`) | `SECURITY DEFINER` function that returns company ids, with `EXECUTE` granted to `core_app`. Pattern reused here. |
| Transactions | `shared/infrastructure/persistance.ts`, `persistence-error.ts` | `withinTransaction` with `timeout`, `lockTimeoutMs`, `statementTimeoutMs`. A thrown error marks the scope aborted. No savepoint helper exists. `isPersistenceFailure` and `transactionFailureStage` exist. |
| Order contract | `shared/contracts/orders.ts` | `orderAggregateSchema` (strict), `registerPaymentResponseSchema`, `createOrderSchema` with `deferStockDeduction`. |
| Projections | `presentation/order-json.ts` | `toOrderAggregateJson` is called by the API routes, `app/routes/order-detail.tsx`, `order-list.tsx` (only for `balanceDue`) and `features/orders/index.ts` (dispatch labels, `getOrderAggregateResponsesByIds`). |
| Web UI | `app/routes/order-detail.tsx`, `order-new.tsx`, `checkout.tsx`, `app/locales.ts`, `presentation/order-payments-card.tsx`, `payment-decision-form.tsx` | Show stock rejections. `order-new.tsx` uses `variantId` only for `VARIANT_NOT_FOUND`. |
| Mobile UI | `apps/mobile/src/features/orders/…` (see §10) | Has the stock dialog, «Guardar como pendiente», `creationStockWarning` and «Descontar stock ahora». |

## 4. Gaps this design closes

1. Payments, deliveries, creations and checkout fail with `INSUFFICIENT_STOCK` (§5.2–5.5).
2. The partial-deduction request is not stored (§6, §7).
3. Nothing deducts an order when stock increases (§5.1, §5.6).
4. There is no in-transaction event and no savepoint; the pg-boss bus cannot satisfy "already deducted" or "one step" (§9).
5. Nothing guarantees that a due order with stock gets deducted (§5.7).
6. The order response does not say whether an order is waiting, nor for what (§6, §8).
7. A standalone deduction path bypasses the oldest-first rule (§5.8).
8. The clients reject or defer payments because of stock (§10, §16).

## 5. Use cases

### 5.1 `deductDueOrderStock` and `serveWaitingOrders` (new, orders, `application/deduct-due-stock.ts`)

Both are in-transaction handlers. They require an active transaction of `payload.companyId` and run inside a savepoint opened by the publisher.

```ts
type OrderStockTrigger = "payment_confirmed" | "order_delivery_changed" | "order_stock_deduction_overdue";
export type DeductionOutcome =
  | Readonly<{ kind: "not_due" }>
  | Readonly<{ kind: "deducted"; stock: VariantStock }>
  | Readonly<{ kind: "short"; shortItems: readonly [ShortItem, ...ShortItem[]] }>
  | Readonly<{ kind: "skipped_locked" }> // only for order_stock_deduction_overdue: a stock row was held elsewhere
  | Readonly<{ kind: "failed"; stage: DeductionStage; errorCode: DeductionErrorCode }>;
export type ServeOutcome = Readonly<{ candidates: number; deducted: number; skippedLocked: number; skippedInvalid: number;
  budgetExhausted: boolean; failed: Readonly<{ stage: DeductionStage; errorCode: DeductionErrorCode }> | null }>;
export type DeductionStage = "load_order" | "lock_stock" | "deduct_stock" | "save_deduction" | "list_waiting" | "lock_orders";
/** Data faults vs statement-level database errors; the creation paths map them to different HTTP answers (§5.4). */
export type DeductionErrorCode = "INVALID_STORED_DATA" | "UNEXPECTED_ROW_COUNT" | "LOCK_TIMEOUT" | "STATEMENT_TIMEOUT" | "DEADLOCK" | "DATABASE_ERROR";
/** Only errors that end the whole transaction; everything else is contained in the savepoint. */
export type TransactionEndingError = Readonly<{ code: "PERSISTENCE_UNAVAILABLE"; message: string; transactionEnding: true }>;
export type DeductDueStockDependencies = Readonly<{
  /** Narrow read: core order fields, items (variantId, quantity) and confirmed payments (amount, deductStockIfPartial); one query. */
  loadStockOrders: (ids: readonly OrderId[], companyId: CompanyId) => Promise<Result<readonly StockOrderRow[], TransactionEndingError>>;
  /** One statement: locks the rows not held elsewhere, returns them in createdAt, id order. */
  lockOrdersSkipLocked: (ids: readonly OrderId[], companyId: CompanyId) => Promise<Result<readonly OrderId[], TransactionEndingError>>;
  /** One statement in variantId order; "skip_locked" omits rows held by another transaction. */
  lockVariantStock: (variantIds: readonly VariantId[], mode: "wait" | "skip_locked") => Promise<Result<ReadonlyMap<VariantId, unknown>, TransactionEndingError>>;
  /** One guarded statement: decrements every row or none; returns the updated row count. */
  deductStockBulk: (lines: readonly StockLine[]) => Promise<Result<number, TransactionEndingError>>;
  /** One statement: sets stockDeducted where still false; returns the updated count. */
  saveStockDeductions: (ids: readonly OrderId[], companyId: CompanyId) => Promise<Result<number, TransactionEndingError>>;
  /** Full due rule and "every item fits" in SQL, driven by the partial index; createdAt, id order. */
  listWaitingOrderIds: (companyId: CompanyId, variantIds: readonly VariantId[], limit: number) => Promise<Result<readonly OrderId[], TransactionEndingError>>;
  waitingOrdersBatchSize: number;
  waitingOrdersBudgetMs: number;
  clock: () => Date;
}>;
export function deductDueOrderStock(trigger: OrderStockTrigger, deps: DeductDueStockDependencies):
  (payload: Readonly<{ companyId: CompanyId; orderId: OrderId }>) => Promise<Result<DeductionOutcome, TransactionEndingError>>;
export function serveWaitingOrders(deps: DeductDueStockDependencies):
  (payload: ProductStockIncreased) => Promise<Result<ServeOutcome, TransactionEndingError>>;
```

Every dependency returns either data or a transaction-ending error; a statement-level PostgreSQL error is thrown by Prisma, caught by `withinSavepoint`, classified and turned into outcome `failed` (or `budgetExhausted` inside serving). A row that does not validate is reported per row, not as an error: `StockOrderRow` is `{ ok: true; order: StockOrder } | { ok: false; id }`, and stock values are validated in the use case with `parseStockQuantity`.

**`deductDueOrderStock`.** Precondition: the publisher's transaction already holds the order's row lock. The producer took it, or the recovery job took it before publishing. Steps:
1. `loadStockOrders([orderId])`. An invalid row returns `failed` (`load_order`); a missing order returns `not_due`.
2. `isStockDeductionDue` is false: return `not_due`.
3. `lockVariantStock(variantIds, mode)`, then validate the quantities. The mode is `wait` for `payment_confirmed` and `order_delivery_changed` (bounded by the producer's `lockTimeoutMs` 2000; a timeout is contained as `failed` / `LOCK_TIMEOUT`) and `skip_locked` for `order_stock_deduction_overdue` (a missing row returns `skipped_locked`, so recovery never waits while holding an order). An invalid quantity returns `failed` (`lock_stock`, `INVALID_STORED_DATA`).
4. `planDueStockDeduction`. A short plan returns `short` with the short items.
5. `deductStockBulk(lines)`. A count different from the number of lines returns `failed` (`deduct_stock`); the savepoint undoes nothing because the guarded statement wrote nothing.
6. `saveStockDeductions([orderId])`. A count of 0 returns `failed` (`save_deduction`), and the savepoint rolls back the decrement.
7. Return `deducted` with the locked stock after the decrement.

That is four statements in total.

**`serveWaitingOrders`.** The budget is enforced per statement: before each statement it sets `statement_timeout` and `lock_timeout` to `max(50, budget − elapsed)` ms in one `set_config` statement, and it does not start a statement once the budget is spent. A 57014 or 55P03 raised by any of its statements is contained: the savepoint rolls back everything serving wrote, the outcome is `budgetExhausted: true`, and the restoration goes on and commits. When the savepoint ends (released or rolled back), the publisher restores the producer's `statement_timeout` and `lock_timeout` in one `set_config` statement. Steps:
1. `listWaitingOrderIds(companyId, variantIds, waitingOrdersBatchSize)`.
2. `lockOrdersSkipLocked(ids)`. Ids not returned are counted as `skippedLocked`.
3. `loadStockOrders(locked)`. Invalid rows are counted as `skippedInvalid` and logged.
4. `lockVariantStock(every variant of the loaded orders, "skip_locked")`. The increased rows are already held by this transaction and come back. A candidate with a missing or invalid row is skipped.
5. In memory, oldest first, against a running stock map:
   - an order that is not due or short is skipped;
   - an order that fits is planned, and its quantities are subtracted from the map.
6. `deductStockBulk(the planned lines summed per variant)`. A count mismatch writes nothing and reports `failed` (`deduct_stock`, `UNEXPECTED_ROW_COUNT`) for the whole batch; the restoration still commits.
7. `saveStockDeductions(the planned ids)`.
8. Log `waiting_orders_served` after commit.

That is seven statements whatever the number of candidates.

### 5.2 `registerPayment` (modified)

- The input loses `deferStockDeduction`.
- `INSUFFICIENT_STOCK` leaves the error union. `deductProductStock` and `saveStockDeduction` leave the dependencies.
- `confirmPayment` stores `deductStockIfPartial` on a new confirmation. A repeated approval returns the stored confirmation, as today.
- New dependencies:
  - `publishPaymentConfirmed: (p: PaymentConfirmed) => Promise<Result<DeductionOutcome, TransactionEndingError>>`;
  - `findVariantStock` (used only for a `failed` outcome, step 6).
- Transaction options: `{ lockTimeoutMs: 2000, statementTimeoutMs: 3000 }` under the default 5000 ms Prisma timeout (same for §5.3–5.5).
- Flow:
  1. Lock the order.
  2. Confirm the payment and run `orderStateMachine.registerPayment`. A replay returns the current order with its described `stockDue`.
  3. Save the payment and the completion.
  4. Publish `payment_confirmed`.
  5. Patch the in-memory order: `stockDeducted: true` when the outcome is `deducted`.
  6. Derive `stockDue` from the outcome:
     - `short` → `waiting`;
     - `deducted` or `not_due` → `null`;
     - `failed` → `describeStockDue(order, findVariantStock(...))` inside the same transaction.
- Output: `OrderWithStockDue`. There is no second aggregate load.

### 5.3 `setOrderDelivery`, `persistDeliveryChange` and `confirmCheckout` (modified)

- `persistDeliveryChange` no longer deducts.
- After `saveDelivery`, it publishes `order_delivery_changed` and patches the order from the outcome, as in §5.2. An unchanged delivery publishes nothing.
- New dependencies: `publishStockEvent` (for `order_delivery_changed`) and `findVariantStock` (for a `failed` outcome, as in §5.2 step 6).
- `INSUFFICIENT_STOCK`, `deductProductStock` and `saveStockDeduction` leave its types.
- `setOrderDelivery` returns `OrderWithStockDue`.
- The buyer checkout keeps its own view without stock.

### 5.4 `createCompleteOrder` (modified)

- It loses `deferStockDeduction` and its validations. The route still accepts the field and drops it.
- Payments go through `registerPayment`, and the creation returns the last `OrderWithStockDue`.
- `deliverImmediately`: if the order is undeducted after the payments, the transaction rolls back and the answer follows the last outcome: `short` → `{ code: "INSUFFICIENT_STOCK", variantId: shortItems[0].variantId }`; `failed` with `INVALID_STORED_DATA` or `UNEXPECTED_ROW_COUNT` → `INVALID_STORED_DATA` (500); `failed` with a database error code → `PERSISTENCE_UNAVAILABLE` (503).
- `shipImmediately`: unchanged.

### 5.5 `registerImmediateSale` (modified)

Confirms the payment as before, then publishes `payment_confirmed` and delivers. If the outcome is not `deducted`, it rolls back and answers as in §5.4: `INSUFFICIENT_STOCK` with `variantId` for `short`, `INVALID_STORED_DATA` or `PERSISTENCE_UNAVAILABLE` for `failed`. `deductProductStock` and `saveStockDeduction` leave its dependencies.

### 5.6 `restoreCancelledOrderStock` (modified, products)

- After the increments and before `saveStockRestoration`, it calls the new dependency `publishStockIncreased({ companyId, variantIds })`.
- Only a transaction-ending failure is returned, as retryable. Everything that happens while serving waiting orders (slow statement, lock wait, deadlock, bad data) is contained in the savepoint and bounded by the serving budget, so the restoration always commits once its own increments succeed.
- Its transaction in `event-handlers.ts` gets `{ timeout: 5000, lockTimeoutMs: 2000, statementTimeoutMs: 2000 }` (initial values, adjustable).
- A duplicate `order_cancelled` still restores once, so it publishes once.

Meeting contract for stock editing (`6hj7HpVmhfCCHrC3`):
- Any products use case that increases `ProductStock.quantity` publishes one `product_stock_increased` per transaction, after the increments.
- `variantIds` lists only the variants whose quantity actually increased.
- A single edit over many variants is still one event.
- The `serveWaitingOrders` budget and its per-statement timeouts apply there too, so a bulk edit inside an HTTP request adds at most about 550 ms to that request and the edit always commits.

### 5.7 `recoverDueStockDeductions` (new, orders, `application/recover-due-stock-deductions.ts`)

```ts
export type RecoverDueStockDeductionsDependencies = Readonly<{
  /** Definer function: company ids that have overdue orders (full due rule and fit); one statement. */
  listCompaniesWithOverdueStockDeductions: () => Promise<Result<readonly CompanyId[], PersistenceError>>;
  /** Full due rule and fit, partial index, createdAt, id order, under RLS; ids in `exclude` are left out. */
  listOverdueOrderIds: (companyId: CompanyId, limit: number, exclude: readonly OrderId[]) => Promise<Result<readonly OrderId[], PersistenceError>>;
  /** Own tenant transaction { timeout 3000, lockTimeoutMs 1000, statementTimeoutMs 1000 }: lock the order FOR NO KEY UPDATE SKIP LOCKED, publish order_stock_deduction_overdue. */
  publishOverdueInOwnTransaction: (companyId: CompanyId, orderId: OrderId) => Promise<Result<DeductionOutcome, PersistenceError>>;
  /** Worker-local quarantine of orders whose last outcome was a data fault; ephemeral, never persisted. */
  quarantine: Readonly<{ list: (now: Date) => readonly OrderId[]; add: (id: OrderId, now: Date) => boolean /* true when newly added */ }>;
  wait: (ms: number, signal: AbortSignal) => Promise<"elapsed" | "aborted">;
  passOffsetsMs: readonly number[];   // initial [0, 20000, 40000]
  lastPassStartMs: number;            // initial 45000
  passBudget: Readonly<{ maxOrders: number; maxMs: number }>; // initial 200 orders, 10000 ms
  clock: () => Date;
}>;
export type RecoveryPassOutput = Readonly<{ pass: number; companies: number; candidates: number; deducted: number; short: number;
  notDue: number; skippedLocked: number; failed: number; quarantined: number; failedCompanies: number; budgetExhausted: boolean;
  listCompaniesMs: number; durationMs: number }>;
export async function recoverDueStockDeductions(signal: AbortSignal, deps: RecoverDueStockDeductionsDependencies): Promise<Result<readonly RecoveryPassOutput[], PersistenceError>>;
```

One run per minute, up to three passes:
1. For each offset in `passOffsetsMs`: wait until `runStart + offset` (stop if the signal aborts); skip the pass if it would start after `lastPassStartMs`.
2. A pass lists the companies, then shares its order budget fairly: each company gets `max(1, floor(maxOrders / companies))` ids, the starting company rotates with the pass sequence (`passSequence mod companies`), and budget a company does not use is offered to the remaining companies in the same rotation.
3. Each listed order runs in its own transaction, oldest first within its company. Stop on `signal.aborted` or when the pass budget (orders or time) runs out.
4. Count each outcome. Log `stock_deduction_recovered` for each `deducted`. A `failed` outcome with `INVALID_STORED_DATA` or `UNEXPECTED_ROW_COUNT` puts the order in quarantine for 10 minutes (`STOCK_DEDUCTION_FAILURE_QUARANTINE_MINUTES`, adjustable) and logs `stock_deduction_failed` only when the order enters quarantine. Such an order is expected to need manual diagnosis: it keeps showing «Descontando stock» and logs an error every 10 minutes. Statement-level failures (`LOCK_TIMEOUT`, `DEADLOCK`, …) are not quarantined; the next pass retries them.
5. Log `stock_deduction_recovery_pass_completed` per pass.

Only a failed company listing fails a pass; the run continues with the next pass, and the cron is its own retry.

**Overlap and liveness.** The queue is `stately` (at most one active and one queued job, across every worker replica), `retryLimit` 0, `expireInSeconds` 58. The pg-boss schedule row keeps the job alive across deploys and restarts (`missed: "once"`); there is no chain to break. A worker that is down stops recovery until it returns (§9).

**Worst case** (while passes are not budget-cut, §15). Let `M` be the minute slot of a run. pg-boss creates the job within the 10 s monitor interval and the worker picks it within the 2 s poll, so the run starts at `S ∈ [M, M + 12 s]`. Passes start at `S`, `S + 20` and `S + 40`, each lasting at most 10 s. The next run starts at `S' ∈ [M + 60, M + 72]`; if the previous pass is still running, `stately` queues it until that pass ends, which is at most `S + 50 ≤ M + 62`. The largest gap between two pass starts is therefore `(M + 72) − (S + 40) ≤ 32 s` (with `S = M`); inside a run it is 20 s. An order that becomes overdue just after a pass listed its company waits for the next pass start (≤ 32 s) and is processed within that pass (≤ 10 s): **≤ 42 s**. An order skipped as locked in that pass is retried in the following one (≤ 74 s in the double-miss case, which needs a seller operation on the same order at that instant).

Registered in `scheduledJobs` as `recover-due-stock-deductions` with cron `* * * * *`. `ScheduleOptions` gains `policy?: { retryLimit; expireInSeconds; queuePolicy: "standard" | "stately" }`; the existing jobs keep their current policy. The provider passes `cronMonitorIntervalSeconds: 10`.

### 5.8 Removed

- `deductStock` (`application/deduct-stock.ts`);
- `orders.deductStock`;
- the `deduct-stock` entry of the operation routes.

### 5.9 `describeOrderStockDue` (new read, orders)

`describeOrderStockDue(orders, deps: { findVariantStock })` filters the orders with `isStockDeductionDue` first. It reads stock once, for the variants of the due orders only, and runs the pure `describeStockDue` on them; every other order gets `stockDue: null`. When no order is due it makes no stock read and opens no snapshot; otherwise the read runs inside `withinReadSnapshot`. Callers:

- `GET /:id/aggregate` and the `order-detail.tsx` loader;
- responses of void, reject, ship, deliver and cancel, after commit;
- dispatch labels (`getOrderAggregateResponsesByIds`), once per batch.

List pages never call it: `toOrderAggregateListJson` and `order-list.tsx` project summaries, which have no `stockDue`. `order-list.tsx` reads `balanceDue` from the payment summary instead of `toOrderAggregateJson`.

## 6. Domain and typing

New pure file `apps/core/src/features/orders/domain/stock-deduction.ts`:

```ts
export type VariantStock = ReadonlyMap<VariantId, NonNegativeInteger>; // a missing variant counts as 0
export type StockLine = Readonly<{ variantId: VariantId; quantity: PositiveInteger }>;
export type ShortItem = Readonly<{ variantId: VariantId; available: NonNegativeInteger }>;
/** What deduction needs from an order; OrderAggregate satisfies it. */
export type StockOrder = Readonly<{ id: OrderId; createdAt: Date; cancelled: boolean; stockDeducted: boolean;
  deliveryStatus: DeliveryStatus; total: Money; items: readonly [StockLine, ...StockLine[]];
  confirmedPayments: readonly Readonly<{ amount: Money; deductStockIfPartial: boolean }>[] }>;
export type DueStockDeductionPlan =
  | Readonly<{ kind: "not_due" }>
  | Readonly<{ kind: "short"; shortItems: readonly [ShortItem, ...ShortItem[]] }>
  | Readonly<{ kind: "deduct"; lines: readonly [StockLine, ...StockLine[]] }>;
export type StockDue =
  | Readonly<{ kind: "waiting"; shortItems: readonly [ShortItem, ...ShortItem[]] }>
  | Readonly<{ kind: "deducting" }>;
export type OrderWithStockDue = Readonly<{ order: OrderAggregate; stockDue: StockDue | null }>;

export function toStockOrder(order: OrderAggregate): StockOrder;
export function isStockDeductionDue(order: StockOrder): boolean;
export function planDueStockDeduction(order: StockOrder, stock: VariantStock): DueStockDeductionPlan;
export function describeStockDue(order: StockOrder, stock: VariantStock): StockDue | null;
export function parseStockQuantity(value: unknown): Result<NonNegativeInteger, Readonly<{ code: "INVALID_STORED_DATA"; message: string }>>;
```

Why each new type exists:

- `StockOrder`: the restock and the listener load only these fields, instead of a full aggregate per candidate.
- `DueStockDeductionPlan`: the existing `StockDeductionPlan` depends on a request flag and has no "short" case. `StockDeductionPlan` stays for ship.
- `StockDue`: the only representation of «Esperando stock» and «Descontando stock». `null` covers deducted and not-due orders, which `stockDeducted` already distinguishes.
- `OrderWithStockDue`: the producer's order and its `stockDue` come from one transaction, so a response cannot mix two moments.
- `ShortItem`: listed in the order's item order.
- `ConfirmedPayment` and `VoidedPayment` gain `deductStockIfPartial: boolean`.
- Events go in each feature's `application/events.ts`:
  - orders: `PaymentConfirmed`, `OrderDeliveryChanged`, `OrderStockDeductionOverdue`;
  - products: `ProductStockIncreased = Readonly<{ companyId: CompanyId; variantIds: readonly [VariantId, ...VariantId[]] }>`.

| Layer | Types and authority |
| --- | --- |
| Domain (orders) | Due rule, plan and `StockDue`: the authority on waiting |
| Application (orders) | Listener, recovery and describe: decide when to lock and write, and contain errors |
| Infrastructure (products, orders) | Set-based locks, guarded bulk writes, prefilters that mirror the due rule |
| Presentation | Projects `StockDue` to JSON |
| Clients | Render from `stockDue` with `orderFulfillmentBlock` |

## 7. Persistence

Two migrations, generated with the Prisma CLI under `.agents/skills/database-migrations/SKILL.md`:

1. `add_payment_stock_request_and_undeducted_order_index`: the column and the partial index. Its statements run in one explicit `BEGIN; SET LOCAL lock_timeout = '5s'; … COMMIT;`, the skill's transaction-local form; a session-level `SET` is not used, so nothing leaks into the rest of the deploy.
2. `add_overdue_stock_deductions_lookup`: SQL only (`--create-only`), the definer function, its `REVOKE` and `GRANT`, in its own migration as the function precedent `20261017051040_add_expired_catalog_orders_lookup` does.

Contents:

- `Payment.deductStockIfPartial Boolean @default(false)`: `NOT NULL`, metadata-only.
- A partial index `Order_undeducted_pending_idx` on `("companyId", "createdAt", id) WHERE NOT "stockDeducted" AND NOT cancelled AND "deliveryStatus" = 'pending'`. A plain `CREATE INDEX` is used, because there is no production data and no need for `CONCURRENTLY`.
- `public.list_companies_with_overdue_stock_deductions() RETURNS SETOF uuid`:
  - `SECURITY DEFINER`, `STABLE`, with a fixed `search_path`;
  - returns the distinct `companyId` of the orders that match the due-and-fit predicate below;
  - `REVOKE ALL … FROM PUBLIC; GRANT EXECUTE … TO core_app`.

Due-and-fit predicate. All three queries build it from one shared SQL fragment in `order-repository.ts`, with `o` an order. Its first line repeats the partial index predicate with the same literals (`NOT "stockDeducted"`, `NOT cancelled`, `'pending'` as a literal, never a parameter), so PostgreSQL can prove the index applies under a generic plan:

```sql
NOT o."stockDeducted" AND NOT o.cancelled AND o."deliveryStatus" = 'pending'
AND (
  (SELECT coalesce(sum(p.amount), 0) FROM "Payment" p
     WHERE p."companyId" = o."companyId" AND p."orderId" = o.id AND p.status = 'confirmed') >= o.total
  OR EXISTS (SELECT 1 FROM "Payment" p WHERE p."companyId" = o."companyId" AND p."orderId" = o.id
     AND p.status = 'confirmed' AND p."deductStockIfPartial")
)
AND NOT EXISTS (SELECT 1 FROM "OrderItem" i LEFT JOIN "ProductStock" s ON s."variantId" = i."variantId"
     WHERE i."companyId" = o."companyId" AND i."orderId" = o.id AND coalesce(s.quantity, 0) < i.quantity)
```

The payment subqueries use `Payment (companyId, orderId, id)`. The fit anti-join uses the unique `OrderItem (companyId, orderId, variantId)` and the `ProductStock` primary key.

Repository functions:

| Function | File | Behavior |
| --- | --- | --- |
| `lockVariantStock(variantIds, mode)` | `products/infrastructure/order-stock.ts` | `SELECT "variantId", quantity … WHERE "variantId" = ANY($1) ORDER BY "variantId" FOR UPDATE [SKIP LOCKED]`. Requires an active transaction. |
| `deductStockBulk(lines)` | same | `WITH need(v, q) AS (VALUES …), short AS (SELECT 1 FROM need LEFT JOIN "ProductStock" s ON s."variantId" = need.v WHERE s.quantity IS NULL OR s.quantity < need.q) UPDATE "ProductStock" s SET quantity = s.quantity - need.q FROM need WHERE s."variantId" = need.v AND NOT EXISTS (SELECT 1 FROM short)`. Returns the row count, which is either n or 0. |
| `findVariantStock(variantIds)` | same | The same read without a lock and without a status filter (inactive variants count). |
| `loadStockOrders(ids)` | `orders/infrastructure/order-repository.ts` | One raw SQL statement (`$queryRaw`, not a Prisma `include`, which would issue three): order fields, items (`variantId`, `quantity`) and confirmed payments (`amount`, `currency`, `deductStockIfPartial`) aggregated per order with `json_agg`. Each row is validated with Zod. The statement counts in §5.1 assume this shape. |
| `lockOrdersSkipLocked(ids)` | same | `SELECT id FROM "Order" WHERE "companyId" = $1 AND id = ANY($2) ORDER BY "createdAt", id FOR NO KEY UPDATE SKIP LOCKED` (see §11 "Lock strength"). |
| `saveStockDeductions(ids)` | same | `UPDATE "Order" SET "stockDeducted" = true WHERE "companyId" = $1 AND id = ANY($2) AND NOT "stockDeducted"`. |
| `listWaitingOrderIds(companyId, variantIds, limit)` | same | Orders of the company with an item on one of the increased variants, plus the due-and-fit predicate, `ORDER BY "createdAt", id LIMIT n`. Two shapes are acceptable, and T1 picks the cheaper by `EXPLAIN` under the criterion 9 load: a walk of the partial index with an `EXISTS` on `OrderItem`, or a drive from `OrderItem ("companyId", "variantId")` joined to `Order` with the partial predicate, de-duplicated, then sorted and limited. The second grows with the variants' sales history instead of the company's abandoned orders. It runs inside the restock transaction, so it sees the restock's own increment. |
| `listOverdueOrderIds(companyId, limit)` | same | Due-and-fit predicate, `ORDER BY "createdAt", id LIMIT n`. |
| `listCompaniesWithOverdueStockDeductions()` | same | Calls the definer function through `systemPrisma`. |
| `savePayment`, `updatePayment`, payment mapping | same | Write and read `deductStockIfPartial`. |

`withinSavepoint(work)`: a new helper in `shared/infrastructure/persistance.ts`, valid only inside an active transaction. Contract:

- It runs `SAVEPOINT s_n` (a counter keeps nested names unique), then `work`.
- **Release** (`RELEASE SAVEPOINT`) when `work` returns a successful `Result`. After-commit observers registered inside it move to the parent scope and run only if the outer transaction commits.
- **Rollback** (`ROLLBACK TO SAVEPOINT`) when `work` throws or returns a failed `Result`, including a nested `withinTransaction` that set `aborted`. It then restores the scope as it was before the savepoint: `aborted` and `abortCause` go back to their previous values, and every after-commit observer registered inside the savepoint is discarded, so a rolled-back deduction never logs `order_stock_deducted`.
- It rethrows, without rolling back, an error that `classifyPersistenceFailure` marks as transaction-ending (P2028, closed connection), and marks the scope aborted as `execute` does today.
- It returns the classified error (`DeductionErrorCode`) for contained failures, so the publisher builds outcome `failed`. The PR attaches an `EXPLAIN` of `listWaitingOrderIds`, `listOverdueOrderIds` and the definer function, each showing the partial index in use.

## 8. Contracts between applications

T0 changes `shared/contracts/orders.ts` in place:

```ts
export const orderStockDueSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("waiting"), shortItems: z.array(z.strictObject({
    variantId: z.uuid(), available: z.number().int().nonnegative().safe() })).min(1) }),
  z.strictObject({ kind: z.literal("deducting") }),
]);
export type OrderStockDue = z.infer<typeof orderStockDueSchema>;
// orderAggregateSchema: + stockDue: orderStockDueSchema.nullable()
export const registerPaymentResponseSchema = z.strictObject({ order: orderAggregateSchema }); // stockOutcomeSchema removed
// createOrderSchema: deferStockDeduction stays optional; core ignores it
```

- `paymentSchema` does not expose `deductStockIfPartial`; `toOrderAggregateJson` omits it.
- `orderAggregateSummarySchema` does not pick `stockDue`. `cancelOrderResponseSchema` inherits it.
- `toOrderAggregateJson(order, stockDue)` takes the value already described.
- `INSUFFICIENT_STOCK` (409) remains only for:
  - ship and `PATCH /:id/shipping` with shipment;
  - creation with `shipImmediately` or `deliverImmediately`;
  - `registerImmediateSale`.
  
  It carries `variantId` when core knows the short item.
- `POST /api/orders/:id/deduct-stock` is removed.

T0 also changes `shared/orders-fulfillment.ts`, additively:

```ts
export type StockFulfillmentBlock =
  | Readonly<{ code: "STOCK_WAITING"; variantIds: readonly [string, ...string[]] }>
  | Readonly<{ code: "STOCK_DEDUCTING" }>;
export function stockFulfillmentBlock(order: Readonly<{ stockDue: OrderStockDue | null }>, operation: "ship" | "deliver"): StockFulfillmentBlock | null;
/** The only function clients call: payment and transition reasons first, then the stock block. */
export function orderFulfillmentBlock(order: FulfillmentState & Readonly<{ stockDue: OrderStockDue | null }>, operation: "ship" | "deliver") {
  const base = fulfillmentBlock(order, operation);
  if (base !== null && base !== "STOCK_NOT_DEDUCTED") return { code: base } as const;
  return stockFulfillmentBlock(order, operation) ?? (base === null ? null : { code: base } as const);
}
```

How the blocks work:
- Ship is blocked only by `STOCK_WAITING`.
- Deliver is blocked by `STOCK_WAITING` or `STOCK_DEDUCTING`.
- `STOCK_NOT_DEDUCTED` stays only for an order that is not due (deliver already shows the payment reason first in that case).

## 9. Events and cross-feature integration

### In-transaction publisher

```ts
// apps/core/src/shared/events/application/in-transaction-events.ts
export interface InTransactionEvents {} // declaration merging: { [name]: { payload: P; outcome: O } }
type Payload<N extends keyof InTransactionEvents> = InTransactionEvents[N] extends { payload: infer P } ? P : never;
type Outcome<N extends keyof InTransactionEvents> = InTransactionEvents[N] extends { outcome: infer O } ? O : never;
export type InTransactionRegistry<E> = Readonly<{ [N in keyof InTransactionEvents]: (payload: Payload<N>) => Promise<Result<Outcome<N>, E>> }>;
export function createInTransactionPublisher<E>(registry: InTransactionRegistry<E>, deps: Readonly<{
  requireTransaction: (companyId: CompanyId) => void;      // requireActiveTransaction
  withinSavepoint: <T>(work: () => Promise<T>) => Promise<T>;
}>): <N extends keyof InTransactionEvents>(name: N, payload: Payload<N> & Readonly<{ companyId: CompanyId }>) => Promise<Result<Outcome<N>, E>>;
```

- There is exactly one handler per event. The registry type makes a missing or extra handler a compile error.
- The handler runs inside `withinSavepoint`, and its outcome is returned to the producer.
- Before the handler, the publisher sets `lock_timeout` and `statement_timeout` for the savepoint to `min(1000, 4000 − elapsed)` ms, where `elapsed` is the time since the producer's transaction started, in the same single `set_config` statement serving uses (serving then narrows it further). A contended listener therefore always ends as a contained 55P03 or 57014 before Prisma's 5000 ms timer (P2028), even after the producer waited on the order row. The producer's values are restored when the savepoint ends.
- There are no retries and no persistence of its own. The producer's transaction is the unit of retry.
- The registry is built in `orders/composition.ts` and exported as `publishStockEvent`. The orders use cases receive it from their own composition. `composition/event-handlers.ts` passes it to the products restoration as `publishStockIncreased`.
- Payloads are built in-process and never cross JSON, so there is no Zod parser.

### Who publishes and who listens

| Event | Publisher (inside its transaction) | Listener | Outcome |
| --- | --- | --- | --- |
| `payment_confirmed` | `registerPayment` (manual payment, report approval, creation), `registerImmediateSale` | `deductDueOrderStock` | `DeductionOutcome` |
| `order_delivery_changed` | `persistDeliveryChange` (seller, buyer checkout) | `deductDueOrderStock` | `DeductionOutcome` |
| `order_stock_deduction_overdue` | `recoverDueStockDeductions` | `deductDueOrderStock` | `DeductionOutcome` |
| `product_stock_increased` | `restoreCancelledOrderStock`; later stock editing | `serveWaitingOrders` | `ServeOutcome` |

### Failure windows

| Failure window | What happens | Effect for the user |
| --- | --- | --- |
| Transaction-ending failure during a payment (Prisma timeout, lost connection) | The payment transaction rolls back (`503 SERVICE_UNAVAILABLE`) | «No se pudo guardar el pago. Inténtalo de nuevo.»; the retry records it once |
| Lock timeout, statement timeout or deadlock in the listener during a payment | Rolled back to the savepoint; the payment commits | «Pago registrado.» and «Descontando stock»; recovery deducts it within about 42 s |
| Data fault in the listener during a payment (bad stored data, unexpected count) | Rolled back to the savepoint; the payment commits; `stock_deduction_failed` is logged | «Pago registrado.» and «Descontando stock» or «Esperando stock»; recovery retries, then quarantines the order for diagnosis |
| Any failure while serving waiting orders (slow query, lock wait, deadlock, bad data) | Contained in the savepoint, bounded by the serving budget; the restoration commits | Stock is restored; the waiting orders it covers are deducted by recovery within about 42 s |
| Transaction-ending failure or a failed increment during a restoration | The restoration rolls back; pg-boss retries `restore-cancelled-order-stock` | Stock is restored on the retry |
| A waiting order with invalid stored data | Skipped; the others are served; the restoration commits | Only that order waits (logged) |
| The restock budget runs out, or an order or stock row is locked elsewhere | Skipped; recovery serves it | «Descontando stock» for under a minute |
| Orders saved before this feature | Recovery finds them | «Descontando stock» for under a minute |
| Recovery fails for one order or company | Counted and logged; the next pass retries (data faults are quarantined for 10 minutes) | One more pass |
| Worker down | Recovery stops; payments and deliveries still deduct in their own transaction | Windows above wait until the worker returns |
| `order_cancelled` publication lost (existing gap) | No restoration and no increase | Unchanged accepted gap |

## 10. Mobile

| Layer | File | Change |
| --- | --- | --- |
| Domain | `domain/order-draft.ts` | Remove `deferStockDeduction`. |
| Application | `application/order-operations.ts` | Remove the deduct operation and the «Guardar como pendiente» path. |
| Infrastructure | `infrastructure/order-api.ts` | Remove `deductStock`. The payment response is `{ order }`. |
| Presentation | `order-detail-screen.tsx`, `order-detail-translations.ts` | Notice from `order.stockDue`, the four stock line values, button reasons with `orderFulfillmentBlock`, and a reload when a tap meets short stock. |
| Presentation | `order-items-card.tsx` | Polite status line under the balance after a recorded payment. |
| Presentation | `order-payment-card.tsx`, `order-payment-parts.tsx`, `payment-fields.tsx` | «Descontar stock con abono parcial» and «No hace falta: …»; no stock rejection. |
| Presentation | `new-order-screen.tsx`, `translations.ts` | Remove the dialog and `savePending`; inline warning; new `creationStockWarning` texts; delivered-at-creation text; Portuguese. |
| Presentation | `order-delivery-screen.tsx` | No stock rejection. |

There is no SQLite change and no queue change. A queued sale that carries `deferStockDeduction` is sent as stored, and core ignores the field.

## 11. Transactions and concurrency

The lock order is the same everywhere: order row, then stock rows in `variantId` order. After their first lock, restocks and recovery never wait on another transaction: they take orders and stock rows with `SKIP LOCKED`. Only the payment and delivery paths wait on stock rows, bounded by `lockTimeoutMs` 2000.

**Payment** (`registerPayment` and the use cases that call it, delivery and checkout alike):
1. Company-scoped `withinTransaction` with `{ lockTimeoutMs: 2000, statementTimeoutMs: 3000 }` under the 5000 ms Prisma timeout.
2. Lock the order (`FOR UPDATE`, as today). A lock timeout here fails the operation with `503`, as today; nothing is recorded.
3. Write the payment and the completion.
4. Savepoint, then `payment_confirmed`. The listener locks the stock rows (`wait`) and writes the guarded bulk decrement and the flag. A lock timeout, statement timeout or deadlock here is contained: the payment commits and the order shows «Descontando stock» until recovery.
5. Patch the order and derive `stockDue`.
6. Commit.

A payment that waits on stock rows held by a restock waits at most the restock's serving budget (about 550 ms) plus its own increments. Its listener's lock and statement timeouts are `min(1000, 4000 − elapsed)` ms (§9), so two lock waits in a row (order row, then stock rows) still end as a contained timeout before the 5000 ms Prisma timer. T1 measures it (criterion 9).

**Restock** (`restoreCancelledOrderStock`):
1. Run with `{ timeout: 5000, lockTimeoutMs: 2000, statementTimeoutMs: 2000 }`.
2. Lock the cancelled order. A duplicate event does nothing.
3. Increment the items in `variantId` order. A failure here is the only one pg-boss retries.
4. Savepoint, then `serveWaitingOrders`: candidates `FOR NO KEY UPDATE SKIP LOCKED`, other stock rows `SKIP LOCKED`, at most 7 statements, each with `statement_timeout` and `lock_timeout` set to the remaining budget. Any error is contained.
5. Restore the timeouts, `saveStockRestoration`, commit.

**Recovery:** one transaction per order, `{ timeout: 3000, lockTimeoutMs: 1000, statementTimeoutMs: 1000 }`. The order is locked `FOR NO KEY UPDATE SKIP LOCKED`; the overdue listener locks stock rows `skip_locked`.

**Lock strength.** Restock candidates and recovery use `FOR NO KEY UPDATE`: they write only `stockDeducted`, which is not a key, so foreign-key inserts on the order (`Payment`, `OrderItem`, `OrderMessage`, which take `FOR KEY SHARE`) are not blocked and fewer candidates are skipped. It still conflicts with the `FOR UPDATE` that every order operation takes, so mutual exclusion holds. `findOrderForUpdate` keeps `FOR UPDATE` unchanged for the existing operations.

**Ship:** unchanged rule. The ship transaction locks the order, plans with `planStockDeduction(order, true)`, locks the stock rows (`wait`), runs the guarded bulk decrement and registers the shipment.

**Duplicates:** `saveStockDeductions` updates only `NOT "stockDeducted"` under the order lock, and every decrement is guarded. An order is therefore deducted at most once, and stock never goes negative.

## 12. Code organization

| File | Task | Change |
| --- | --- | --- |
| `shared/contracts/orders.ts`, `shared/orders-fulfillment.ts` | T0 | §8 |
| `apps/core/src/features/orders/presentation/api-routes.ts` (payment route projection only) | T0 | Answer `{ order }` with `stockDue: null` |
| Client test fixtures that build an `orderAggregateSchema` object | T0 | Add `stockDue: null` |
| `apps/core/src/shared/events/application/in-transaction-events.ts` | T1 | New publisher |
| `apps/core/src/shared/infrastructure/persistance.ts`, `persistence-error.ts` | T1 | `withinSavepoint` (contract in §7), `classifyPersistenceFailure` (transaction-ending vs statement-level, built on `transactionFailureStage`) |
| `apps/core/src/shared/events/application/contracts.ts`, `infrastructure/pg-boss-provider.ts` | T1 | `ScheduleOptions.policy` (`stately`, `retryLimit`, `expireInSeconds`), `cronMonitorIntervalSeconds: 10` |
| `apps/core/src/composition/event-handlers.ts`, `scheduled-jobs.ts` | T1 | Restoration options and `publishStockIncreased`; recovery job |
| `apps/core/src/features/orders/domain/stock-deduction.ts`, `domain/payment.ts` | T1 | §6 |
| `apps/core/src/features/orders/application/deduct-due-stock.ts`, `recover-due-stock-deductions.ts`, `describe-order-stock-due.ts`, `events.ts` | T1 | New |
| `apps/core/src/features/orders/application/register-payment.ts`, `set-delivery.ts`, `checkout.ts`, `create-complete-order.ts`, `register-immediate-sale.ts`, `fulfill-order.ts` | T1 | §5.2–5.5, ship uses the bulk capability |
| `apps/core/src/features/orders/application/deduct-stock.ts` | T1 | Deleted |
| `apps/core/src/features/orders/infrastructure/order-repository.ts` | T1 | §7 |
| `apps/core/src/features/orders/composition.ts` | T1 | Publisher and registry, wiring, `describeStockDue`, removal of `deductStock`, logs |
| `apps/core/src/features/orders/presentation/api-routes.ts`, `order-json.ts`, `features/orders/index.ts` | T1 | `stockDue` in aggregate responses, `{ order }`, no `deduct-stock`, `deferStockDeduction` dropped |
| `apps/core/app/routes/order-detail.tsx` (loader and actions only), `order-list.tsx` | T1 | Pass `stockDue`; list reads `balanceDue` without describing |
| `apps/core/app/routes/checkout.tsx`, `src/features/orders/presentation/payment-decision-form.tsx` (data only) | T1 | Drop the `INSUFFICIENT_STOCK` comparisons that no longer typecheck once the code leaves the unions; T2 owns the resulting texts |
| `apps/core/src/features/products/application/restore-cancelled-order-stock.ts`, `application/events.ts`, `infrastructure/order-stock.ts`, `composition.ts` | T1 | §5.6, capabilities |
| `apps/core/prisma/schema.prisma`, `prisma/migrations/<ts>_add_payment_stock_request_and_undeducted_order_index/`, `prisma/migrations/<ts>_add_overdue_stock_deductions_lookup/` | T1 | §7: two migrations, the function only in the second |
| `docs/event-bus.md`, `.agents/skills/architecture/architecture-guide.md` (rule 6.7) | T1 | The exception |
| Web UI files (§3) | T2 | UI |
| Mobile files (§10) | T3 | UI |

Capabilities: products exposes `lockVariantStock`, `deductStockBulk` and `findVariantStock` through `products/composition.ts`. Products receives `publishStockIncreased` by injection and never imports orders.

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `order_stock_deducted` | info | listener, after commit | `["companyId", "orderId", "trigger", "itemCount", "durationMs"]` |
| `order_stock_waiting` | info | listener, after commit | `["companyId", "orderId", "trigger", "shortItemCount"]` |
| `waiting_orders_served` | info | `serveWaitingOrders`, after commit | `["companyId", "variantCount", "candidates", "deducted", "skippedLocked", "skippedInvalid", "budgetExhausted", "durationMs"]` |
| `stock_deduction_failed` | error | listener (contained failure); in recovery only when an order enters quarantine | `["companyId", "orderId", "trigger", "stage", "errorCode"]` |
| `stock_deduction_contended` | warn | listener, contained statement-level failure (`LOCK_TIMEOUT`, `STATEMENT_TIMEOUT`, `DEADLOCK`) | `["companyId", "orderId", "trigger", "stage", "errorCode"]` |
| `stock_deduction_rolled_back` | warn | publisher (transaction-ending failure returned) | `["companyId", "event", "stage", "errorCode"]` |
| `stock_deduction_recovery_pass_completed` | info, or warn when `durationMs` > 3000, `listCompaniesMs` > 1000 or `budgetExhausted` | recovery job, per pass | `["pass", "companies", "candidates", "deducted", "short", "notDue", "skippedLocked", "failed", "quarantined", "failedCompanies", "budgetExhausted", "listCompaniesMs", "durationMs"]` |
| `stock_deduction_recovered` | warn | recovery, per `deducted` outcome, after commit | `["companyId", "orderId"]` |
| `stock_deduction_recovery_failed` | error | recovery job | `["stage", "errorCode", "companyId"]` |
| `payment_confirmed` (existing log) | info | `orders.registerPayment` | `stockOutcome` is replaced by `stockStatus` (`deducted`, `waiting`, `deducting`, `not_due`) |

`payment_confirmation_stock_rejected` is removed. Amounts, buyer data, payloads, receipt ids and checkout tokens are never logged.

## 14. Tests

### Shared (T0)

`shared/orders-fulfillment` (current runner):
- `test("ship is blocked only while the order waits for stock")`
- `test("deliver is blocked while the order waits for stock or is being deducted")`
- `test("the payment reason comes before any stock block")`
- `test("an order that is not due keeps the stock-not-deducted reason for deliver")`

### Core unit (T1)

`domain/stock-deduction.test.ts`:
- `test("an order is due when confirmed payments cover the total")`
- `test("an order is due when a confirmed partial payment asked to deduct stock")`
- `test("an order is not due when its only partial payment did not ask to deduct stock")`
- `test("a voided payment that asked to deduct stock no longer makes the order due")`
- `test("cancelled, deducted or shipped orders are never due")`
- `test("plans the deduction only when every item has enough stock")`
- `test("lists the short items in item order with the available units")`
- `test("a variant missing from the stock map counts as zero")`
- `test("describes a due order with short items as waiting")`
- `test("describes a due order whose items all fit as deducting")`
- `test("describes deducted and not due orders as having no stock due")`

`application/deduct-due-stock.test.ts` (fakes):
- `test("deducts every item of a due order that fits and marks it deducted")`
- `test("leaves a due order with a short item undeducted and writes nothing")`
- `test("does nothing for an order that is not due")`
- `test("returns failed without throwing when the order's stored data is invalid")`
- `test("returns a transaction-ending failure so the producer rolls back")`
- `test("contains a lock timeout on the stock rows and reports it as failed")`
- `test("the overdue trigger skips a locked stock row instead of waiting")`
- `test("serves waiting orders oldest first and skips one that does not fit")`
- `test("serves a waiting order with a deactivated variant")`
- `test("skips a waiting order locked by another transaction")`
- `test("skips a waiting order with invalid stored data and serves the others")`
- `test("sets each serving statement's timeout to the budget left")`
- `test("reports a statement timeout while serving as budget exhausted")`
- `test("stops before the next statement when the budget is spent")`
- `test("deducts every served order with one bulk statement")`

`application/register-payment.test.ts`:
- `test("records a covering payment with short stock and returns the waiting order")`
- `test("records a covering payment with enough stock and returns the deducted order")`
- `test("records the payment when the deduction fails with invalid stock data")`
- `test("stores the partial deduction request on the confirmation")`
- `test("a repeated approval publishes nothing and returns the current order")`

`application/set-delivery.test.ts`, `checkout.test.ts`:
- `test("saves a delivery that makes payments cover the total even with short stock")`
- `test("an unchanged delivery publishes no event")`
- `test("the buyer confirms a cheaper delivery with short stock")`

`application/create-complete-order.test.ts`, `register-immediate-sale.test.ts`:
- `test("creates an order with covering payments and short stock as waiting")`
- `test("refuses delivering immediately with short stock, names the short variant and persists nothing")`
- `test("answers a data fault while delivering immediately as INVALID_STORED_DATA, never as insufficient stock")`
- `test("answers a contended deduction while delivering immediately as PERSISTENCE_UNAVAILABLE")`
- `test("ignores the old deferral option")`

`application/recover-due-stock-deductions.test.ts`:
- `test("publishes one overdue event per candidate, oldest first within each company")`
- `test("runs three passes twenty seconds apart and skips a pass that would start after forty-five seconds")`
- `test("shares each pass's order budget across companies and rotates the first company")`
- `test("quarantines an order with a data fault and logs it once per quarantine")`
- `test("retries a contended order on the next pass without quarantine")`
- `test("counts each outcome and logs only deducted orders as recovered")`
- `test("stops when the signal aborts or the pass budget is spent")`
- `test("keeps going after a failed order and fails only when listing companies fails")`

`shared/events/application/in-transaction-events.test.ts`:
- `test("runs the event's handler and returns its outcome")`
- `test("refuses to publish outside a transaction of the payload company")`

`products/application/restore-cancelled-order-stock.test.ts`:
- `test("publishes only the restored variants after incrementing their stock")`
- `test("a duplicate cancellation event publishes nothing")`
- `test("a contained waiting-order failure still commits the restoration")`
- `test("only a failed increment or a transaction-ending error makes the restoration retryable")`

### Core integration, PostgreSQL (T1)

`orders/presentation/api-routes.integration.test.ts`:
- `test("approving a covering report with short stock confirms it and leaves the order waiting")` (criterion 1)
- `test("approving a covering report with enough stock answers already deducted")` (2)
- `test("a partial payment with deduction request and short stock is recorded as waiting")` (4)
- `test("cancelling an order that deducted stock deducts the waiting order it now covers")` (5)
- `test("a restock serves the oldest waiting order that fits and leaves the larger one waiting")` (6)
- `test("a restock of one variant leaves an order short of another variant waiting")` (7)
- `test("a cancelled waiting order is not deducted on restock")` (8)
- `test("voiding the covering payment takes the order out of waiting")` (9)
- `test("a delivery change that raises the total takes the order out of waiting")` (10)
- `test("saving a delivery that covers the total with short stock answers the waiting order")` (11)
- `test("the checkout confirms a cheaper delivery with short stock")` (12)
- `test("creating an order with payments and short stock saves it waiting")` (13, 15)
- `test("creating an order with covering payments and enough stock on the server saves it deducted")` (14)
- `test("creating a paid and delivered sale with short stock answers INSUFFICIENT_STOCK and persists nothing")` (15)
- `test("approving the same report twice records one payment and deducts once")` (18)
- `test("two restocks in quick succession deduct a waiting order once")` (19)
- `test("a waiting order takes restored units before a concurrent new sale")` (21)
- `test("a queued sale with the old deferral option is saved as a plain save")` (22)
- `test("shipping a partially paid order with short stock still answers INSUFFICIENT_STOCK")` (23)
- `test("the deduct-stock route no longer exists")`
- `test("every order detail response carries stockDue with the current available units")`
- `test("list pages make no stock read")`

`orders/infrastructure/order-repository.integration.test.ts`:
- `test("a partially paid order without deduction request is never listed as waiting or overdue")`
- `test("lists waiting orders of a variant oldest first, due and fitting, within the company")`
- `test("locks a set of orders in one statement and skips those held elsewhere")`
- `test("lists overdue orders only when every item fits the current stock")`
- `test("the overdue companies lookup returns only company ids and other companies' orders stay invisible")`
- `test("stores and reads the partial deduction request of a payment")`
- `test("a savepoint rollback keeps the producer's writes")`
- `test("a rolled-back savepoint discards its after-commit observers and restores the abort state")`
- `test("a released savepoint runs its after-commit observers only when the outer transaction commits")`
- `test("a statement timeout inside a savepoint is recovered and the outer transaction commits")`
- `test("the SQL due-and-fit rule and isStockDeductionDue agree on zero totals, overpayment, null amounts, voided requests and shipped or delivered orders")`
- `test("restock and recovery order locks do not block a payment report insert on the same order")`

`products/infrastructure/order-stock.integration.test.ts`:
- `test("locks stock rows in variant order and skips rows held by another transaction")`
- `test("the bulk decrement changes every row or none")`
- `test("reads stock of inactive variants")`

`composition/event-handlers.integration.test.ts`, `scheduled-jobs.test.ts`:
- `test("the restoration worker deducts covered waiting orders in the same transaction")`
- `test("a restock in one company never serves an order of another company")`
- `test("a waiting order with invalid stored data does not stop the restoration")`
- `test("a waiting-orders query that exceeds the serving budget still commits the restoration and leaves the orders to recovery")`
- `test("a failed increment rolls back the restoration and is retried")`
- `test("a payment whose stock-row wait times out is still recorded")`
- `test("a payment waiting on a restock's stock rows completes within the transaction timeout")`
- `test("the recovery job deducts a due order that becomes overdue right after a pass within the worst-case bound")` (17, measured against a running worker)
- `test("the recovery job never runs twice at once across two workers")`
- `test("the recovery schedule survives a worker restart")`

### Web (T2)

Component and route tests, plus E2E (`apps/core/tests/e2e/order-waiting-stock.spec.ts`), listed in §16.

### Mobile (T3)

Listed in §16.

### Pending manual checks

- On a small phone, the mobile status line does not push the payment buttons below the fold.
- With the worker stopped and then restarted, an order that shows «Descontando stock» is deducted within a minute of the restart.

## 15. Limits and checks during implementation

- Out of scope: list badge or filter, manual ordering of waiting orders, partial deduction, label batch marks, notifications.
- Rare accepted case. Suppose that at the instant of a restock a waiting order, or a stock row of one of its other variants, is locked by another operation, **or the serving budget runs out before that order** (`budgetExhausted`). The units the increase added then stay free until recovery, and a concurrent newer paid sale can take them before recovery serves the older order. The same gap opens through the payment path: an order left «Descontando stock» by a contained failure (a lock timeout, for example) holds no units until recovery, so a newer covering payment or a ship on the same variants can take them, and the older order then shows «Esperando stock». An oldest-first check in the payment listener would close it and is not worth its cost. Both paths deviate from the product rule «New sale versus waiting orders» and are listed for the founder in §17.
- The `order_cancelled` publication can still be lost (memory f4d3c120). Recovery does not restore stock.
- The cost of the definer function and of the partial index grows with all pending, undeducted orders on the platform, including abandoned unpaid orders, and recovery evaluates it three times a minute. The `listCompaniesMs` (> 1000 ms) and `durationMs` (> 3000 ms) warnings in `stock_deduction_recovery_pass_completed` make that growth visible before the pass budget hides it.
- `cronMonitorIntervalSeconds: 10` also applies to the existing daily and 5-minute jobs. That is harmless: they keep their schedules.
- pg-boss 12.35 throttles cron to one job per minute (verified in `timekeeper.js`), so the cadence comes from passes inside one minute job (§5.7). Verify in T1 that `stately` keeps a second worker from running the same minute's job, and that `expireInSeconds` 58 lets a stuck run free the queue before the next slot.
- Quarantined orders are worker-local and forgotten on restart, and with several worker replicas each replica keeps its own quarantine. Accepted: it costs one transaction and one error log per order, per replica, per restart or per 10 minutes. A persisted quarantine is not worth a column.
- The 42 s bound of §5.7 holds while passes are not cut by their budget. A company backlog above its fair share (right after release, when existing paid orders become due, or after a worker outage) defers the rest to later passes, 20 s each; `budgetExhausted` (warn) shows it. Without a backlog, 200 overdue orders per 20 s is far above any real rate.
- Not applied (performance r3 S7): the definer function could return `(companyId, orderId)` pairs and remove `listOverdueOrderIds`, one scan per pass instead of `1 + K`. It is a later simplification if the §13 warnings fire.
- Verify that the stored-data validation errors inside `loadStockOrders` are produced after the query returns, so they never mark the transaction scope as aborted.
- Transaction-local settings made inside a savepoint survive `RELEASE` and are undone by `ROLLBACK TO SAVEPOINT`; the publisher restores the producer's values explicitly in both cases, and an integration test checks the timeout after a released serving savepoint.
- Verify that the restricted role can execute the definer function and still cannot read other companies' rows.
- `deferStockDeduction` stays in `createOrderSchema` only for queued sales. Removing it later is an improvement with no risk.
- Design-gate suggestion F9 is applied only in part. Web UI (T2) waits for T1, because the `order-detail.tsx` loader and actions need T1's use case outputs, and running them in parallel would make two tasks edit that file at once.

## 16. Implementation plan

### Order and parallelism

```text
Wave 1:  T0 shared contract, helper and client fixtures
Wave 2:  T1 core backend   ∥   T3 mobile UI
Wave 3:  T2 web UI (needs T1: order-detail.tsx loader/actions and use case outputs)
Final:   verification on web and on a device
```

Merge order: T0 first. T1 and T3 merge in either order; until T1 merges, every response carries `stockDue: null`, which is valid and shows no notice. T3's checks against a live core run after T1 merges. T2 starts after T1 merges.

Shared files:
- Only T0 edits `shared/`.
- Only T1 edits `prisma/`, `composition/`, `shared/events`, `shared/infrastructure`, the core feature internals, `docs/event-bus.md` and the architecture guide.
- T1 edits `order-detail.tsx`, `order-list.tsx`, `checkout.tsx` and `payment-decision-form.tsx` only for data (and to keep typecheck green when `INSUFFICIENT_STOCK` leaves the unions), before T2 starts.
- T3 owns `apps/mobile`.

### T0. Shared contract and fulfillment helper

**Scope:**
- `orderStockDueSchema` and `stockDue` on `orderAggregateSchema`;
- `registerPaymentResponseSchema` as `{ order }`, together with the route projection at `api-routes.ts` (`POST /:id/payments` answers `{ order }`), so the strict schema never rejects a response between merges;
- `stockFulfillmentBlock` and `orderFulfillmentBlock`;
- `stockDue: null` in client and core test fixtures that parse the aggregate strictly;
- core `toOrderAggregateJson` emits `stockDue: null` until T1 describes it (no client shows it before T1 and T3 merge);
- the T0 tests in §14.

**Out of scope:** any behavior change in core or the clients other than dropping `stock` from the payment response.

**Acceptance criteria:**
1. The contract and helper compile and are exported.
2. `POST /api/orders/:id/payments` answers 200 with `{ order }` and `order.stockDue = null`.
3. `pnpm --dir apps/core typecheck`, `test:unit`, `sh scripts/run-tests.sh integration` and `pnpm --dir apps/mobile typecheck`, `test` are green.

**Depends on:** nothing.

### T1. Core: payments always accepted and deduction through in-transaction events

**Scope:** §5–§9, §11–§13 for core; the T1 tests in §14; the docs for the exception.

**Out of scope:** web and mobile UI, copy, Portuguese texts, E2E.

**Acceptance criteria:**
1. Order with 4 Camisa M, stock 3, S/ 40.00 paid of S/ 120.00. Approving the S/ 80.00 report answers 200 with `paymentStatus = "paid"`, `stockDeducted = false` and `stockDue = { kind: "waiting", shortItems: [{ variantId, available: 3 }] }`. Stock stays at 3.
2. The same order with stock 4 answers `stockDeducted = true` and `stockDue = null`. Stock goes to 0.
3. Cancelling #1008 (2 deducted, stock 2) while #1012 waits for 4: one restoration transaction leaves stock at 0 and #1012 deducted.
4. A restock to 3 with #1010 (5, older) and #1012 (2) waiting: #1012 is deducted, and #1010 stays waiting with `available: 1`.
5. With 300 partially paid orders without deduction request, `listOverdueOrderIds` and `listWaitingOrderIds` return none of them.
6. With a running worker, an order inserted as due and undeducted with enough stock right after a recovery pass listed its company is deducted within 45 s (the §5.7 bound of 42 s plus margin), measured over at least 10 insertions at different offsets of the minute; `stock_deduction_recovered` is logged. The PR reports the measured maximum.
7. A stock row with an invalid quantity under a covering payment: the payment commits, the order shows `deducting`, and `stock_deduction_failed` is logged. A restoration whose oldest waiting candidate has invalid data still commits and serves the next candidate. A restoration whose `listWaitingOrderIds` is forced to exceed the budget (for example with `pg_sleep` in a test-only query hook) commits with its stock restored and `budgetExhausted: true`.
8. A delivery change or checkout that makes payments cover the total with short stock answers success with `stockDue.kind = "waiting"`.
9. A restoration that serves 100 candidates finishes within about 1 s and never reaches its 5 s timeout. With 10,000 unpaid pending orders in the same company and zero or one candidate, `listWaitingOrderIds` stays under the 500 ms serving budget; its time is reported in the PR. A payment that waits on its stock rows completes within its 2 s lock timeout, and a payment whose wait is forced past it is still recorded. Both durations are reported in the PR, and `WAITING_ORDERS_BATCH_SIZE` and `WAITING_ORDERS_BUDGET_MS` are kept or lowered from them.
10. `POST /api/orders/:id/deduct-stock` answers 404. No production code outside `deduct-due-stock.ts` and `fulfill-order.ts` decrements `ProductStock`.
11. `docs/event-bus.md` has an "In-transaction events" section (when to use them, same-database writes only, idempotent, no external I/O, where the registry lives), and guide rule 6.7 states the exception.
12. The PR attaches an `EXPLAIN` of the three due-and-fit queries, each confirming `Order_undeducted_pending_idx` (or, for `listWaitingOrderIds`, the chosen `OrderItem` drive).
13. `lint`, `typecheck`, `test:unit` and `sh scripts/run-tests.sh integration` in core, and mobile `typecheck` and `test`, are green.

**Depends on:** T0.

### T2. Web: waiting-stock notice, buttons and payment texts

**Scope:**
- `order-detail.tsx`:
  - the notice between the header and the cards;
  - the «Detalles internos» line with four values;
  - «Marcar enviado» and «Marcar entregado» driven by `orderFulfillmentBlock`;
  - a reload when a tap meets short stock.
- `order-payments-card.tsx`, `payment-decision-form.tsx`: success texts from `order.stockDue`, no stock rejection, «Pago actualizado.» kept for void and reject.
- The «Entrega» card texts.
- `order-new.tsx`: per-item note; saving with payments and short stock; the refusal of «Confirmar cobro y completar venta».
- `checkout.tsx`: the stock message is removed.
- `app/locales.ts`: Spanish and Portuguese.
- The E2E test.

**Out of scope:** core use cases, contracts, mobile.

**Acceptance criteria:**
1. Product criterion 1 on web: «Pago registrado. El pedido queda esperando stock.» and «Camisa (M): 4 en el pedido, hay 3.».
2. Product criterion 16 on web: «Para despachar falta stock de Camisa (M) y Polo (L).».
3. An order being deducted shows «Descontando stock»: ship is enabled, and deliver is disabled with its reason.
4. A delivery that leaves the order waiting shows «Entrega guardada. El pedido queda esperando stock.».
5. Product criterion 15 on web.
6. The notice of a catalog order never says «pediste» (criterion 20).

**Tests:**
- `test("shows the waiting notice with each short item and its available units")`
- `test("shows the deducting notice when every item fits")`
- `test("shows no notice for deducted or not due orders")`
- `test("shows the four internal stock line values")`
- `test("disables ship and deliver with the short items as a list")`
- `test("reloads the order when shipping meets short stock")`
- `test("chooses the payment success text from the returned order")`
- `test("saves a new sale with payments and short stock")`
- `test("a catalog order's notice never says pediste")`
- E2E `test("the seller approves a report with short stock and sees the order waiting for stock")`

**Depends on:** T0, T1.

### T3. Mobile: waiting-stock notice, status line and «Nueva venta» without the stock dialog

**Scope:** the §10 files and the product draft's mobile texts, including Portuguese.

**Out of scope:** core, web, the queue's retry rules.

**Acceptance criteria:**
1. Product criterion 3: the sheet closes and the products card shows «Pago registrado. El pedido queda esperando stock.», plus the notice.
2. Product criterion 13: **Guardar** sends one request with every payment and no `deferStockDeduction`.
3. Product criterion 16 for store pickup: «Para entregar falta stock de Camisa (Talla: M).».
4. A sale queued with `deferStockDeduction` before the update is re-sent unchanged.
5. The notice of a catalog order never says «pediste» (criterion 20).

**Tests:**
- `test("shows the waiting notice after the heading block with each short item")`
- `test("shows the four internal stock line values")`
- `test("announces the payment status line once and clears it on the next action")`
- `test("disables the next fulfillment action with the short items")`
- `test("reloads the order when dispatching meets short stock")`
- `test("saves a short-stock sale with every payment and no dialog")`
- `test("keeps blocking a delivered sale with short stock")`
- `test("labels the partial deduction box «Descontar stock con abono parcial» in every sheet")`
- `test("saving a covering delivery with short stock returns to the detail, which shows the waiting notice")` (product criterion 11, mobile)
- `test("a store-pickup order being deducted shows «Marcar como entregado» disabled with the deducting reason")` (product criterion 17, mobile)
- `test("a catalog order's notice never says pediste")`

**Depends on:** T0. Component tests use fixtures; checks against a live core run after T1 merges.

### Final verification

On web, against Docker Compose with the worker running:
- product criteria 1, 2, 5, 6, 11, 15, 16 and 17;
- for 17: stop the worker, insert an overdue order, start the worker, and see the order deducted within a minute.

On a device:
- criteria 3, 13, 14 and 16;
- the small-screen check.

The results go in the PR description.

## 17. Decided unless objected

- Deduction runs only in the orders listener. Payments, deliveries, checkout and products publish in-transaction events.
- Each handler runs in a savepoint with a stated contract (observers and abort state restored on rollback). Only transaction-ending failures (Prisma timeout, lost connection) roll back the producer. Statement-level errors (lock and statement timeouts, deadlocks) and data faults are contained, logged and left to recovery, so a payment always commits and a restoration always commits once its increments succeed.
- Producers that publish run with `lockTimeoutMs` 2000 and `statementTimeoutMs` 3000 under the 5000 ms Prisma timeout; each listener savepoint narrows both to `min(1000, 4000 − elapsed)` ms.
- Ship deducts in its own transaction with the same bulk capability. Deliver never deducts. Delivering at creation and `registerImmediateSale` deduct through `payment_confirmed`; they answer `INSUFFICIENT_STOCK` with the short `variantId` only when stock is short, `INVALID_STORED_DATA` for a data fault and `PERSISTENCE_UNAVAILABLE` for a contended deduction.
- The four events and the publisher's registry live in `orders/composition.ts`.
- `Payment.deductStockIfPartial` is a new column (default `false`).
- The due rule is implemented in full in the three SQL prefilters, and the domain re-checks it under lock.
- Restocks run a fixed number of statements, with at most 100 candidates and a 500 ms budget enforced per statement (one `set_config` of `statement_timeout` / `lock_timeout` to the time left), `FOR NO KEY UPDATE SKIP LOCKED`, and restoration timeouts 5000 / 2000 / 2000 ms. A serving timeout is contained.
- Recovery runs as one pg-boss cron job per minute (`* * * * *`) with three passes at 0, 20 and 40 s:
  - `stately` queue, `retryLimit` 0, 58 s expiry, kept alive by the schedule row;
  - each pass capped at 200 orders and 10 s, shared fairly across companies with a rotating start;
  - data-fault orders quarantined for 10 minutes in the worker, logged once per quarantine;
  - `cronMonitorIntervalSeconds` 10;
  - one transaction per order, `FOR NO KEY UPDATE SKIP LOCKED`, stock rows `skip_locked`;
  - worst case about 42 s.
- `stockDue` is added to the aggregate and computed in the producer's transaction or in a read snapshot, reading stock only for due orders. List pages never compute it; labels compute it once per batch.
- `registerPaymentResponseSchema` becomes `{ order }`.
- `orderFulfillmentBlock` is the single client entry point.
- `deduct-stock` is removed. `deferStockDeduction` stays optional and is ignored.
- Existing paid, undeducted orders become due with no migration.
- Two migrations: the column and index, then the definer function in its own SQL-only migration.
- Waves: T0 (including the payment route projection), then T1 ∥ T3, then T2.

Deferred with real risk, without a Todoist task:
- the rare oldest-first gap in §15: an order locked elsewhere or cut by the serving budget at a restock, or left «Descontando stock» by a contained payment-path failure, can lose units to a newer sale until recovery;
- worker-local quarantine: one error log per data-fault order, per replica, every 10 minutes and after each restart;
- the 42 s bound holds only while recovery passes are not budget-cut (backlog after release or a worker outage);
- the existing lost `order_cancelled` publication.

## 18. Questions decided by the review gate

| Question | Answer | Decided by | Reason | Discarded alternatives |
| --- | --- | --- | --- | --- |
| Q1. In-transaction events plus recovery, or pg-boss after commit with an outbox? | (1) In-transaction events plus bounded recovery. Conditions: the exception to rule 6.7 is documented (T1 criterion 11); errors are contained per order; every listener has a hard time bound inside its producer, and a restoration never depends on serving; the 1-minute bound is verified under the performance limits (§2, §11, T1 criteria 6 and 9) | Every design and performance reviewer of rounds 1 to 3, confirmed by the coordinator | It is the only option that gives an already-deducted response «como hoy», a restock with its deduction in one step, and no outbox. It also does less work per payment | pg-boss after commit with a transactional outbox: it reverses the "no outbox" decision, shows a false «Descontando stock» on every covering payment, and lets newer sales take restored units |

Round 1 findings, and how the draft answers them:

- Design F1 (blocker): savepoint containment; only transaction-ending failures roll back (§2, §5.1, §9; narrowed in round 3).
- Performance B1 (blocker): the full due rule in SQL (§7).
- Performance B2 (blocker): budget, timeouts, set-based statements (§2, §5.1, §11).
- Design F2: sub-minute recovery, measured in T1 criterion 6 (mechanism replaced in round 3, see below).
- F3: outcomes returned through the publisher.
- F4: `stockDue` in the producer's transaction or a snapshot.
- F5: the chat window is removed (it does not exist).
- F6: docs owned by T1.
- F7: registry in `orders/composition.ts`.
- F8: tests added.
- F9: partial T0 (reason in §15).
- F10: `orderFulfillmentBlock`.
- F11: `variantId` kept.
- F12: concurrent payment wait measured (T1 criterion 9).
- Performance S1: outcome patch, no re-read.
- S2: query shape through the partial index, plus `EXPLAIN`.
- S3: §15 note and the `durationMs` warning.
- S4: `stately`, `retryLimit` 0, signal, run cap.
- S5: lists never describe; labels once per batch.
- S6: meeting contract (§5.6).
- S7: bounded lock waits in the migration (layout fixed in round 3).
- S8: confirmation only, no change.

Objections applied to the decided list:

- the rollback rule, now replaced by containment (design);
- the recovery bound becomes an acceptance criterion (design, performance);
- the chat case is removed (design);
- the partial T0 (design);
- the single client composition (design);
- the full due rule and the S4 guards for recovery (performance);
- the budget and timeouts for the batch of 100 (performance);
- no `stockDue` on lists or labels (performance).

None contradicts the closed product definition.

Round 2 findings, and how the draft answers them:

- Performance B1 (blocker): the serving budget is enforced per statement with transaction-local `statement_timeout` / `lock_timeout`, and any error while serving is contained, so the restoration always commits (§2, §5.1, §5.6, §9, §11; T1 criterion 7).
- Design B1 (blocker): pg-boss 12.35 throttles cron to one job per minute, so recovery is one cron job per minute with three passes 20 s apart; worst case redone at about 42 s (§2, §5.7, §17; T1 criterion 6).
- Design S1: savepoint contract on observers, abort cause and nested failed results (§7), with tests.
- Design S2 and performance S5: errors split into transaction-ending and statement-level; producers get `lockTimeoutMs` 2000 below the Prisma timeout (§2, §11).
- Design S3 and performance S1: recovery locks stock rows `skip_locked` and §11 states which paths wait.
- Design S4 and performance S2: fair share per company with a rotating start, worker-local quarantine of data-fault orders, logs once per quarantine (§5.7).
- Design S5: `failed` outcomes answer `INVALID_STORED_DATA` or `PERSISTENCE_UNAVAILABLE`, never `INSUFFICIENT_STOCK` (§5.4, §5.5).
- Design S6: T0 also changes the payment route projection and runs core integration tests; merge order stated (§16).
- Design S7: SQL/domain parity test on shared fixtures (§14).
- Design S8: the budget cut is part of the accepted deviation and of the deferred list (§15, §17).
- Design S9: T3 test for product criterion 11 on mobile.
- Performance S3: two migrations, function in its own SQL-only migration, bounded lock waits per statement (§7).
- Performance S4: `FOR NO KEY UPDATE` for restock candidates and recovery; `findOrderForUpdate` keeps `FOR UPDATE` (§11).
- Performance S6: §15 states the three-per-minute cost; warnings on pass duration and on the definer function's duration (§13).

Round 3: both reviewers approved, with no blockers and no objections to §17. Its suggestions, and how this version answers them:

- Design S1: one consistent rule for transaction-local settings in savepoints, restored explicitly after release and rollback (§2, §15).
- Design S2: the 42 s bound is stated as holding while passes are not budget-cut (§5.7, §15, §17).
- Design S3: the payment-path variant of the oldest-first gap is added to §15 and §17.
- Design S4: `checkout.tsx` and `payment-decision-form.tsx` are T1 data-only edits (§12, §16).
- Design S5: §12 lists both migrations; the lock bound uses `SET LOCAL` in an explicit transaction (§7).
- Design S6: `findVariantStock` is listed as a dependency of `registerPayment` and `persistDeliveryChange` (§5.2, §5.3).
- Design S7: T3 test for the deducting deliver reason on mobile.
- Design S8: the per-replica quarantine is accepted in §15 and §17.
- Performance S1: `listWaitingOrderIds` shape chosen by `EXPLAIN` between the index walk and the `OrderItem` drive; criterion 9 adds a 10,000-order backlog (§7, §16).
- Performance S2: one `set_config` statement per serving statement (§2, §5.1).
- Performance S3: each listener savepoint gets `min(1000, 4000 − elapsed)` ms, so contention ends before P2028 (§9, §11).
- Performance S4: `describeOrderStockDue` reads stock only for due orders (§5.9).
- Performance S5: `loadStockOrders` is one raw SQL statement with `json_agg` (§7).
- Performance S6: one shared predicate fragment with the index literals; `EXPLAIN` confirms the index (§7, T1 criterion 12).
- Performance S7: not applied, recorded in §15 as a later simplification.

Round 2 objections to the decided list, applied in round 3: the rollback rule narrowed to transaction-ending errors; the recovery cadence replaced; the `failed` outcome codes; the T0 route projection; the budget cut in the deferred list; the per-statement serving budget; recovery fairness and stock-row mode; the migration layout. None contradicts the closed product definition.
