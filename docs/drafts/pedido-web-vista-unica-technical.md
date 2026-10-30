# Single order view on web: technical design

**Status:** design closed, pending implementation. The questions were decided by the architecture review gate (round 3 approved by both reviewers, §17) and are pending the founder's confirmation in the pull request. Based on `docs/drafts/pedido-web-vista-unica.md`. Base: branch `jorgeluis594/pedido-web-1-3-vista-unica-de-nueva-vent`, commit `a475b875`.

## 1. Technical goal

Core gets one seller operation, `editOrder`. It applies the final state of an order's items, its customer and, optionally, its delivery in one transaction under the order lock. Each part is refused only when something changed that same part since the view loaded it, or when the order's state locks it. The operation never touches payments and never deducts stock itself. When items or delivery change, it publishes the in-transaction event `order_edited`, and the existing orders listener deducts the stock if the order became due.

On the web, one order view replaces «Nueva venta» and the order detail. It is built from shared cards, a floating product picker and a pure draft-state module. The view sends **Guardar venta** to the existing creation and **Guardar cambios** to `editOrder`. It pins the saved state and the revisions it edits against, so a refresh never moves them under pending edits.

```text
order view (web) ── Guardar venta ──► createCompleteOrder (unchanged)
      │
      ├── Guardar cambios ──► order-detail action "save_changes" ──► editOrder
      │                                                    │  lock order row
      │                                                    │  drop parts already applied; check state locks; check part revisions
      │                                                    │  resolve new/raised variants (products) / quote delivery (delivery-settings)
      │                                                    │  write items, customer, delivery
      │                                                    └► publish order_edited (in transaction) ──► deductDueOrderStock
      └── payments, ship, deliver, cancel ──► existing actions (unchanged)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Scope | Core: `editOrder` with its tests. Web: the order view for new and saved orders, the picker, the header and list labels, and the Spanish and Portuguese texts. Checkout: a confirmed order may have no buyer details, in the domain rule and in the shared public checkout contract. Mobile: no change. |
| Entry point | The `orders/:orderId` route action, with a JSON body carrying `operation: "save_changes"`. No `/api/orders` route is added in this version. The mobile task adds `PATCH /api/orders/:id` on the same use case (gate decision 1). |
| Edit request | It carries the final state per part, never increments: `items.lines` (variant and quantity), `customer.value` (name and phone, or `null`) and `delivery.change` (`replace` or `amend`). A part that is absent is not touched. |
| Conflict detection | Per-part content revisions. The view receives `revisions: { items, customer, delivery }`, a digest of each part as stored, and sends back the revision it pinned for each part it edits. Under the order lock, core recomputes the revision of every sent part and refuses with `ORDER_CHANGED` when it differs. No version column is added, and no other writer has to change. |
| Pinned base | For each part, the view keeps the saved state and revision it loaded. It replaces them only while that part has no unsaved edits: on load, after its own successful save, after a discard, and after a reload the seller confirms. A refresh after **Anular pago**, **Rechazar** or any other action updates payments, totals, payment status, stock state and the parts without edits. An edited part keeps its pinned base, so a change made elsewhere meanwhile is answered as `ORDER_CHANGED` on save. |
| Idempotent repeat | Before any lock or revision check, a sent part whose stored state already equals the requested state is treated as applied and dropped. Repeating a save after an in-doubt answer therefore succeeds, even if the first attempt deducted the stock or the order was shipped since, and it doubles nothing. |
| State locks enforced by core | For the parts that remain: a cancelled order refuses every edit (`ORDER_CANCELLED`). A delivery that is no longer pending refuses items and delivery edits (`DELIVERY_LOCKED`). Deducted stock refuses items edits (`ITEMS_LOCKED`). The «Descontando stock» lock is a screen rule only. |
| Payments | `editOrder` reads payments only to derive the summary. A payment change never invalidates an edit, because payments are not part of any revision. |
| Stock | `editOrder` publishes `order_edited` when items or delivery changed. The existing listener deducts the stock or leaves the order waiting. The save is never refused for stock. |
| Stock and sellable state of saved lines | The detail loader and the save result read them with one new products query, `findSellableVariantStock(variantIds)`: the stock of the order's variants that are active in an active product, the same filter as `findSellableVariants`. A variant missing from the result is not sellable. No cap applies: the read is bounded by the order's own lines. If the read fails, `lineCatalog` is `null` («stock unknown»): the order stays readable and editable without stock warnings, and core still refuses an unsellable variant on save. When the stored order already locks its products (cancelled, delivery not pending or stock deducted), the read is skipped and `lineCatalog` is `null` without a query; the locked card shows no stock warning and no «unknown» text either way. |
| Prices | A variant in the order before and after the save keeps its item row: id, copied name, combination, SKU, unit price and mentioned price. A new variant takes the current catalog price. |
| Deactivated variants | A kept line of a deactivated variant may keep or lower its quantity. Raising it, or adding a deactivated variant, answers `VARIANT_NOT_FOUND` with its `variantId`. |
| Quantity limit | 1 to 9999 per line, and at most 100 lines (`maxOrderLineQuantity` and `maxOrderLines` in `shared/orders-edit.ts`, initial values, adjustable). The view and the request schema use them. Creation keeps its own limits. |
| Customer | `customer.value: { name, phone }` sets or replaces the customer. `null` empties it: an order linked to a contact keeps the contact with empty name and phone, and any other order loses its `OrderBuyer` row («Público general»). |
| Delivery | `replace` quotes again through the existing resolver (`expectedPrice`, `TOTAL_CHANGED`, `RATE_UNAVAILABLE`). `amend` changes only the recipient, the home address text or the reference. It keeps the stored pricing and is never quoted. In both cases the author becomes the seller. |
| Checkout | `checkoutState` stops requiring buyer details on a confirmed order, and so does the shared `publicCheckoutSchema` in `shared/contracts/order-checkout.ts`, which the buyer's checkout route parses. A confirmed order whose customer was cleared shows empty, read-only details and stays confirmed. The order repository applies `checkoutState` to every order it reads, so this change is a prerequisite of `editOrder`. |
| New sale | **Guardar venta** keeps `createConfiguredOrder` and `completeOrderSchema`. The in-doubt check reads `GET /api/orders/:id/aggregate` with the same order id. The «Nueva venta» loader stops searching the catalog: the picker loads products on demand. |
| Picker data | `GET /api/orders/catalog` gains an optional `inStock=true` flag that filters on the server: products with at least one active variant in stock, shown with all their active variants. Existing callers (mobile `search` and `variantIds`) are unchanged. `variantIds` is capped at 100. |
| Picker requests | The search is debounced by 250 ms (initial value, adjustable); the first, empty query is not debounced. A new request aborts the previous one (`AbortController`), and only the latest request may set the results. The previous results stay visible while loading, and a new result set clears the highlight. The empty-query result is cached per `inStock` value (key `(text, inStock)`, only for an empty text) in `useCatalogSearch`, a hook mounted by the view and passed to the picker, so the cache outlives the dialog between openings. The view bumps a catalog epoch after a successful save and after every loader revalidation. An epoch change only drops the cache; the next opening of the picker fetches again, so a closed picker never sends a request. Stock and «✓ n» never stay stale after a save or a payment action. |
| Photos | Lines and picker results show initials, not photos (gate decision 2). |
| Texts | W1 adds every new key in `apps/core/app/locales.ts` (es and pt). A renamed or removed existing text is changed by the task that owns the code and the assertions it affects (§16). |
| Migration | None. No table or column changes. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Order aggregate and state machine | `apps/core/src/features/orders/domain/order-state-machine.ts` | `appendItems`, `removeItem`, `setItemQuantity`, `replaceItemVariant` and `withItems` exist, but they are only exercised by the chat path through `applyChatActions`. `setDelivery`, `canSetDelivery`, `getPaymentSummary` and `getLifecycle` are public. |
| Item price and total rules | `domain/order.ts` (`buildOrder`) | Validates items, allows one item per variant, and checks that subtotals and totals stay within range. Reused by `withItems`. |
| Chat item editing | `application/apply-chat-message.ts`, `domain/chat-order.ts` | Edits items of open orders (no confirmed or reported payment). Persists them with `saveItemChanges(order, ChatOrderItemChanges)`. `ChatOrderItemChanges` is imported by `apply-chat-message.ts` and `order-repository.ts`. |
| Item persistence | `infrastructure/order-repository.ts` `saveItemChanges` | One `deleteMany`, one `update` per changed item, one `create` per added item sorted by `variantId`, then the totals. A missing-variant foreign-key violation answers `PERSISTENCE_UNAVAILABLE`, which the chat path retries. |
| Item read order | `order-repository.ts` `aggregateInclude` | Items and payments are read ordered by `id`. |
| Order read invariant | `order-repository.ts` (about line 167) | Every stored order goes through `checkoutState`. A confirmed order without a valid buyer throws `InvalidStoredOrderError` in the detail, the list and the stock listener. |
| Order lock | `order-repository.ts` `findOrderForUpdate(id, companyId, operation)` | Locks the order row and returns the full aggregate. It logs `delivery_lock_acquired` with `lockWaitMs` only for `set_order_delivery`. |
| Delivery save | `application/set-delivery.ts` (`setOrderDelivery`, `persistDeliveryChange`), `order-repository.ts` `saveDelivery` | Quotes through `resolveRatedShippingCost` with `expectedPrice` and publishes `order_delivery_changed`. Composed in `composition.ts` `setConfiguredOrderDelivery` with `producerOptions` (2000 ms lock, 3000 ms statement). Quoting is database-only, in a nested savepoint. |
| Recipient-only change precedent | `application/checkout.ts` `confirmCheckoutDelivery` (`kind: "keep"`) | Rewrites the recipient name and phone in the stored snapshot without quoting. |
| Public checkout contract | `shared/contracts/order-checkout.ts` `publicCheckoutSchema`, parsed by `app/routes/checkout.tsx` `serialize`; tested in `presentation/checkout-contracts.test.ts` | A `.refine` requires `checkoutBuyerSchema` (name and valid phone) when the state is confirmed. The contract test asserts that a confirmed view with `buyer: null` fails. `CheckoutBuyerDetails` (`checkout-sections.tsx`) prints `name · phone` and hides the card when `buyer` is `null`. `checkout-recipient.ts` uses `checkoutBuyerSchema` only to validate the buyer's own form; its prefill already reads `buyer?.name ?? ""`. Mobile imports only `checkoutLinkSchema` from this file. |
| Buyer persistence | `infrastructure/checkout-repository.ts` `saveBuyer` | Upserts `OrderBuyer` with a required phone (`ConfirmedBuyer`). No operation deletes or empties it. |
| Stock listener | `application/deduct-due-stock.ts`, `application/events.ts`, `composition.ts` | The in-transaction events `payment_confirmed`, `order_delivery_changed` and `order_stock_deduction_overdue` share `deductDueOrderStock(trigger)`. `orderWithStockDue` builds the response `stockDue` from the outcome. |
| Variant lookup | `products` `findSellableVariants(ids)` | One batched lookup of active variants with their price. Deactivated variants are absent. |
| Variant stock | `products` `findVariantStock(ids)` | One query of `ProductStock` without a status filter. `findSellableVariants` reads attributes and photos and caps `available` at 99, so neither gives the exact stock of the sellable variants alone. |
| Sale catalog | `products` `searchSaleCatalog(search, variantIds?)`, `GET /api/orders/catalog` (`api-routes.ts` `catalogQuerySchema`), `orderCatalogSchema` | One read snapshot of about 5 queries. Up to 20 active products by name, or exactly the given active variants with no limit. Each comes with attributes, SKU, price and stock, and no photo. Mobile calls it with `search` and with `variantIds`. |
| Shared delivery schemas | `shared/contracts/orders.ts` | `recipientSchema` and `agencyRecipientSchema` are private constants. `homeDeliverySnapshotSchema` requires `instructions` to be at least 1 character or `null`. |
| Web «Nueva venta» | `apps/core/app/routes/order-new.tsx` | The loader searches the catalog for the flat list (`newOrderLoaderSchema.products`). Payments, delivery, deliver-on-save. Its action calls `createConfiguredOrder` and redirects. No in-doubt handling. |
| Web order detail | `apps/core/app/routes/order-detail.tsx` | Read-only items and customer, «Desde el catálogo» badge, `OrderPaymentsCard`, delivery editor, ship, deliver, cancel, «Detalles internos», label printing. The action sends every `application/json` request to `deliveryAction`. `clientAction` passes JSON through without catching a lost response. `shouldRevalidate` revalidates after every action except cancellation. |
| Lost-response helper | `apps/core/app/routes/lost-response.ts` | Tells «offline» from «in-doubt». |
| Payment card | `apps/core/src/features/orders/presentation/order-payments-card.tsx`, `payment-fields.tsx` | Used by `order-detail.tsx` and, for the fields, by `order-new.tsx`. Shows «¿Te pagaron por fuera? Registrar pago». |
| Delivery form | `presentation/rated-delivery-form.tsx` | Used by `order-new.tsx` and `order-detail.tsx`. |
| Order link card | `apps/core/app/components/order-link-card.tsx` | States `ready`, `subdomain_required` and `unavailable`. |
| Sales list | `apps/core/app/routes/order-list.tsx` | Compact status control («Pagado · Entrega: Despachada»), «Desde el catálogo» badge, `balanceDue` computed in the loader. |
| Texts | `apps/core/app/locales.ts`, `app/locales.test.ts` | One file with the `es` and `pt` resources and a key-parity test per namespace. `deliveryStatus.shipped` reads «Despachada». |
| Assertions on texts this feature changes | unit and E2E | «Despachada» / «Despachado»: `app/routes/order-list.test.ts`, `tests/e2e/order-list.spec.ts`, `order-fulfillment.spec.ts`, `order-cancellation.spec.ts`. «Entrega: …» / «Pagado · …»: `order-list.test.ts`, `order-list.spec.ts`, `order-fulfillment.spec.ts`, `order-cancellation.spec.ts`, `orders.spec.ts`. «Registrar pago»: `order-payments-card.test.ts`, `buyer-payment.spec.ts`, `order-cancellation.spec.ts`, `order-fulfillment.spec.ts`, `select-in-dialog.spec.ts`. «Detalles internos»: `order-waiting-stock.spec.ts`. «Desde el catálogo» in the detail: `order-detail.test.ts`, `public-catalog.spec.ts`. The mobile specs (`mobile-checkout`, `native-order-cancellation`) assert mobile texts and are not affected. |
| Specs bound to the old actions | `tests/e2e` | `rated-order-delivery-action.spec.ts` posts the old delivery JSON body (`{ delivery, expectedPrice }`) to `/orders/:id.data` and clicks «Editar entrega». `store-delivery.spec.ts` clicks «Editar entrega» three times, including the cross-company case. `rated-order-creation-action.spec.ts` posts `form: { order: <JSON> }` to `/orders/new` and `/orders/new.data`. |

## 4. Gaps this design closes

1. No seller operation changes the items of a saved order (§5.1).
2. No operation sets, changes or empties the customer of a saved order (§5.1, §7).
3. A delivery change always quotes again; there is no change limited to the recipient or the address (§5.1, §6.2).
4. Nothing detects that a part the seller is editing changed elsewhere (§6.1, §6.4, §11).
5. No stock trigger exists for an item change that makes an order due (§9).
6. A confirmed checkout without buyer details is invalid stored data and breaks every read of that order (§5.2).
7. The detail does not know the stock or sellable state of its lines (§8).
8. The web has two screens with different layouts, a flat product list and «Detalles internos» (§12, §16).
9. Header and list labels, the «Despachada» wording and the list icons differ from the product definition (§12, §16).
10. The catalog search cannot filter by stock (§8).

## 5. Use cases

### 5.1 `editOrder` (new, orders)

File: `apps/core/src/features/orders/application/edit-order.ts`.

```ts
export type EditOrderInput = Readonly<{
  orderId: OrderId;
  items?: Readonly<{ base: OrderRevision; lines: readonly [OrderLineRequest, ...OrderLineRequest[]] }>;
  customer?: Readonly<{ base: OrderRevision; value: BuyerData | null }>;
  delivery?: Readonly<{ base: OrderRevision; change: DeliveryEdit }>;
}>;
export type OrderLineRequest = Readonly<{ variantId: VariantId; quantity: OrderLineQuantity }>;
export type EditOrderAccess = OrderAccess; // { companyId, userId } of an authenticated seller

