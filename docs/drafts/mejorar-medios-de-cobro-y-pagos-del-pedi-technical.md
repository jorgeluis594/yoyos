# Payment methods and order payments: technical design

**Status:** draft for the review gate, round 4 (rounds 1 at `e3832cb2`, 2 at `a1e2a179` and 3 at `e22634d6` were rejected; sections 17, 18 and 19 list what changed), no open questions. Based on [`docs/drafts/mejorar-medios-de-cobro-y-pagos-del-pedi.md`](mejorar-medios-de-cobro-y-pagos-del-pedi.md) (closed product definition, commit `d8d502a5`, adjusted in this round for wallets saved before this version). Base: branch `jorgeluis594/mejorar-medios-de-cobro-y-pagos-del-pedi`. This draft is the pipeline's working document, not permanent architecture documentation: on merge only `docs/orders.md` and `docs/checkout.md` receive the behavior changes, and both drafts are deleted.

## 1. Technical goal

Core rejects saving an offered digital wallet unless its image holds a QR that core decodes. It stores with the wallet that its current image passed. Only wallets that passed reach buyers and the checkout preview; a wallet saved before this version is read as unchecked until the seller saves it again. A pending buyer report gets a new final `rejected` payment state with an optional reason. Web, checkout and mobile read that state through the shared orders contract. The web order detail is reorganized into the b3 card and the b4 receipt dialog. Mobile adds rejection to its existing review sheet.

