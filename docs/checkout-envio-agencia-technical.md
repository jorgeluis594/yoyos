# Agency delivery in the buyer checkout: technical design

**Status:** design closed (diseño cerrado), pending implementation. Product: [`docs/checkout-envio-agencia.md`](checkout-envio-agencia.md). Base: branch `jorgeluis594/tarea-6hpQ6v6PCQ55pgM3` (commit `2b0cdd6e`). Tasks: [`docs/checkout-envio-agencia-tasks.md`](checkout-envio-agencia-tasks.md). Todoist `6hpQ6v6PCQ55pgM3`.

## 1. Technical goal

When done, the public checkout loader says whether the business has agency coverage, and the web checkout splits «Entrega a domicilio» from «Envío a agencia». In agency mode the checkout quotes the buyer's district with the current quotation, merges the agencies of every agency rate, keeps each agency once with its cheapest option and shows only the first cascade level (district → province → department) that has agencies. The chosen agency defines the `rateId` and `agencyId` confirmed with the current contract. Schema, quotation, confirmation and order snapshot do not change.

```text
checkout loader ──▶ deliverySettings.getCheckoutDeliveryOptions(companyId)
                      └─ readDeliveryConfiguration(companyId, "shared") + hasAgencyCoverage()
                 ──▶ deliveryOptions { home, agency { enabled, covered }, store }

web checkout (mode "agency")
  PeruDistrictSelect ─▶ current quotation POST ─▶ rates[]
  agencyChoices(rates, districtCode) ─▶ { level, choices[] } ─▶ CheckoutAgencyDestination
  chosenAgency(choices, draft.agencyId) ─▶ { method: "agency", rateId, agencyId, districtCode } ─▶ current confirmation
```

## 2. Decisions

| Topic | Decision |
|---|---|
| Technical scope | Core only: public checkout contract, its loader and the web checkout. No change to mobile, seller forms, quotation, confirmation, snapshot or schema. |
| Coverage in the contract | `checkoutDeliveryOptionsSchema.agency` becomes `{ enabled: boolean; covered: boolean }`. `enabled` stays the switch; `covered` is coverage. The radio shows with `enabled && covered`. Only a yes/no: no zones, districts or agencies are exposed. |
| Coverage rule | Pure domain function `hasAgencyCoverage(configuration)` in `delivery-settings/domain/quotation.ts`, reusing `eligibleAgencies`: some enabled zone has an enabled agency option with at least one eligible agency. It does not depend on the district nor on the switch, which travels apart. |
| Coverage read | New use case `getCheckoutDeliveryOptions` in `delivery-settings`, reading `readDeliveryConfiguration(companyId, "shared")` inside `quotationTransaction`. The loader uses it instead of `getForCompany`; `getForCompany` stays because `orders` uses it on confirm. |
| Cascade, dedup and order | Pure web function `agencyChoices(rates, districtCode)` in `apps/core/app/checkout-agency-choices.ts`. It is the buyer's view: it does not live in the quotation nor on the server. |
| Current choice | Pure `chosenAgency(choices, agencyId)` in the same file: the single choice when the list has one, else the one whose `agency.id` equals the draft's `agencyId`, else none. Preselection is derived, never written with an effect. |
| Selection | The «Agencia de destino» dropdown's value is the `agencyId`; the `rateId` comes from the deduplicated choice. Agency mode has no «Tarifa de envío» dropdown. |
| Initial mode | Without a saved delivery, nothing is selected (`mode: ""`), whatever methods are offered (product flow step 1, criterion 1). With a saved delivery, `keep`, as today. This replaces today's preselection of «Envío» or of store pickup. |
| Draft modes | Draft `mode` goes from `"" \| "keep" \| "ship" \| "store"` to `"" \| "keep" \| "home" \| "agency" \| "store"`. |
| Agency list rendering | New presentational component `CheckoutAgencyDestination` (`apps/core/app/components/checkout-agency-destination.tsx`) renders the notice, the dropdown or the no-agencies message from `AgencyChoices`. It exists so the cascade screen is testable with the static rendering core component tests use, and to keep `CheckoutDeliveryFields` from growing. |
| Agency label | New `buyerAgencyLabel` in `checkout-agency-choices.ts`: «{agency} · {courier} · {address} · {district}, {province} · {price}», «Gratis» for 0. `agencyLabel` in `app/rate-label.ts` does not change: the seller form uses it. |
| Radio labels | Radios reuse `checkoutDelivery.method.home` («Entrega a domicilio») and `checkoutDelivery.method.agency`, which becomes «Envío a agencia» (pt «Envio para agência», like the seller settings). The kept-delivery summary uses the same key. `checkoutDelivery.ship` is removed. |
| Place names | Notices and labels use the INEI catalog names as `peruDeliveryDistrict` and the quotation return them (uppercase: `CAYMA`, `AREQUIPA`); no case transformation. |
| **Cambiar distrito** | Focuses the «Distrito» select of `PeruDistrictSelect` through a wrapper `ref` in the checkout (`select[id$="-district"]`); department and province stay. `PeruDistrictSelect` does not change. |
| **Pasar a Entrega a domicilio** | Sets the mode to `home` through the same handler as the radio change (clears rate, agency and received quotation, keeps the district, requotes). Rendered only when the `home` radio exists. |
| Authority | The server still decides on confirm (`RATE_UNAVAILABLE`, `TOTAL_CHANGED`, `DELIVERY_METHOD_DISABLED`). The cascade never adds agencies the quotation did not return. |
| Logs | No new events: the cascade is ephemeral in the browser and the read reuses the logs of `quotationTransaction` and the loader. |
| Data dependency | Production has no agencies until task `6hpPJM53WPcwJvJ3`; until then `covered` is `false` and the radio does not appear. No intermediate state is added. |
| Interaction tests | Clearing on change, switch to home and recovery are verified in e2e; the pure functions and the static render cover the rest. No DOM testing library is added to core. |