export type EditOrderError =
  | OrderDomainError | ResolveRateError | PeruDistrictError
  | Readonly<{ code: "ORDER_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE" | "INVALID_STORED_DATA" | "DELIVERY_UNAVAILABLE" | "DELIVERY_METHOD_DISABLED"; message: string }>
  | Readonly<{ code: "ITEMS_LOCKED"; message: string }>
  | Readonly<{ code: "ORDER_CHANGED"; message: string; parts: readonly [OrderPart, ...OrderPart[]] }>
  | Readonly<{ code: "VARIANT_NOT_FOUND"; message: string; variantId: VariantId }>
  | TransactionEndingError;

export type EditOrderDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, EditOrderError>>) => Promise<Result<T, EditOrderError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, EditOrderError>>;
  /** Products capability: active variants only, one batched lookup. */
  findSellableVariants: (ids: readonly VariantId[]) => Promise<Result<readonly SellableVariant[], EditOrderError>>;
  resolveRatedDelivery: (selection: RatedDeliverySelection, access: OrderAccess, currency: Currency, expectedPrice: Money) => Promise<Result<ResolvedDelivery, EditOrderError>>;
  saveItemChanges: (order: OrderAggregate, changes: OrderItemChanges) => Promise<Result<null, EditOrderError>>;
  saveOrderCustomer: (id: OrderId, companyId: CompanyId, buyer: OrderBuyer | null) => Promise<Result<null, EditOrderError>>;
  saveDelivery: (id: OrderId, companyId: CompanyId, change: Pick<OrderAggregate, "delivery" | "deliveryCost" | "deliveryCharge" | "total">) => Promise<Result<null, EditOrderError>>;
  /** In-transaction event: the orders listener deducts the stock when the edit made the order due and it fits. */
  publishStockEvent: (payload: OrderEdited) => Promise<Result<DeductionOutcome, TransactionEndingError>>;
  findVariantStock: StockReader;
  newItemId: () => OrderItemId;
}>;