```text
Settings page ──PUT/POST qr-checks──▶ companies.savePaymentSettings ──readImageBytes + readQrCodes──▶ stored wallet { qr: verified }
                                                     │
                       companyPaymentSettings.get (offered only) ──▶ orders.getBuyerPaymentView, store-appearance preview

Web order detail (action) / mobile (POST …/reject) ──▶ orders.rejectPayment ──▶ Payment { status: "rejected" } ──▶ buyer view { rejectedReport }
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| QR reader location | `readQrCodes` moves from `features/products/infrastructure/qr-code-reader.ts` to `src/shared/images/infrastructure/qr-code-reader.ts`, together with its test and `qr-fixtures/`. Products imports it from there; `selectProductCode` stays in products. Reason: it is generic (sharp + zxing, no product knowledge), two features now use it, and importing products from companies would close the cycle companies → products → orders → companies. This changes what memory `b9ad8a84` records ("the QR reader and selectProductCode live in products"); happy-memory-maintainer updates it when T2 merges. Memory `ceeffc07` ("Payment as a discriminated union of reported, confirmed, and voided") is updated when T1 merges: a fourth variant `rejected`, final, reached only from `reported`, never counted toward coverage, stored in the same row. |
| What "passed" means | At least one decoded QR (`readQrCodes` returns a non-empty list). `UNREADABLE_IMAGE` counts as "no QR". The content is not compared with provider or holder. |
| QR validity storage | A save writes the wallet as `{ method, provider, holder, qr: { status: "verified", imageId } }` inside `CompanyPaymentSettings.settings` (JSON). No new table or column. A save from any client can only produce `verified`; nothing else is ever written. |
| Re-reading on save | A save whose wallet `imageId` equals the stored `verified` image is not read again. Any other wallet image is read before saving. Images are immutable per id, so "passed" is a fact about the id. |
| Pre-existing wallets | Validated when read, with no script, no deploy step and no environment change (the founder allowed "una validación al leer o un script de una sola vez"; no business is in production). The stored parser has one rule: a stored wallet without a verified `qr` (the only other accepted stored shape is the pre-version `{ method, provider, holder, imageId: uuid \| null }`) parses as `{ status: "unchecked", imageId }`. An unchecked wallet is not offered to buyers and the panel shows it as needing a QR check; saving it, which reads the image like any new image, is the only way to make it `verified`. There is no other legacy code path. |
| Choose-time check | New `POST /api/company/payment-settings/qr-checks` `{ imageId }` → `{ status: "verified" \| "not_a_qr" }`. It only informs the page; nothing is stored. The save reads the same image again (section 11, "Cost of a check"); this double read is accepted. |
| Load bound | QR checks (choose-time and save) share one per-process limit of `PAYMENT_QR_CHECK_SLOTS` concurrent checks (environment value, initial 2). A check that finds no free slot is not queued: it answers `503 QR_CHECK_UNAVAILABLE`, which the page already handles with **Reintentar**. The image read of a check is aborted after `PAYMENT_QR_CHECK_READ_TIMEOUT_MS` (environment value, initial 10000), so a stalled storage request cannot hold a slot. |
| Settings errors | Not a QR: `400 INVALID_PAYMENT_QR`. Checker or image storage unavailable, storage misconfigured, or no free check slot: `503 QR_CHECK_UNAVAILABLE` (each logged with its own `errorCode`). Image of another company or missing: `400 INVALID_INPUT`, as the PUT answers today; `POST /qr-checks` answers the same. The settings page, which calls the composition in process, receives `INVALID_IMAGE` and shows the field empty (**Subir QR**). Nothing is saved on any error. |
| Offered methods | `companyPaymentSettings.get(companyId)` returns only the offered methods: bank transfer plus a wallet whose `qr.status` is `verified`, in today's shape with a non-null wallet `imageId`. An `unchecked` wallet is never offered. Orders (`getBuyerPaymentView`) and store-appearance (`paymentMethods`) keep calling it unchanged. The settings page uses the new `companyPaymentSettings.getConfiguration(companyId)`. |
| Rejected payment | New `RejectedPayment` variant of the existing `Payment` union, stored in the existing `Payment` row: `status = 'rejected'`, `amount`/`method` null, `data = { report, rejectedAt, rejectedBy, reason }`. No migration: `status` is a free `String` with no `CHECK`, and the variant rules live in domain (memory `8f0d1d36`: `status` and `amount` in columns, variant data in JSONB). |
| Reject endpoint | `POST /api/orders/:id/payments/:paymentId/reject` with body `{ reason: string \| null }`, returning `200` with `orderAggregateSchema`, like void. The web order detail calls the use case from its route action, like confirm and void. |
| Rejection reason | Trimmed; empty → `null`; at most 200 characters after trimming (initial value, adjustable in code; it is a product limit, not an environment value). |
| Repeated and crossed decisions | Rejecting a rejected payment returns it unchanged, with its original reason. Confirming with the same amount and method returns the existing confirmation; `register-payment.ts` already ignores `deductStockIfPartial` on that replay. Rejecting a confirmed or voided payment, or confirming a rejected one, returns `409 PAYMENT_CONFLICT`; voiding a rejected one returns `409 INVALID_TRANSITION`, as voiding a reported one does today. A buyer report replayed with the same payment id and receipt after the seller rejected it returns the rejected payment without writing, so a retried «Ya pagué» shows the rejection instead of an error. The web and mobile map `PAYMENT_CONFLICT` and `INVALID_TRANSITION` from approve/reject to «Este pago ya fue revisado.» and reload. No new error code. |
| Buyer view | `payments[]` gains the `rejected` status and `rejectionReason`. The view gains `rejectedReport: { reason } \| null`: the most recent buyer report (by `reportedAt`), when it is rejected and no report is pending. Receipt and wallet image URLs are resolved with one batched lookup. From T3 on, a wallet whose image URL does not resolve is dropped from the view instead of failing it, and the wallet `imageUrl` becomes non-null. |
| Stock box rule | Pure function `offersPartialStockDeduction` in `shared/orders-payment.ts`, used by web and mobile: shown only when stock is not deducted and the amount is below `balanceDue`. Core keeps its current rule; a hidden box sends `deductStockIfPartial: false`. |
| Web order detail split | `app/routes/order-detail.tsx` keeps loader and action; the «Pagos» card, the receipt dialog and the decision forms move to `src/features/orders/presentation/` components. The receipt dialog uses `app/components/ui/dialog.tsx`. Row thumbnails load lazily with fixed dimensions; only the dialog loads the receipt eagerly. |
| Mobile | No new screen. The existing review sheet in `order-detail-screen.tsx` gains **Rechazar**; the API adapter gains `rejectPayment`. |
| Task count | Four tasks in three waves (section 16): T1 alone; then T2 and T4 in parallel; then T3. T1 also leaves every consumer of the `Payment` union compiling (minimal narrowing, no new UI). Because T2 starts on T1's merged base, it may edit files and tests T1 created, so each task's tests pass on its own base. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Payment settings contract | `shared/contracts/payment-settings.ts` | `digital_wallet { provider, holder, imageId: uuid \| null }`, bank with nullable image; max 2, one per method. Not consumed by mobile. |
| Settings domain | `apps/core/src/features/companies/domain/payment-settings.ts` | `parsePaymentSettings`, `CompanyPaymentSettings`, `INVALID_PAYMENT_SETTINGS`. The same schema parses input and stored data. |
| Settings use cases | `companies/application/payment-settings.ts` | `getPaymentSettings`, `savePaymentSettings(companyId, value, { load, save, imageAvailable })`; only checks that the image exists (`INVALID_IMAGE`). |
| Settings persistence | `companies/infrastructure/payment-settings-repository.ts`; Prisma `CompanyPaymentSettings` (`companyId` PK, `settings Json`, RLS `company_payment_settings_isolation`) | `loadPaymentSettings` (`INVALID_STORED_DATA` on parse failure), `persistPaymentSettings` (upsert, full replacement). |
| Settings routes | `companies/presentation/payment-settings-routes.ts` at `/api/company/payment-settings` | `GET` 200/503/500; `PUT` 415/400 `INVALID_INPUT` (also for `INVALID_PAYMENT_SETTINGS` and `INVALID_IMAGE`)/503/200. |
| Settings composition | `companies/composition.ts`, re-exported by `companies/index.ts` | `companyPaymentSettings = { get, save }`; save logs `company_payment_settings_saved`. |
| Settings consumers | `orders/composition.ts` `getBuyerPaymentView` (~L187); `store-appearance/composition.ts` `paymentMethods` (L52, preview L76); `app/routes/payment-settings.tsx` (L20, L44) | All read `companyPaymentSettings.get`. |
| QR reader | `features/products/infrastructure/qr-code-reader.ts`, test and `qr-fixtures/` | `ReadQrCodes = ({ bytes, contentType }) => Result<readonly string[], UNREADABLE_IMAGE \| QR_READER_UNAVAILABLE>`; used by `products/composition.ts` (L29, L129). |
| Image bytes | `src/shared/images` `readImageBytes(imageId)` | `IMAGE_NOT_FOUND \| IMAGE_STORAGE_UNAVAILABLE \| PERSISTENCE_UNAVAILABLE`; a storage configuration error (`IMAGE_STORAGE_CONFIG_ERROR`, missing `R2_*`) is folded into `IMAGE_STORAGE_UNAVAILABLE` (`images.ts:141`). Company isolation through RLS `image_company_isolation` under `withTenantIsolation`. |
| Image URLs | `src/shared/images/application/images.ts` `getImage`, `getImages(ids)`; `index.ts` exports only `resolvePublicImage` (one id) | `getImages` resolves several ids with one `findMany`; per-image URL failures come back in `failures`. The order-detail loader (L46–52) and `getBuyerPaymentView` (L196–201) resolve one id per `await` today. |
| Payment domain | `orders/domain/payment.ts` | `Payment = Reported \| Confirmed \| Voided`; `parsePayment`, `reportPayment` (replay compares id, order, currency and receipt; reads `existing.data.evidence` and `existing.amount.currency` for any non-reported payment), `confirmPayment` (idempotent on same data, `PAYMENT_CONFLICT` otherwise), `voidPayment` (non-reported, non-voided falls through to `parsePayment`). |
| State machine | `orders/domain/order-state-machine.ts` | `registerPayment`, `addReportedPayment`, `voidConfirmedPayment`, `planStockDeduction`, `paymentSummary` (counts only confirmed; L211 reads `payment.amount.currency` for every non-reported payment). `message-order.ts` `isOpenForMessageItems` accepts only voided payments. |
| Use cases | `orders/application/register-payment.ts`, `report-payment.ts`, `void-payment.ts` | Each runs `deps.transaction(companyId, …)` and `findOrderForUpdate` (row lock). A confirmation replay returns before any write; `report-payment.ts` returns the order without writing whenever the domain `reportPayment` accepts an existing payment (L31). |
| Payment persistence | `orders/infrastructure/order-repository.ts`; Prisma `Payment` (`status String`, `amount Decimal?`, `method String?`, `data Json`) | `mapPaymentUnsafe` checks status-specific nulls and parses `data` per status; `updatePayment(payment, companyId, expectedStatus)` updates only when the stored status matches, else `PAYMENT_CONFLICT`. Payment `CHECK`s: `amount > 0`, supported currency; none on `status`. |
| Orders API | `orders/presentation/api-routes.ts` | `POST /:id/payments`, `POST /:id/payments/:paymentId/void`; `operationError` maps 422/409/404/503. |
| Buyer API and view | `orders/presentation/buyer-payment-routes.ts`; `orders/composition.ts` L181–217 | `GET /api/buyer/orders/:orderId/payment` → `buyerPaymentViewSchema`; payments as `{ id, status, amount, method, receiptImageUrl }`. |
| Orders contract | `shared/contracts/orders.ts` | `paymentSchema` union (L87–95), `registerPaymentSchema`, `buyerPaymentViewSchema` (L143–151), `orderApiErrorSchema` (L176–180), `orderDetailLoaderSchema` (L190). |
| Web order detail | `apps/core/app/routes/order-detail.tsx` (378 lines) | Loader builds `receiptUrls`; action handles `operation=confirm` and `operation=void`; a `PaymentForm` under each report plus «Registrar pago manual»; «Ver captura» opens a new tab; `Dialog` already imported for cancellation. |
| Web settings page | `apps/core/app/routes/payment-settings.tsx` (115 lines) | Loader, action building settings from form data, upload by `fetch("/api/images")`, local `ImageControl`. |
| Checkout | `orders/presentation/buyer-payment-content.tsx` | Upload block hidden while a report is pending; «Comprobantes enviados» as `Ver captura · {status}`. |
| Mobile orders | `apps/mobile/src/features/orders/infrastructure/order-api.ts`, `application/order-operations.ts`, `presentation/order-detail-screen.tsx`, `order-detail-translations.ts`, `translations.ts` | Uses `orderAggregateSchema` directly; `registerPayment`, `voidPayment`, `receiptUrl`; review sheet is a `pageSheet` modal (L419–439); any non-reported, non-voided payment is labelled confirmed. |
| Union consumers outside orders domain | `app/routes/order-detail.tsx` L48–49 and L292–293; `orders/presentation/order-json.ts` L25–30; `orders/composition.ts` L197–213; `orders/infrastructure/order-repository.ts` L284; `apps/mobile/.../order-detail-screen.tsx` L323–329; `buyer-payment-content.tsx` L95 with the typed i18n key `buyerPaymentContent.status.${status}` (`locales.ts` L138, L280) | Each reads `data.evidence`, `amount` or a status-keyed text for every non-reported payment, so the new variant stops them compiling. |
| E2E images | `tests/e2e/buyer-payment.spec.ts` fakes `/api/images` and `/test-images/*` in the browser (`page.route`); `message-to-order.spec.ts` serves a fake S3 on port+1000 through `R2_ENDPOINT`; `store-appearance-buyer.spec.ts` seeds only a bank transfer, so it needs no change | The server never holds real wallet bytes in `buyer-payment.spec.ts` today. |
| Transactions | `src/shared/infrastructure/persistance.ts` | `withinTransaction`, `withTenantIsolation`, `withLockedForUpdate`, `requireActiveTransaction`. |
| Logs | `orders/composition.ts` L346–377, repository, companies composition | `payment_confirmed`, `payment_reported`, `payment_voided`, `payment_operation_replayed`, `payment_operation_conflict`, `payment_confirmation_stock_rejected`, `company_payment_settings_saved`, … |

Release: `compose.prod.yaml` (and `compose.yaml` locally) runs a `migrate` service (`create-role.sql && tsx scripts/migrate.ts && provision-role.sql`) that `web` and `worker` wait on, with no `R2_*` variables. This design adds nothing to it: pre-version wallets are handled when read (section 2), so the release, its environment and its failure behavior do not change.

## 4. Gaps this design closes

1. Nothing validates that a wallet image holds a QR, and `imageId` is nullable for the wallet (§5.1, §6.1, §8.1).
2. Validity is not stored, so it cannot survive a later checker outage (§6.1, §7).
3. Wallets saved before this version have no validity (§5.4, §7: read as unchecked).
4. Buyers and the checkout preview receive wallets without a valid QR (§5.3, §9).
5. There is no choose-time QR check for the settings page (§5.2, §8.1).
6. A buyer report cannot be rejected; the union, domain, persistence mapper, contract and API lack the state (§5.5, §6.2, §8.2).
7. The buyer view cannot tell the buyer that their last receipt was rejected nor why (§5.6, §8.2).
8. The stock box rule is not defined in one place for web and mobile (§6.3).
9. The web order detail has duplicated forms and no receipt dialog (§12, T3).
10. Mobile labels a rejected payment as confirmed and cannot reject (§10).

## 5. Use cases

### 5.1 `savePaymentSettings` (companies, modified)

- **Input:** `value: unknown` (validated by `parsePaymentSettingsInput`).
- **Access:** `{ companyId, userId }` from the session.
- **Deps:**
  - `load: (companyId) => Promise<Result<readonly CompanyPaymentSettings[], SettingsFailure>>`
  - `save: (companyId, settings: readonly CompanyPaymentSettings[]) => Promise<Result<null, SettingsFailure>>`
  - `imageAvailable: (companyId, imageId: ImageId) => Promise<Result<boolean, SettingsFailure>>`
  - `detectQrCode: (imageId: ImageId, context: QrCheckContext) => Promise<Result<"qr_found" | "no_qr", QrCheckFailure>>`, with `QrCheckContext = Readonly<{ companyId: CompanyId; stage: "choose" | "save" }>` (the use case passes `stage: "save"`; the context only feeds the logs)
- **Output:** `readonly CompanyPaymentSettings[]` (stored shape, wallet with `qr.status = "verified"`).
- **Errors:** `INVALID_PAYMENT_SETTINGS | INVALID_IMAGE | INVALID_PAYMENT_QR | QR_CHECK_UNAVAILABLE | INVALID_STORED_DATA | PERSISTENCE_UNAVAILABLE`.
- **Flow:**
  1. Parse the input; a wallet requires `imageId`.
  2. Check `imageAvailable` for every image (wallet and bank), as today.
  3. `load` the current settings.
  4. If the stored wallet is `{ status: "verified", imageId }` with the same `imageId`, keep it verified without reading.
  5. Otherwise, including an `unchecked` stored wallet with the same `imageId`, `detectQrCode(imageId)`: `no_qr` → `INVALID_PAYMENT_QR`; failure → `QR_CHECK_UNAVAILABLE`; `qr_found` → `{ status: "verified", imageId }`.
  6. `save` the full replacement and return it.

### 5.2 `checkPaymentQr` (companies, new)

- **Input:** `{ imageId: ImageId }`.
- **Access:** `{ companyId, userId }`.
- **Deps:** `imageAvailable`, `detectQrCode` (same signatures as 5.1; the use case passes `stage: "choose"`).
- **Output:** `"verified" | "not_a_qr"`.
- **Errors:** `INVALID_IMAGE | QR_CHECK_UNAVAILABLE | PERSISTENCE_UNAVAILABLE`.
- **Flow:** check the image belongs to the company; `detectQrCode`; map `qr_found` → `verified`, `no_qr` → `not_a_qr`. Nothing is written.
- `detectQrCode` is one function created once at module scope in `companies/composition.ts` (§9), with one limiter instance shared by 5.1 and 5.2. No per-request or per-use-case limiter is created, so the bound of section 11 holds for the whole process.

### 5.3 `getOfferedPaymentSettings` and `getPaymentConfiguration` (companies)

- `getOfferedPaymentSettings(companyId, { load })` → `Result<readonly OfferedPaymentSetting[], SettingsFailure>`: `load`, then the pure `offeredPaymentSettings(settings)`, which drops an `unchecked` wallet. Exposed as `companyPaymentSettings.get` (same name and shape its consumers use today).
- `getPaymentConfiguration(companyId, { load })` → stored settings with `qr` (`verified` or `unchecked`), for the settings page. Exposed as `companyPaymentSettings.getConfiguration`.

### 5.4 Reading a wallet saved before this version (companies, no use case)

- No script and no release step. `parseStoredPaymentSettings` (§6.1) reads the pre-version wallet `{ method, provider, holder, imageId: uuid | null }` as `{ status: "unchecked", imageId }`. Every other stored wallet must be `{ method, provider, holder, qr: { status: "verified", imageId } }`; anything else is still `INVALID_STORED_DATA`.
- Effects, all from existing use cases: `get` (offered) drops it, so buyers and the checkout preview do not see it; `getConfiguration` returns it, so the panel shows its state (§12, settings page); `savePaymentSettings` reads its image on the next save (§5.1 step 5), which is the only way to make it `verified`.
- A row is never rewritten on read. It changes only when the seller saves, so a checker outage can never turn a wallet into a failure.
- Deploy window: if the previous version accepts a save while the new one already serves, it writes the pre-version shape, which the new version reads as `unchecked` (hidden until saved again). The company's checkout never fails because of it.
- Reverse deploy window: while old containers still serve, a save on a new container writes `{ …, qr }`, which the old strict parser (`strictObject` with required `imageId`) rejects as `INVALID_STORED_DATA`. On the old containers that company's settings page and whole buyer payment view fail until they are replaced. Accepted: no business is in production and the window lasts one container replacement.
- This parser rule is the whole compatibility cost (guide 6.9 is waived only here, as the founder's "validación al leer"). Removal condition: no stored `CompanyPaymentSettings` row has a wallet without `qr` (`jsonb_path_exists(settings, '$[*] ? (@.method == "digital_wallet" && !exists(@.qr))')` returns no row, checked per environment), at the latest before the first business goes to production. Then the pre-version branch and its tests are deleted and such a row becomes `INVALID_STORED_DATA`. Listed as a deferred item (section 18).

### 5.5 `rejectPayment` (orders, new) — `orders/application/reject-payment.ts`

```ts
export type RejectPaymentInput = Readonly<{ orderId: OrderId; paymentId: PaymentId; reason: string | null }>;
export type RejectPaymentError = OrderDomainError | PaymentError
  | Readonly<{ code: "ORDER_NOT_FOUND" | "PAYMENT_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE"; message: string }>;
export type RejectPaymentDependencies = Readonly<{
  transaction: <T>(companyId: CompanyId, work: () => Promise<Result<T, RejectPaymentError>>) => Promise<Result<T, RejectPaymentError>>;
  findOrderForUpdate: (id: OrderId, companyId: CompanyId) => Promise<Result<OrderAggregate | null, RejectPaymentError>>;
  updatePayment: (payment: Payment, companyId: CompanyId, expectedStatus: "reported") => Promise<Result<null, RejectPaymentError>>;
  clock: () => Date;
}>;
export async function rejectPayment(input: RejectPaymentInput, access: OrderAccess, deps: RejectPaymentDependencies): Promise<Result<RejectPaymentOutput, RejectPaymentError>>;
export type RejectPaymentOutput = Readonly<{ order: OrderAggregate; applied: boolean }>;
```

Flow:
1. `transaction(companyId)`; `findOrderForUpdate` (row lock); `null` → `ORDER_NOT_FOUND`.
2. Find the payment; missing → `PAYMENT_NOT_FOUND`.
3. `parseRejectionReason(input.reason)` → `INVALID_PAYMENT` when longer than 200.
4. `orderStateMachine.rejectReportedPayment(order, paymentId, { rejectedBy: userId, rejectedAt: clock(), reason })`:
   - cancelled order → `ORDER_CANCELLED`;
   - already rejected → `ok` with the same order and `applied: false`;
   - confirmed or voided → `PAYMENT_CONFLICT`.
5. If applied, `updatePayment(rejected, companyId, "reported")` (a concurrent decision makes it `PAYMENT_CONFLICT`).
6. Return the next aggregate. Recibido, balance, stock and completion do not change: `paymentSummary` already counts only confirmed payments.

### 5.6 `getBuyerPaymentView` (orders composition, modified)

- Payments projection adds `rejected` and `rejectionReason` (`data.reason` of a rejected payment, otherwise `null`). The receipt of a rejected payment comes from `data.report.receiptImageId`.
- `rejectedReport = rejectionAwaitingNewReport(order)` → `{ reason } | null`.
- Settings come from `companyPaymentSettings.get`, which now returns only offered methods.
- Image URLs (wallet, bank and every receipt) are resolved with one call to the new `resolvePublicImages(ids)` export of `src/shared/images/index.ts` (it wraps `getImages`, one `findMany`), instead of one `resolvePublicImage` per id. A lookup failure keeps answering `PERSISTENCE_UNAVAILABLE`; a per-image URL failure gives `receiptImageUrl: null` for that receipt. Rejection makes receipts accumulate per order (report → reject → report), so the loop must not grow one query per receipt.
- Wallet image URL (T1 keeps today's nullable `imageUrl`). T3 drops from `settings` a wallet whose URL does not resolve and makes the field non-null, matching the product rule "a wallet without a usable QR is not listed"; a missing image never fails the whole buyer view.

### 5.7 Existing use cases with an exact change

- `reportPayment(input, existing)` (domain): an existing `rejected` payment with the same id, order, currency and receipt (`data.report.receiptImageId`, `currency`) → `ok(existing)`; any other `rejected` existing → `PAYMENT_CONFLICT`. `report-payment.ts` then returns the order without writing (its existing L31 branch), so the buyer's retried «Ya pagué» shows the rejection.
- `confirmPayment` (domain): an existing `rejected` payment → `PAYMENT_CONFLICT`.
- `voidPayment(existing)` (domain): an explicit `rejected` branch → `INVALID_TRANSITION`, before the fall-through to `parsePayment` (which would return `INVALID_PAYMENT`).
- `orderStateMachine.registerPayment`: a `rejected` payment with the same id → `PAYMENT_CONFLICT`.
- `voidConfirmedPayment`: a `rejected` payment → `INVALID_TRANSITION` (same as reported today).
- `paymentSummary` (L211): the currency of a `rejected` payment is `payment.currency`, like a reported one; it adds nothing to `paidAmount`.
- `order-repository.ts` insert and update (L284, L300): currency of a `rejected` payment is `payment.currency`.
- `isOpenForMessageItems` (`message-order.ts:19`): no change. A rejected payment keeps the order closed to message items like any non-voided payment. It is unreachable in practice, because a buyer reports only after checkout confirmation and `checkoutConfirmedAt !== null` already closes the order; do not "fix" it to treat rejected like voided.
- `register-payment.ts`, `void-payment.ts`, `report-payment.ts`: no code change (their behavior follows the domain).

## 6. Domain and typing

### 6.1 Companies

```ts
// companies/domain/payment-settings.ts
export type WalletQr =
  | Readonly<{ status: "verified"; imageId: ImageId }>
  | Readonly<{ status: "unchecked"; imageId: ImageId | null }>; // only from a wallet saved before this version
export type DigitalWalletSetting = Readonly<{ method: "digital_wallet"; provider: string; holder: string; qr: WalletQr }>;
export type BankTransferSetting = Readonly<{ method: "bank_transfer"; bank: string; holder: string; accountNumber: string | null; cci: string | null; imageId: ImageId | null }>;
export type CompanyPaymentSettings = DigitalWalletSetting | BankTransferSetting;
export type PaymentSettingsInput = /* wallet { method, provider, holder, imageId: ImageId } | bank (as today) */;
export type OfferedPaymentSetting =
  | Readonly<{ method: "digital_wallet"; provider: string; holder: string; imageId: ImageId }>
  | BankTransferSetting;