## 3. Verified current state

| Piece | Location | State |
|---|---|---|
| Checkout options contract | `shared/contracts/order-checkout.ts` (`checkoutDeliveryOptionsSchema`, `CheckoutDeliveryOptions`) | `home.enabled`, `agency.enabled` (switch only) and `store`. Consumed only by core: `app/routes/checkout.tsx`, `app/components/checkout-delivery-fields.tsx` and `checkout-appearance/presentation/preview-fixtures.ts` (`previewDeliveryOptions`). Mobile does not import it. |
| Checkout loader | `apps/core/app/routes/checkout.tsx` (`loader`, line ~101) | For pending orders reads `deliverySettings.getForCompany` inside `withTenantIsolation`, builds `deliveryOptions` with `safeParse`, 503 on failure. |
| Loader tests | `apps/core/app/routes/checkout.test.ts` | Spies on `deliverySettings.getForCompany` (lines 33 and 122) and asserts `deliveryOptions`. |
| Full configuration read | `delivery-settings/infrastructure/delivery-zones-repository.ts` (`readDeliveryConfiguration`) | Reads settings, zones, options and associated agencies with `enabled` and `courierEnabled`. Without a settings row returns the initial configuration without zones. |
| Agency eligibility | `delivery-settings/domain/quotation.ts` (`eligibleAgencies`, private; `applicableDeliveryOptions`) | Associated, enabled, courier enabled in catalog and business. One rate per applicable option; agency rates require the switch. |
| Read transaction | `delivery-settings/composition.ts` (`quotationTransaction`) | Verifies the tenant and maps failures to `SERVICE_UNAVAILABLE`, logging `quotation_transaction_failed`. |
| Quotation | `requestDeliveryQuotation` (`delivery-settings/infrastructure/quotation-api.ts`); contract `shared/contracts/quotations.ts` | Each rate carries `id`, `optionId`, `name`, `zoneName`, `price`; agency rates carry `agencies[]` (min 1) with `id`, `name`, `address`, `courier { id, name }`, `location { districtCode, district, province, department }`. |
| Geography | `shared/peru-geography.ts` | `getPeruDistrict` and `peruDeliveryDistrict` give district, province and department names. The INEI code holds the province (4 digits) and department (2). Example codes: Cayma `040103`, Characato `040105`, Yanahuara `040126`, Yura `040128`, Mollendo `040701`, Callao `070101`, Miraflores `150122`. |
| Web delivery fields | `apps/core/app/components/checkout-delivery-fields.tsx` | Radios `keep`/`ship`/`store`; initial mode `keep`, else `ship` if home or agency on, else `store`, else `""`. In `ship`: `PeruDistrictSelect`, mixed «Tarifa de envío» dropdown and «Agencia de destino» with `agencyLabel`. Radio change clears `rateId`, `agencyId` and the received quotation, keeps `districtCode`. District change clears `rateId` and `agencyId`. A quotation counts only if it matches the visible district, `revision` and `recoveryVersion`. |
| Component tests | `apps/core/app/components/checkout-delivery-fields.test.tsx` | Static `renderToStaticMarkup` only (no DOM library in core). Two tests rely on the current preselection («unassigned delivery asks for a district…», «pickup-only businesses show the configured point…») and one asserts «Retiro en agencia». |
| Recovery | `apps/core/app/routes/checkout.tsx` (`recoveryVersion`) | After `RATE_UNAVAILABLE` or `TOTAL_CHANGED` bumps `recoveryVersion`; the component requotes keeping the draft. |
| Confirmation and snapshot | `ratedDeliverySelectionSchema` (`shared/contracts/orders`), `resolveSelectedDeliveryRate` | The agency variant requires `rateId`, `agencyId`, `districtCode`; revalidated under lock. Snapshot keeps destination, courier, agency with location and `pricing.optionId`. Unchanged. |
| Texts | `apps/core/app/locales.ts` (`checkoutDelivery`) | `ship: "Envío"`, `method.agency: "Retiro en agencia"` (es) and pt equivalents. |
| E2E agency fixtures | `delivery-settings/infrastructure/courier-catalog-fixture.ts` (`insertAgency`, `deleteAgencies`, `seededCatalogId`) | `insertAgency` takes `districtCode`, so specs can place agencies in Cayma, Yanahuara or Lima. |
| Buyer checkout e2e | `tests/e2e/checkout.spec.ts` (home tests at lines 307, 468, 524, 574, 634, 742 select a district with «Envío» preselected or check `input[value="ship"]`; agency test at 414 uses «Tarifa de envío»), `checkout-appearance-buyer.spec.ts` (test «keeps delivery quote and payment flows working», agency via «Tarifa de envío»), `delivery-settings.spec.ts` (overlapping zones test, buyer page reads «Tarifa de envío») | Must be migrated to the new radios. `buyer-payment.spec.ts`, `public-catalog.spec.ts` and `mobile-checkout.spec.ts` already check «Recojo en tienda · Gratis» explicitly. `agency-delivery.spec.ts`, `store-delivery.spec.ts` and `delivery-without-tariffs.spec.ts` exercise the seller order form and do not change. |