export async function editOrder(input: EditOrderInput, access: EditOrderAccess, deps: EditOrderDependencies): Promise<Result<EditedOrder, EditOrderError>>;
export type EditedOrder = StockEventResult & Readonly<{ applied: readonly OrderPart[] }>;
```

Flow, inside one `deps.transaction(access.companyId, …)`:

1. **Lock and load:** `findOrderForUpdate`. `null` → `ORDER_NOT_FOUND`. An order of another company is absent.
2. **Drop applied parts:** `orderEdit.isApplied` removes every sent part whose stored state already equals the request. If none remain, describe `stockDue` and return with `applied: []`.
3. **Check state locks** on the remaining parts with `orderEdit.checkLocks(order, parts)`, in this order: `ORDER_CANCELLED` for any part; `DELIVERY_LOCKED` when the delivery is not `pending` and items or delivery remain; `ITEMS_LOCKED` when stock is deducted and items remain.
4. **Check revisions:** compare each remaining part's base with `orderRevisions(order)`. If any differ → `ORDER_CHANGED`, listing every differing part.
5. **Items:** `orderEdit.planItems(order, lines)` classifies each line as kept, new or raised. One `findSellableVariants` call covers the new and raised variants. A missing variant → `VARIANT_NOT_FOUND` with the first such `variantId` in request order. `orderEdit.applyItems(...)` returns the next aggregate and its `OrderItemChanges`, with totals recalculated through `buildOrder`.
6. **Customer:** `orderEdit.applyCustomer(order, value)` returns the next `buyer`.
7. **Delivery:**
   - `replace`: `orderStateMachine.canSetDelivery`, then `resolveRatedDelivery` with author `{ kind: "seller", userId }`, then `orderStateMachine.setDelivery`.
   - `amend`: `orderEdit.amendDelivery(order, amendment, author)`, which keeps pricing, cost and charge.
8. **Write only what changed:** `saveItemChanges`, `saveOrderCustomer`, `saveDelivery`.
9. **Stock:** if items or delivery changed, publish `order_edited` once and build the result with `orderWithStockDue`. Otherwise, describe `stockDue` in the transaction, as `persistDeliveryChange` does for an unchanged delivery.
10. **Return** the final aggregate, `stockDue` and `applied` (the parts that were written).

A request with no part is refused at the boundary (`INVALID_INPUT`).

Everything inside the order lock is database-only: the variant lookup and the rate resolution read stored data. If a future courier quote goes over the network, it must run before the lock and be checked inside it with `expectedPrice`.

### 5.2 Changed existing pieces

| Piece | Change |
| --- | --- |
| `domain/checkout.ts` `checkoutState` | A confirmed order is valid with `buyer: null`, or with a buyer whose name and phone are both `null`. A buyer that has one of name and phone must have both, with a valid phone. Because the repository applies this rule on every read, `editOrder` depends on it. |
| `shared/contracts/order-checkout.ts` `publicCheckoutSchema` | The confirmed refinement becomes the same rule: `buyer` is `null`, both fields are `null`, or it passes `checkoutBuyerSchema`. Only one of the two fields set is still refused. No field changes shape. |
| `app/components/checkout-sections.tsx` `CheckoutBuyerDetails` | Without a name and phone (`buyer: null` or both `null`), the card shows only the delivery line, and it is hidden when there is no delivery either. It never prints a lone «·». |
| `application/deduct-due-stock.ts` `OrderStockTrigger` | Adds `"order_edited"`. The handler is the same `deductDueOrderStock(trigger, deps)`. |
| `application/events.ts` | Adds `OrderEdited = { companyId, orderId }` to `InTransactionEvents` with outcome `DeductionOutcome`. |
| `composition.ts` | Registers `order_edited` with `deductDueOrderStock("order_edited", …)`. Exports `editConfiguredOrder(input, access)`, built like `setConfiguredOrderDelivery` (`producerOptions`, observed stage and stage timings, logs after commit), and adds `orders.edit`, `orders.revisions` and `orders.lineCatalog` (over `findSellableVariantStock`, answering `null` on any failure with a warn log). The chat dependency `saveItemChanges` maps the new `VARIANT_NOT_FOUND` back to `PERSISTENCE_UNAVAILABLE`, so chat retries keep their behavior. |
| `domain/chat-order.ts` | `ChatOrderItemChanges` is replaced by `OrderItemChanges` from `domain/order-edit.ts`. Its importers `apply-chat-message.ts` and `order-repository.ts` change their import in the same task. |
| `order-repository.ts` `saveItemChanges` | Removed items: one `deleteMany`, as today. Quantity changes: one `UPDATE "OrderItem" … FROM (VALUES …)` statement instead of one `update` per item. It sets the same columns as today's per-row update: `quantity`, `subtotal`, `mentionedPriceAmount` and `mentionedPriceUnits`. It filters on `id`, `orderId` and `companyId`, casts every value to its column type (`::uuid`, `::bigint`, `::numeric(15,2)` for the subtotal, `::numeric(11,2)` for the mentioned price, `::int`), and refuses with `PERSISTENCE_UNAVAILABLE` when the updated count differs from the number of changed items. Added items: one `createMany`, with its rows still in `variantId` order, so a save makes a fixed number of statements whatever its line count (memory e1c291c2). A missing-variant foreign-key violation answers `VARIANT_NOT_FOUND` with the `variantId` taken from the violation's key detail (`Key ("companyId", "variantId")=(…, <id>)`). |
| `order-repository.ts` `findOrderForUpdate` | Logs `lockWaitMs` for `edit_order` too. |
| `products` `findSellableVariantStock(ids)` (new, `order-stock.ts`, exported from `products/index.ts`) | One query: the stock of the given variants whose variant and product are active, as `ReadonlyMap<VariantId, number>`. A sellable variant without a stock row reads 0, as in `findSellableVariants`. A quantity outside 0 to `MAX_SAFE_INTEGER` fails the read (`INVALID_STORED_DATA`, logged). |
| `products` `searchSaleCatalog` | Gains an optional `{ inStock: boolean }` filter (`variants.some({ status: "active", stock.quantity > 0 })`). |
| `api-routes.ts` `catalogQuerySchema` | `search` accepts an optional `inStock: "true"`. `variantIds` accepts at most 100 ids. |

## 6. Domain and typing

### 6.1 New types

File `apps/core/src/features/orders/domain/order-edit.ts` (pure):

| Type | Why an existing one does not work |
| --- | --- |
| `OrderPart = "items" \| "customer" \| "delivery"` | Names the parts that the conflict and lock rules are scoped to. No existing union has these values. |
| `OrderLineQuantity` (brand, 1 to `maxOrderLineQuantity`) with `parseOrderLineQuantity` | `PositiveInteger` has no upper bound, and the save has one. |
| `OrderItemChanges = { added; updated; removedItemIds }` | Moved from `ChatOrderItemChanges`: the same write shape, now with two producers. It is not a new type. |
| `DeliveryEdit = { kind: "replace"; selection: RatedDeliverySelection; expectedPrice: Money } \| { kind: "amend"; amendment: DeliveryAmendment }` | Separates a change that quotes from one that keeps the price. A `RatedDeliverySelection` always quotes. |
| `DeliveryAmendment = { method: "home"; recipient: Recipient; address: string; instructions: string \| null } \| { method: "agency"; recipient: AgencyRecipient } \| { method: "store"; recipient: Recipient }` | Only the fields that can change without a new quote, one variant per method, so the agency document rule is part of the type. |

File `apps/core/src/features/orders/domain/order-revisions.ts` (pure, server-only):

| Type | Why |
| --- | --- |
| `OrderRevision` (brand, 43-character base64url SHA-256) with `parseOrderRevision` | The opaque token the view sends back. It is a digest, not a counter, because no stored counter exists. |
| `OrderRevisions = Readonly<Record<OrderPart, OrderRevision>>` | One token per part, computed together. |

`orderRevisions(order)` digests a canonical JSON (keys sorted) of:

- **items:** `[id, variantId, quantity, unitPrice.amount, unitPrice.currency, mentionedPrice]`, sorted by `id`;
- **customer:** `buyer` (`contactId`, `name`, `phone`) or `null`;
- **delivery:** the full `DeliverySnapshot`, including `recordedBy`, or `null`.

No part carries `variantAttributes` or any other copied catalog data, so a catalog edit never changes a revision. Money is digested as its amount in cents and its currency, never as a float string. Payments, totals, stock and fulfillment fields are excluded on purpose. A change that a chat message, the checkout or another tab makes to a part changes that part's revision. A change back to the same content does not, which is harmless.

The digest uses `node:crypto` `createHash`. `order-revisions.ts` is imported only by server code: the route `loader` and `action`, and `composition.ts`. Client modules (`order-view-state.ts`, the cards) import only types and `order-edit-schemas.ts`, which does not import `order-revisions.ts`. The loader's revisions (read without a lock) and the use case's revisions (read under the lock) come from the same function over the same repository mapping. A test pins that they are equal.

### 6.2 Pure functions

```ts
export const orderEdit = {
  isApplied(order: OrderAggregate, input: EditOrderInput, part: OrderPart): boolean,
  checkLocks(order: OrderAggregate, parts: ReadonlySet<OrderPart>): Result<null, OrderDomainError | Readonly<{ code: "ITEMS_LOCKED"; message: string }>>,
  planItems(order: OrderAggregate, lines: readonly OrderLineRequest[]): Result<ItemsPlan, OrderDomainError>,   // ItemsPlan = { lookup: readonly VariantId[] } (new and raised variants)
  applyItems(order: OrderAggregate, lines: readonly OrderLineRequest[], variants: readonly SellableVariant[], newItemId: () => OrderItemId):
    Result<Readonly<{ order: OrderAggregate; changes: OrderItemChanges }>, BuildOrderError | Readonly<{ code: "VARIANT_NOT_FOUND"; message: string; variantId: VariantId }>>,
  applyCustomer(order: OrderAggregate, value: BuyerData | null): OrderAggregate,
  amendDelivery(order: OrderAggregate, amendment: DeliveryAmendment, author: DeliveryAuthor): Result<OrderAggregate, OrderDomainError>,
} as const;
```

Rules:

- **`isApplied`:**
  - items: the stored `variantId → quantity` map equals the request;
  - customer: name and phone equal, `null` meaning empty;
  - `amend`: recipient and, for home, address and reference equal;
  - `replace`: method, `pricing.rateId`, district code, agency id, recipient, address and reference equal, a seller author, and a charge equal to `expectedPrice`.
- **`planItems`** refuses duplicate variants, an empty list, more than `maxOrderLines` lines, and a quantity outside 1 to 9999 (`INVALID_ORDER`). A raised line is a kept line whose quantity grows.
- **`applyItems`:**
  - Each kept item keeps its id, copied data and `mentionedPrice`, and gets the new quantity.
  - New lines get a new id and `mentionedPrice: null`.
  - Missing kept items are removed.
  - A kept line that is not raised never needs its variant to be active.
  - Items are read in `id` order, so a new line takes its place by id, as chat additions do today.
- **`applyCustomer(order, null)`** gives `{ contactId, name: null, phone: null }` when `buyer.contactId` is set, and `null` otherwise.
- **`amendDelivery`:**
  - Requires a stored delivery of the same method (`INVALID_ORDER` otherwise).
  - Sets the recipient, and for home also the address and reference. `recordedBy` becomes `{ kind: "seller", userId }`.
  - Validates the result through `parseDeliverySnapshot`.
  - Leaves pricing, cost, charge and total unchanged.

### 6.3 Authority per layer

| Layer | Types and authority |
| --- | --- |
| Web view state (`order-view-state.ts`) | Drafts, the pinned base, the unsaved-changes diff, invalid fields, estimated totals, the choice between `amend` and `replace`, and the screen locks. Advisory only. |
| Route action | Parses the body with `editOrderRequestSchema`, normalizes an empty reference to `null`, builds `EditOrderInput` with brands and maps error codes to action results. |
| `editOrder` and `orderEdit` | Locks, conflicts, prices, totals, and the customer and delivery rules. The authority. |
| Repository | Writes the given changes in the company scope. Decides nothing. |

### 6.4 Pinned base in the view

`order-view-state.ts` keeps, per part, `base: { saved: <part as loaded>; revision: OrderRevision }`, next to the draft.

| Event | Items, customer, delivery | Payments, totals, payment status, stock state, line stock |
| --- | --- | --- |
| First load | Pin from the loader | From the loader |
| Revalidation after **Anular pago**, **Rechazar**, register, approve, ship, deliver | A part with unsaved edits keeps its base and draft. A part without edits takes the new saved state and revision. | From the loader |
| Successful **Guardar cambios** | Re-pin every part from the action result (`order`, `revisions`), and clear the draft of the parts in `applied` | From the action result |
| `ITEMS_LOCKED` | Revalidate. Items have their edits dropped (reset to the fresh saved items, re-pinned). Customer and delivery keep their pinned base and edits. | From the loader |
| `ORDER_CHANGED` | Nothing re-pinned. The edits stay until **Recargar pedido** → **Descartar y recargar**, which re-pins every part. | Unchanged |
| In-doubt answered «applied» | Revalidate. The draft equals the saved state, so every part re-pins with fresh revisions. | From the loader |
| In-doubt answered «changed» (a sent part equals neither the draft nor its pinned `base.saved`) | Nothing re-pinned; the conflict alert with **Recargar pedido**, as for `ORDER_CHANGED`. | Unchanged |
| In-doubt answered «not applied» | Nothing re-pinned; the edits stay and saving is enabled again. | Unchanged |
| **Descartar cambios** | Draft reset to the base | Unchanged |

Because an edited part keeps its pinned revision, a chat message that changed the items before a void and its refresh still makes the next save answer `ORDER_CHANGED`.

## 7. Persistence

No schema change and no migration.

- `saveItemChanges` keeps its contract (§5.2) with batched quantity updates (same columns, scoped by order and company), one `createMany` for added items and the `VARIANT_NOT_FOUND` mapping. Its `cancelled: false` guard and its insert order by `variantId` stay.
- New `saveOrderCustomer(id, companyId, buyer)` in `order-repository.ts`:
  - For a buyer, it upserts `OrderBuyer` on `(companyId, orderId)` with `contactId`, `name` and `phone`, nulls included.
  - For `null`, it deletes the row, scoped by company and order.
  - It requires an active transaction (`requireActiveTransaction`). Known failures become `PERSISTENCE_UNAVAILABLE`.
- `saveDelivery` is reused unchanged, also for `amend`.
- The lock hold of an edit is a fixed number of statements: one delete, one update, one insert, one buyer write, one delivery write, then the listener's bounded work. `maxOrderLines` bounds the rows per statement.

## 8. Contracts between applications

Mobile does not call the new operation in this version (gate decision 1). The web-only schemas live in `apps/core/src/features/orders/presentation/order-edit-schemas.ts`:

```ts
export const orderRevisionSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const orderRevisionsSchema = z.strictObject({ items: orderRevisionSchema, customer: orderRevisionSchema, delivery: orderRevisionSchema });
const lineSchema = z.strictObject({ variantId: z.uuid(), quantity: z.number().int().min(1).max(maxOrderLineQuantity) });
const reference = z.string().trim().max(1000).nullable().transform((value) => value || null);
const amendmentSchema = z.discriminatedUnion("method", [
  z.strictObject({ method: z.literal("home"), recipient: recipientSchema, address: z.string().trim().min(1).max(500), instructions: reference }),
  z.strictObject({ method: z.literal("agency"), recipient: agencyRecipientSchema }),
  z.strictObject({ method: z.literal("store"), recipient: recipientSchema }),
]);
export const editOrderRequestSchema = z.strictObject({
  operation: z.literal("save_changes"),
  items: z.strictObject({ base: orderRevisionSchema, lines: z.array(lineSchema).min(1).max(maxOrderLines) }).optional(),
  customer: z.strictObject({ base: orderRevisionSchema, value: newOrderCustomerSchema.nullable() }).optional(),
  delivery: z.strictObject({ base: orderRevisionSchema, change: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("replace"), selection: ratedDeliverySelectionSchema, expectedPrice: moneySchema }),
    z.strictObject({ kind: z.literal("amend"), amendment: amendmentSchema }) ]) }).optional(),
}).refine((body) => body.items || body.customer || body.delivery);
export const orderLineCatalogSchema = z.record(z.uuid(), z.strictObject({ stock: z.number().int().nonnegative().safe() })).nullable(); // absent variant = not sellable; null = stock unknown
export const editOrderResultSchema = z.strictObject({ order: orderAggregateSchema, revisions: orderRevisionsSchema, lineCatalog: orderLineCatalogSchema,
  applied: z.array(z.enum(["items", "customer", "delivery"])) });