export function parsePaymentSettingsInput(value: unknown): Result<readonly PaymentSettingsInput[], PaymentSettingsError>;
export function parseStoredPaymentSettings(value: unknown): Result<readonly CompanyPaymentSettings[], PaymentSettingsError>;
export function offeredPaymentSettings(settings: readonly CompanyPaymentSettings[]): readonly OfferedPaymentSetting[];
export type QrCheckFailure = Readonly<{ code: "QR_CHECK_UNAVAILABLE" | "INVALID_IMAGE"; message: string }>;

// src/shared/images/application/images.ts (T2): the storage variant keeps its code and says why
export type ImageReadError =
  | Readonly<{ code: "IMAGE_NOT_FOUND" | "PERSISTENCE_UNAVAILABLE"; message: string }>
  | Readonly<{ code: "IMAGE_STORAGE_UNAVAILABLE"; storageCode: "IMAGE_STORAGE_UNAVAILABLE" | "IMAGE_STORAGE_CONFIG_ERROR" | "IMAGE_STORAGE_TIMEOUT"; message: string }>;

export function readImageBytes(imageId: string, storage: ImageStorage, repository: ImageRepository,
  options?: Readonly<{ signal: AbortSignal }>): Promise<Result<Readonly<{ bytes: Uint8Array; contentType: string }>, ImageReadError>>;
// ImageStorage.read(key, options?) passes the signal to the S3 GetObjectCommand (abortSignal) and keeps it for the body read
// (transformToByteArray). The SDK rejects with AbortError before the headers and with Error { code: "ECONNRESET", message: "aborted" }
// during the body (measured by the performance gate with the repo's SDK). Classify by `options.signal.aborted` after the catch, never by
// the error name: aborted → storageCode IMAGE_STORAGE_TIMEOUT, otherwise IMAGE_STORAGE_UNAVAILABLE.
// src/shared/images/index.ts (T2): the readImageBytes wrapper forwards options:
//   export const readImageBytes = (imageId: string, options?: Readonly<{ signal: AbortSignal }>) => readBytes(imageId, storage, imageRepository, options);
```

- `WalletQr`: validity is a variant, not a boolean next to a nullable id (guide 3.5). `unchecked` is produced only by the stored parser (§5.4); no save writes it.
- `ImageReadError.storageCode`: products and orders keep reading `code` unchanged and pass no signal; only `detectQrCode` passes `AbortSignal.timeout(PAYMENT_QR_CHECK_READ_TIMEOUT_MS)` and reads `storageCode` to log a misconfigured environment or a timeout apart from an outage.
- `PaymentSettingsInput` separate from `CompanyPaymentSettings`: a client sends an image and never sends `qr`; the server decides it.
- `OfferedPaymentSetting`: the only shape consumers receive; it keeps today's field names so consumers do not change.
- `ImageId` is the existing branded id used by images.

### 6.2 Orders

```ts
// orders/domain/payment.ts
export type RejectionReason = string & { readonly __brand: "RejectionReason" };
export function parseRejectionReason(value: string | null): Result<RejectionReason | null, PaymentError>; // trim, "" → null, > 200 → INVALID_PAYMENT
export type RejectedPayment = Readonly<{ id: PaymentId; orderId: OrderId; status: "rejected"; currency: Currency; amount: null; method: null;
  data: Readonly<{ report: ReportData; rejectedAt: Date; rejectedBy: UserId; reason: RejectionReason | null }> }>;