## 4. Gaps this design closes

1. The public contract does not say whether there is agency coverage (§5.1, §8).
2. Coverage cannot be computed without a district (§6).
3. The checkout mixes home and agency in one radio and one rate dropdown, and preselects a method (§5.4).
4. There is no cascade by agency location, no dedup by lowest price, no product order (§5.2).
5. There are no province or department notices, nor the no-agencies case with its two exits (§5.3).
6. The texts say «Envío» and «Retiro en agencia» (§12).

## 5. Use cases

### 5.1 `getCheckoutDeliveryOptions` (new, `delivery-settings`)

File `delivery-settings/application/get-checkout-delivery-options.ts`.

```ts
export type GetCheckoutDeliveryOptionsInput = Readonly<{ companyId: CompanyId }>;
export type CheckoutDeliveryOptionsView = Readonly<{ settings: DeliverySettings; agencyCovered: boolean }>;
export type GetCheckoutDeliveryOptionsDependencies = Readonly<{
  readConfigurationForShare: (companyId: CompanyId) => Promise<Result<DeliveryConfiguration, QuotationStorageError>>;
}>;
export async function getCheckoutDeliveryOptions(input: GetCheckoutDeliveryOptionsInput, deps: GetCheckoutDeliveryOptionsDependencies)
  : Promise<Result<CheckoutDeliveryOptionsView, QuotationStorageError>>;
```