```

- **Imported from `shared/contracts/orders.ts`:** `ratedDeliverySelectionSchema`, `newOrderCustomerSchema` and `orderAggregateSchema`; `moneySchema` comes from `shared/contracts/money.ts`. `recipientSchema` and `agencyRecipientSchema` are exported there with no shape change (C1). `maxOrderLineQuantity` and `maxOrderLines` live in `shared/orders-edit.ts`.
- **Detail loader:** adds `revisions: orderRevisionsSchema` and `lineCatalog: orderLineCatalogSchema`. `lineCatalog` comes from `orders.lineCatalog(variantIds)`, which wraps `findSellableVariantStock` (one query, no cap). Today the loader awaits the aggregate, `describeStockDue`, the receipt URLs, the delivery settings and the order link one after another. It becomes: the aggregate first (`lineCatalog` needs its variant ids), then one `Promise.all` over `lineCatalog`, `describeStockDue`, the receipt URLs, the settings and the link (up to 5 pool connections at once). A failed read gives `null` and never fails the loader. On an order whose products are locked, `lineCatalog` is `null` without a query; the save result follows the same rule.
- **After commit,** the `save_changes` action reads `lineCatalog` again, outside the transaction and without a lock, so the stock warning reflects the new stock. It may disagree with `order` if another writer acts in between, which is harmless because it is advisory. If that read fails, the action still answers «saved» with `lineCatalog: null`, never a save error.
- **After a successful `save_changes`,** `shouldRevalidate` returns `false`: the action result is the new state. Revalidation stays for every other operation and for the error codes `ITEMS_LOCKED`, `DELIVERY_LOCKED` and `ORDER_CANCELLED`.
- **`GET /api/orders/:id/aggregate`** is unchanged and serves the in-doubt check. Revisions come from the loader revalidation that follows an «applied» answer.
- **`GET /api/orders/catalog`:** `?search=…&inStock=true` filters on the server. `?variantIds=…` is capped at 100.

Action results by `code` (the route action returns data, never an HTTP error, like the other detail operations):

| Situation | `code` | Extra fields | View |
| --- | --- | --- | --- |
| Saved | — | `order`, `revisions`, `lineCatalog`, `applied` | «Cambios guardados.», or «Cambios guardados. El pedido queda esperando stock.» when `order.stockDue.kind === "waiting"` |
| Malformed body | `INVALID_INPUT` | — | Generic save error |
| Order missing or of another company | `ORDER_NOT_FOUND` | — | Error state |
| Cancelled meanwhile | `ORDER_CANCELLED` | — | «… está cancelado», revalidate |
| Shipped or delivered meanwhile | `DELIVERY_LOCKED` | — | Revalidate; «se envió / se entregó» from the fresh status; offers **Guardar solo el cliente** when there is a customer edit |
| Stock deducted meanwhile | `ITEMS_LOCKED` | — | Revalidate; reset the products as in §6.4; keep the other edits |
| A part changed elsewhere | `ORDER_CHANGED` | `parts` | Conflict alert with **Recargar pedido** |
| New or raised variant not sellable | `VARIANT_NOT_FOUND` | `variantId` | Line marked; the text depends on whether the line is saved |
| Delivery price changed | `TOTAL_CHANGED` | `currentPrice` | Rate marked with the new price |
| Rate or agency unavailable, method disabled | `RATE_UNAVAILABLE`, `DELIVERY_UNAVAILABLE`, `DELIVERY_METHOD_DISABLED` | — | Delivery marked «ya no está disponible» |
| Business rule broken | `INVALID_ORDER`, `CURRENCY_MISMATCH` | — | Generic save error |
| Persistence or transaction failure | `PERSISTENCE_UNAVAILABLE`, `SERVICE_UNAVAILABLE` | — | «No se pudieron guardar los cambios…» |
| Thrown error or lost response | (`clientAction`) | — | In-doubt check: «applied» → «Cambios guardados.»; «not applied» → the edits stay; «changed» → the conflict alert |

## 9. Events and cross-feature integration

- **Event:** `order_edited`, in-transaction, payload `{ companyId, orderId }`, outcome `DeductionOutcome`. `editOrder` publishes it once per save, only when items or delivery changed. A customer-only save publishes nothing, because the customer never makes an order due.
- **Listener:** `deductDueOrderStock("order_edited", …)`, registered in `features/orders/composition.ts`. It runs inside the producer's transaction, under the order lock already held, in a savepoint. It re-checks the due rule and deducts every item or none.
- **Products:** `findSellableVariants`, `searchSaleCatalog`, `lockVariantStock`, `deductStockBulk` and `findVariantStock` are reused through the orders composition. Products only gains the `inStock` filter and `findSellableVariantStock`, and knows nothing about orders.
- **Delivery settings:** `resolveRatedShippingCost` is reused through the same wiring as `setConfiguredOrderDelivery`.

| Failure window | What happens | Effect for the user |
| --- | --- | --- |
| The listener hits a lock or statement timeout, or a data fault | Contained in its savepoint. The edit commits and the order is due; recovery deducts it within a minute. | «Cambios guardados.», then the «Descontando stock» notice |
| The transaction ends (timeout, lost connection) | Everything rolls back | In-doubt check, then «not applied»; repeating is safe |
| Short stock | `short` outcome; the edit commits | «Cambios guardados. El pedido queda esperando stock.» |

## 10. Mobile

No change. The contracts mobile parses (`orderAggregateSchema`, `orderCatalogSchema`, the list schemas and `checkoutLinkSchema`) keep their shape. The relaxed `publicCheckoutSchema` in `shared/contracts/order-checkout.ts` is parsed only by the web checkout route; mobile does not import it. The catalog route only gains an optional query flag and a cap that mobile never reaches.

## 11. Transactions and concurrency

1. A tenant transaction (`orderTransaction` with `producerOptions`: 5000 ms transaction, 2000 ms lock and 3000 ms statement timeouts).
2. `findOrderForUpdate` takes the order row lock. Chat messages, payments, the checkout, ship, deliver, cancel and restock serving take the same row first, so they serialize with the edit.
3. Applied parts are dropped, then the lock checks, then the revision checks, all against the locked row.
4. `findSellableVariants` (a read). The inserted rows follow `variantId` order, so they cannot deadlock with a product save.
5. Writes: items (three statements at most, bounded by `maxOrderLines` rows), then the customer, then the delivery.
6. `order_edited` → the listener locks stock rows in `variantId` order after the order row, the same order used everywhere.
7. Commit. The success log is written after commit.

Everything inside the lock is database-only (§5.1).

| Situation | Decision |
| --- | --- |
| Two tabs save items | The second waits for the lock. It then sees a different items revision → `ORDER_CHANGED`, unless it sends the same final state, which is dropped as applied. |
| One tab edits the customer, another the items | Both succeed: their parts do not overlap. |
| A chat message changes the items during an edit | The items revision differs → `ORDER_CHANGED`. Customer-only saves still succeed. A refresh after a void in between does not hide it, because the base is pinned (§6.4). |
| The buyer confirms the checkout during an edit | If their name, phone or delivery changed, that part's revision differs, and edits to it conflict. Otherwise nothing conflicts. The buyer's own `expectedTotal` check refuses an outdated total. |
| A payment is recorded, approved, rejected or voided during an edit | No part revision changes, so the save succeeds. A covering payment may deduct the stock, and a pending items edit then gets `ITEMS_LOCKED`. |
| A restock serves the order during an edit | Stock deducted → `ITEMS_LOCKED` for items edits only. |
| Ship, deliver or cancel during an edit | `DELIVERY_LOCKED` or `ORDER_CANCELLED`, by the lock rules. |
| Repeat after an in-doubt answer | Same final state → dropped as applied, whatever happened to the order since. No double quantity. |

## 12. Code organization

### Core feature `orders` and `products`

| File | Change |
| --- | --- |
| `src/features/orders/domain/order-edit.ts` (+ test) | New: `orderEdit`, `OrderPart`, `OrderLineQuantity`, `OrderItemChanges`, `DeliveryEdit`, `DeliveryAmendment` |
| `src/features/orders/domain/order-revisions.ts` (+ test) | New, server-only: `orderRevisions`, `OrderRevision`, `parseOrderRevision` |
| `src/features/orders/domain/chat-order.ts`, `application/apply-chat-message.ts`, `infrastructure/order-repository.ts` (imports) | `ChatOrderItemChanges` → `OrderItemChanges` |
| `src/features/orders/domain/checkout.ts` (+ test) | `checkoutState` accepts a confirmed order without buyer details |
| `shared/contracts/order-checkout.ts`, `src/features/orders/presentation/checkout-contracts.test.ts` | `publicCheckoutSchema` accepts a confirmed checkout without buyer details |
| `app/components/checkout-sections.tsx`, `app/routes/checkout.tsx` (+ tests) | Empty read-only buyer details |
| `src/features/orders/application/edit-order.ts` (+ test, + integration test) | New use case |
| `src/features/orders/application/events.ts` | `OrderEdited` in-transaction event |
| `src/features/orders/application/deduct-due-stock.ts` | `"order_edited"` trigger |
| `src/features/orders/infrastructure/order-repository.ts` | `saveOrderCustomer`; batched `saveItemChanges` with `VARIANT_NOT_FOUND`; `lockWaitMs` for `edit_order` |
| `src/features/orders/composition.ts` | Handler registration, `editConfiguredOrder`, `orders.edit`, `orders.revisions`, `orders.lineCatalog`, chat error mapping |
| `src/features/orders/presentation/order-edit-schemas.ts` (+ test) | New web schemas |
| `src/features/orders/presentation/api-routes.ts` (+ tests) | `inStock` flag and `variantIds` cap |
| `src/features/products/infrastructure/order-stock.ts` (+ integration test), `products/index.ts` | `searchSaleCatalog` `inStock` filter (W3); new `findSellableVariantStock` (C2) |
| `shared/orders-edit.ts` | `maxOrderLineQuantity`, `maxOrderLines` |
| `shared/contracts/orders.ts` | Export `recipientSchema` and `agencyRecipientSchema`; later `newOrderLoaderSchema` without `products` (W9) |

### Web (`apps/core`)

| File | Change |
| --- | --- |
| `app/locales.ts`, `app/locales.test.ts` | New keys (W1). Renames and removals by the owning tasks (W4, W9, W10). |
| `src/features/orders/presentation/order-view-state.ts` (+ test) | Pure view model: drafts, pinned base, diff, validation, estimates, screen locks, request builders, in-doubt comparison |
| `src/features/orders/presentation/product-picker-dialog.tsx`, `product-picker-keyboard.ts`, `use-catalog-search.ts` (+ tests) | Floating picker, its pure keyboard model and its request policy |
| `src/features/orders/presentation/order-products-card.tsx` (+ test) | «Productos» card |
| `src/features/orders/presentation/order-customer-card.tsx` (+ test) | «Cliente» card |
| `app/components/order-link-card.tsx` (+ test) | Additive `pending_save` state |
| `src/features/orders/presentation/order-delivery-card.tsx` (+ test) | «Entrega» card. `rated-delivery-form.tsx` gets additive optional props only. |
| `src/features/orders/presentation/order-payments-panel.tsx` (+ test) | New «Pagos» card for the view. `order-payments-card.tsx` stays for the current detail until W10 deletes it. |
| `src/features/orders/presentation/order-status-labels.tsx` (+ test) | Header and list labels |
| `app/routes/order-list.tsx` (+ tests) | Uses the labels; «Enviado desde» |
| `src/features/orders/presentation/order-view.tsx`, `use-unsaved-changes-guard.ts` (+ tests) | Layout, header, status line, sticky bar, discard and leave guard. New-sale mode by W9; saved mode (header labels, alerts, in-doubt blocking, fulfillment slot) by W10 |
| `app/routes/order-new.tsx` (+ tests) | Renders the view for a new sale; in-doubt create; no catalog search in the loader |
| `app/routes/order-detail.tsx` (+ tests) | Renders the view for a saved order; JSON dispatch on `operation`; `save_changes`; no «Detalles internos», no old delivery JSON action |

Capabilities exposed from `features/orders/composition.ts`: `orders.edit(input, access)`, `orders.revisions(order)` and `orders.lineCatalog(variantIds)`.

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `order_edit_saved` | info | `composition.ts` `editConfiguredOrder`, after commit | `["operation", "orderId", "userId", "parts", "applied", "addedItems", "removedItems", "changedQuantities", "deliveryChange", "customerChange", "stockOutcome", "stockDeducted", "totalChanged", "lockWaitMs", "stageMs", "durationMs", "transactionOutcome"]` |
| `order_edit_conflicted` | info | same, for `ORDER_CHANGED`, `ITEMS_LOCKED`, `DELIVERY_LOCKED` and `ORDER_CANCELLED` | `["operation", "orderId", "userId", "parts", "errorCode", "conflictParts", "deliveryStatus", "stockDeducted", "cancelled", "lockWaitMs", "durationMs"]` |
| `order_edit_rejected` | debug | same, for validation, variant and delivery rejections | `["operation", "orderId", "userId", "parts", "errorCode", "stage", "durationMs"]` |
| `order_edit_failed` | error | same, for `PERSISTENCE_UNAVAILABLE`, `INVALID_STORED_DATA` and transaction-ending errors | `["operation", "orderId", "userId", "parts", "errorCode", "stage", "durationMs", "err"]` |
| `delivery_lock_acquired` (existing) | debug | `findOrderForUpdate` | now also for `operation: "edit_order"` |
| `order_edit_request_failed` | error | `order-detail.tsx` action catch | `["operation", "entryPoint", "orderId", "userId", "errorCode", "err"]` |
| `order_stock_deducted` / `order_stock_waiting` (existing listener events) | existing | listener | the only addition is `trigger: "order_edited"` |
| `unable_to_save_order_customer` | error | `saveOrderCustomer` | `["orderId", "err"]` |
| `order_line_catalog_unavailable` | warn | `composition.ts` `orders.lineCatalog` | `["orderId", "entryPoint", "errorCode", "variantCount"]`, with `entryPoint` `"detail_loader" \| "save_result"` |

- `operation` is `"edit_order"`.
- `stage` takes the values `lock_order`, `check_applied`, `check_locks`, `check_revisions`, `resolve_variants`, `resolve_delivery`, `save_items`, `save_customer`, `save_delivery` and `deduct_stock`.
- `stageMs` is `{ lock_order, save_items, deduct_stock }`.
- `deliveryChange` is `"replace" | "amend" | null`, and `customerChange` is `"set" | "cleared" | null`.
- Logs never include names, phones, addresses, document numbers, amounts or revision tokens.

## 14. Tests

### Core unit

`domain/order-revisions.test.ts`
- `test("gives the same revisions for the same order read twice")`
- `test("changes only the items revision when a quantity changes")`
- `test("changes only the customer revision when the buyer phone changes")`
- `test("changes only the delivery revision when the delivery author changes")`
- `test("keeps every revision when a payment is added, voided or rejected")`
- `test("keeps every revision when stock is deducted or the order is shipped")`

`domain/order-edit.test.ts`
- `test("drops an items part equal to the stored items even when stock is deducted")`
- `test("refuses any edit of a cancelled order")`
- `test("refuses items and delivery edits once the delivery left pending but allows a customer edit")`
- `test("refuses items edits once stock is deducted but allows customer and delivery edits")`
- `test("keeps the copied price, name and mentioned price of a kept line whose quantity changes")`
- `test("keeps the item id of a variant removed and added back in the same request")`
- `test("prices a new line with the current catalog price")`
- `test("refuses an empty list, a repeated variant, more than 100 lines and a quantity above 9999")`
- `test("asks to look up only new and raised variants")`
- `test("allows lowering a line whose variant is no longer sellable")`
- `test("refuses raising a line whose variant is no longer sellable with its variantId")`
- `test("recalculates items total and total keeping the delivery charge")`
- `test("empties name and phone but keeps the contact when clearing a contact customer")`
- `test("removes the buyer when clearing a customer without contact")`
- `test("amends the recipient and address of a home delivery without changing its pricing or total")`
- `test("clears the reference of a home delivery")`
- `test("records the seller as author of an amended delivery")`
- `test("refuses an amendment whose method does not match the stored delivery")`

`application/edit-order.test.ts` (fakes)
- `test("saves items, customer and delivery together and returns the recalculated order")`
- `test("answers ORDER_CHANGED naming the items when a chat message changed them since the view loaded")`
- `test("saves a customer edit even though the items revision changed")`
- `test("saves while a payment was voided since the view loaded")`
- `test("answers ITEMS_LOCKED and writes nothing when stock was deducted since the view loaded")`
- `test("saves only the customer of a shipped order")`
- `test("answers VARIANT_NOT_FOUND for a new variant that is no longer sellable and writes nothing")`
- `test("answers TOTAL_CHANGED with the current price when a replaced delivery was requoted")`
- `test("does not quote an amended delivery")`
- `test("publishes order_edited once when items and delivery change")`
- `test("publishes nothing for a customer-only edit")`
- `test("returns the order deducted when the edit covers the total and stock fits")`
- `test("returns the order waiting when the edit covers the total and stock is short")`
- `test("never changes, voids or removes a payment")`
- `test("succeeds without writes when the same final state is sent twice")`
- `test("succeeds without writes when the repeated edit had deducted the stock")`

`domain/checkout.test.ts`
- `test("accepts a confirmed checkout whose buyer details were cleared")`
- `test("still rejects a confirmed buyer with a name and an invalid phone")`

`presentation/checkout-contracts.test.ts` (changed: the confirmed `buyer: null` case moves from rejected to accepted)
- `test("public response accepts a confirmed checkout with no buyer or with an empty name and phone")`
- `test("public response rejects a confirmed buyer with only a name or an invalid phone")`

`app/components/checkout-sections.test.tsx`
- `test("shows only the delivery in the buyer details when the confirmed buyer was cleared")`

`presentation/order-edit-schemas.test.ts`
- `test("rejects a request without any part")`
- `test("rejects a quantity of 0 or above 9999")`
- `test("rejects an agency amendment without identity document")`
- `test("turns an empty reference into null")`

`presentation/api-routes.test.ts` (added)
- `test("rejects more than 100 variant ids in the catalog query")`

### Core integration (real database)

`application/edit-order.integration.test.ts`
- `test("raises a quantity of order 1042 to a total of 418.00 keeping the 150.00 Yape payment unchanged")`
- `test("removes two lines so payments cover the total and deducts stock in the same response")`
- `test("removes two lines with short stock and leaves the order waiting")`
- `test("refuses an items edit after a restock served the order and keeps the stored items")`
- `test("saves a customer edit after a covering payment from another session deducted the stock")`
- `test("refuses the items edit when a chat message changed the items of the same order")`
- `test("serializes two simultaneous item saves: one succeeds, the other answers ORDER_CHANGED")`
- `test("keeps the buyer-chosen delivery untouched when only a quantity changes")`
- `test("changes only the reference of a buyer-chosen delivery at the old price after the rate price changed")`
- `test("refuses a district change after the rate price changed and keeps the item edits unsaved")`
- `test("clears the customer of a manual order so the list shows general public")`
- `test("keeps the contact of a WhatsApp order when name and phone are emptied")`
- `test("clears the customer of a confirmed checkout order and reads it back in the detail, the list and the stock listener")`
- `test("answers VARIANT_NOT_FOUND when a new variant is deleted between the lookup and the insert")`
- `test("replaces 100 lines in a fixed number of statements and leaves the stock listener its full budget")`
- `test("gives the same revisions from the unlocked read and from the locked read of one stored order")`
- `test("cannot read or edit an order of another company")`
- `test("rolls back items and customer when the transaction ends during stock deduction")`

`application/apply-chat-message.integration.test.ts` (existing, must stay green)
- the existing missing-variant retry case keeps answering a retryable failure.

`infrastructure/order-repository.integration.test.ts` (added)
- `test("saveOrderCustomer upserts and deletes the buyer only within the company")`
- `test("saveItemChanges stores each changed quantity with a subtotal equal to quantity times unit price and keeps the mentioned price")`
- `test("saveItemChanges updates no item of another order or company")`

`products/infrastructure/order-stock` integration (added)
- `test("filters the sale catalog to products with an active variant in stock")`
- `test("reads the stock of active variants of active products and leaves deactivated ones out")`

Checkout route test (added)
- `test("serves the checkout of a confirmed order whose customer was cleared with empty details")`
- `test("serves the checkout of a confirmed WhatsApp order whose name and phone were emptied")`

### Web (component and route tests, Vitest)

`order-view-state.test.ts`
- `test("reports no unsaved changes after raising a quantity and lowering it back")`
- `test("builds an edit request with only the changed parts and their pinned revisions")`
- `test("keeps the pinned items base and edits when a refresh after a void brings items changed by a chat message")`
- `test("takes the refreshed customer when the customer has no unsaved edits")`
- `test("chooses amend when only the recipient, address or reference changed")`
- `test("chooses replace when the method, district, rate or agency changed")`
- `test("marks an empty quantity, an incomplete delivery and a half-typed customer as invalid in screen order")`
- `test("estimates totals using the saved price for a kept variant and the catalog price for a new one")`
- `test("locks products while stock is deducting, deducted, shipped or delivered")`
- `test("recognizes an applied save in the re-read order after an in-doubt answer")`
- `test("answers changed after an in-doubt answer when a sent part matches neither the draft nor its pinned base")`
- `test("sends no delivery part when the customer changes on a shipped order with Igual que el cliente checked")`
- `test("keeps the customer and delivery base revisions when products are reset after ITEMS_LOCKED")`
- `test("sends no delivery part when only the customer name changes on an order where another person receives")`
- `test("shows no stock warning or no-longer-sold note when the line catalog is unknown")`

`use-catalog-search.test.ts`, `product-picker-keyboard.test.ts` and `product-picker-dialog.test.tsx`
- `test("ignores a catalog response for an older search text")`
- `test("aborts the previous request when the text changes")`
- `test("waits 250 ms after typing before searching but loads the empty query at once")`
- `test("keeps the previous results visible while a new search loads")`
- `test("asks the server for in-stock products when Con stock is chosen")`
- `test("moves the caret with left and right until down arrow highlights the first product")`
- `test("adds the highlighted chip with Enter and keeps the picker open")`
- `test("highlights the first chip on Enter over a product with options without adding")`
- `test("clears the highlight when the search text, the filter or the result set changes")`
- `test("names a chip with its stock and the units already in the order")`
- `test("announces each addition politely")`
- `test("lets a no-stock chip be added")`
- `test("shows the retry state and keeps the search when the catalog fails")`
- `test("keys the cached empty search by the Con stock filter")`
- `test("drops the cached empty search when the catalog epoch changes and fetches again only on the next opening")`
- `test("keeps the cached empty search across closing and reopening the picker")`

`order-products-card.test.tsx`
- `test("disables removing the only line with its note")`
- `test("restores the previous quantity when the field is left empty")`
- `test("shows the stock warning on a saved line above its current stock")`
- `test("shows the no-longer-sold note when raising a line absent from the line catalog")`
- `test("shows the locked note with its remedy when stock is deducted")`

`order-customer-card.test.tsx`
- `test("marks the missing field when only the name is typed")`
- `test("offers Quitar cliente only on orders without a WhatsApp contact")`

`order-delivery-card.test.tsx`
- `test("starts a new sale at Por definir and discards a half-filled method when chosen again")`
- `test("disables Por definir on a saved order with a delivery")`
- `test("starts Igual que el cliente unchecked when the saved recipient differs")`
- `test("unchecks Igual que el cliente and keeps the mirrored values on Quitar cliente")`

`order-payments-panel.test.tsx`
- `test("shows one button per wallet of the country plus bank transfer")`
- `test("keeps a typed draft amount when products change")`
- `test("keeps Anular pago and Rechazar enabled while there are unsaved changes")`
- `test("disables Agregar Yape with its note while there are unsaved changes")`

`order-status-labels.test.tsx` and `order-list.test.ts`
- `test("shows only Venta completada for a completed sale")`
- `test("shows only Pedido cancelado without balance for a cancelled order")`
- `test("shows Pago pendiente with the balance and Enviada for an active partially paid shipped order")`
- `test("names labels with Estado del pago and Estado de la entrega")`

`order-view.test.tsx` (saved mode, W10)
- `test("shows the saved order sections in mockup order without Detalles internos")`
- `test("shows only Venta completada, only Pedido cancelado, or Pago pendiente and Enviada in the saved order header with their accessible names")`
- `test("asks to discard changes when leaving a saved order with unsaved edits and keeps them on Seguir editando")`
- `test("shows only the total in the sticky bar of a saved order without changes and the two actions after an edit")`

`order-new` and `order-detail` route tests
- `test("replaces the history entry after Guardar venta so back opens Ventas")`
- `test("resolves an in-doubt Guardar venta by reading the order with the same id")`
- `test("loads Nueva venta without searching the catalog")`
- `test("dispatches a JSON body by its operation")`
- `test("does not revalidate after a successful save_changes and uses its result")`
- `test("answers the conflict on save after a void refreshed an order whose items a chat message changed")`
- `test("maps ORDER_CHANGED to the conflict alert and keeps the edits")`
- `test("maps DELIVERY_LOCKED with a customer edit to the Guardar solo el cliente offer")`
- `test("blocks saving and leaving while an in-doubt check is running")`
- `test("revalidates after an in-doubt check finds the changes applied so the next save sends fresh revisions")`
- `test("shows the conflict alert when the in-doubt check finds the order changed otherwise")`
- `test("loads the line catalog in one batched read for all the order's variants")`
- `test("loads the order with an unknown line catalog when the stock read fails")`
- `test("answers saved with an unknown line catalog when the read after commit fails")`
- `test("saves a customer name change without touching the recipient of another person")`
- `test("answers TOTAL_CHANGED with the current price for a replaced delivery with an outdated expectedPrice and writes nothing")`

### Web E2E (happy path only)

`tests/e2e/order-view.spec.ts`
- `test("creates a sale with the picker, a Yape advance and a customer, then opens the saved order with its link")`
- `test("raises a quantity on a saved order, saves, and shows the new balance with the payment unchanged")`
- `test("asks before leaving a saved order with unsaved changes")`

Rewritten existing specs (W10): `rated-order-delivery-action.spec.ts` posts `save_changes` bodies (malformed → `INVALID_INPUT`; outdated `expectedPrice` → `TOTAL_CHANGED` without writes; fresh price → saved aggregate) and edits the delivery in the card instead of «Editar entrega». `store-delivery.spec.ts` replaces a pickup point in the open card and saves with **Guardar cambios**, keeping its author, stock and cross-company assertions. `rated-order-creation-action.spec.ts` stays unchanged (W9 keeps the creation action contract).

### Pending manual checks

- Keyboard-only and screen-reader pass of the picker (NVDA or VoiceOver): combobox announcements and chip names.
- On a real phone browser: the sticky bar on narrow screens, and the full-screen picker below 640 px.
- The browser's own leave warning on reload and close, in Chrome and Safari.
- A pass over every new text in the Portuguese locale.

## 15. Limits and checks during implementation

- Verify that `findSellableVariants` returns the current `salePrice` and leaves inactive variants out; the rule for raising a deactivated line depends on it.
- The `UPDATE … FROM (VALUES …)` for quantities goes through `$executeRaw` with parameters inside the active tenant transaction. RLS applies to it as it does to the Prisma calls.
- React Router:
  - `useBlocker` for in-app navigation and `beforeunload` for reload and close.
  - The create submission uses `replace`, so back skips «Nueva venta».
  - `shouldRevalidate` follows §8.
- Verify that the Prisma `P2003` error for `OrderItem_companyId_variantId_fkey` exposes the PostgreSQL key detail, as `isMissingVariantViolation` already reads `cause.message`. If it does not, read the variant id from the error's raw `meta`; per-row inserts are not reintroduced.
- Memory 9990ffcf says «Confirmation requires a nonempty name and valid international phone». After C3 the confirmation input still requires both, but a stored confirmed order may have its buyer cleared by the seller. Update that memory when the feature merges.
- `findSellableVariantStock` takes no cap: creation and chat have no line maximum, so an older order may exceed 100 lines; the read stays bounded by that order. The HTTP `variantIds` cap does not apply to it.
- «Descontando stock» is derived on screen from `stockDue.kind === "deducting"`. Core does not enforce it.
- Searches with an empty or very short text cannot use the `Product.name` trigram index. They read every active product of the company, sort them and take 20, which is fine at today's catalog sizes. Revisit trigger: add a `(companyId, status, name)` index when catalogs reach thousands of products.
- Left out:
  - editing items after the stock is deducted;
  - mobile editing;
  - product photos;
  - searching by variant value;
  - categories;
  - clearing a saved delivery;
  - repricing kept lines.
- Deferred with real risk (from the product draft):
  - mobile item editing, a release gate for orders from chat (memory de4d23f5);
  - editing orders whose stock was deducted.

  No Todoist task exists yet; the founder decides.
- Assumption: the «Desde el catálogo» badge that the product draft drops is the one in the detail header. The list keeps its badge, which the product draft does not mention.

## 16. Implementation plan

### Order and parallelism

```text
Wave 1:  C1 (edit domain, schemas, type move)   C3 (checkout without buyer)   W1 (new text keys)
Wave 2:  W2 (view state) ← C1
         W3 (picker + catalog inStock) ← W1
         W4 (labels, list, «Enviada» rename) ← W1