export type Payment = ReportedPayment | ConfirmedPayment | VoidedPayment | RejectedPayment;
export function rejectPayment(existing: Payment, rejection: Readonly<{ rejectedBy: UserId; rejectedAt: Date; reason: RejectionReason | null }>): Result<RejectedPayment, PaymentError>;

// orders/domain/order-state-machine.ts
rejectReportedPayment(order: OrderAggregate, paymentId: PaymentId, rejection: …): Result<Readonly<{ order: OrderAggregate; applied: boolean }>, OrderDomainError>;
rejectionAwaitingNewReport(order: OrderAggregate): RejectedPayment | null;
```

- `RejectedPayment` keeps `report` because the receipt stays as evidence and the buyer still sees it.
- `rejectedBy: UserId` matches `VoidedPayment.voidedBy`.

Transitions: `reported → confirmed`, `reported → rejected`, `confirmed → voided`. `rejected` and `voided` are final. `rejectionAwaitingNewReport` orders buyer reports (reported, confirmed or voided from a buyer report, rejected) by `report.reportedAt` and returns the newest only when it is rejected and no payment is `reported`.

### 6.3 Shared rule

```ts
// shared/orders-payment.ts
export function offersPartialStockDeduction(order: Readonly<{ stockDeducted: boolean; balanceDue: Money }>, amount: Money | null): boolean;
```

It returns `true` only when stock is not deducted, the amount is valid and the amount is below `balanceDue`. Web and mobile need the same rule; core does not use it, because its stock rule already deducts on coverage and only reads `deductStockIfPartial` on partial payments.

| Layer | Types and authority |
| --- | --- |
| Companies domain | `WalletQr`, `CompanyPaymentSettings`, `offeredPaymentSettings`: what buyers may see |
| Orders domain | `RejectedPayment`, transitions, `rejectionAwaitingNewReport` |
| Shared | Contracts (`z.infer`), `offersPartialStockDeduction` |
| Web / mobile presentation | Labels, row date, «Pago por revisar» flag, error-code → text |

## 7. Persistence

- **No Prisma migration.** `Payment.status` is a `String` without `CHECK`; the rejection data is in `Payment.data`. `CompanyPaymentSettings.settings` is JSON.
- **Payment row mapper** (`order-repository.ts`): `status = 'rejected'` requires `amount` and `method` null and parses `data` with `rejectionDataSchema` (`{ report, rejectedAt, rejectedBy, reason: string(1..200) | null }`, strict). Invalid stored data keeps raising `invalid_stored_payment`. `paymentDataJson` serializes the rejected variant.
- **Settings repository:** `loadPaymentSettings` parses with `parseStoredPaymentSettings`: a wallet with `qr.status = "verified"`, or the pre-version shape read as `unchecked` (§5.4). Any other shape is `INVALID_STORED_DATA`, as today. `persistPaymentSettings` stores the full array, as today; it only ever writes verified wallets.
- **Existing and development data:** no business is in production and no row is converted. Worktree and local databases keep their pre-version rows; they show as unchecked until saved. Fixtures that need an offered wallet (`buyer-payment.spec.ts`, integration tests) insert `qr: { status: "verified", imageId }` directly, or save through the page with a real QR fixture (§14). `scripts/seed.ts` does not seed payment settings (`grep digital_wallet scripts/` finds none).

## 8. Contracts between applications

### 8.1 `shared/contracts/payment-settings.ts`

- `paymentSettingsInputSchema` (PUT body): wallet `{ method, provider, holder, imageId: z.uuid() }` (no longer nullable); bank unchanged.
- `paymentSettingsResponseSchema` (GET and PUT 200): wallet `{ method, provider, holder, qr: { status: "verified", imageId: uuid } | { status: "unchecked", imageId: uuid | null } }`; bank unchanged. PUT 200 always returns a `verified` wallet.
- `paymentQrCheckSchema` `{ imageId: z.uuid() }` and `paymentQrCheckResponseSchema` `{ status: "verified" | "not_a_qr" }`.
- Statuses: `400 INVALID_INPUT` (schema, and an image of another company or missing, as today), `400 INVALID_PAYMENT_QR`, `503 QR_CHECK_UNAVAILABLE`, `503 SERVICE_UNAVAILABLE`. Error envelope `{ code, error }` as today. New codes: only `INVALID_PAYMENT_QR` and `QR_CHECK_UNAVAILABLE`.
- Only core consumes this contract (web and API). Mobile does not.

### 8.2 `shared/contracts/orders.ts`

- `paymentSchema` adds `{ status: "rejected", currency, amount: null, method: null, data: rejectionDataSchema }`.
- `rejectPaymentSchema = z.strictObject({ reason: z.string().max(1000).nullable() })`. The domain applies the 200-character rule after trimming; the schema bound only limits the payload.
- `POST /api/orders/:id/payments/:paymentId/reject` → `200 orderAggregateSchema`. Errors: `400 INVALID_INPUT`, `415`, `422 INVALID_PAYMENT`, `404 ORDER_NOT_FOUND | PAYMENT_NOT_FOUND`, `409 PAYMENT_CONFLICT | ORDER_CANCELLED`, `503`. `orderApiErrorSchema` already has these codes.
- `buyerPaymentViewSchema`:
  - `payments[].status` adds `"rejected"`;
  - `payments[].rejectionReason: z.string().nullable()`;
  - `rejectedReport: z.strictObject({ reason: z.string().nullable() }).nullable()`;
  - wallet `imageUrl` becomes `z.url()` (non-null) in T3, together with dropping a wallet whose URL does not resolve (§5.6). T1 leaves it nullable: until T2's offered-only `get` lands, a company can still have a wallet without image.
- Mobile parses `orderAggregateSchema` and must handle the new variant (T4). The variant is additive. An older mobile build fails to parse an order with a rejected payment, which is acceptable with no production users.

## 9. Events and cross-feature integration

- No event. Rejecting a report changes nothing in other features.
- Companies exposes `companyPaymentSettings.get` (offered methods), `getConfiguration`, `save` and `checkQr` from `companies/composition.ts` via `companies/index.ts`.
- Companies composes `detectQrCode` from `src/shared/images` `readImageBytes` and the moved `readQrCodes`, behind the per-process slot limit and with the read timeout (§11): no free slot → `QR_CHECK_UNAVAILABLE`; `UNREADABLE_IMAGE` → `no_qr`; empty list → `no_qr`; `IMAGE_NOT_FOUND` → `INVALID_IMAGE`; `IMAGE_STORAGE_UNAVAILABLE` (any `storageCode`), `PERSISTENCE_UNAVAILABLE` and `QR_READER_UNAVAILABLE` → `QR_CHECK_UNAVAILABLE`. The user outcome is the same for all of them (503, nothing saved); the log keeps them apart (§13).
- Orders and store-appearance keep calling `companyPaymentSettings.get`, and now receive only offered methods. The checkout preview therefore follows the buyer rule without changes in store-appearance.

## 10. Mobile

| File | Change |
| --- | --- |
| `infrastructure/order-api.ts` | `rejectPayment(orderId, paymentId, reason)` → `POST /api/orders/:id/payments/:paymentId/reject`, parsed with `orderAggregateSchema`; error schema like `void`. |
| `application/order-operations.ts` | `rejectPayment` operation mapping `PAYMENT_CONFLICT`/`INVALID_TRANSITION` to an "already reviewed" outcome, `ORDER_CANCELLED`, network uncertainty to "unknown result". |
| `presentation/order-detail-screen.tsx` | Rejected rows: «Pago rechazado», date, reason, «Ver captura» (receipt from `data.report.receiptImageId`); review sheet: **Rechazar** step with reason field inside the same sheet; stock box with `offersPartialStockDeduction`; «Pago por revisar» under Saldo pendiente when a report is pending and the order is not cancelled. |
| `presentation/order-detail-translations.ts`, `presentation/translations.ts` | es/pt texts from the product draft. |

| Situation | Decision |
| --- | --- |
| Reject without response | Shows «No sabemos si se guardó…», reloads the order; a repeat returns the same rejection. No queue or automatic retry. |
| Reject answered `409 PAYMENT_CONFLICT` | «Este pago ya fue revisado.», reload. |

## 11. Transactions and concurrency

**Reject:**
1. `scopedOrderTransaction(companyId)` (tenant isolation plus `withinTransaction`).
2. `findOrderForUpdate`: `SELECT … FOR UPDATE` on the order row.
3. Domain transition.
4. `updatePayment(…, "reported")`: conditional on the stored status.
5. Commit.

The order lock serializes approve, reject and void on the same order, from web, another tab or mobile. The second decision sees the first one and gets a replay or `PAYMENT_CONFLICT`. The conditional update is the second guard. Nothing else is written, so there is no stock or completion step.

**Settings save:**
1. Parse, then check images (under tenant isolation).
2. Read the QR outside any transaction (slow I/O: R2 download plus decode). Never wrap the read in `withinTransaction`: it would hold a connection and the row across the download.
3. Upsert the full array.

Two concurrent saves: the last one wins, as today. The reuse decision compares the stored `verified` image id with the submitted one. Because image bytes are immutable per id, it stays correct under any interleaving. No lock is added.

**QR check:** read-only.

**Cost of a check:** one image-row lookup, an R2 GET of up to 10 MB, a sharp resize on the libuv threadpool and a zxing decode on the event loop. Measured by the performance gate on a 16-core machine: about 0.3 s wall and under 0.1 s of event-loop block for the worst case (4000×3000 noise JPEG), perhaps 3–5× more on a small VPS. Memory per check: the bytes (≤10 MB), the libvips decode buffers (up to ~96 MB for a large PNG) and a ≤16 MB RGBA buffer.

- **Double read, accepted:** a newly chosen image is read by `POST /qr-checks` and again by `PUT`, because only the save check counts and nothing is stored by the first. It happens once per accepted wallet image, an interactive and rare setup action. Avoiding it would need a stored or cached "checked" token, which the product rejected (the save check is the one that counts). Trigger to revisit: p95 of `payment_qr_checked.durationMs` over `outcome` ∈ {`qr_found`, `no_qr`} above 2 s on production hardware (the event is `info`, so production logs it). Busy answers and timeouts are excluded: they measure saturation and storage, not read-plus-decode cost.
- **Load bound:** `detectQrCode` acquires one of `PAYMENT_QR_CHECK_SLOTS` per-process slots (environment value, initial 2; §11 expects 3–5× slower checks on a small VPS, so it is calibrated per environment) before reading the image and releases it in a `finally` when the decode ends, on success, failure `Result` or thrown error.
- **Read deadline:** the image read gets `AbortSignal.timeout(PAYMENT_QR_CHECK_READ_TIMEOUT_MS)` (environment value, initial 10000). `createR2ImageStorage` sets no request timeout, so without it two stalled GETs would hold both slots and every check would answer `QR_CHECK_BUSY` until restart. An aborted read answers `QR_CHECK_UNAVAILABLE`, logged as `IMAGE_STORAGE_TIMEOUT`. The decode itself is synchronous and bounded by the image limits, so it needs no deadline.
- Both values are read with the zod env pattern of `products/composition.ts` (`z.coerce.number().int().positive().default(…)`), documented in `apps/core/.env.example` and passed to the `web` service of `compose.prod.yaml` with the same defaults (`${PAYMENT_QR_CHECK_SLOTS:-2}`). The `migrate` service does not change. Without a free slot it answers `QR_CHECK_UNAVAILABLE` at once (no queue), logged with `errorCode: "QR_CHECK_BUSY"`. This bounds the memory and event-loop time QR checks take in the web process, which also serves checkout for every company. The WhatsApp product identification runs in the worker process and is not counted.
- **Resident memory:** this is the first time zxing-wasm loads in the web process. Its WebAssembly heap grows to fit the largest frame decoded (up to 2000×2000×4 = 16 MB plus zxing working memory) and never shrinks, so after the first check web keeps a few tens of MB more for its lifetime. The slot limit does not change it, because the wasm call is synchronous and only one decode is in the heap at a time. Whoever sizes the web container should count it.

**Duplicates:**
- Approve uses the client `paymentId`, as today.
- Reject is idempotent per payment id (rejected → same result).
- A manual payment repeated from the same open form reuses `manualPaymentId`, as today.

## 12. Code organization

| File | Change |
| --- | --- |
| `apps/core/src/shared/images/infrastructure/qr-code-reader.ts` (+ test, `qr-fixtures/`) | Moved from products, unchanged. |
| `apps/core/src/features/products/composition.ts` | Import path of `readQrCodes`. |
| `apps/core/src/shared/images/application/images.ts` (+ test), `infrastructure/r2-image-storage.ts` | `ImageReadError.storageCode`, optional read `signal` (§6.1), T2. |
| New `companies/infrastructure/qr-check-limiter.ts` (+ test) | `createQrCheckLimiter(slots)` → `run(work)`: answers busy without running `work` when no slot is free, releases in `finally`. T2. |
| `apps/core/.env.example`, `compose.prod.yaml` (`web` only) | `PAYMENT_QR_CHECK_SLOTS=2`, `PAYMENT_QR_CHECK_READ_TIMEOUT_MS=10000`, T2. |
| `apps/core/src/shared/images/index.ts` | T1: new `resolvePublicImages(ids)` wrapping `getImages`. T2 (after T1): the `readImageBytes` wrapper forwards `options` (§6.1), so the `vi.mock` seam of §14 and the single storage instance stay. |
| `companies/domain/payment-settings.ts` (+ test) | `WalletQr`, input and stored parsers, `offeredPaymentSettings`. |
| `companies/application/payment-settings.ts` (+ test) | `savePaymentSettings` with QR, `checkPaymentQr`, `getOfferedPaymentSettings`, `getPaymentConfiguration`. |
| `companies/infrastructure/payment-settings-repository.ts` (+ integration test) | Stored parser. |
| `companies/presentation/payment-settings-routes.ts` (+ integration test) | PUT error mapping, `POST /qr-checks`, response schema. |
| `companies/composition.ts` | Env values; one module-scope limiter and one `detectQrCode(imageId, { companyId, stage })`; `get` (offered), `getConfiguration`, `save`, `checkQr`, logs. |
| New `companies/offered-payment-methods.integration.test.ts` | Buyer view and checkout preview receive only offered methods (T2, §14). |
| `shared/contracts/payment-settings.ts` | §8.1. |
| `apps/core/app/routes/payment-settings.tsx`, new `companies/presentation/wallet-qr-field.tsx` | b1/b2 page, QR field states, choose-time check through `fetch`. The loader reads `getConfiguration`. An `unchecked` wallet with image shows its thumbnail and «Tus compradores no ven esta billetera hasta que la guardes con un QR válido.», with **Cambiar imagen**, **Quitar imagen** and **Guardar cambios** enabled (the save sends that `imageId` and core reads it); `400 INVALID_PAYMENT_QR` turns the field into the not-a-QR state, `503` into «No pudimos revisar el QR…». An `unchecked` wallet without image, or whose image URL does not resolve in the loader, shows **Subir QR** with «Tus compradores no ven esta billetera hasta que subas un QR válido.» and save disabled by the existing missing-QR rule; a save answered `INVALID_IMAGE` (image deleted in between) moves the field to that same state. Save enablement is the pure `canSaveWalletQr(field)` exported from `wallet-qr-field.tsx`, unit-tested (§14). |
| `shared/contracts/orders.ts` | §8.2. |
| `shared/orders-payment.ts` (+ test) | `offersPartialStockDeduction`. |
| `orders/domain/payment.ts`, `order-state-machine.ts` (+ tests) | §6.2. |
| `orders/application/reject-payment.ts` (+ test) | §5.5. |
| `orders/infrastructure/order-repository.ts` (+ integration test) | Rejected mapper and serializer; currency of a rejected row (L284, L300). |
| `orders/presentation/order-json.ts` | T1: a `rejected` branch serializing `data.report.reportedAt` and `data.rejectedAt`. |
| `orders/presentation/api-routes.ts` (+ integration test) | Reject route. |
| `orders/composition.ts` | `orders.rejectPayment` with logs; buyer view projection §5.6 with `resolvePublicImages` (T1); dropping an unresolved wallet and the non-null `imageUrl` (T3). |
| `apps/core/app/routes/order-detail.tsx` (+ `order-detail.test.ts`) | T1: exhaustive narrowing only (loader takes a rejected receipt from `data.report.receiptImageId` and resolves all receipt URLs with one `resolvePublicImages`; the row labels a rejected payment «Pago rechazado» with `data.rejectedAt`, no amount and no action, never «Pago confirmado»). T3: action adds `operation=reject` and maps codes; renders the new components. |
| New `orders/presentation/order-payments-card.tsx`, `receipt-dialog.tsx`, `payment-decision-form.tsx` | b3 card, b4 dialog with in-place decision area, approve/register/reject forms. Row actions, «Pago por revisar», «Registrar pago» visibility and per-row accessible names come from the pure `paymentRowActions` and `paymentCardSummary` of `order-payments-card.tsx`, unit-tested (§14). |
| `orders/presentation/payment-fields.tsx` | Stock box shown with `offersPartialStockDeduction`. |
| `orders/presentation/buyer-payment-content.tsx` | Rejection notice at the start of the upload block; `Rechazado` status with reason (T3). |
| `apps/core/app/locales.ts` | T1: only `buyerPaymentContent.status.rejected` es «Rechazado» / pt «Rejeitado» (L138, L280), required by the typed i18n key, and `orders.paymentRejected` «Pago rechazado» / «Pagamento rejeitado» for the narrowed row. T2: `paymentSettings`. T3: `orderDetail`/`orders` payments and the rest of `buyerPaymentContent`. The three edit it in sequence (T1, T2, T3). |
| `apps/core/tests/e2e/buyer-payment.spec.ts` | T2: the settings save reads a real QR fixture from a fake S3 (`R2_ENDPOINT` at port+1000, as in `message-to-order.spec.ts`) instead of the browser-faked `/api/images`. T3: reject and resend journey. |
| Mobile | §10. T1 adds only the exhaustive narrowing in `order-detail-screen.tsx` (rejected receipt from `data.report`, no amount row, date from `data.rejectedAt`, no actions) and the `paymentRejected` es/pt key, so no build ever labels a rejected payment as confirmed. |

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `payment_rejected` | info | orders composition, after commit | `["companyId", "userId", "orderId", "paymentId", "hasReason"]` |
| `payment_operation_replayed` | debug | orders composition | `["operation": "reject", "paymentId"]` (existing event, new operation value) |
| `payment_operation_conflict` | debug | orders composition | `["operation": "reject", "paymentId", "errorCode"]` (existing event) |
| `company_payment_settings_saved` | info | companies composition | existing fields plus `walletQr: "read" \| "reused" \| "none"` and `qrDurationMs` (number when `walletQr` is `read`, else `null`) |
| `payment_qr_checked` | info | companies composition (`detectQrCode`) | `["companyId", "stage": "choose" \| "save", "outcome": "qr_found" \| "no_qr" \| "unavailable", "durationMs"]`; `durationMs` is `null` for a busy answer (no read ran) |
| `payment_qr_check_unavailable` | warn | companies composition (`detectQrCode`) | `["companyId", "stage": "choose" \| "save", "errorCode": "IMAGE_STORAGE_UNAVAILABLE" \| "IMAGE_STORAGE_CONFIG_ERROR" \| "PERSISTENCE_UNAVAILABLE" \| "IMAGE_STORAGE_TIMEOUT" \| "QR_READER_UNAVAILABLE" \| "QR_CHECK_BUSY"]` |

An image without a QR is a business rejection: it returns a `Result` and is only counted in `payment_qr_checked` (`info`: a rare, seller-triggered event, so the volume is negligible). `durationMs` covers the image read and the decode and is what verifies the cost assumption of section 11 on production hardware. Never logged: rejection reason text, provider, holder, account data, image ids or URLs, QR contents.

## 14. Tests

Every title names the task that writes it and must leave it green. A task passes its own tests on its own branch: no test needs code from a task of the same wave, and no file is edited by two tasks of the same wave. A file edited by a later task (T2 after T1, T3 after T2) is edited in sequence, and the later task updates any earlier test its change affects.

### Unit (core)

`companies/domain/payment-settings.test.ts`
- T2 `test("rejects a wallet input without imageId")`
- T2 `test("parses a stored verified wallet with its qr image")`
- T2 `test("parses a wallet saved before this version as unchecked keeping its image or no image")`
- T2 `test("refuses a stored wallet in any other shape as invalid stored data")`
- T2 `test("offers a wallet only when its qr is verified and always offers bank transfer")`

`companies/application/payment-settings.test.ts`
- T2 `test("saves an offered wallet as verified when its image holds a qr")`
- T2 `test("rejects saving a wallet whose image holds no qr and saves nothing")`
- T2 `test("does not save when the qr check is unavailable for a new image")`
- T2 `test("keeps an unchanged verified wallet image without reading it again")`
- T2 `test("saves bank changes while the qr check is unavailable when the wallet image is unchanged")`
- T2 `test("reads the image of an unchecked wallet on save and stores it verified when it holds a qr")`
- T2 `test("rejects saving an unchecked wallet whose image holds no qr and keeps it unchecked")`
- T2 `test("rejects saving an unchecked wallet whose stored image no longer exists with INVALID_IMAGE")`
- T2 `test("reports a choose-time qr check as verified or not_a_qr without writing")`

`companies/infrastructure/qr-check-limiter.test.ts`
- T2 `test("answers busy without running the check when every slot is taken")`
- T2 `test("frees the slot after a failed check and after a thrown error")`

`companies/composition.test.ts` (fake reader and storage)
- T2 `test("a timed-out image read answers qr check unavailable and frees its slot")`
- T2 `test("choose-time and save checks share one process-wide limit")`

`src/shared/images/application/images.test.ts`
- T2 `test("reports a storage configuration error with its own storageCode")`
- T2 `test("reports an image read aborted before the response as an IMAGE_STORAGE_TIMEOUT storage failure")`
- T2 `test("reports an image read aborted during the body as an IMAGE_STORAGE_TIMEOUT storage failure")` (fake body that rejects with `ECONNRESET` "aborted" after the signal fires)
- T2 `test("reports a non-aborted storage error as IMAGE_STORAGE_UNAVAILABLE")`

`companies/presentation/wallet-qr-field.test.ts` (pure `canSaveWalletQr`, no rendering)
- T2 `test("disables save while the offered wallet has no qr image")`
- T2 `test("disables save while the chosen image is not a qr")`
- T2 `test("disables save while the image is uploading or the qr is being checked")`
- T2 `test("keeps save enabled when the choose-time check could not run")`
- T2 `test("keeps save enabled for an unchecked wallet with image and disables it without image")`
- T2 `test("does not require a qr when the wallet is not offered")`

`orders/domain/payment.test.ts`
- T1 `test("rejects a reported payment keeping its receipt and an optional trimmed reason")`
- T1 `test("treats an empty rejection reason as no reason")`
- T1 `test("refuses a rejection reason longer than 200 characters")`
- T1 `test("returns an already rejected payment unchanged with its original reason")`
- T1 `test("refuses to reject a confirmed or voided payment")`
- T1 `test("refuses to confirm a rejected payment")`
- T1 `test("replaying a buyer report whose payment was rejected returns it without writing")`
- T1 `test("refuses a buyer report with the id of a rejected payment and another receipt")`
- T1 `test("refuses to void a rejected payment with INVALID_TRANSITION")`

`orders/domain/order-state-machine.test.ts`
- T1 `test("rejecting a report leaves paid amount, balance, stock and completion unchanged")`
- T1 `test("refuses to reject a report in a cancelled order")`
- T1 `test("returns the latest report rejection only when no report is pending")`
- T1 `test("payment summary accepts a rejected payment in the order currency and counts nothing for it")`

`orders/application/reject-payment.test.ts`
- T1 `test("rejects a pending report inside the order transaction")`
- T1 `test("returns not found for a payment outside the order")`
- T1 `test("replays a repeated rejection without writing")`

`shared/orders-payment.test.ts`
- T1 `test("offers the partial stock choice only when the amount is below the balance and stock is not deducted")`
- T1 `test("does not offer the partial stock choice for an empty or invalid amount")`

`orders/presentation/order-payments-card.test.ts` (pure `paymentRowActions` and `paymentCardSummary`, no rendering)
- T3 `test("offers reject and approve only on a pending report of an order that is not cancelled")`
- T3 `test("shows a cancelled order read-only without Pago por revisar")`
- T3 `test("offers Registrar pago only while Pendiente is above zero")`
- T3 `test("names each row action with the row date and time")`

`apps/core/app/routes/order-detail.test.ts` (Vitest unit, `test:unit`: renders with `renderToStaticMarkup`, spies on `orders` and `@core/src/shared/images` with `vi.spyOn`, no database)
- T1 `test("loader resolves receipt urls for rejected payments with one image lookup")` (spies on `resolvePublicImages` and asserts one call with every receipt id)
- T3 `test("reject action rejects the report and returns the updated order")`
- T3 `test("approve and reject map PAYMENT_CONFLICT to the already-reviewed message")`
- T3 `test("receipt thumbnails load lazily with fixed dimensions")`

### Integration (core, real database)

Image bytes: the integration project has no image storage (`run-tests.sh`), so tests that read bytes `vi.mock` `readImageBytes` of `@core/src/shared/images` and serve the files of `qr-fixtures/` (pattern of `index-product-image.integration.test.ts`). `readQrCodes` runs for real.

`companies/infrastructure/payment-settings-repository.integration.test.ts`
- T2 `test("stores and reads a verified wallet qr per company")`
- T2 `test("reads a row saved before this version as an unchecked wallet without rewriting it")`

`companies/presentation/payment-settings-routes.integration.test.ts`
- T2 `test("PUT answers 400 INVALID_INPUT for an offered wallet without imageId")`
- T2 `test("PUT answers 400 INVALID_INPUT for a wallet image of another company")`
- T2 `test("PUT answers 400 INVALID_PAYMENT_QR for an image without qr and keeps the previous settings")`
- T2 `test("PUT answers 503 QR_CHECK_UNAVAILABLE when the reader is unavailable and saves nothing")`
- T2 `test("PUT saves a wallet with a real Plin qr fixture as verified")`
- T2 `test("POST qr-checks answers not_a_qr for a landscape photo and verified for a qr")`
- T2 `test("POST qr-checks answers 400 INVALID_INPUT for an image of another company")`
- T2 `test("GET returns a pre-version wallet as unchecked and PUT with its image stores it verified")`

`companies/offered-payment-methods.integration.test.ts` (new, only T2 edits it; real companies, orders and store-appearance compositions, nothing mocked but image bytes)
- T2 `test("buyer view hides a wallet without a verified qr")`
- T2 `test("buyer view of a company with a pre-version wallet offers only bank transfer")`
- T2 `test("store-appearance checkout preview lists only offered payment methods")`

`orders/infrastructure/order-repository.integration.test.ts`
- T1 `test("round-trips a rejected payment with its report and reason")`

`orders/presentation/api-routes.integration.test.ts`
- T1 `test("POST reject marks a reported payment rejected and keeps the balance")`
- T1 `test("POST reject answers 409 PAYMENT_CONFLICT for a confirmed payment")`
- T1 `test("POST reject answers 409 ORDER_CANCELLED in a cancelled order")`
- T1 `test("POST reject answers 404 for an order of another company")`
- T1 `test("repeating POST reject returns the same rejection")`
- T1 `test("confirming a rejected payment answers 409 PAYMENT_CONFLICT")`
- T1 `test("POST void of a rejected payment answers 409 INVALID_TRANSITION")`
- T1 `test("buyer view exposes the rejected status, its reason and rejectedReport")`
- T1 `test("buyer view resolves the bank transfer image and every receipt url with one image lookup")` (fixture: a bank transfer with image and no wallet, a shape T2 does not change)
- T1 `test("repeating a buyer report after its rejection returns the rejected payment")`
- T3 `test("buyer view drops a wallet whose image url does not resolve")`

### Unit (mobile)

- T1 `presentation/order-detail-screen.test.tsx`: `test("never labels a rejected payment as confirmed")`
- T4 `infrastructure/order-api.test.ts`: `test("rejectPayment posts the reason and parses the order aggregate")`
- T4 `application/order-operations.test.ts`: `test("maps a conflicting rejection to already reviewed")`
- T4 `presentation/order-detail-screen.test.tsx`:
  - `test("labels a rejected payment as Pago rechazado with its reason and Ver captura")`
  - `test("rejects a report from the review sheet with an optional reason")`
  - `test("shows the partial stock box only when the amount is below the balance")`
  - `test("shows Pago por revisar while a report is pending")`

### Web E2E (`apps/core/tests/e2e/buyer-payment.spec.ts`, happy path)

- T2 (existing journey, new setup): the settings save reads a real QR fixture from the fake S3 and the buyer sees that wallet.
- T3 `test("buyer pays with the verified wallet qr and the seller approves the report from the receipt dialog")`
- T3 `test("seller rejects a report with a reason and the buyer sees it and sends another receipt")`

### Pending manual checks

- Settings page against b1/b2; QR of a real Yape and Plin screenshot accepted; a landscape photo refused.
- Receipt dialog at 390 px: the reduced receipt stays readable with the keyboard open; ×, Escape and outside click close it; focus returns.
- Mobile on a device: reject from the sheet, «Pago por revisar», «Ver captura» of a rejected payment.
- A worktree database with a wallet saved before this version: the panel shows it as needing a QR check, the checkout does not list it, and saving it with its QR makes it offered.

## 15. Limits and checks during implementation

- The pre-version branch of `parseStoredPaymentSettings` is the only code that knows the old shape. It is not removed in this task (§5.4).
- Verify that `readQrCodes` decodes the Yape and Plin fixtures in `qr-fixtures/` (memory b9ad8a84 says they decode). Add a payment-wallet screenshot fixture if none exists.
- Verify that the QR-check route runs under `withTenantIsolation`, so `readImageBytes` cannot read another company's image.
- Store-appearance needs no code change. Verify that its preview test still passes with offered-only methods.
- Verify that `pnpm --dir apps/core typecheck` and `pnpm --dir apps/mobile typecheck` pass at the end of each task, not only at the end of the wave.
- `locales.ts` is edited in sequence: T1 (two keys), then T2 (`paymentSettings`), then T3 (`orderDetail`, `orders`, `buyerPaymentContent`).
- `store-appearance/composition.test.ts` mocks `@core/src/features/companies`, so it cannot observe the offered-only rule; that rule is covered by `companies/offered-payment-methods.integration.test.ts` (T2).
- Matching the QR content with provider or holder, undoing a rejection, and warning the seller outside «Medios de cobro» stay out (product draft).

## 16. Implementation plan

### Order and parallelism

```text
Wave 1:             T1 Rejected payment backend + contract + union narrowing
Wave 2 (parallel):  T2 Wallet QR end to end (after T1)      T4 Mobile (after T1)
Wave 3:             T3 Web order detail + checkout (after T2; may overlap T4, disjoint files)
```

T1 and T2 are sequenced, not parallel: both touch `src/shared/images/index.ts`, `locales.ts` and the buyer view, and T2's offered-only `get` changes what T1's buyer view returns. Starting T2 on T1's merged base lets T2 edit those files and update any T1 test its change affects, so every task's tests pass on its own base.

Files per task:
- T1: `shared/contracts/orders.ts`, `shared/orders-payment.ts`, `features/orders/**` (domain, application, infrastructure, `composition.ts`, `presentation/api-routes.ts`, `presentation/order-json.ts`), `src/shared/images/index.ts` (`resolvePublicImages`), the minimal narrowing in `app/routes/order-detail.tsx` and `apps/mobile/src/features/orders/presentation/order-detail-screen.tsx` (+ the mobile `paymentRejected` key), and `locales.ts` (`buyerPaymentContent.status.rejected`, `orders.paymentRejected`).
- T2: `shared/contracts/payment-settings.ts`, `features/companies/**`, `src/shared/images/**` (including the `readImageBytes` wrapper in `index.ts`), the products import, `app/routes/payment-settings.tsx`, `locales.ts` (`paymentSettings`), `buyer-payment.spec.ts` setup, the new `companies/offered-payment-methods.integration.test.ts`, `.env.example`, the `web` service of `compose.prod.yaml`, and any T1 buyer-view test its offered-only rule affects (`orders/presentation/api-routes.integration.test.ts`). No file under `apps/mobile`.
- T4: only `apps/mobile/**` (`order-api.ts`, `order-operations.ts`, `order-detail-screen.tsx`, translations and their tests). No file under `apps/core` or `shared/`.
- T2 and T4 are therefore disjoint. T3 edits only `apps/core` (web routes, orders presentation, `orders/composition.ts`, `locales.ts`, E2E) and is disjoint from T4, so it waits only for T2.

### T1. Rejected payment backend and contracts

**Scope:**
- §5.5–5.7, §6.2, §6.3, §7 (payment mapper), §8.2 (wallet `imageUrl` stays nullable).
- Reject API route, buyer view projection with `resolvePublicImages`, and `orders.rejectPayment` composition with logs.
- `resolvePublicImages` in `src/shared/images/index.ts`; the order-detail loader uses it too.
- Minimal exhaustive narrowing so every consumer of the `Payment` union compiles and no surface labels a rejected payment as confirmed: `order-json.ts`, `app/routes/order-detail.tsx` (loader and row), mobile `order-detail-screen.tsx`, the typed i18n keys in `locales.ts` and the mobile `paymentRejected` key. No new action, form or layout.

**Out of scope:** reject UI on web and mobile, checkout rejection notice, payment settings, the non-null wallet `imageUrl` (T3).

**Acceptance criteria:**
1. Order #1042 with a pending report: `POST …/reject` with `{ reason: "El monto no coincide" }` returns the order with that payment `rejected` and the reason; `paidAmount` and `balanceDue` unchanged; stock unchanged.
2. The same request again returns the same rejection; a second request on a confirmed payment returns `409 PAYMENT_CONFLICT`; in a cancelled order `409 ORDER_CANCELLED`; for another company's order `404`.
3. Confirming a rejected payment returns `409 PAYMENT_CONFLICT`.
4. `GET /api/buyer/orders/:orderId/payment` shows the payment `rejected` with `rejectionReason` and `rejectedReport.reason`; after a new report `rejectedReport` is `null`.
5. `offersPartialStockDeduction` is false for S/ 70.00 on a S/ 70.00 balance and true for S/ 30.00.

6. A buyer report resent with the id and receipt of a rejected payment returns that rejected payment and writes nothing; voiding a rejected payment returns `409 INVALID_TRANSITION`.
7. The web order detail and mobile order detail show a rejected payment as «Pago rechazado», never «Pago confirmado».

**Tests to leave green:** every §14 title tagged T1 (orders domain and application, `shared/orders-payment.test.ts`, the T1 titles of `order-repository` and `api-routes` integration, the T1 loader title of `order-detail.test.ts`, the T1 mobile title), the existing tests of those files, `pnpm --dir apps/core typecheck`, `pnpm --dir apps/mobile typecheck`, `pnpm --dir apps/mobile test`. None of them depends on how a wallet is read: T1's buyer view fixtures use a bank transfer with image and no wallet, which T2 does not change.

**Depends on:** nothing.

### T2. Wallet QR end to end

**Scope:**
- §5.1–5.4, §6.1 (including `ImageReadError.storageCode`), §7 (settings), §8.1, §9, the QR reader move and the check slot limit (§11).
- The b1/b2 settings page with every QR field state and save rule from the product draft, including both unchecked states (§12).
- The `paymentSettings` es/pt texts.
- The E2E setup with a verified wallet QR (fake S3 in `buyer-payment.spec.ts`).
- `companies/offered-payment-methods.integration.test.ts` (only T2 edits it).
- The two environment values in `.env.example` and the `web` service of `compose.prod.yaml`.

**Out of scope:** orders, checkout UI (it receives offered methods automatically), mobile, the release step (the `migrate` service and `compose.yaml` do not change).

**Acceptance criteria:**
1. `PUT /api/company/payment-settings` with an offered wallet without `imageId` → `400 INVALID_INPUT`; with a landscape photo → `400 INVALID_PAYMENT_QR`, previous settings intact; with the reader unavailable → `503 QR_CHECK_UNAVAILABLE`, nothing saved.
2. A Plin QR fixture saves as `verified`; changing only the bank account with the reader unavailable succeeds and the wallet stays verified.
3. A company whose stored wallet was saved before this version (no `qr`) offers only bank transfer in the buyer view and the store preview, and its checkout loads. With image, the settings page shows the thumbnail, «Tus compradores no ven esta billetera hasta que la guardes con un QR válido.» and save enabled; saving with a Plin QR makes it offered; saving with a landscape photo shows the not-a-QR state. Without image, it shows **Subir QR** and save disabled.
4. The page shows «Revisando QR…» with save disabled, then «✓ QR válido» or the b2 error; a failed choose-time check leaves save enabled.
5. With both check slots busy, a third check answers `503 QR_CHECK_UNAVAILABLE` without reading the image; a read that exceeds `PAYMENT_QR_CHECK_READ_TIMEOUT_MS` answers `503` and frees its slot; `payment_qr_checked` (`info`) carries `durationMs`.

**Tests to leave green:** every §14 title tagged T2 (companies unit and integration, `qr-check-limiter`, `images.test.ts`, `wallet-qr-field.test.ts`, `offered-payment-methods.integration.test.ts`), the existing products QR reader test at its new path, `buyer-payment.spec.ts` (existing journey with the new setup), `store-appearance-buyer.spec.ts` and `store-appearance/composition.test.ts` unchanged, `pnpm --dir apps/core typecheck`. Everything T1 left green, updated by T2 only where its offered-only rule changes the expected wallet.

**Depends on:** T1 (starts on its merged base).

### T3. Web order detail and checkout

**Scope:**
- The b3 «Pagos» card, the b4 receipt dialog with the in-place decision area, and the approve, register and reject forms with focus, accessible names and failure placement from the product draft.
- `operation=reject` in the route action.
- Checkout rejection notice and `Rechazado` status.
- Buyer view: drop a wallet whose image URL does not resolve and make the wallet `imageUrl` non-null (§5.6, §8.2).
- Lazy row thumbnails (`loading="lazy"`, `decoding="async"`, fixed width and height); only the b4 dialog loads the receipt eagerly.
- `orderDetail`/`orders`/`buyerPaymentContent` es/pt texts.
- The two E2E journeys.

**Out of scope:** backend rules (T1), settings (T2), mobile.

**Acceptance criteria:**
1. Order #1042 with one report shows one row with thumbnail, «Ver captura», **Rechazar**, **Aprobar**, and «¿Te pagaron por fuera? Registrar pago» at the end; no form is visible until opened.
2. From the receipt dialog, approving S/ 70.00 shows no stock box, closes the dialog, shows «Pago actualizado.» and focuses the confirmed row; approving S/ 30.00 shows the unticked box.
3. Rejecting with «El monto no coincide» from the row or the dialog shows «Pago rechazado» with the reason.
4. A `PAYMENT_CONFLICT` shows «Este pago ya fue revisado.» inside the dialog and reloads the card.
5. The buyer sees «Tu comprobante fue rechazado» and «Motivo: El monto no coincide.» at the start of the upload block, and «Ver captura · Rechazado».

**Tests to leave green:** every §14 title tagged T3 (`order-payments-card.test.ts`, the T3 titles of `order-detail.test.ts` and `api-routes.integration.test.ts`, the two E2E journeys), everything T1 and T2 left green, `pnpm --dir apps/core typecheck`.

**Depends on:** T1, T2 (`locales.ts`, E2E setup, buyer view). Not on T4.

### T4. Mobile payments

**Scope:** §10, building on T1's narrowing of `order-detail-screen.tsx`.

**Out of scope:** b3/b4 reorganization, a receipt modal, payment settings.

**Acceptance criteria:**
1. A rejected payment shows «Pago rechazado», its reason and «Ver captura», never «Pago confirmado».
2. In the review sheet, **Rechazar** with «El monto no coincide» rejects the report and the row updates; a `409 PAYMENT_CONFLICT` shows «Este pago ya fue revisado.».
3. The stock box appears only when the amount is below the balance.
4. An order with a pending report shows «Pago por revisar» under Saldo pendiente.

**Tests to leave green:** every §14 title tagged T4, T1's mobile title, `pnpm --dir apps/mobile test`, `pnpm --dir apps/mobile typecheck`.

**Depends on:** T1.

### Final verification

The manual checks of §14 and the product draft's acceptance criteria, with results in the pull request description.

## 17. Review gate round 1

Both reviewers (design and performance) rejected round 1. The coordinator consolidated the direction for the pre-existing wallets; the rest is applied as each reviewer asked.

| Finding | Resolution |
| --- | --- |
| Design B1, performance 1, 2, 7: one-time script not wired, and wired as written it would stop every deploy (`migrate` service has no `R2_*`) | Script, release wiring and retries removed. Read-time rule (§2, §5.4, §7): a pre-version wallet parses as `unchecked`, is not offered and is made `verified` only by a save. No deploy step or environment change; the deploy window cannot break a checkout. The product draft was adjusted (its "Decisions taken by the review gate"). |
| Design B2: `reportPayment`, `paymentSummary` and `voidPayment` cannot stay unchanged | §5.7: report replay on a rejected payment returns it without writing; another receipt → `PAYMENT_CONFLICT`; void → `409 INVALID_TRANSITION`; summary and repository read `payment.currency`. Test titles in §14. |
| Design B3: T1 cannot merge green; non-null wallet `imageUrl` depends on T2 | T1 owns the minimal narrowing (`order-detail.tsx`, mobile `order-detail-screen.tsx`, `order-json.ts`, typed i18n keys) and runs core and mobile typecheck. The non-null `imageUrl` moves to T3 (§16). |
| Design S1: memory references | `8f0d1d36` cited; the update of `b9ad8a84` is recorded (§2). |
| Design S2: test seam for image bytes | `vi.mock` of `readImageBytes` with `qr-fixtures/` in integration; fake S3 in `buyer-payment.spec.ts`; seeded `qr` in `store-appearance-buyer.spec.ts` (§12, §14; dropped in round 3, see §18). |
| Design S3: non-null wallet URL fails the whole buyer view | A wallet whose URL does not resolve is dropped (T3, §5.6). |
| Design S4: storage configuration error grouped with outages | `ImageReadError.storageCode` keeps them apart in `payment_qr_check_unavailable` (§6.1, §13). |
| Design S5: `isOpenForMessageItems` | Stated as unchanged and why (§5.7). |
| Performance 3: double decode | Stated and accepted, with a trigger (§11). |
| Performance 4: unbounded checks in the web process | Two slots per process, `503 QR_CHECK_UNAVAILABLE` when busy, `durationMs` logged (§2, §11, §13). |
| Performance 5: N+1 receipt URL resolution | `resolvePublicImages` (one `findMany`) in the buyer view and the order-detail loader (§5.6, T1). |
| Performance 6: full-size thumbnails | Lazy row thumbnails with fixed dimensions; only the dialog loads eagerly (§2, T3). |

Questions: none new.

Decided unless objected (new in this round):
- A wallet saved before this version is read as `unchecked`: hidden from buyers, shown in the panel as needing a QR check, made `verified` only by a save that reads its image. With image, save stays enabled; without image, save is disabled by the existing missing-QR rule.
- Saving an `unchecked` wallet reads its image even when unchanged, so a checker outage blocks that save (as with a new image); untick the wallet to save the bank alone.
- Two concurrent QR checks per process (initial value); a busy check answers `503 QR_CHECK_UNAVAILABLE` with no queue.
- The double read of a newly chosen image (choose-time plus save) is accepted.
- A buyer report replayed after its rejection returns the rejection without writing.
- The non-null wallet `imageUrl` and dropping an unresolved wallet land in T3; T1 adds the `«Pago rechazado»` labels needed so no build shows a rejected payment as confirmed.

## 18. Review gate round 2

Design rejected (1 blocker); performance approved with 3 suggestions. All applied.

| Finding | Resolution |
| --- | --- |
| Design B1: tests listed under T1 that pass only after T2 or T3; untagged titles | Every §14 title names its task. The offered-only tests move to the new `companies/offered-payment-methods.integration.test.ts`, which only T2 edits; the reject action and conflict mapping titles of `order-detail.test.ts` are T3's; `orders/composition.test.ts` is dropped (a mock of companies cannot observe the rule). Each task's "Tests to leave green" lists only what it passes alone (§16). |
| Design S1: slot count in code | `PAYMENT_QR_CHECK_SLOTS`, environment value, initial 2 (§2, §11). |
| Design S2 / performance 1: no deadline on a held slot | Read aborted after `PAYMENT_QR_CHECK_READ_TIMEOUT_MS` (initial 10000) through a signal passed to the S3 GET; slot released in `finally`; logged `IMAGE_STORAGE_TIMEOUT`; tests for a timed-out read and a thrown error (§6.1, §11, §14). |
| Design S3: `INVALID_IMAGE` "as today" was wrong | The API keeps today's `400 INVALID_INPUT` (no contract change), with a PUT test; the page shows **Subir QR** for an unchecked wallet whose image is gone, in the loader or on save (§2, §8.1, §12). |
| Design S4: `detectQrCode` lacks `companyId`/`stage`; one limiter | `detectQrCode(imageId, { companyId, stage })`, one module-scope function and limiter for both use cases, with a test (§5.1, §5.2, §14). |
| Design S5: permanent second stored shape; reverse deploy window | Removal condition and deferred item (below); the old-container direction is written down and accepted (§5.4). |
| Design S6: pure rules only covered manually or by E2E | `canSaveWalletQr` (T2) and `paymentRowActions` / `paymentCardSummary` (T3) with unit titles for AC 2, 3, 6, 20, 24, 26, «Registrar pago» and both unchecked states (§12, §14). |
| Design S7: `store-appearance-buyer.spec.ts` seeds no wallet | Dropped from T2; the preview rule is covered by the new T2 integration test. |
| Design S8: product scope item 3 wording | Product draft scope item 3 now matches its screens section and AC 7. |
| Performance 2: trigger event at `debug` | `payment_qr_checked` is `info` (§13). |
| Performance 3: wasm heap in the web process | Added to "Cost of a check" (§11). |

Questions: none new.

Decided unless objected (new in this round):
- `PAYMENT_QR_CHECK_SLOTS=2` and `PAYMENT_QR_CHECK_READ_TIMEOUT_MS=10000` as environment values with defaults, added to the `web` service of `compose.prod.yaml` and to `.env.example`.
- An image of another company or a missing one keeps answering `400 INVALID_INPUT` in the settings API, also on `POST /qr-checks`.
- An unchecked wallet whose stored image is gone is shown as without image (**Subir QR**, save disabled).
- During the deploy window, old containers fail the payment view of a company that saved on a new container (accepted with no production).

Deferred item with real risk (Todoist task only if the founder asks): remove the pre-version branch of `parseStoredPaymentSettings` once no stored wallet lacks `qr`, at the latest before the first business goes to production. Risk if forgotten: a permanent second stored shape that every future change to payment settings must keep reading.

## 19. Review gate round 3

Design rejected (2 blockers about wave-1 ownership); performance approved with 2 suggestions. The coordinator directed sequencing T1 and T2 instead of parallelizing them.

| Finding | Resolution |
| --- | --- |
| Design B1: T1 buyer-view test needs a wallet that T2 later hides | T1's fixture is a bank transfer with image and no wallet, which T2 does not change. T2 now runs after T1 and may update any T1 test its rule affects (§14, §16). |
| Design B2: T2 must edit `src/shared/images/index.ts` for the read deadline | T2 owns the `readImageBytes` wrapper forwarding `options` in `index.ts`; with T1 → T2 in sequence there is no shared-file overlap (§6.1, §12, §16). |
| Waves (coordinator) | Wave 1 T1; wave 2 T2 ∥ T4 (disjoint: core and `shared/` vs `apps/mobile` only); wave 3 T3 after T2, may overlap T4 (§16). |
| Design S1: memory `ceeffc07` goes stale | Listed for happy-memory-maintainer at T1's merge, next to `b9ad8a84` at T2's (§2). |
| Design S2: `order-detail.test.ts` is a unit test | Moved under Unit (core): `test:unit`, `vi.spyOn` on `resolvePublicImages`, no database (§14). |
| Design S3 / performance 1: abort during the body | The signal covers request and body; classification by `signal.aborted`, not by error name; tests for an abort before the response, during the body (`ECONNRESET` "aborted") and a non-aborted error (§6.1, §14). |
| Performance 2: busy answers skew the p95 trigger | Busy answers log `durationMs: null`; the trigger is the p95 over `qr_found`/`no_qr` only (§11, §13). |

Questions: none new.

Decided unless objected (new in this round):
- T1 alone in wave 1; T2 and T4 in parallel in wave 2; T3 in wave 3 after T2, possibly overlapping T4. Delivery takes one more sequential step than in round 3.
- T2 may edit files and tests T1 created (`src/shared/images/index.ts`, buyer-view tests) when its rule changes what they expect.
- Abort classification by `signal.aborted`; a busy check logs `durationMs: null`.