- Access: the loader already authorized the link (`orders.getCheckout`) before calling; `companyId` comes from the verified link. No extra access object, like `getForCompany`.
- Flow: 1) read the configuration with shared lock; 2) return `settings` and `agencyCovered = hasAgencyCoverage(configuration)`.
- Errors: `SERVICE_UNAVAILABLE` (persistence, via `quotationTransaction`) and `INTERNAL_ERROR` (invalid stored data). The loader answers 503 for both, as today.
- Composition: `deliverySettings.getCheckoutDeliveryOptions(companyId)` = `quotationTransaction(companyId, () => getCheckoutDeliveryOptions({ companyId }, { readConfigurationForShare: id => readDeliveryConfiguration(id, "shared") }))`.
- `CheckoutDeliveryOptionsView` exists because the loader needs the settings plus a datum that is not stored configuration; `covered` is not added to `DeliverySettings`.

### 5.2 `agencyChoices`, `chosenAgency`, `buyerAgencyLabel` (new, web view rules)

Pure functions in `apps/core/app/checkout-agency-choices.ts`; not server use cases.

```ts
export type AgencyChoice = Readonly<{ agency: QuotedAgencyContract; rateId: string; optionName: string; price: Money }>;
export type AgencyChoiceLevel = "district" | "province" | "department";
export type AgencyChoices =
  | Readonly<{ level: AgencyChoiceLevel; choices: readonly [AgencyChoice, ...AgencyChoice[]] }>
  | Readonly<{ level: "none" }>;
export function agencyChoices(rates: readonly DeliveryRateContract[], districtCode: string): AgencyChoices;
export function chosenAgency(choices: AgencyChoices, agencyId: string): AgencyChoice | null;
export function buyerAgencyLabel(choice: AgencyChoice, amount: (price: Money) => string): string;
```

`agencyChoices`:

1. Keeps only rates with `method === "agency"`.
2. Flattens to one choice per rate–agency pair (`optionName = rate.name`).
3. Dedups by `agency.id`: lowest `price.amount` wins; on equal price the option `name` first alphabetically (`localeCompare`, locale `es`); then the lower `rate.id`, for determinism.
4. Filters by level with `agency.location.districtCode`: equal to the buyer's district; same first 4 digits (province); same first 2 (department). Returns the first non-empty level or `{ level: "none" }`. An agency outside the buyer's department never appears.
5. Orders inside the level by price ascending, agency name, courier name (`localeCompare` `es`), then `agency.id`.

`chosenAgency`: `level === "none"` → `null`; one choice → that choice; else the choice with `agency.id === agencyId` or `null`. After a requote the same `agencyId` returns the choice with its new price; if the agency is gone, `null`.

`buyerAgencyLabel`: «Agencia Cayma · Shalom · Av. Ejército 1020 · CAYMA, AREQUIPA · S/ 12.00», using `location.district` and `location.province` as received; price through `amount`, which returns «Gratis» for 0.

### 5.3 `CheckoutAgencyDestination` (new, presentational)

```ts
type CheckoutAgencyDestinationProps = Readonly<{
  choices: AgencyChoices; buyerDistrict: Readonly<{ district: string; province: string; department: string }>;
  value: string; onChange: (agencyId: string) => void; homeOffered: boolean;
  onChangeDistrict: () => void; onSwitchToHome: () => void; amount: (price: Money) => string; disabled?: boolean;
}>;
```

- `district`: dropdown «Agencia de destino» with «Selecciona una agencia» and `buyerAgencyLabel` entries, no notice.
- `province`: `role="status"` notice `agenciesInProvince` above the dropdown.
- `department`: `role="status"` notice `agenciesInDepartment` above the dropdown.
- `none`: `role="status"` message `noAgencies` with **Cambiar distrito** and, only if `homeOffered`, **Pasar a Entrega a domicilio**.
- `value` is the `chosenAgency` id (so a single choice renders selected).
- Uses the current `Field`, `FieldLabel`, `controlClass`, `Button` (`variant="outline"`) and the muted status style of `noRates`.

### 5.4 `CheckoutDeliveryFields` (modified)