Wave 3:  C2 (editOrder end to end) ← C1, C3, W3
         W5 (products card) ← W1, W2, W3
         W6 (customer card + link card) ← W1, W2
         W7 (delivery card) ← W1, W2
         W8 (payments panel) ← W1, W2
Wave 4:  W9 (view shell + Nueva venta) ← W4, W5, W6, W7, W8
Wave 5:  W10 (saved order + Guardar cambios) ← C2, W9
Wave 6:  D1 (permanent docs) ← W10
```

Rules every task follows, so that each intermediate merge keeps typecheck, lint, unit tests and E2E green:

- A task edits only the files it owns, plus its own new test files.
- A task that changes a consumed export, a text or a visible behavior also owns every call site, unit test and E2E assertion that the change breaks. The owned tests are named in each task.
- Wave-3 components are new files. An existing component they reuse (`rated-delivery-form.tsx`, `order-link-card.tsx`) only gets additive optional props, with the old call sites untouched. The old components still used by `order-new.tsx` and `order-detail.tsx` are deleted by the task that stops using them (W9, W10).
- `apps/core/app/locales.ts` is edited by at most one task per wave: W1 (wave 1), W4 (wave 2), W9 (wave 4), W10 (wave 5).
- No two tasks in the same wave touch the same file. Shared files are touched in successive waves: `order-repository.ts` by C1 then C2; `products/infrastructure/order-stock.ts` and its integration test by W3 then C2 (that is why C2 waits for W3); `shared/contracts/orders.ts` by C1 then W9; `order-view.tsx` and `use-unsaved-changes-guard.ts` by W9 then W10; `api-routes.ts` by W3; `order-fulfillment.spec.ts`, `order-cancellation.spec.ts` and `public-catalog.spec.ts` by W4 then W10; `orders.spec.ts` by W4 then W9; `order-waiting-stock.spec.ts` and `order-mentioned-price.spec.ts` by W9 then W10.

### C1. Edit domain, revisions, schemas and the item-changes type

**Files:**
- `apps/core/src/features/orders/domain/order-edit.ts`, `domain/order-revisions.ts`, `presentation/order-edit-schemas.ts`, `shared/orders-edit.ts`, and their tests;
- `domain/chat-order.ts`, `application/apply-chat-message.ts` and `infrastructure/order-repository.ts`, for the import change only;
- `shared/contracts/orders.ts`, to export `recipientSchema` and `agencyRecipientSchema`.

**Scope:**
- `orderEdit` (`isApplied`, `checkLocks`, `planItems`, `applyItems`, `applyCustomer`, `amendDelivery`) and `orderRevisions`;
- the brands and unions in §6;
- the request and result schemas in §8;
- `maxOrderLineQuantity` and `maxOrderLines`;
- `ChatOrderItemChanges` replaced by `OrderItemChanges` in every importer.

**Out of scope:** use case, repository behavior, events, routes, UI.

**Acceptance criteria:**
1. Raising «Deadpool · M» from 1 to 2 on order 1042 gives an items total of 418.00. The kept «Traje» lines keep S/ 89.00 even when the catalog price passed in is 95.00.
2. `orderRevisions` of 1042 is equal before and after adding a payment. After changing the buyer phone, only `customer` differs.
3. Clearing the customer of a WhatsApp order keeps its `contactId` with a null name and phone. On a manual order it gives `buyer: null`.
4. `editOrderRequestSchema` rejects a body without parts and a quantity of 10000, and turns a reference of «» into `null`.
5. Typecheck, lint, the chat unit tests and `apply-chat-message.integration.test.ts` stay green after the type move.

**Tests:** the `order-revisions`, `order-edit` and `order-edit-schemas` unit titles in §14.

**Depends on:** nothing.

### C3. Checkout accepts a confirmed order without buyer details

**Files:**
- `apps/core/src/features/orders/domain/checkout.ts` (+ test);
- `shared/contracts/order-checkout.ts` (`publicCheckoutSchema` only) and `apps/core/src/features/orders/presentation/checkout-contracts.test.ts`;
- the buyer details rendering in `apps/core/app/components/checkout-sections.tsx` (+ test) and `apps/core/app/routes/checkout.tsx` (+ `checkout.test.ts`).

**Scope:** relax `checkoutState` and `publicCheckoutSchema` with the same rule (§5.2). The checkout shows the read-only details empty for such an order. Confirm that `checkout-recipient.ts` needs no change: its schema validates only the buyer's own form, and the prefill already tolerates a missing name and phone.

**Out of scope:** any change to how the buyer confirms.

**Acceptance criteria:**
1. A confirmed order with `buyer: null`, and a confirmed WhatsApp order with `{ name: null, phone: null }`, render their checkout as confirmed with empty buyer details, instead of a 503 from `serialize`.
2. A confirmed buyer with a name and an invalid phone, or with only one of the two, still fails both `checkoutState` (`INVALID_CHECKOUT`) and `publicCheckoutSchema`.
3. The existing checkout tests, `checkout-contracts.test.ts` (with its confirmed `buyer: null` case moved to accepted) and `tests/e2e/checkout.spec.ts` stay green.

**Tests:** the `checkout`, `checkout-contracts` and `checkout-sections` unit titles and the checkout route titles in §14.

**Depends on:** nothing.

### W1. New text keys for the order view

**Files:** `apps/core/app/locales.ts`, `apps/core/app/locales.test.ts`.

**Scope:** every new Spanish text in the product draft (sections Screens, Rules and When something fails), under a new `orderView` namespace, with its Portuguese version. Keys are named by meaning (`orderView.products.lockedDeducted`), and interpolations use i18next.

**Out of scope:** renaming or removing any existing key (W4, W9, W10), and components.

**Acceptance criteria:**
1. Each new text of the product draft has an `es` key. `pt` has the same keys, and a parity assertion for `orderView` is added to `locales.test.ts`.
2. No existing key or text changes. Every existing unit test and E2E spec stays green.

**Tests:** `app/locales.test.ts`.

**Depends on:** nothing.

### C2. `editOrder` end to end in core

**Files:**
- `application/edit-order.ts` (+ unit test, + integration test);
- `application/events.ts`, `application/deduct-due-stock.ts` (trigger union);
- `infrastructure/order-repository.ts` (`saveOrderCustomer`, batched `saveItemChanges`, `VARIANT_NOT_FOUND`, `lockWaitMs`), with the added integration cases in `order-repository.integration.test.ts`;
- `products/infrastructure/order-stock.ts` and `products/index.ts` (`findSellableVariantStock` only), with its case in the order-stock integration test;
- `composition.ts`.

**Scope:**
- the use case in §5.1, the `order_edited` event and its handler registration;
- `editConfiguredOrder`, `orders.edit`, `orders.revisions` and `orders.lineCatalog` (`null` on failure, with its warn log);
- `findSellableVariantStock`;
- the chat error mapping and the logs in §13.

**Out of scope:** the web action and UI (W10), and the catalog `inStock` flag (W3).

**Acceptance criteria:** the integration scenarios in §14, in particular:
1. Raising Deadpool to 2 on 1042 → total 418.00, `balanceDue` 268.00, the payment unchanged, the delivery snapshot byte-equal.
2. Removing both «Traje» lines from 1042:
   - with Deadpool M stock at 4 → `paymentStatus: "paid"`, `overpaidAmount` 30.00 and `stockDeducted: true` in the same result;
   - with stock at 0 → `stockDue.kind === "waiting"`.
3. A chat message changes the items between the load and the save → `ORDER_CHANGED` with `parts: ["items"]`. The same save with only `customer` succeeds.
4. Sending the same request twice → the second succeeds with `applied: []`, and quantities do not double. The same holds when the first one deducted the stock.
5. After a quantity edit, every stored `subtotal` equals quantity × unit price, and no item of another order or company changes. Added items go in one `createMany`, and a variant deleted before the insert answers `VARIANT_NOT_FOUND` with its id.
6. The existing chat, payment, delivery and checkout integration suites stay green, including the chat retry on a deleted variant.

**Tests:** the `edit-order` unit and integration titles, the repository titles, the `findSellableVariantStock` title and the chat title in §14.

**Depends on:** C1, C3, W3 (W3 edits `order-stock.ts` first).

### W2. Order view state

**Files:** `apps/core/src/features/orders/presentation/order-view-state.ts` (+ test).

**Scope:** a pure model and its functions; type-only imports from `domain/`, and none from `order-revisions.ts`.
- `OrderViewDraft` for a new or saved order: lines with their saved or catalog price, the typed quantity text, the shown stock from `lineCatalog`, and a sellable flag; customer fields; delivery tab and form; draft payments for a new sale.
- The pinned base per part, with the update rules in §6.4.
- `initialDraft`, `refreshFromLoader` and `applySaveResult`.
- `unsavedParts`; `invalidFields` (in screen order); `estimate` (subtotal, delivery, paid, total, balance or excess, with `shared/money`); `screenLocks`.
- `buildCreateRequest` (`completeOrderSchema`); `buildEditRequest` (`editOrderRequestSchema`, with `amend` or `replace` and the pinned revisions).
- `inDoubtOutcome(reread, draft, base)` for the in-doubt check (`applied`, `not_applied` or `changed`); `resetProducts` for `ITEMS_LOCKED`.
- With a locked delivery, the «Igual que el cliente» mirror is off: a customer change never emits a delivery part.

**Out of scope:** React components.

**Acceptance criteria:**
1. The `order-view-state` titles in §14 pass.
2. Raising and lowering back a quantity leaves `unsavedParts` empty.
3. A refresh that brings chat-changed items while items are edited leaves the items base revision unchanged.

**Depends on:** C1.

### W3. Floating product picker and catalog `inStock`

**Files:**
- `presentation/product-picker-dialog.tsx`, `presentation/product-picker-keyboard.ts`, `presentation/use-catalog-search.ts` (+ tests);
- `presentation/api-routes.ts` (`catalogQuerySchema`) with its tests;
- `products/infrastructure/order-stock.ts` (`searchSaleCatalog` `inStock`) with its integration test.

**Scope:**
- A modal over `GET /api/orders/catalog`: search, **Todos** / **Con stock** (server filter), the counter, one chip per active variant with its stock and «✓ n».
- The request policy in §2 in `useCatalogSearch({ catalogEpoch })`, a hook the view mounts and passes to the dialog: debounce, abort, latest wins, previous results kept, the empty query cached per `inStock` value, dropped when `catalogEpoch` changes, and fetched again only when the picker opens.
- The combobox keyboard model and polite announcements.
- The loading, empty, error and too-many states, and initials thumbnails.
- `search` (the hook's state), `onAdd(variant)` and `onClose()` props on the dialog.
- The `variantIds` cap.

**Out of scope:** the «/» shortcut wiring and the lines (W5, W9).

**Acceptance criteria:**
1. The picker titles in §14 pass.
2. Product criterion 2 passes against a fake catalog.
3. A response for «prín» arriving after the one for «príncipe» does not change the results.
4. Switching to **Con stock** with an empty text sends `inStock=true` instead of reusing the **Todos** result, and a new `catalogEpoch` drops the cache without a request until the next opening.
5. The existing mobile calls (`search`, `variantIds`) answer as before.

**Depends on:** W1.

### W4. Header and list labels and the «Enviada» wording

**Files:**
- `presentation/order-status-labels.tsx` (+ test);
- `app/routes/order-list.tsx` and `app/routes/order-list.test.ts`;
- `app/locales.ts` and `app/locales.test.ts`: rename `deliveryStatus.shipped` to «Enviada» and the list filter to «Enviado desde», and add the label keys if W1 did not;
- the E2E assertions this changes: `tests/e2e/order-list.spec.ts`, `order-fulfillment.spec.ts` (the «Entrega: Despachada» and «Despachado» lines), `order-cancellation.spec.ts` (the «Entrega: …» lines) and `orders.spec.ts` (the «Entrega: Pendiente» line). The detail header still shows the old badge, now with «Enviada».

**Scope:** the label rules and icons of «Header labels and sales list» in the list control, «Enviada» and «Enviado desde», and an `orderOriginKey` helper for the subtitle.

**Out of scope:** the detail header layout (W10). The list's «Desde el catálogo» badge stays.

**Acceptance criteria:**
1. Product criterion 24 holds in the list.
2. The label titles in §14 pass.
3. `order-list.test.ts` and the listed E2E specs pass with the new texts, and nothing else asserts «Despachada».

**Depends on:** W1.

### W5. «Productos» card

**Files:** `presentation/order-products-card.tsx` (+ test).

**Scope:**
- Lines with initials, name, combination or «Variante única», the mentioned-price note, the stepper, the typed quantity rules, remove with its accessible name, the stock warning from `lineCatalog`, and the no-longer-sold note.
- The header count and stock line, the dashed search row, totals with the estimate note, and the empty and locked states.
- Opens W3's picker.

**Out of scope:** saving and the «/» shortcut. Not mounted by any route yet.

**Acceptance criteria:**
1. Product criteria 3 and 10 hold at component level.
2. The products card titles in §14 pass.

**Depends on:** W1, W2, W3.

### W6. «Cliente» card and the link card's pending state

**Files:** `presentation/order-customer-card.tsx` (+ test), `app/components/order-link-card.tsx` (+ test).

**Scope:**
- Name and phone with the country selector (`phone-field.tsx`), the both-or-none rule, **Quitar cliente** except on WhatsApp orders, the WhatsApp hint, read-only when cancelled.
- A `pending_save` state added to the link card («Disponible al guardar», disabled controls). The existing states and call sites stay unchanged.

**Out of scope:** the delivery mirror (W7).

**Acceptance criteria:**
1. Product criteria 5 (before saving) and 22 (no **Quitar cliente** on WhatsApp) hold at component level.
2. `order-link-card.test.tsx` stays green.

**Depends on:** W1, W2.

### W7. «Entrega» card

**Files:** `presentation/order-delivery-card.tsx` (+ test), `presentation/rated-delivery-form.tsx` (additive optional props only, + test).

**Scope:**
- Tabs **Por definir** plus the enabled methods; open fields with no **Editar entrega** step; the incomplete-delivery notes; «Igual que el cliente» with the new-sale and saved-order rules.
- The internal cost, «Elegida por el comprador», «Marcar como entregado al guardar» for a new sale, and the locked state.
- A slot for the fulfillment buttons.

**Out of scope:** the ship and deliver actions, and the current call sites in `order-new.tsx` and `order-detail.tsx`, which keep working unchanged.

**Acceptance criteria:**
1. Product criteria 6 and 21 hold at component level.
2. The delivery card titles in §14 pass.
3. The existing `rated-delivery-form` tests, `order-new.test.tsx` and `order-delivery-action.test.ts` stay green.

**Depends on:** W1, W2.

### W8. «Pagos» panel

**Files:** `presentation/order-payments-panel.tsx` (+ test). It may import pieces of `payment-fields.tsx`, `payment-decision-form.tsx` and `receipt-dialog.tsx` without changing them.

**Scope:**
- Summary lines, and **Agregar <wallet>** per country wallet plus **Transferencia bancaria**, each opening the existing form with its method preset.
- Draft rows with **Quitar** for a new sale.
- Blocked actions as `aria-disabled` with «Guarda o descarta los cambios primero.».
- «Agrega productos para registrar pagos.».
- The existing decisions and dialogs.

**Out of scope:** `order-payments-card.tsx`, which keeps serving the current detail until W10 deletes it, and the payment actions' server code.

**Acceptance criteria:**
1. Product criterion 23 holds.
2. The payments panel titles in §14 pass.
3. `order-payments-card.test.ts` and the E2E specs asserting «¿Te pagaron por fuera? Registrar pago» stay green.

**Depends on:** W1, W2.

### W9. Order view shell and «Nueva venta»

**Files:**
- `presentation/order-view.tsx`, `presentation/use-unsaved-changes-guard.ts` (+ tests);
- `app/routes/order-new.tsx`, `order-new.test.tsx`, `order-new-action.test.ts`. The action keeps its contract: a form field `order` with the creation JSON, posted to `/orders/new` and `/orders/new.data`, so `tests/e2e/rated-order-creation-action.spec.ts` passes unchanged;
- `shared/contracts/orders.ts` (`newOrderLoaderSchema` without `products`);
- `app/locales.ts` and `app/locales.test.ts`, to remove the keys only the old «Nueva venta» used;
- E2E: a new `tests/e2e/order-view.spec.ts` (the new-sale test), and updates to the specs that create sales through the «Nueva venta» UI (`orders.spec.ts`, `order-waiting-stock.spec.ts`, `agency-delivery.spec.ts`, `order-mentioned-price.spec.ts` where applicable).

**Scope:**
- The two-column and single-column layout, and the header: breadcrumb, «Sin guardar», actions, saved labels from W4, subtitle.
- The status line and the sticky bar.
- The «/» shortcut, **Descartar** with its dialog, and the leave guard.
- **Guardar venta** with invalid-field focus, the in-doubt check by order id (`lost-response.ts`), the history-replacing navigation, and focus on the heading after saving.
- A loader without the catalog search.
- `useCatalogSearch` mounted in the view, outside the picker dialog.
- Saved-mode extension points in `order-view.tsx` are not required: W10 owns the file next and adds saved mode itself.
- `order-new.tsx` stops using `rated-delivery-form`'s old mode and `payment-fields` directly where the cards replace them.

**Out of scope:** editing a saved order and the saved mode of `order-view.tsx` (W10). `order-detail.tsx` is untouched.

**Acceptance criteria:**
1. Product criteria 1 (new sale), 2, 4, 5, 6, 17 (on a new sale), 25 and 28 (new-sale part) hold.
2. The new-sale E2E passes.
3. Every listed E2E spec passes, and `rated-order-creation-action.spec.ts` passes unchanged.

**Depends on:** W4, W5, W6, W7, W8.

### W10. Saved order and «Guardar cambios»

**Files:**
- `app/routes/order-detail.tsx`, `order-detail.test.ts`; `order-delivery-action.test.ts` (deleted, replaced by the `save_changes` route tests);
- `presentation/order-view.tsx` and `presentation/use-unsaved-changes-guard.ts` (+ tests), for the saved mode;
- deleted once unused: `presentation/order-payments-card.tsx` and its test, and the old mode of `rated-delivery-form.tsx`;
- `app/locales.ts` and `app/locales.test.ts`, to remove the keys of «Detalles internos», «¿Te pagaron por fuera? Registrar pago», «Editar entrega» and the detail «Desde el catálogo» badge, when no longer used;
- E2E: `tests/e2e/order-view.spec.ts` (the edit test), and updates to `order-fulfillment.spec.ts`, `order-cancellation.spec.ts`, `order-waiting-stock.spec.ts` («Detalles internos»), `buyer-payment.spec.ts` and `select-in-dialog.spec.ts` («Registrar pago» → wallet buttons), `order-mentioned-price.spec.ts`, `dispatch-labels.spec.ts`, `public-catalog.spec.ts` (the detail badge line), `store-delivery.spec.ts` (the three «Editar entrega» steps) and `rated-order-delivery-action.spec.ts` (rewritten onto `save_changes`, keeping its stale-price and pickup-replacement cases, §14).

**Scope:**
- The loader adds `revisions` and `lineCatalog`: the aggregate first, then one `Promise.all` over `lineCatalog` (skipped when products are locked), `describeStockDue`, the receipt URLs, the settings and the link (§8).
- The JSON action dispatches on `body.operation`. `"save_changes"` calls `orders.edit`, re-reads `lineCatalog` and maps codes as in §8. The old `"delivery"` JSON action is removed, because the delivery card saves through `save_changes`.
- `clientAction` catches a lost `save_changes` response and runs the in-doubt check (`GET /api/orders/:id/aggregate`, then `inDoubtOutcome`). It revalidates when the check finds the changes applied, shows the conflict alert when it finds them `changed`, keeps the edits when `not_applied`, and shows **Comprobar de nuevo** when the check itself fails.
- `shouldRevalidate` follows §8.
- The view in saved mode, in `order-view.tsx` and `order-detail.tsx`:
  - the saved header: «Pedido #N», the subtitle and the W4 labels with their accessible names;
  - the sticky bar with only the total, or «Cambios sin guardar» with **Descartar cambios** and **Guardar cambios**;
  - the leave guard for a saved order («¿Descartar los cambios?», **Descartar cambios**, **Seguir editando**);
  - pinned base per §6.4;
  - the `catalogEpoch` bump after a successful save and after each revalidation;
  - `lineCatalog: null` shown as unknown stock;
  - immediate actions blocked while there are unsaved changes;
  - refresh after **Anular pago** and **Rechazar** keeping the edits;
  - the conflict, `ITEMS_LOCKED`, `DELIVERY_LOCKED` (**Guardar solo el cliente**) and cancelled alerts;
  - «Detalles internos» removed;
  - fulfillment buttons in the delivery slot.

**Out of scope:** the part 2 state card.

**Acceptance criteria:**
1. Product criteria 7 to 16, 18 to 20, 22, 26, 27 and 29 hold, and so do the saved-order parts of the others: criterion 1 (opening #1042), 17 (leaving a saved order), 21 (saving a customer name change leaves the other recipient), 24 (the header) and 28 (the sticky bar of a saved order).
2. The saved-order E2E tests pass, and so do the saved-mode `order-view.test.tsx` titles and the route titles in §14.
3. A void after a chat change, followed by **Guardar cambios**, shows the conflict.
4. Every listed E2E spec passes, and no test references a deleted component or key.

**Depends on:** C2, W9.

### D1. Permanent documentation

**Files:** `docs/orders.md`, `docs/checkout.md`, `docs/event-bus.md` (event list).

**Scope:**
- Document the edit operation and its rules, the new stock trigger, the catalog `inStock` flag, the products card stock line that replaces «Detalles internos», the labels and wording, and the checkout without buyer details, following the Documentation skill.
- Delete both drafts when the feature merges.

**Out of scope:** code.

**Acceptance criteria:**
1. The sentence «never through a seller action on the order» is replaced by the edit trigger.
2. «No route edits the items of an existing order» is replaced by the edit rules.
3. The «Detalles internos» table becomes the products card stock line.

**Depends on:** W10. Merge-time task.

### Final verification

Run the manual checks in §14 and `scripts/ci.sh` on the integration branch. The results go in the pull request description.

## 17. Questions decided by the review gate

Decided on 30/10/2026 by the architecture review gate of the implement-task skill: the design reviewer and the performance reviewer, consolidated by the coordinator. Gate record: round 1 rejected by both (design 3 blockers, performance 2); round 2 rejected by design (2 blockers) and approved by performance; round 3 approved by both, with both answers below unchanged. Both answers are pending the founder's confirmation in the pull request.

1. **Is the edit operation exposed to mobile as a public API now?**
   - Answer: no. Only the web route action uses it, with its schemas in `features/orders/presentation/order-edit-schemas.ts`. The mobile item-editing task adds `PATCH /api/orders/:id` on the same use case and moves the schemas to `shared/contracts/orders.ts`.
   - Who decided: the design and performance reviewers, consolidated by the coordinator.
   - Reason: mobile editing is out of this version, and the guide puts web-only schemas in the feature's presentation. A public contract without a consumer would add fixtures and tests, and three digests on every aggregate serialization, for nothing.
   - Discarded alternative: adding `PATCH /api/orders/:id` and `revisions` in `orderAggregateSchema` now. It fixes a public contract before any client uses it, and every aggregate payload, including list pages and mobile, would pay for the revisions.
2. **Do order lines and picker results show product photos?**
   - Answer: no, initials only in this version.
   - Who decided: the design and performance reviewers, consolidated by the coordinator.
   - Reason: the product draft allows «thumbnail or initials». Photos would change the shared catalog contract and the mobile fixtures, and would add image resolution to every picker search, for a cosmetic gain better made together with the mobile picker.
   - Discarded alternative: `imageUrl` per product in `orderCatalogSchema`, plus a photo map in the order view loader using `findItemPhotos`.

Decided unless objected:
- Conflicts are detected with per-part content revisions (a digest of items, customer and delivery) that the view pins and sends back. No version column is added, and the chat, checkout and delivery writers do not change.
- The view keeps, per part, the base it edits against. A refresh replaces the base only of parts without unsaved edits.
- A sent part already in the requested state is dropped before any lock or revision check, so a repeat after an in-doubt answer always succeeds without writes.
- Core enforces only cancelled, delivery not pending and stock deducted. «Descontando stock» stays a screen rule.
- A new in-transaction event, `order_edited`, triggers the existing stock listener once per save that changes items or delivery. A customer-only save publishes nothing.
- A delivery change is either an `amend` or a `replace`; the view chooses, and core validates the method.
  - `amend`, one variant per method: recipient, home address text, reference, agency document. No new quote.
  - `replace`: method, district, rate or agency. Quoted with `expectedPrice`.
- An emptied reference is stored as `null`.
- Clearing the customer keeps the contact link with an empty name and phone when the order has one, and deletes `OrderBuyer` otherwise.
- `checkoutState` and the shared `publicCheckoutSchema` accept a confirmed order without buyer details, with the same rule. `editOrder` depends on it. The buyer's details card then shows only the delivery.
- Quantity per line is 1 to 9999, and a request carries at most 100 lines (`shared/orders-edit.ts`, initial values, adjustable).
- New and raised variants are looked up in one batched `findSellableVariants`:
  - A raised deactivated line and a new deactivated variant both answer `VARIANT_NOT_FOUND`, and the view picks the text by whether the line was saved.
  - A variant deleted between the lookup and the insert also answers `VARIANT_NOT_FOUND` for the edit, while the chat path keeps its retry.
- `saveItemChanges` updates quantities in one statement that sets quantity, subtotal and the mentioned-price columns, scoped by order and company. It inserts added items in one `createMany`, ordered by `variantId`, and names a missing variant from the foreign-key detail (memory e1c291c2).
- The stock and sellable state of saved lines come from one new query, `findSellableVariantStock`, in the detail loader and after commit in the save result, with no cap. A failed read gives `lineCatalog: null` (stock unknown): the loader still serves the order, and a committed save still answers «saved».
- A successful `save_changes` does not revalidate the loader; its result is the new state.
- «Con stock» is a server filter (`inStock=true`) on `GET /api/orders/catalog`. The existing callers are unchanged, and `variantIds` is capped at 100.
- Picker requests:
  - debounce of 250 ms (initial value, adjustable), with the first empty query sent at once;
  - abort of the previous request, and only the latest response is used;
  - previous results kept while loading;
  - the empty query cached per `inStock` value in a hook mounted by the view, so it outlives the dialog; dropped after a successful save or any revalidation, and fetched again only at the next opening.
- The detail loader reads the aggregate, then everything else in one `Promise.all`. It skips `lineCatalog` when the stored order locks its products.
- The in-doubt check of **Guardar cambios** has three outcomes: applied, not applied and changed (the conflict alert).
- With a locked delivery, a customer change never changes the recipient.
- The «Nueva venta» loader no longer searches the catalog, and its action keeps the current `form: { order }` contract.
- `C2` runs in wave 3, after W3, because both edit `products/infrastructure/order-stock.ts`.
- W9 builds the new-sale mode of `order-view.tsx`, and W10 owns the same file next for the saved mode.
- W1 adds only new text keys. Renames and removals belong to the tasks that own the affected assertions: W4 for «Enviada» and «Enviado desde», W9 for the old «Nueva venta» texts, and W10 for «Detalles internos», «Registrar pago», «Editar entrega» and the detail badge.
- The list keeps its «Desde el catálogo» badge; only the detail header loses it.
- Conflict codes are logged at info (`order_edit_conflicted`) to measure how often sellers hit them. Validation rejections stay at debug.
- No migration and no data change.
