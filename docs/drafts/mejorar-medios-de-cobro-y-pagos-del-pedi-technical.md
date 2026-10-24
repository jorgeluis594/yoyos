# Payment methods and order payments: technical design

**Status:** draft for the review gate, no open questions. Based on [`docs/drafts/mejorar-medios-de-cobro-y-pagos-del-pedi.md`](mejorar-medios-de-cobro-y-pagos-del-pedi.md) (closed product definition, commit `d8d502a5`). Base: branch `jorgeluis594/mejorar-medios-de-cobro-y-pagos-del-pedi`. This draft is the pipeline's working document, not permanent architecture documentation: on merge only `docs/orders.md` and `docs/checkout.md` receive the behavior changes, and both drafts are deleted.

## 1. Technical goal

Core rejects saving an offered digital wallet unless its image holds a QR that core decodes. It stores with the wallet whether its current image passed. Only wallets that passed reach buyers and the checkout preview. A pending buyer report gets a new final `rejected` payment state with an optional reason. Web, checkout and mobile read that state through the shared orders contract. The web order detail is reorganized into the b3 card and the b4 receipt dialog. Mobile adds rejection to its existing review sheet.

```text
Settings page ──PUT/POST qr-checks──▶ companies.savePaymentSettings ──readImageBytes + readQrCodes──▶ stored wallet { qr: verified }
                                                     │
                       companyPaymentSettings.get (offered only) ──▶ orders.getBuyerPaymentView, store-appearance preview

Web order detail (action) / mobile (POST …/reject) ──▶ orders.rejectPayment ──▶ Payment { status: "rejected" } ──▶ buyer view { rejectedReport }
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| QR reader location | `readQrCodes` moves from `features/products/infrastructure/qr-code-reader.ts` to `src/shared/images/infrastructure/qr-code-reader.ts`, together with its test and `qr-fixtures/`. Products imports it from there. Reason: it is generic (sharp + zxing, no product knowledge), two features now use it, and importing products from companies would close the cycle companies → products → orders → companies. |
| What "passed" means | At least one decoded QR (`readQrCodes` returns a non-empty list). `UNREADABLE_IMAGE` counts as "no QR". The content is not compared with provider or holder. |
| QR validity storage | The wallet stores `qr: { status: "verified", imageId } \| { status: "not_a_qr", imageId } \| { status: "missing" }` inside `CompanyPaymentSettings.settings` (JSON). No new table or column. A save from any client can only produce `verified`. `not_a_qr` and `missing` come only from the one-time check of wallets saved before this version. |
| Re-reading on save | A save whose wallet `imageId` equals the stored `verified` image is not read again. Any other wallet image is read before saving. Images are immutable per id, so "passed" is a fact about the id. |
| Pre-existing wallets | One-time script `apps/core/scripts/verify-wallet-qr.ts` (`pnpm --dir apps/core payments:verify-wallet-qr`) runs in the release right after `scripts/migrate.ts` and before the new server version serves. It converts every wallet without `qr` to the new shape. A checker or storage outage is retried (3 attempts, 2 s, 4 s; initial values, adjustable) and the row is left unchanged; the script then exits with code 1 and is run again. The product code has no legacy branch: the stored parser requires `qr`. |
| Choose-time check | New `POST /api/company/payment-settings/qr-checks` `{ imageId }` → `{ status: "verified" \| "not_a_qr" }`. It only informs the page; nothing is stored. |
| Settings errors | Not a QR: `400 INVALID_PAYMENT_QR`. Checker or image storage unavailable: `503 QR_CHECK_UNAVAILABLE`. Image of another company or missing: `400 INVALID_IMAGE` (as today). Nothing is saved on any error. |
| Offered methods | `companyPaymentSettings.get(companyId)` returns only the offered methods: bank transfer plus a wallet whose `qr.status` is `verified`, in today's shape with a non-null wallet `imageId`. Orders (`getBuyerPaymentView`) and store-appearance (`paymentMethods`) keep calling it unchanged. The settings page uses the new `companyPaymentSettings.getConfiguration(companyId)`. |
| Rejected payment | New `RejectedPayment` variant of the existing `Payment` union, stored in the existing `Payment` row: `status = 'rejected'`, `amount`/`method` null, `data = { report, rejectedAt, rejectedBy, reason }`. No migration: `status` is a free `String` with no `CHECK`, and the variant rules live in domain (memory f358e2a0). |
| Reject endpoint | `POST /api/orders/:id/payments/:paymentId/reject` with body `{ reason: string \| null }`, returning `200` with `orderAggregateSchema`, like void. The web order detail calls the use case from its route action, like confirm and void. |
| Rejection reason | Trimmed; empty → `null`; at most 200 characters after trimming (initial value, adjustable in code; it is a product limit, not an environment value). |
| Repeated and crossed decisions | Rejecting a rejected payment returns it unchanged, with its original reason. Confirming with the same amount and method returns the existing confirmation; `register-payment.ts` already ignores `deductStockIfPartial` on that replay. Rejecting a confirmed or voided payment, or confirming a rejected one, returns `409 PAYMENT_CONFLICT`. The web and mobile map `PAYMENT_CONFLICT` and `INVALID_TRANSITION` from approve/reject to «Este pago ya fue revisado.» and reload. No new error code. |
| Buyer view | `payments[]` gains the `rejected` status and `rejectionReason`. The view gains `rejectedReport: { reason } \| null`: the most recent buyer report (by `reportedAt`), when it is rejected and no report is pending. |
| Stock box rule | Pure function `offersPartialStockDeduction` in `shared/orders-payment.ts`, used by web and mobile: shown only when stock is not deducted and the amount is below `balanceDue`. Core keeps its current rule; a hidden box sends `deductStockIfPartial: false`. |
| Web order detail split | `app/routes/order-detail.tsx` keeps loader and action; the «Pagos» card, the receipt dialog and the decision forms move to `src/features/orders/presentation/` components. The receipt dialog uses `app/components/ui/dialog.tsx`. |
| Mobile | No new screen. The existing review sheet in `order-detail-screen.tsx` gains **Rechazar**; the API adapter gains `rejectPayment`. |
| Task count | Four tasks in two waves (section 16). |

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
| Image bytes | `src/shared/images` `readImageBytes(imageId)` | `IMAGE_NOT_FOUND \| IMAGE_STORAGE_UNAVAILABLE \| PERSISTENCE_UNAVAILABLE`; company isolation through RLS `image_company_isolation` under `withTenantIsolation`. |
| Payment domain | `orders/domain/payment.ts` | `Payment = Reported \| Confirmed \| Voided`; `parsePayment`, `reportPayment`, `confirmPayment` (idempotent on same data, `PAYMENT_CONFLICT` otherwise), `voidPayment`. |
| State machine | `orders/domain/order-state-machine.ts` | `registerPayment`, `addReportedPayment`, `voidConfirmedPayment`, `planStockDeduction`, `paymentSummary` (counts only confirmed). |
| Use cases | `orders/application/register-payment.ts`, `report-payment.ts`, `void-payment.ts` | Each runs `deps.transaction(companyId, …)` and `findOrderForUpdate` (row lock). A confirmation replay returns before any write. |
| Payment persistence | `orders/infrastructure/order-repository.ts`; Prisma `Payment` (`status String`, `amount Decimal?`, `method String?`, `data Json`) | `mapPaymentUnsafe` checks status-specific nulls and parses `data` per status; `updatePayment(payment, companyId, expectedStatus)` updates only when the stored status matches, else `PAYMENT_CONFLICT`. Payment `CHECK`s: `amount > 0`, supported currency; none on `status`. |
| Orders API | `orders/presentation/api-routes.ts` | `POST /:id/payments`, `POST /:id/payments/:paymentId/void`; `operationError` maps 422/409/404/503. |
| Buyer API and view | `orders/presentation/buyer-payment-routes.ts`; `orders/composition.ts` L181–217 | `GET /api/buyer/orders/:orderId/payment` → `buyerPaymentViewSchema`; payments as `{ id, status, amount, method, receiptImageUrl }`. |
| Orders contract | `shared/contracts/orders.ts` | `paymentSchema` union (L87–95), `registerPaymentSchema`, `buyerPaymentViewSchema` (L143–151), `orderApiErrorSchema` (L176–180), `orderDetailLoaderSchema` (L190). |
| Web order detail | `apps/core/app/routes/order-detail.tsx` (378 lines) | Loader builds `receiptUrls`; action handles `operation=confirm` and `operation=void`; a `PaymentForm` under each report plus «Registrar pago manual»; «Ver captura» opens a new tab; `Dialog` already imported for cancellation. |
| Web settings page | `apps/core/app/routes/payment-settings.tsx` (115 lines) | Loader, action building settings from form data, upload by `fetch("/api/images")`, local `ImageControl`. |
| Checkout | `orders/presentation/buyer-payment-content.tsx` | Upload block hidden while a report is pending; «Comprobantes enviados» as `Ver captura · {status}`. |
| Mobile orders | `apps/mobile/src/features/orders/infrastructure/order-api.ts`, `application/order-operations.ts`, `presentation/order-detail-screen.tsx`, `order-detail-translations.ts`, `translations.ts` | Uses `orderAggregateSchema` directly; `registerPayment`, `voidPayment`, `receiptUrl`; review sheet is a `pageSheet` modal (L419–439); any non-reported, non-voided payment is labelled confirmed. |
| Scripts | `apps/core/scripts/*.ts` run with `tsx` from `package.json` | Pattern: iterate companies with `systemPrisma` and `withTenantIsolation`, `process.exitCode = 1` on failure, `$disconnect` in `finally`. |
| Transactions | `src/shared/infrastructure/persistance.ts` | `withinTransaction`, `withTenantIsolation`, `withLockedForUpdate`, `requireActiveTransaction`. |
| Logs | `orders/composition.ts` L346–377, repository, companies composition | `payment_confirmed`, `payment_reported`, `payment_voided`, `payment_operation_replayed`, `payment_operation_conflict`, `payment_confirmation_stock_rejected`, `company_payment_settings_saved`, … |

Assumption: the release runs `scripts/migrate.ts` as a step before starting the server (no deployment file in the repository shows it). The one-time script is chained in the same place.

## 4. Gaps this design closes

1. Nothing validates that a wallet image holds a QR, and `imageId` is nullable for the wallet (§5.1, §6.1, §8.1).
2. Validity is not stored, so it cannot survive a later checker outage (§6.1, §7).
3. Wallets saved before this version have no validity (§5.4, §7).
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
  - `detectQrCode: (imageId: ImageId) => Promise<Result<"qr_found" | "no_qr", QrCheckFailure>>`
- **Output:** `readonly CompanyPaymentSettings[]` (stored shape, wallet with `qr.status = "verified"`).
- **Errors:** `INVALID_PAYMENT_SETTINGS | INVALID_IMAGE | INVALID_PAYMENT_QR | QR_CHECK_UNAVAILABLE | INVALID_STORED_DATA | PERSISTENCE_UNAVAILABLE`.
- **Flow:**
  1. Parse the input; a wallet requires `imageId`.
  2. Check `imageAvailable` for every image (wallet and bank), as today.
  3. `load` the current settings.
  4. If the stored wallet is `{ status: "verified", imageId }` with the same `imageId`, keep it verified without reading.
  5. Otherwise `detectQrCode(imageId)`: `no_qr` → `INVALID_PAYMENT_QR`; failure → `QR_CHECK_UNAVAILABLE`; `qr_found` → `{ status: "verified", imageId }`.
  6. `save` the full replacement and return it.

### 5.2 `checkPaymentQr` (companies, new)

- **Input:** `{ imageId: ImageId }`.
- **Access:** `{ companyId, userId }`.
- **Deps:** `imageAvailable`, `detectQrCode` (same signatures as 5.1).
- **Output:** `"verified" | "not_a_qr"`.
- **Errors:** `INVALID_IMAGE | QR_CHECK_UNAVAILABLE | PERSISTENCE_UNAVAILABLE`.
- **Flow:** check the image belongs to the company; `detectQrCode`; map `qr_found` → `verified`, `no_qr` → `not_a_qr`. Nothing is written.

### 5.3 `getOfferedPaymentSettings` and `getPaymentConfiguration` (companies)

- `getOfferedPaymentSettings(companyId, { load })` → `Result<readonly OfferedPaymentSetting[], SettingsFailure>`: `load`, then the pure `offeredPaymentSettings(settings)`. Exposed as `companyPaymentSettings.get` (same name and shape its consumers use today).
- `getPaymentConfiguration(companyId, { load })` → stored settings with `qr`, for the settings page. Exposed as `companyPaymentSettings.getConfiguration`.

### 5.4 One-time wallet QR verification (companies, script)

- **Entry point:** `apps/core/scripts/verify-wallet-qr.ts`, run once per environment.
- **Deps:** `systemPrisma` to list companies with a `CompanyPaymentSettings` row, then per company inside `withTenantIsolation`: a raw read of `settings`, `readImageBytes`, `readQrCodes`, `persistPaymentSettings`.
- **Flow per company:**
  1. Read the JSON with a local pre-version schema (wallet with `imageId: uuid | null`, no `qr`). A row already in the new shape is skipped (idempotent).
  2. `imageId` null → `{ status: "missing" }`. Image not found → `{ status: "missing" }`.
  3. Read the QR: found → `verified`; `no_qr` or `UNREADABLE_IMAGE` → `not_a_qr`.
  4. `QR_READER_UNAVAILABLE`, `IMAGE_STORAGE_UNAVAILABLE` or `PERSISTENCE_UNAVAILABLE` → retry up to 3 attempts; if all fail, leave the row unchanged, log, and continue with the next company; the process ends with `exitCode = 1`.
  5. Write the converted settings with `persistPaymentSettings`.
- The local pre-version schema lives only in the script; it is deleted once every environment ran it (§15).

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
- Settings come from `companyPaymentSettings.get`, which now returns only offered methods; the wallet `imageUrl` is always resolved.

### 5.7 Existing use cases with an exact change

- `confirmPayment` (domain): an existing `rejected` payment → `PAYMENT_CONFLICT`.
- `orderStateMachine.registerPayment`: a `rejected` payment with the same id → `PAYMENT_CONFLICT`.
- `voidConfirmedPayment`: a `rejected` payment → `INVALID_TRANSITION` (same as reported today).
- `register-payment.ts`, `void-payment.ts`, `report-payment.ts`: no change.

## 6. Domain and typing

### 6.1 Companies

```ts
// companies/domain/payment-settings.ts
export type WalletQr =
  | Readonly<{ status: "verified"; imageId: ImageId }>
  | Readonly<{ status: "not_a_qr"; imageId: ImageId }>
  | Readonly<{ status: "missing" }>;
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
```

- `WalletQr`: validity is a variant, not a boolean next to a nullable id (guide 3.5).
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
- **Settings repository:** `loadPaymentSettings` parses with `parseStoredPaymentSettings` (wallet requires `qr`); a row without `qr` is `INVALID_STORED_DATA`. `persistPaymentSettings` stores the full array, as today.
- **Development data:** no business is in production. Seeds and fixtures that create wallets (`scripts/seed.ts`, if it seeds payment settings; E2E setup) store `qr: { status: "verified", imageId }` with a real QR fixture. The script converts any remaining development row.

## 8. Contracts between applications

### 8.1 `shared/contracts/payment-settings.ts`

- `paymentSettingsInputSchema` (PUT body): wallet `{ method, provider, holder, imageId: z.uuid() }` (no longer nullable); bank unchanged.
- `paymentSettingsResponseSchema` (GET and PUT 200): wallet `{ method, provider, holder, qr: { status: "verified", imageId } | { status: "not_a_qr", imageId } | { status: "missing" } }`; bank unchanged.
- `paymentQrCheckSchema` `{ imageId: z.uuid() }` and `paymentQrCheckResponseSchema` `{ status: "verified" | "not_a_qr" }`.
- Statuses: `400 INVALID_INPUT` (schema), `400 INVALID_PAYMENT_QR`, `400 INVALID_IMAGE`, `503 QR_CHECK_UNAVAILABLE`, `503 SERVICE_UNAVAILABLE`. Error envelope `{ code, error }` as today.
- Only core consumes this contract (web and API). Mobile does not.

### 8.2 `shared/contracts/orders.ts`

- `paymentSchema` adds `{ status: "rejected", currency, amount: null, method: null, data: rejectionDataSchema }`.
- `rejectPaymentSchema = z.strictObject({ reason: z.string().max(1000).nullable() })`. The domain applies the 200-character rule after trimming; the schema bound only limits the payload.
- `POST /api/orders/:id/payments/:paymentId/reject` → `200 orderAggregateSchema`. Errors: `400 INVALID_INPUT`, `415`, `422 INVALID_PAYMENT`, `404 ORDER_NOT_FOUND | PAYMENT_NOT_FOUND`, `409 PAYMENT_CONFLICT | ORDER_CANCELLED`, `503`. `orderApiErrorSchema` already has these codes.
- `buyerPaymentViewSchema`:
  - `payments[].status` adds `"rejected"`;
  - `payments[].rejectionReason: z.string().nullable()`;
  - `rejectedReport: z.strictObject({ reason: z.string().nullable() }).nullable()`;
  - wallet `imageUrl` becomes `z.url()` (non-null).
- Mobile parses `orderAggregateSchema` and must handle the new variant (T4). The variant is additive. An older mobile build fails to parse an order with a rejected payment, which is acceptable with no production users.

## 9. Events and cross-feature integration

- No event. Rejecting a report changes nothing in other features.
- Companies exposes `companyPaymentSettings.get` (offered methods), `getConfiguration`, `save` and `checkQr` from `companies/composition.ts` via `companies/index.ts`.
- Companies composes `detectQrCode` from `src/shared/images` `readImageBytes` and the moved `readQrCodes`: `UNREADABLE_IMAGE` → `no_qr`; empty list → `no_qr`; `IMAGE_NOT_FOUND` → `INVALID_IMAGE`; `IMAGE_STORAGE_UNAVAILABLE`, `PERSISTENCE_UNAVAILABLE` and `QR_READER_UNAVAILABLE` → `QR_CHECK_UNAVAILABLE`.
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
2. Read the QR outside any transaction (slow I/O).
3. Upsert the full array.

Two concurrent saves: the last one wins, as today. The reuse decision compares the stored `verified` image id with the submitted one. Because image bytes are immutable per id, it stays correct under any interleaving. No lock is added.

**QR check:** read-only.

**Duplicates:**
- Approve uses the client `paymentId`, as today.
- Reject is idempotent per payment id (rejected → same result).
- A manual payment repeated from the same open form reuses `manualPaymentId`, as today.

## 12. Code organization

| File | Change |
| --- | --- |
| `apps/core/src/shared/images/infrastructure/qr-code-reader.ts` (+ test, `qr-fixtures/`) | Moved from products, unchanged. |
| `apps/core/src/features/products/composition.ts` | Import path of `readQrCodes`. |
| `companies/domain/payment-settings.ts` (+ test) | `WalletQr`, input and stored parsers, `offeredPaymentSettings`. |
| `companies/application/payment-settings.ts` (+ test) | `savePaymentSettings` with QR, `checkPaymentQr`, `getOfferedPaymentSettings`, `getPaymentConfiguration`. |
| `companies/infrastructure/payment-settings-repository.ts` (+ integration test) | Stored parser. |
| `companies/presentation/payment-settings-routes.ts` (+ integration test) | PUT error mapping, `POST /qr-checks`, response schema. |
| `companies/composition.ts` | `detectQrCode`, `get` (offered), `getConfiguration`, `save`, `checkQr`, logs. |
| `apps/core/scripts/verify-wallet-qr.ts`, `apps/core/package.json` | One-time script and `payments:verify-wallet-qr` command. |
| `shared/contracts/payment-settings.ts` | §8.1. |
| `apps/core/app/routes/payment-settings.tsx`, new `companies/presentation/wallet-qr-field.tsx` | b1/b2 page, QR field states, choose-time check through `fetch`. |
| `shared/contracts/orders.ts` | §8.2. |
| `shared/orders-payment.ts` (+ test) | `offersPartialStockDeduction`. |
| `orders/domain/payment.ts`, `order-state-machine.ts` (+ tests) | §6.2. |
| `orders/application/reject-payment.ts` (+ test) | §5.5. |
| `orders/infrastructure/order-repository.ts` (+ integration test) | Rejected mapper and serializer. |
| `orders/presentation/api-routes.ts` (+ integration test) | Reject route. |
| `orders/composition.ts` | `orders.rejectPayment` with logs; buyer view projection §5.6. |
| `apps/core/app/routes/order-detail.tsx` (+ `order-detail.test.ts`) | Loader adds receipt URLs for rejected payments; action adds `operation=reject` and maps codes; renders the new components. |
| New `orders/presentation/order-payments-card.tsx`, `receipt-dialog.tsx`, `payment-decision-form.tsx` | b3 card, b4 dialog with in-place decision area, approve/register/reject forms. |
| `orders/presentation/payment-fields.tsx` | Stock box shown with `offersPartialStockDeduction`. |
| `orders/presentation/buyer-payment-content.tsx` | Rejection notice at the start of the upload block; `Rechazado` status with reason. |
| `apps/core/app/locales.ts` | es/pt for `paymentSettings` (T2), `orderDetail`/`orders` payments and `buyerPaymentContent` (T3). |
| `apps/core/tests/e2e/buyer-payment.spec.ts` | Wallet with a verified QR in setup (T2); reject and resend journey (T3). |
| Mobile | §10. |

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `payment_rejected` | info | orders composition, after commit | `["companyId", "userId", "orderId", "paymentId", "hasReason"]` |
| `payment_operation_replayed` | debug | orders composition | `["operation": "reject", "paymentId"]` (existing event, new operation value) |
| `payment_operation_conflict` | debug | orders composition | `["operation": "reject", "paymentId", "errorCode"]` (existing event) |
| `company_payment_settings_saved` | info | companies composition | existing fields plus `walletQr: "read" \| "reused" \| "none"` |
| `payment_qr_check_unavailable` | warn | companies composition (`detectQrCode`) | `["companyId", "stage": "choose" \| "save", "errorCode"]` |
| `wallet_qr_verification_completed` | info | script | `["companies", "verified", "notAQr", "missing", "failed", "durationMs"]` |
| `wallet_qr_verification_failed` | error | script, per company after the last attempt | `["companyId", "errorCode", "attempts"]` |

An image without a QR is a business rejection: it returns a `Result` and is not logged. Never logged: rejection reason text, provider, holder, account data, image ids or URLs, QR contents.

## 14. Tests

### Unit (core)

`companies/domain/payment-settings.test.ts`
- `test("rejects a wallet input without imageId")`
- `test("parses a stored wallet only when it has a qr status")`
- `test("offers a wallet only when its qr is verified and always offers bank transfer")`

`companies/application/payment-settings.test.ts`
- `test("saves an offered wallet as verified when its image holds a qr")`
- `test("rejects saving a wallet whose image holds no qr and saves nothing")`
- `test("does not save when the qr check is unavailable for a new image")`
- `test("keeps an unchanged verified wallet image without reading it again")`
- `test("saves bank changes while the qr check is unavailable when the wallet image is unchanged")`
- `test("reports a choose-time qr check as verified or not_a_qr without writing")`

`orders/domain/payment.test.ts`
- `test("rejects a reported payment keeping its receipt and an optional trimmed reason")`
- `test("treats an empty rejection reason as no reason")`
- `test("refuses a rejection reason longer than 200 characters")`
- `test("returns an already rejected payment unchanged with its original reason")`
- `test("refuses to reject a confirmed or voided payment")`
- `test("refuses to confirm a rejected payment")`

`orders/domain/order-state-machine.test.ts`
- `test("rejecting a report leaves paid amount, balance, stock and completion unchanged")`
- `test("refuses to reject a report in a cancelled order")`
- `test("returns the latest report rejection only when no report is pending")`

`orders/application/reject-payment.test.ts`
- `test("rejects a pending report inside the order transaction")`
- `test("returns not found for a payment outside the order")`
- `test("replays a repeated rejection without writing")`

`shared/orders-payment.test.ts`
- `test("offers the partial stock choice only when the amount is below the balance and stock is not deducted")`
- `test("does not offer the partial stock choice for an empty or invalid amount")`

### Integration (core, real database)

`companies/infrastructure/payment-settings-repository.integration.test.ts`
- `test("stores and reads a verified wallet qr per company")`
- `test("reports a stored wallet without qr status as invalid stored data")`

`companies/presentation/payment-settings-routes.integration.test.ts`
- `test("PUT answers 400 INVALID_INPUT for an offered wallet without imageId")`
- `test("PUT answers 400 INVALID_PAYMENT_QR for an image without qr and keeps the previous settings")`
- `test("PUT answers 503 QR_CHECK_UNAVAILABLE when the reader is unavailable and saves nothing")`
- `test("PUT saves a wallet with a real Plin qr fixture as verified")`
- `test("POST qr-checks answers not_a_qr for a landscape photo and verified for a qr")`
- `test("POST qr-checks refuses an image of another company")`

`scripts/verify-wallet-qr` (integration test next to the script)
- `test("converts pre-version wallets to verified, not_a_qr or missing")`
- `test("leaves a wallet unchanged and exits with failure when the reader stays unavailable")`
- `test("skips companies already in the new shape")`

`orders/infrastructure/order-repository.integration.test.ts`
- `test("round-trips a rejected payment with its report and reason")`

`orders/presentation/api-routes.integration.test.ts`
- `test("POST reject marks a reported payment rejected and keeps the balance")`
- `test("POST reject answers 409 PAYMENT_CONFLICT for a confirmed payment")`
- `test("POST reject answers 409 ORDER_CANCELLED in a cancelled order")`
- `test("POST reject answers 404 for an order of another company")`
- `test("repeating POST reject returns the same rejection")`
- `test("confirming a rejected payment answers 409 PAYMENT_CONFLICT")`
- `test("buyer view exposes the rejected status, its reason and rejectedReport")`
- `test("buyer view hides a wallet without a verified qr")`

`orders/composition.test.ts`
- `test("store-appearance preview and buyer view receive only offered payment methods")`

`apps/core/app/routes/order-detail.test.ts`
- `test("reject action rejects the report and returns the updated order")`
- `test("approve and reject map PAYMENT_CONFLICT to the already-reviewed message")`
- `test("loader resolves receipt urls for rejected payments")`

### Unit (mobile)

- `infrastructure/order-api.test.ts`: `test("rejectPayment posts the reason and parses the order aggregate")`
- `application/order-operations.test.ts`: `test("maps a conflicting rejection to already reviewed")`
- `presentation/order-detail-screen.test.tsx`:
  - `test("labels a rejected payment as Pago rechazado with its reason and Ver captura")`
  - `test("rejects a report from the review sheet with an optional reason")`
  - `test("shows the partial stock box only when the amount is below the balance")`
  - `test("shows Pago por revisar while a report is pending")`

### Web E2E (`apps/core/tests/e2e/buyer-payment.spec.ts`, happy path)

- `test("buyer pays with the verified wallet qr and the seller approves the report from the receipt dialog")`
- `test("seller rejects a report with a reason and the buyer sees it and sends another receipt")`

### Pending manual checks

- Settings page against b1/b2; QR of a real Yape and Plin screenshot accepted; a landscape photo refused.
- Receipt dialog at 390 px: the reduced receipt stays readable with the keyboard open; ×, Escape and outside click close it; focus returns.
- Mobile on a device: reject from the sheet, «Pago por revisar», «Ver captura» of a rejected payment.
- Running the one-time script against the environment's data before the new version serves.

## 15. Limits and checks during implementation

- The pre-version schema in `verify-wallet-qr.ts` and the script itself are removed in a later cleanup once every environment ran it. Until then they are the only code that knows the old shape.
- Verify that `readQrCodes` decodes the Yape and Plin fixtures in `qr-fixtures/` (memory b9ad8a84 says they decode). Add a payment-wallet screenshot fixture if none exists.
- Verify whether `scripts/seed.ts` seeds payment settings and update it to the new shape.
- Verify that the QR-check route runs under `withTenantIsolation`, so `readImageBytes` cannot read another company's image.
- Store-appearance needs no code change. Verify that its preview test still passes with offered-only methods.
- `locales.ts` is edited by T2 (`paymentSettings`) and T3 (`orderDetail`, `orders`, `buyerPaymentContent`). T3 starts after T2 merges.
- Matching the QR content with provider or holder, undoing a rejection, and warning the seller outside «Medios de cobro» stay out (product draft).

## 16. Implementation plan

### Order and parallelism

```text
Wave 1 (parallel):  T1 Rejected payment backend + contract      T2 Wallet QR end to end (backend, script, settings page)
Wave 2 (parallel):  T3 Web order detail + checkout (after T1 and T2)      T4 Mobile (after T1)
```

T1 and T2 edit disjoint files: T1 edits `shared/contracts/orders.ts`, `shared/orders-payment.ts` and `features/orders/**` except presentation UI. T2 edits `shared/contracts/payment-settings.ts`, `features/companies/**`, `src/shared/images/**`, the products import, scripts, `app/routes/payment-settings.tsx`, `locales.ts` (`paymentSettings`) and the E2E setup. T3 and T4 edit disjoint files (core web vs `apps/mobile`).

### T1. Rejected payment backend and contracts

**Scope:**
- §5.5–5.7, §6.2, §6.3, §7 (payment mapper), §8.2.
- Reject API route, buyer view projection and `orders.rejectPayment` composition with logs.

**Out of scope:** web UI, checkout UI, mobile, payment settings.

**Acceptance criteria:**
1. Order #1042 with a pending report: `POST …/reject` with `{ reason: "El monto no coincide" }` returns the order with that payment `rejected` and the reason; `paidAmount` and `balanceDue` unchanged; stock unchanged.
2. The same request again returns the same rejection; a second request on a confirmed payment returns `409 PAYMENT_CONFLICT`; in a cancelled order `409 ORDER_CANCELLED`; for another company's order `404`.
3. Confirming a rejected payment returns `409 PAYMENT_CONFLICT`.
4. `GET /api/buyer/orders/:orderId/payment` shows the payment `rejected` with `rejectionReason` and `rejectedReport.reason`; after a new report `rejectedReport` is `null`.
5. `offersPartialStockDeduction` is false for S/ 70.00 on a S/ 70.00 balance and true for S/ 30.00.

**Tests to leave green:** §14 unit (orders, shared), core integration (repository, api-routes, buyer view).

**Depends on:** nothing.

### T2. Wallet QR end to end

**Scope:**
- §5.1–5.4, §6.1, §7 (settings), §8.1, §9 and the QR reader move.
- The one-time script and its command.
- The b1/b2 settings page with every QR field state and save rule from the product draft.
- The `paymentSettings` es/pt texts.
- The E2E setup with a verified wallet QR.

**Out of scope:** orders, checkout UI (it receives offered methods automatically), mobile.

**Acceptance criteria:**
1. `PUT /api/company/payment-settings` with an offered wallet without `imageId` → `400 INVALID_INPUT`; with a landscape photo → `400 INVALID_PAYMENT_QR`, previous settings intact; with the reader unavailable → `503 QR_CHECK_UNAVAILABLE`, nothing saved.
2. A Plin QR fixture saves as `verified`; changing only the bank account with the reader unavailable succeeds and the wallet stays verified.
3. A company whose stored wallet is `not_a_qr` or `missing` offers only bank transfer in the buyer view and the store preview; the settings page shows «Tus compradores no ven esta billetera…».
4. The script converts pre-version rows and, with the reader unavailable, leaves them unchanged and exits 1.
5. The page shows «Revisando QR…» with save disabled, then «✓ QR válido» or the b2 error; a failed choose-time check leaves save enabled.

**Tests to leave green:** §14 companies unit and integration, script integration, existing products QR reader test at its new path, `buyer-payment.spec.ts` (existing journey with the new setup).

**Depends on:** nothing.

### T3. Web order detail and checkout

**Scope:**
- The b3 «Pagos» card, the b4 receipt dialog with the in-place decision area, and the approve, register and reject forms with focus, accessible names and failure placement from the product draft.
- `operation=reject` in the route action.
- Checkout rejection notice and `Rechazado` status.
- `orderDetail`/`orders`/`buyerPaymentContent` es/pt texts.
- The two E2E journeys.

**Out of scope:** backend rules (T1), settings (T2), mobile.

**Acceptance criteria:**
1. Order #1042 with one report shows one row with thumbnail, «Ver captura», **Rechazar**, **Aprobar**, and «¿Te pagaron por fuera? Registrar pago» at the end; no form is visible until opened.
2. From the receipt dialog, approving S/ 70.00 shows no stock box, closes the dialog, shows «Pago actualizado.» and focuses the confirmed row; approving S/ 30.00 shows the unticked box.
3. Rejecting with «El monto no coincide» from the row or the dialog shows «Pago rechazado» with the reason.
4. A `PAYMENT_CONFLICT` shows «Este pago ya fue revisado.» inside the dialog and reloads the card.
5. The buyer sees «Tu comprobante fue rechazado» and «Motivo: El monto no coincide.» at the start of the upload block, and «Ver captura · Rechazado».

**Tests to leave green:** `order-detail.test.ts`, the E2E journeys of §14.

**Depends on:** T1, T2 (`locales.ts` and E2E setup).

### T4. Mobile payments

**Scope:** §10.

**Out of scope:** b3/b4 reorganization, a receipt modal, payment settings.

**Acceptance criteria:**
1. A rejected payment shows «Pago rechazado», its reason and «Ver captura», never «Pago confirmado».
2. In the review sheet, **Rechazar** with «El monto no coincide» rejects the report and the row updates; a `409 PAYMENT_CONFLICT` shows «Este pago ya fue revisado.».
3. The stock box appears only when the amount is below the balance.
4. An order with a pending report shows «Pago por revisar» under Saldo pendiente.

**Tests to leave green:** §14 mobile unit tests, `pnpm --dir apps/mobile typecheck`.

**Depends on:** T1.

### Final verification

The manual checks of §14 and the product draft's acceptance criteria, with results in the pull request description.