- Radios in order: `keep` (if saved delivery), `home` (`method.home`, if `options.home.enabled`), `agency` (`method.agency`, if `options.agency.enabled && options.agency.covered`), `store` (`storeFree`). Initial mode `keep` with a saved delivery, else `""`. «No hay modalidades de entrega disponibles» when none.
- Radio change (and **Pasar a Entrega a domicilio**): clears `rateId`, `agencyId` and the received quotation; keeps `districtCode`; requotes if there is a district (current behavior).
- Department, province or district change: clears `rateId` and `agencyId` (current) and the quotation is requested again.
- Quotation: the same effect as today, active in `home` and `agency`. A late answer for another district, revision or recovery does not change the screen (current).
- `home`: «Tarifa de envío» lists only `method === "home"` rates, with `rateLabel` computed over those rates; without home rates, the current `noRates`/`noRatesOrStore`. Address and instructions as today.
- `agency`: no rate dropdown. With a successful quotation, `CheckoutAgencyDestination` with `agencyChoices(rates, districtCode)` and `peruDeliveryDistrict(districtCode)`. Loading and quotation error texts as today.
- Draft in `agency`: with `choice = chosenAgency(...)`, `{ method: "agency", rateId: choice.rateId, agencyId: choice.agency.id, districtCode, recipient }` with `price = choice.price` and mandatory document. Without a choice the draft is `null`: no confirm, never an implicit price. Document fields show in `agency` mode (today they depend on `rate?.method === "agency"`).
- Kept summary: unchanged structure («{method} · {charge}», «courier · agency · address»); the method name comes from `method.agency` = «Envío a agencia».

## 6. Domain and typing

| Type or function | Layer | Why |
|---|---|---|
| `hasAgencyCoverage(configuration: DeliveryConfiguration): boolean` | `delivery-settings` domain | Coverage business rule; reuses `eligibleAgencies`, private to the same file. Ignores the switch, which travels apart. |
| `CheckoutDeliveryOptionsView` | `delivery-settings` application | Joins stored settings with a derived datum; not mixed into `DeliverySettings`. |
| `AgencyChoice`, `AgencyChoices` | web (`app/`) | Buyer view as a union discriminated by level; `none` carries no empty list. Reuses `QuotedAgencyContract` and `DeliveryRateContract`, no mirror types. |
| `Draft.mode` | web | Literal union `"" \| "keep" \| "home" \| "agency" \| "store"`; replaces `"ship"`. |

| Layer | Types and authority |
|---|---|
| Domain (core) | Eligibility and coverage; quotation by the zone of the buyer's district. |
| Public contract | `covered: boolean`, Zod-validated in the loader before answering. |
| Web | Cascade, dedup, order and preselection; never decides final price or eligibility. |
| Confirmation (core) | Revalidates option and agency under lock; unchanged. |

## 7. Persistence

No schema, migration or data change. Coverage uses the existing `readDeliveryConfiguration` with shared lock. Old orders unchanged.

## 8. Contracts

`shared/contracts/order-checkout.ts`:

```ts
export const checkoutDeliveryOptionsSchema = z.strictObject({
  home: z.strictObject({ enabled: z.boolean() }),
  agency: z.strictObject({ enabled: z.boolean(), covered: z.boolean() }),
  store: storeDeliverySettingsSchema,
});
```

- The loader builds `{ home: settings.home, agency: { enabled: settings.agency.enabled, covered: agencyCovered }, store: settings.store }` and validates with `safeParse`; on failure 503 as today.
- Only core web consumes it; mobile does not import it, so it is not a cross-application contract change.
- Quotation (`shared/contracts/quotations.ts`) and confirmation (`confirmCheckoutDeliverySchema`, `ratedDeliverySelectionSchema`) do not change. Confirm codes unchanged: `RATE_UNAVAILABLE`, `TOTAL_CHANGED`, `DELIVERY_METHOD_DISABLED`.

## 11. Transactions and concurrency

1. `getCheckoutDeliveryOptions` runs in `quotationTransaction` within `withTenantIsolation(companyId)`, with a shared read of settings; it writes nothing.
2. Coverage is a snapshot at checkout load. If configuration changes later: a district without agency rates shows the no-agencies case; on confirm the server rejects with the current codes and the checkout requotes keeping the draft; on reload the radio reflects the new coverage.
3. A chosen agency may belong to another option besides the winner; the winner's `rateId` (lowest price) is always confirmed, and the server validates the agency is still associated with that option.

## 12. Code organization

| File | Change |
|---|---|
| `shared/contracts/order-checkout.ts` | `agency.covered` in `checkoutDeliveryOptionsSchema`. |
| `apps/core/src/features/delivery-settings/domain/quotation.ts` | Exports `hasAgencyCoverage`. |
| `apps/core/src/features/delivery-settings/application/get-checkout-delivery-options.ts` | New use case. |
| `apps/core/src/features/delivery-settings/composition.ts` | Exposes `getCheckoutDeliveryOptions`. |
| `apps/core/app/routes/checkout.tsx` | Loader uses `getCheckoutDeliveryOptions` and builds `agency.covered`. |
| `apps/core/src/features/checkout-appearance/presentation/preview-fixtures.ts` | `agency: { enabled: false, covered: false }`. |
| `apps/core/app/components/checkout-delivery-fields.test.tsx` | Fixture `options` gets `covered` (T1); new and rewritten tests (T3). |
| `apps/core/app/checkout-agency-choices.ts` | New: `agencyChoices`, `chosenAgency`, `buyerAgencyLabel`. |
| `apps/core/app/components/checkout-agency-destination.tsx` | New presentational component. |
| `apps/core/app/components/checkout-delivery-fields.tsx` | Radios per method, no preselection, filtered home rates, agency mode with `CheckoutAgencyDestination`, **Cambiar distrito** focus. |
| `apps/core/app/locales.ts` | New and changed texts in es and pt (below). |

Texts in `checkoutDelivery` (es; pt equivalent):

| Key | Text |
|---|---|
| `ship` | Removed. |
| `method.agency` | «Envío a agencia» (pt «Envio para agência») |
| `agenciesInProvince` (new) | «No hay agencias en {{district}}; te mostramos las de la provincia de {{province}}» |
| `agenciesInDepartment` (new) | «No hay agencias en {{district}} ni en la provincia de {{province}}; te mostramos las del departamento de {{department}}» |
| `noAgencies` (new) | «No hay agencias disponibles para envío a {{district}}.» |
| `changeDistrict` (new) | «Cambiar distrito» |
| `switchToHome` (new) | «Pasar a Entrega a domicilio» |

The seller form (`rated-delivery-form.tsx`), `app/rate-label.ts`, `PeruDistrictSelect`, quotation and confirmation do not change.

## 13. Observability

| Event | Level | Where | Fields |
|---|---|---|---|
| `quotation_transaction_failed` (existing) | error | `delivery-settings/composition.ts` | `["companyId", "err"]` |
| `delivery_zones_stored_data_invalid` (existing) | error | `delivery-zones-repository.ts` | `["companyId", "zoneId"]` |
| operation `get_checkout` (existing) | request context | `checkout.tsx` loader | `outcome` (`technical_failure` on 503) |

No event is added: the cascade happens in the browser and is not stored; confirmation already logs its rejections. Recipient data, documents, addresses and amounts are never logged.

## 14. Tests

### Unit (core, Vitest)

`apps/core/src/features/delivery-settings/domain/quotation.test.ts`:
- `test("agency coverage exists when an enabled zone has an enabled agency option with an eligible agency")`
- `test("agency coverage is absent when every agency option is disabled, in a disabled zone or has only disabled agencies or couriers")`
- `test("agency coverage is absent for a business with only home options or no zones")`

`apps/core/src/features/delivery-settings/application/get-checkout-delivery-options.test.ts`:
- `test("returns the stored settings with agency coverage computed from the configuration")`
- `test("propagates an unavailable configuration read without inventing coverage")`

`apps/core/src/features/orders/presentation/checkout-contracts.test.ts`:
- `test("checkout delivery options require an agency coverage flag and reject extra fields")`

`apps/core/app/routes/checkout.test.ts` (loader, use cases spied):
- `test("public loader exposes agency coverage only as a yes or no flag")`
- `test("public loader reports no agency coverage when the switch is on but no option has eligible agencies")`
- `test("failed coverage read answers 503 without manufacturing delivery options")`

`apps/core/app/checkout-agency-choices.test.ts`:
- `test("buyer in Cayma sees only the Cayma agencies, Olva at S/ 10.00 before Shalom at S/ 12.00, without Yanahuara")`
- `test("buyer in Characato falls back to the province agencies ordered by price and then agency name")`
- `test("buyer in Mollendo falls back to the department agencies located in Arequipa province")`
- `test("returns no agencies when the only quoted agency is outside the buyer department")`
- `test("a buyer in Callao never sees agencies located in Lima province")`
- `test("returns no agencies when the quotation of the district has only home rates")`
- `test("never adds agencies that the quotation did not return")`
- `test("an agency in two options appears once with the cheaper option rate and price")`
- `test("an agency in two options with equal price keeps the option whose name sorts first")`
- `test("orders agencies within a level by price, then agency name, then courier name")`
- `test("a single agency is chosen without a buyer selection")`
- `test("a chosen agency missing from the requoted list leaves no choice")`
- `test("a chosen agency keeps the buyer choice with the requoted price")`
- `test("buyer label shows agency, courier, address, district, province and price, with zero as free")`

`apps/core/app/components/checkout-agency-destination.test.tsx` (static render):
- `test("district level shows the destination agency list without a notice")`
- `test("province level shows the province notice above the list with catalog names")`
- `test("department level shows the department notice naming district, province and department")`
- `test("no agencies offers Cambiar distrito and Pasar a Entrega a domicilio only when home is offered")`
- `test("a single agency renders selected")`

`apps/core/app/components/checkout-delivery-fields.test.tsx` (static render):
- `test("a buyer without saved delivery sees Entrega a domicilio, Envío a agencia and Recojo en tienda with none selected")` (rewrites «unassigned delivery asks for a district and recipient…»)
- `test("hides Envío a agencia when the agency switch is off or the business has no agency coverage")`
- `test("pickup-only businesses offer the configured point without preselecting it")` (rewrites «pickup-only businesses show the configured point…»)
- `test("a saved agency delivery is summarized as Envío a agencia with courier, agency and address")` (rewrites «a saved agency delivery shows its courier…»)
- Existing «historical delivery…», «pickup is offered explicitly…» and «businesses without available delivery methods…» stay, with `value="ship"` assertions moved to `home`/`agency`.

### Integration (core, real database)

`apps/core/src/features/delivery-settings/infrastructure/delivery-zones-repository.integration.test.ts`:
- `test("checkout delivery options read real zones and report coverage lost when the only agency courier is disabled for the company")`

Agency confirmation and its snapshot are already covered (`resolve-selected-delivery-rate.test.ts`, `order-repository.integration.test.ts`) and do not change.

### E2E web (Playwright through Vitest)

`apps/core/tests/e2e/checkout.spec.ts` (agencies placed with `insertAgency` in Cayma `040103`, Yanahuara `040126` and Lima `150122`):
- `test("buyer in Cayma chooses Envío a agencia, picks the cheaper Cayma agency and reaches payment with courier and agency in the snapshot")` (replaces «buyer chooses an agency rate and its catalog agency…»)
- `test("buyer moves from Cayma to Characato, sees the province agencies and switches to home delivery keeping the district")`
- `test("buyer without agencies in the department switches to home delivery from the no-agencies message")`
- `test("buyer picks another agency after the seller disables the chosen one before confirming")`
- `test("mobile buyer at 390 px confirms Envío a agencia with a province agency")`

Migrated to the new radios and kept green: in `checkout.spec.ts` the home tests at lines 307, 468, 524, 574, 634 and 742 (check «Entrega a domicilio» before the district; `input[value="ship"]` → `home`), «keeps delivery quote and payment flows working» in `checkout-appearance-buyer.spec.ts` (agency through «Envío a agencia» and «Agencia de destino»), and «seller manages overlapping zones…» in `delivery-settings.spec.ts` (buyer checks «Entrega a domicilio»). `buyer-payment.spec.ts`, `public-catalog.spec.ts`, `mobile-checkout.spec.ts`, `agency-delivery.spec.ts` and `store-delivery.spec.ts` stay green without changes.

### Traceability

| Product criterion / case | Function or use case | Tests | Task |
|---|---|---|---|
| 1 three radios, none selected | `CheckoutDeliveryFields` radios, initial mode | «a buyer without saved delivery sees…» | T3 |
| 2 agency hidden without switch or coverage | `hasAgencyCoverage`, `getCheckoutDeliveryOptions`, loader, radios | quotation coverage tests, use case tests, loader tests, repository integration, «hides Envío a agencia…» | T1, T3 |
| 3 Cayma: two agencies, Olva first, no notice | `agencyChoices`, `buyerAgencyLabel`, `CheckoutAgencyDestination` | «buyer in Cayma sees only…», «district level…», «buyer label…», e2e Cayma | T2, T3 |
| 4 Characato: province notice, three agencies | `agencyChoices` | «buyer in Characato falls back…», «province level…», e2e Cayma → Characato, e2e 390 px | T2, T3 |
| 5 Mollendo: department notice | `agencyChoices` | «buyer in Mollendo…», «department level…» | T2, T3 |
| 6 Mollendo with only a Lima agency: no-agencies, exits by home | `agencyChoices`, `CheckoutAgencyDestination` | «returns no agencies when the only quoted agency is outside…», «no agencies offers…», e2e no-agencies | T2, T3 |
| 7 Yura covered only by home zone | quotation per zone (unchanged), `agencyChoices` | «returns no agencies when the quotation of the district has only home rates» | T2 |
| 8 agency in two options once at lowest price | `agencyChoices` dedup | «an agency in two options appears once…», «…equal price keeps…» | T2 |
| 9 disabled or unassociated agencies never shown | `eligibleAgencies` (unchanged), `agencyChoices` | existing quotation eligibility tests, «never adds agencies…», coverage tests | T1, T2 |
| 10 single agency preselected, total includes it | `chosenAgency`, draft price | «a single agency is chosen…», «a single agency renders selected» | T2, T3 |
| 11 confirm Olva in Cayma, snapshot | draft from `chosenAgency`, current confirmation | e2e Cayma | T3 |
| 12 district change clears and shows province notice | district change handler | e2e Cayma → Characato | T3 |
| 13 switch to home keeps district, home rates only | radio change handler, home filter | e2e Cayma → Characato → home | T3 |
| 14 **Pasar a Entrega a domicilio** | same handler as radio change | e2e no-agencies | T3 |
| 15 chosen agency disabled before confirm | `recoveryVersion` (unchanged), `chosenAgency` | «a chosen agency missing from the requoted list…», e2e disabled agency | T2, T3 |
| 16 price changed before confirm | `recoveryVersion` (unchanged), `chosenAgency` | «a chosen agency keeps the buyer choice with the requoted price», existing e2e «buyer selects a district rate, preserves the form on price conflict…» | T2, T3 |
| 17 home lists only home rates; agency has no rate dropdown | home filter, agency mode | e2e Cayma (no «Tarifa de envío»), e2e Characato → home | T3 |
| 18 saved agency delivery kept as «Envío a agencia» | kept summary, `method.agency` | «a saved agency delivery is summarized…», migrated e2e at line 742 (switch from keep) | T3 |
| 19 store and keep as today | unchanged | existing unit and e2e (380, 709, 742, buyer-payment, public-catalog) | T3 |
| 20 390 px and 1280 px | current components | e2e 390 px; the rest of the e2e at the default desktop viewport | T3 |
| Agency in Callao vs Lima province | `agencyChoices` department filter | «a buyer in Callao never sees…» | T2 |
| Agency delivery turned off during checkout | server `DELIVERY_METHOD_DISABLED` (unchanged) | existing `resolve-selected-delivery-rate.test.ts` | — |
| Quotation did not load | current retry | existing e2e «buyer waits for a district and recovers a failed quotation…» (migrated) | T3 |
| Confirmation without response | unchanged | existing e2e «failed network requests recover…» | T3 |
| Coverage gone between load and quote | `agencyChoices` `none` | «returns no agencies when the quotation of the district has only home rates» | T2 |
| Leaves and comes back | unchanged (draft not stored) | existing unit «historical delivery…» | — |

### Pending manual checks

- Local: insert test agencies in Cayma, Yanahuara and Lima (as `apps/core/prisma/catalog/agencies-example.sql`, changing `districtCode`), build the product example zone, turn on «Envío a agencia», and walk at 390 px and 1280 px: Cayma, Characato, a district without zone, district change, method change and an agency disabled before confirming. Check order detail and label.
- Real phone verification inside task `6hpPJM2RjMP4FmwV`.

## 15. Limits and checks during implementation

- Coverage does not guarantee agencies for a given district; that case is the no-agencies screen by product design.
- The cascade uses the agency's `location.districtCode`; it is mandatory in `quotedAgencySchema`.
- **Cambiar distrito** focuses the «Distrito» select; if it is disabled (no province), it focuses «Departamento».
- Existing e2e that rely on «Envío», on `input[value="ship"]` or on the preselected method are migrated in the same task that changes the UI, so the branch never stays red.
- No proximity catalog, maps or geolocation. No seller or mobile changes.
