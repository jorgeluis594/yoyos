# Checkout location limited to delivery coverage: technical design

**Status:** design closed, pending implementation. The architecture review gate approved it in round 3: in round 1 the design review rejected it and the performance review approved it, in round 2 both rejected it, and in round 3 both approved it. Based on [checkout-cobertura-ubicacion.md](checkout-cobertura-ubicacion.md). Base: `jorgeluis594/checkout-mostrar-solo-departamentos-prov` at `50ad605a`.

## 1. Technical goal

The checkout loader already reads the company's delivery configuration through `getCheckoutDeliveryOptions`. After this change, that use case also computes the places each method covers:

- **Home:** the enabled zones that have an enabled home option.
- **Agency:** the enabled zones that have an enabled agency option, restricted to the departments where that option has an eligible agency.

The contract sends each set of places as a compact area selection: a whole department or a whole province travels as one code and is never expanded into districts. The web checkout lists only those places in its location fields, hides a method that covers nothing, preselects levels that have a single choice and shows the location notice. The seller's coverage warning on web and mobile uses the same pure rule from `shared/`, with the same agency eligibility. The server's quotation and confirmation do not change.

```text
DeliveryConfiguration ──(core: folds catalog states)──► eligibleCoverageAgencies ─► deliveryCoverage (shared, pure) ─► { home, agency }: PeruAreaSelection | null
DeliveryZonesResponse ──(web / mobile: agency.enabled already folded)──┘                       │
        │                                                                                       ▼
        ▼                                                   checkoutDeliveryOptionsSchema { home, agency: offered + places }
coverageWarnings(zonesCoverage(...), switches)                                                  │
                                                                       PeruLocationFields(places) + checkout notice (web)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Single coverage rule | `shared/delivery-coverage.ts` holds two pure functions: `eligibleCoverageAgencies`, which applies the eligibility check (enabled agency, enabled company courier), and `deliveryCoverage`, which applies the zone and option rule with the department bound. Core, the web settings and the mobile settings all call both. Each one prepares the same input (§6), so coverage has one meaning everywhere. |
| Catalog courier state for the seller | The zones response folds the catalog courier's state into `agencies[].enabled` (`agency.enabled && agency.courierEnabled`). The shape of `deliveryZonesSchema` does not change, so mobile parses it as it does today. An agency whose courier was retired from the catalog appears as inactive in the zone editor, which is accurate: it can no longer be used. The company courier's `catalogEnabled` is the same catalog row as the agency's `courierEnabled`, so folding it into the agency is enough for the clients. Core still checks both. |
| Department bound | Each zone counts once per method. For agency, the zone's entries are kept only if they belong to the departments of the eligible agencies across all of that zone's qualifying agency options. The geometry lives in the country module, `shared/peru-geography.ts`. The coverage helper contains no country rule. |
| Cost of `deliveryCoverage` | `deliveryCoverage` is linear in the total number of codes the zones contain. It never folds pairs of areas. It collects loose codes per method into sets and canonicalizes once at the end with `canonicalPeruArea` (§6). Parents are derived from the code prefix with an index built when the module loads, so nothing iterates the 1,892 catalog districts per entry. |
| Budget and how it is measured | Initial value, adjustable: 10 ms in Node, with an expected cost of about 1 ms. The T0 test uses the adversarial shape: 1,892 zones of one loose district each, every one with two enabled home options and one enabled agency option with eligible agencies, plus the offered lists over the result. It warms up once, runs 5 times, and asserts the **minimum** of those runs against the budget. Taking the minimum removes noise from the JIT, GC pauses and busy runners. A quadratic regression costs tens of ms in every run, so this test still catches it. On Hermes (mobile settings) the function runs once per zones load, thanks to the memo described in §5.2, so the Node budget is enough there too. |
| Lock | `checkoutCoverage` runs inside `quotationTransaction`, after the `FOR SHARE` read, as the use case's closure does today. Its cost is linear and bounded by the budget above, so it does not extend the lock noticeably, and the use case keeps its shape. |
| Contract shape | `checkoutDeliveryOptionsSchema.home` and `.agency` become `{ offered: false } \| { offered: true; places }`. The `enabled` and `covered` fields are removed. The contract changes in place, with no version (memory: no production). |
| `places` schema | `places` is `peruAreaSelectionSchema`, a new schema in `shared/contracts/peru-location.ts`. It reuses the code schemas, which move there from `delivery-settings.ts`, and caps each array at `.max(25)`, `.max(196)` and `.max(1892)`. A `transform` with `parsePeruAreaSelection` rejects codes outside the catalog, an empty selection and non-canonical entries (an entry inside a whole parent), and returns the branded `PeruAreaSelection`. The client never needs `as`. |
| Payload | Canonical codes only. All of Peru is 25 department codes. The worst case is about 17 KB **per method** when a method covers all 1,892 districts as loose codes, which is at most about 34 KB in the theoretical case where both do. The gate measured about 19 KB with both methods offered, because the department filter bounds agency. It is sent compressed, once per load. |
| Switches | `deliveryCoverage` ignores the method switches. The core domain function `checkoutCoverage` returns `null` for a method whose switch is off. The seller warning applies `state[method].enabled && …`. |
| Server | `applicableDeliveryOptions`, `createQuotation`, `resolveSelectedDeliveryRate` and the confirmation do not change. `hasAgencyCoverage` is removed, because its only caller was `getCheckoutDeliveryOptions`. |
| Location control | A controlled `PeruLocationFields` is extracted in the same file as `PeruDistrictSelect`. It receives `value: PeruArea \| null`, `places` and `texts`. `PeruDistrictSelect` keeps its API and full-country behavior, so the seller forms do not change. The control knows nothing about zones, methods or rates. |
| Meeting contract with the decoupling tasks | Tasks 6hqc452cgxP3RF83 and 6hhgPHPcVvfJH253 must keep: the `places` and `texts` props of the location control, and the signatures of `deliveryCoverage` and `eligibleCoverageAgencies`, whose places today are `PeruAreaSelection`. Generalizing that type to a country-agnostic area is their job. This task does not anticipate it. |
| Location state in the checkout | The form keeps `location: PeruArea \| null`, the deepest level chosen, in place of `districtCode`. The district is derived from it. The department and province survive a switch to store pickup or to keeping the saved delivery. |
| Initial location (SSR) | The initial location is computed once, with a lazy `useState` initializer that calls `enterLocationMethod`. That value goes into the form's default values. It is not computed inline in `defaultValues`, which are evaluated on every render. The server HTML shows the fields already filled. The form stays disabled until hydration (`useClientReady`), so the person cannot interact with stale fields. |
| Announcements: notice, then quotation | There are two live regions, the notice and the quotation status «Consultando opciones de envío…». Both are `role="status"` and always mounted, and both are empty in the server HTML. Each region is a box without padding, and its text goes in a child that is inserted inside it. So the region exists before its text, and while empty it takes no space. Each region's text has its own source and its own update: (1) The notice text is shown only once `ready` is true, so the commit in which the form becomes interactive is the one that fills the initial notice. Later on, the handler that causes a location event fills it. (2) The quotation status text is no longer derived from the district in render. It comes from an `inFlight` state that the quotation effect sets when it starts the request and clears when the response arrives. The effect requires `ready`, so it never runs in SSR. Effects run after the commit that triggered them, so the loading text always appears in an update after the notice's. This holds on load (criterion 3) and on every later pick or switch. Both are announced, in that order (criterion 23). |
| Method switch | One handler writes `mode`, `location`, `notice` and the clearing of rate, agency and quotation, in a single update. The quotation effect therefore never fires with the new method and the old uncovered district. A switch makes one quotation request for the resulting district, or none if no district remains. |
| Upper-level choice | Preselection runs in the handler only when the control reports `level` as `department` or `province`, `next.kind === level`, and the code differs from the one the location had at that level. A clear (which reports the parent or `null`) and choosing the same value do not trigger it. |
| Measurement | An info log, `buyer_quotation_created` (Q1 decided by the gate: option 1). It is written only for buyer quotations, and the origin travels in `response.locals.quotationOrigin`. The buyer's request adds an optional `trigger: "picked" \| "automatic"` field to `createQuotationRequestSchema`, which the log records. `picked` is used only for the quotation that directly follows the person choosing a district in the control. Every other quotation is `automatic`: preselection, a covered district kept when switching methods, the saved delivery's district when entering home or agency, and a quotation the page repeats on its own. **Reintentar tarifas** repeats the `trigger` of the request that failed. The goal is read only over `picked`, so quotations of districts that are covered by construction do not bias it. The server applies no rule based on `trigger`. |
| Failed loader projection | If the `safeParse` of the checkout contract fails, the loader logs `checkout_delivery_options_invalid` at error level with the field and the issue code (§13). The page then shows its load error, as it does today. |
| Seller order forms | Unchanged on web and mobile: full country. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| `getCheckoutDeliveryOptions` | `apps/core/src/features/delivery-settings/application/get-checkout-delivery-options.ts` | Reads `DeliveryConfiguration` with `FOR SHARE` inside `quotationTransaction` (`composition.ts:47`). Returns `{ settings, agencyCovered }`. Modified. |
| `hasAgencyCoverage`, `eligibleAgencies` | `apps/core/src/features/delivery-settings/domain/quotation.ts:99-111` | Coverage without a department bound. Eligibility checks `agency.enabled && agency.courierEnabled && courier.enabled && courier.catalogEnabled`. The first is replaced; the second keeps working for the quotation. |
| `DeliveryAgency.courierEnabled` | `domain/delivery-agency.ts`, filled in `infrastructure/agency-catalog-repository.ts:15` from the catalog courier | Reused. |
| `zoneCoversDistrict`, `DeliveryZone` | `domain/delivery-zone.ts` | A zone is a `PeruAreaSelection`. Reused. |
| Geography helpers | `shared/peru-geography.ts` | `PeruAreaSelection`, `PeruArea`, `parsePeruAreaSelection`, `peruAreaIncludes`, `selectPeruArea`. `selectPeruArea` and `peruAreaDistricts` are linear per call and are not reused in the new operations. Extended. |
| Checkout options contract | `shared/contracts/order-checkout.ts` (`checkoutDeliveryOptionsSchema`) | `home: { enabled }`, `agency: { enabled, covered }`, `store`. Only core web consumes it. Modified. |
| Location code schemas | `shared/contracts/delivery-settings.ts:55-57` (private), `shared/contracts/peru-location.ts` (`peruDistrictCodeSchema`) | Duplicated. They are unified in `peru-location.ts`. |
| Checkout loader | `apps/core/app/routes/checkout.tsx:119-130` | Builds the contract from `settings` and `agencyCovered`. Modified. |
| Checkout delivery fields | `apps/core/app/components/checkout-delivery-fields.tsx` | Initial method with `home.enabled` first. `changeMode` keeps `districtCode`. «Pasar a Entrega a domicilio» uses `homeEnabled`. Text `checkoutDelivery.noModes`. Modified. |
| Location control | `apps/core/app/components/peru-district-select.tsx` | Whole country. Department and province live in internal `useState`. Hint `peruDistrict.help`, empty text `peruDistrict.noResults`. Modified (extraction). |
| Texts | `apps/core/app/locales.ts` | es and pt. Modified. |
| Preview and stories | `apps/core/src/features/store-appearance/presentation/preview-fixtures.ts`, `checkout-pages.stories.tsx` | Build `CheckoutDeliveryOptions` by hand. Adapted. |
| Quotation status | `checkout-delivery-fields.tsx:106` (`{draft.districtCode && !current && <p role="status">…}`) | It mounts the region together with its text and is not gated by hydration. Modified (§2 Announcements). |
| Quotation request | `shared/contracts/quotations.ts` (`createQuotationRequestSchema`, `strictObject`); web sends it from `delivery-settings/infrastructure/quotation-api.ts`, mobile from its `quotation-api.ts` without `orderId` | Gains the optional `trigger` field. Mobile does not send it. |
| Unchanged agency cascade | `apps/core/app/components/checkout-agency-destination.test.tsx:40` («No hay agencias en CHARACATO ni en la provincia de AREQUIPA; te mostramos las del departamento de AREQUIPA») | Keeps criterion 7's cascade. Unchanged and must stay green. |
| Tests on the old shape | `apps/core/app/components/checkout-delivery-fields.test.tsx` (lines 18, 51, 60, 67, 82: `agency: { enabled, covered }`), `apps/core/app/routes/checkout.test.ts`, `apps/core/src/features/orders/presentation/checkout-contracts.test.ts:67-70`, `apps/core/src/features/orders/presentation/api-routes.integration.test.ts:901`, `delivery-zones-repository.integration.test.ts:290-292`, `quotation.test.ts:147-162`, `get-checkout-delivery-options.test.ts` | Adapted. |
| Zones response | `apps/core/src/features/delivery-settings/presentation/zones-response.ts` | `agencies[].enabled = agency.enabled` (drops `courierEnabled`). Modified. |
| Web seller warning | `apps/core/app/components/delivery-zones-section.tsx:68-74`, used in `apps/core/app/routes/delivery-settings.tsx:115-118` | Calls `lacksCoverage` once per method in each render. No department bound, and no catalog courier. Modified. |
| Mobile seller warning | `apps/mobile/src/features/delivery-settings/presentation/delivery-zones-section.tsx:45-55`, used in `delivery-settings-screen.tsx:92-93` | Same as web. Modified. |
| Buyer quotation route | `apps/core/src/features/delivery-settings/presentation/quotation-routes.ts` | Three handlers. The order-link branch is the second one. No success log. Modified. |
| Checkout E2E | `apps/core/tests/e2e/checkout.spec.ts:655-665` («No hay agencias disponibles para envío a MOLLENDO»), `:773` (home district 040110 without a rate) | They reach dead ends by picking in the UI, which will no longer be possible. Moved (§14). |

## 4. Gaps this design closes

1. Places covered per method are not computed, and agency coverage has no department bound (§5.1, §6).
2. The checkout contract does not carry places, and home has no coverage condition (§8).
3. The seller clients do not know whether an agency's catalog courier is enabled, and their warning follows a different rule (§5.2, §8).
4. The location control cannot be restricted and does not keep department or province outside itself (§12).
5. There is no preselection, no location notice, no group hint and no checkout empty-search texts (§12).
6. The product goal has no measurement (§13).

## 5. Use cases

### 5.1 `getCheckoutDeliveryOptions` (modified, feature `delivery-settings`)

- `input`: `{ companyId: CompanyId }`. `access`: the order link resolved by the loader. Both unchanged.
- `deps`: `readConfigurationForShare(companyId): Promise<Result<DeliveryConfiguration, QuotationStorageError>>`. Unchanged.
- Output: `CheckoutDeliveryOptionsView = Readonly<{ settings: DeliverySettings; coverage: DeliveryCoverage }>`.
- Errors: `QuotationStorageError`.
- Flow:
  1. Read the configuration (`FOR SHARE`, inside `quotationTransaction`).
  2. `coverage = checkoutCoverage(configuration)`, which is bounded (§2).
  3. Return.

### 5.2 Seller warning (modified, web and mobile presentation)

`lacksCoverage(method, state, couriers)` is replaced by two functions per platform:

```ts
/** Coverage of the saved zones; ignores the switches, so it only changes when zones, agencies or couriers change. */
export const zonesCoverage = (zones: DeliveryZonesResponse["zones"], agencies: DeliveryZonesResponse["agencies"], couriers: readonly Courier[]): DeliveryCoverage
export const coverageWarnings = (coverage: DeliveryCoverage | null, switches: Readonly<{ home: boolean; agency: boolean }>): Readonly<{ home: boolean; agency: boolean }>
```

1. `zonesCoverage`:
   - `eligible = eligibleCoverageAgencies(agencies.map(a => ({ id: a.id, courierId: a.courierId, enabled: a.enabled, districtCode: a.location.districtCode })), couriers.filter(c => c.enabled).map(c => c.courierId))`.
   - It returns `deliveryCoverage({ zones, agencies: eligible })`.
2. `coverageWarnings`: with `coverage === null` (zones not loaded) there is no warning, as today. Otherwise it returns `{ home: switches.home && coverage.home === null, agency: switches.agency && coverage.agency === null }`.

Each platform exports a `useZonesCoverage(zones, agencies, couriers)` hook (in its `delivery-zones-section.tsx`), which wraps `zonesCoverage` in `useMemo` and returns `null` while the data is missing. The tests observe the memo through the identity of the returned object. The screens call it on stable inputs, never on the `zonesState` that is rebuilt on every render:

- Web (`delivery-settings.tsx`): `useMemo(() => …, [zonesBase, settings.couriers])`.
- Mobile (`delivery-settings-screen.tsx`): the equivalent inputs, the zones response data and `settings.couriers`. The hook goes **before** any early return (`state.status !== "ready"`, `!settings`), and takes `null` as long as the data is missing.

`state[method].enabled &&` is applied outside the memo, so keystrokes and the optimistic render of a toggle do not recompute coverage. A confirmed save (a toggle or the pickup) replaces `settings` with the server response, so `settings.couriers` changes identity and coverage is recomputed once per save. That is accepted: it costs about 0.5 ms in the worst case, and no deep comparison is introduced. `hasEligibleAgency` stays because the zone editor uses it to label options. With the folded `enabled`, it now also flags an option whose catalog courier was retired.

### 5.3 Zones response (modified)

`parseDeliveryZonesResponse` sends `enabled: agency.enabled && agency.courierEnabled` for each agency. It does not change the use case: it is a projection.

There are no other new use cases. Choosing a place is local, and the quotation and confirmation do not change.

## 6. Domain and typing

New shared types and functions (`shared/delivery-coverage.ts`):

```ts
/** Zone as core, web and mobile already have it; the contract shape is enough. */
export type CoverageZone = Readonly<{
  enabled: boolean; departmentCodes: readonly string[]; provinceCodes: readonly string[]; districtCodes: readonly string[];
  options: readonly (Readonly<{ enabled: boolean; method: "home" }> | Readonly<{ enabled: boolean; method: "agency"; agencyIds: readonly string[] }>)[];
}>;
/** Agency as each caller has it, with every catalog state already folded into `enabled`. */
export type CoverageAgencyInput = Readonly<{ id: string; courierId: string; enabled: boolean; districtCode: string }>;
export type CoverageAgency = Readonly<{ id: string; districtCode: string }>;
export type DeliveryCoverage = Readonly<{ home: PeruAreaSelection | null; agency: PeruAreaSelection | null }>;
/** The only eligibility rule for coverage: enabled agency (catalog agency and catalog courier) and enabled company courier. */
export function eligibleCoverageAgencies(agencies: readonly CoverageAgencyInput[], enabledCourierIds: readonly string[]): readonly CoverageAgency[];
export function deliveryCoverage(input: Readonly<{ zones: readonly CoverageZone[]; agencies: readonly CoverageAgency[] }>): DeliveryCoverage;
```

- `CoverageZone`: the core `DeliveryZone` (branded codes, `Money`) and the contract zone differ. This structural shape is what they have in common, so neither side converts.
- `CoverageAgencyInput` and `CoverageAgency`: core and the contract model agencies with different fields. These shapes carry only what eligibility and the department bound need.
- `DeliveryCoverage`: `null` means the method covers no place. It is never an empty selection, which `parsePeruAreaSelection` rejects.

Callers' input to `eligibleCoverageAgencies`:

| Caller | `enabled` of the agency | `enabledCourierIds` |
| --- | --- | --- |
| core `checkoutCoverage` | `agency.enabled && agency.courierEnabled` | `catalogId` of the couriers with `enabled && catalogEnabled` |
| web and mobile `coverageWarnings` | `agencies[].enabled` from the zones response (already folded, §5.3) | `courierId` of `settings.couriers` with `enabled` |

`deliveryCoverage` algorithm (this is the decision). It is linear in the total number of codes of the zones plus the agencies:

1. `eligible = Map(agency.id → departmentCode)` over `agencies`, with the department from `peruDepartmentOfDistrict` (unknown codes are skipped).
2. Two collectors of loose codes, `home` and `agency`, each with three `Set<string>` (departments, provinces, districts).
3. For each enabled zone:
   - If it has **some** enabled home option, its codes are added to `home` once.
   - `departments` = the union of `eligible.get(id)` over the `agencyIds` of **all** its enabled agency options. If it is not empty, `peruCodesWithinDepartments(zone, departments)` is added to `agency` once.
4. `home = canonicalPeruArea(home)` and `agency = canonicalPeruArea(agency)`. An empty result becomes `null`.

Zones never merge pairwise. A zone with several options counts once per method, and canonicalization runs once per method.

New functions in the country module (`shared/peru-geography.ts`). All of them are pure and linear in the codes they receive. Parents come from the code prefix, using indexes by department and by province that are built once when the module loads. They take loose codes (`readonly string[]` or `Set<string>`) and ignore codes outside the catalog. The functions that receive a `PeruAreaSelection` (offered lists, `keepCoveredPeruPlace`, `settlePeruLocation`) never look codes up with `Array.includes`. They turn the area's arrays into sets once per area object, cached in a module `WeakMap` keyed by the area, so each check is O(1). That also holds in event handlers, which are not memoized. Only `canonicalPeruArea` produces the branded type, so no caller needs `as` and none has to parse whole zones.

| Function | Contract |
| --- | --- |
| `LoosePeruCodes` | `Readonly<{ departmentCodes: Iterable<string>; provinceCodes: Iterable<string>; districtCodes: Iterable<string> }>`. A `CoverageZone` and a contract zone satisfy it without conversion. |
| `peruDepartmentOfDistrict(code): PeruDepartmentCode \| null` | The district's department, or `null` if the district is not in the catalog. |
| `peruCodesWithinDepartments(codes: LoosePeruCodes, departments: ReadonlySet<string>): LoosePeruCodes` | Keeps the entries whose department is in `departments`. Intersecting a zone with whole departments is exactly this filter. |
| `canonicalPeruArea(codes: LoosePeruCodes): PeruAreaSelection` | Drops unknown codes and duplicates. Removes a province whose whole department is present, and a district whose department or province is present. Returns the branded type in canonical form. |
| `offeredPeruDepartments(area)`, `offeredPeruProvinces(area, departmentCode)`, `offeredPeruDistricts(area, provinceCode)` | Catalog lists in catalog order, limited to `area`. A whole department lists all its provinces and districts. |
| `keepCoveredPeruPlace(area, place: PeruArea): PeruArea \| null` | Walks up from `place` (itself, then each parent) and returns the first one `area` covers. A place is covered when it is a covered district, or a department or province with at least one covered district. Returns `null` when none is covered. |
| `isCompletePeruLocation(place: PeruArea): boolean` | True when `place` is at the last level of the hierarchy (district). |
| `settlePeruLocation(area, location: PeruArea \| null): Readonly<{ location: PeruArea \| null; filled: "none" \| "partial" \| "complete" }>` | Below the deepest level already set, it fills each level that has exactly one offered choice, top-down, and stops at the first level with several choices. `filled` is `complete` when it reaches the last level of the hierarchy, `partial` when it filled something short of that, and `none` when it filled nothing. |

Because of this, the order of the levels («Departamento → Provincia → Distrito») lives only in the country module, and the checkout module never names it. The location stays a `PeruArea` (the deepest level chosen), because the codes already contain their parents. No location type is created.

Core domain (`quotation.ts`):

```ts
/** Places each method offers the buyer: enabled switch plus department-bounded coverage. */
export function checkoutCoverage(configuration: DeliveryConfiguration): DeliveryCoverage
```

It prepares the input from the table above, calls `eligibleCoverageAgencies` and `deliveryCoverage`, and returns `null` for a method whose switch is off. `hasAgencyCoverage` is removed. `eligibleAgencies` (quotation) does not change.

Web checkout (`apps/core/app/components/checkout-location.ts`). It does not know the order of the levels: it uses the country functions.

```ts
export type LocationNotice =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "preselected" }>
  | Readonly<{ kind: "cleared"; place: PeruArea; filled: "none" | "partial" | "complete" }>;
export type LocationStep = Readonly<{ location: PeruArea | null; notice: LocationNotice }>;
/** The fields appear (load, or entering home or agency from another method) with the form's last location. */
export function enterLocationMethod(places: PeruAreaSelection, current: PeruArea | null): LocationStep;
/** An upper level got a new value; the levels below were cleared by the control. */
export function chooseUpperLevel(places: PeruAreaSelection, next: PeruArea): LocationStep;
```

`enterLocationMethod`, evaluated per level as the product requires:

1. **Kept level:** `kept = current && keepCoveredPeruPlace(places, current)`. Example: `province Canta` uncovered, with department Lima covered, keeps `department Lima`.
2. **Cleared place:** if `isCompletePeruLocation(current)` and `kept` is not `current`, the notice is `cleared` with `place: current`.
3. **Preselection:** `settlePeruLocation(places, kept)`. In the cleared case, `filled` goes into the notice: `complete` gives «…Completamos los campos que tienen una sola opción.», `partial` gives «…; elige tu distrito.», and `none` gives «… Elige otro distrito.».
4. **Without a cleared place:** the notice is `preselected` if `filled !== "none"`, and `none` otherwise. A covered district stays with the notice `none`.

`chooseUpperLevel` runs `settlePeruLocation` and returns `preselected` or `none`.

## 8. Contracts between applications

`shared/contracts/peru-location.ts` (extended):

```ts
export const peruDepartmentCodeSchema = z.string().regex(/^\d{2}$/);
export const peruProvinceCodeSchema = z.string().regex(/^\d{4}$/);
export const peruDistrictCodeSchema = z.string().regex(/^\d{6}$/); // exists
/** Canonical catalog selection; the caps are the catalog's size. */
export const peruAreaSelectionSchema = z.strictObject({
  departmentCodes: z.array(peruDepartmentCodeSchema).max(25), provinceCodes: z.array(peruProvinceCodeSchema).max(196),
  districtCodes: z.array(peruDistrictCodeSchema).max(1892),
}).transform((value, context) => { /* parsePeruAreaSelection(value): issue on failure, otherwise the branded PeruAreaSelection */ });
```

`shared/contracts/delivery-settings.ts` imports the three code schemas from `peru-location.ts` instead of declaring them. The zone shape does not change.

`shared/contracts/order-checkout.ts`:

```ts
const checkoutLocationMethodSchema = z.discriminatedUnion("offered", [
  z.strictObject({ offered: z.literal(false) }),
  z.strictObject({ offered: z.literal(true), places: peruAreaSelectionSchema }),
]);
export const checkoutDeliveryOptionsSchema = z.strictObject({
  home: checkoutLocationMethodSchema, agency: checkoutLocationMethodSchema, store: storeDeliverySettingsSchema,
});
```

- **Loader mapping:** a `PeruAreaSelection` becomes `{ offered: true, places }`, and `null` becomes `{ offered: false }`. The loader validates the result with `safeParse`, as today. If validation fails, the page shows its existing load error and never shows "no coverage". `CheckoutDeliveryOptions` is `z.output`, with branded `places`.
- **Nothing more is exposed:** the response carries no names, options, prices, couriers or agencies (criterion 34), and `strictObject` keeps it that way.
- **Consumers:** only core web consumes `order-checkout.ts`. Mobile does not import it.
- **Quotation request:** `createQuotationRequestSchema` (`shared/contracts/quotations.ts`) gains `trigger: z.enum(["picked", "automatic"]).optional()`. Only the web checkout sends it, and it is recorded only in the buyer's log. The server ignores it in its rules. Mobile does not send it, and its seller requests remain valid.
- **Zones response:** `deliveryZonesSchema` keeps its shape. Only the meaning of `agencies[].enabled` changes (§5.3), and that is documented in the schema comment: "usable: the catalog agency and its catalog courier are enabled".

## 10. Mobile

| File | Change |
| --- | --- |
| `apps/mobile/src/features/delivery-settings/presentation/delivery-zones-section.tsx` | `lacksCoverage` is replaced by `zonesCoverage` and `coverageWarnings` (§5.2). |
| `apps/mobile/src/features/delivery-settings/presentation/delivery-settings-screen.tsx` | `useMemo` of `zonesCoverage` on stable inputs, before any early return, with `coverageWarnings` derived from it (§5.2). The text, placement and the **Ir a zonas y tarifas** link do not change. |
| `apps/mobile/src/features/delivery-settings/presentation/delivery-zones-section.test.tsx` | Cases in §14. |

There is no new request and no new dependency. `@shared/*` is already mapped in tsconfig and Jest.

## 11. Transactions and concurrency

- **Checkout load:** writes nothing new. The read keeps `FOR SHARE` inside `quotationTransaction`, and `checkoutCoverage` runs within it with the bounded cost from §2. The places are the ones at load time. If coverage changes afterwards, the server's quotation resolves it (criterion 19).
- **Quotations from preselection:** a district preselected when the page loads (or when entering a method) starts a quotation without a buyer action, and each quotation inserts its quotation and rates, as any buyer quotation does today. The product accepts this. Those requests, and the re-quotation of a kept or saved district, carry `trigger: "automatic"`, so they stay out of the goal's measure (§13). The single handler for switching methods (§2) avoids transient quotations with a stale district.
- **Seller writes:** none new.

## 12. Code organization

| File | Change | Task |
| --- | --- | --- |
| `shared/peru-geography.ts`, `shared/peru-geography.spec.mjs` | Loose-code operations, `canonicalPeruArea`, offered lists, `keepCoveredPeruPlace`, `isCompletePeruLocation`, `settlePeruLocation` (§6) | T0 |
| `shared/delivery-coverage.ts` (new), `shared/delivery-coverage.spec.mjs` (new) | `eligibleCoverageAgencies`, `deliveryCoverage` | T0 |
| `shared/contracts/peru-location.ts`, `shared/contracts/delivery-settings.ts` | Code schemas and `peruAreaSelectionSchema` (§8) | T0 |
| `apps/core/src/features/delivery-settings/domain/quotation.ts` and test | `checkoutCoverage`; `hasAgencyCoverage` removed | T1 |
| `.../application/get-checkout-delivery-options.ts` and test | Returns `coverage` | T1 |
| `shared/contracts/order-checkout.ts` | §8 | T1 |
| `apps/core/app/routes/checkout.tsx` and `checkout.test.ts` | New contract, plus the `checkout_delivery_options_invalid` log | T1 |
| `apps/core/app/components/checkout-delivery-fields.test.tsx` | Rewrite onto `offered` (current method tests) | T1 |
| `apps/core/app/components/checkout-delivery-fields.tsx` | T1: offered methods, initial method, «Pasar a Entrega a domicilio», no-method text. T5: location, notice, hint, empty texts | T1, then T5 |
| `apps/core/app/locales.ts` | T1: `checkoutDelivery.noModes` es/pt. T5: the hint, the notice and the empty texts | T1, then T5 |
| `preview-fixtures.ts`, `checkout-pages.stories.tsx`, `checkout-contracts.test.ts`, `api-routes.integration.test.ts`, `delivery-zones-repository.integration.test.ts` | New shape | T1 |
| `apps/core/app/components/peru-district-select.tsx` and `peru-district-select.test.tsx` | `PeruLocationFields` extracted | T4 |
| `apps/core/app/components/checkout-location.ts` (new) and test | `enterLocationMethod`, `chooseUpperLevel` | T5 |
| `apps/core/app/components/checkout-delivery-fields.interaction.test.tsx` (new) | Behavior of the draft, the notice and the quotation status | T5 |
| `apps/core/src/features/delivery-settings/infrastructure/quotation-api.ts` (web) | Sends `trigger` | T5 |
| `apps/core/tests/e2e/checkout.spec.ts` | Happy path, and moving the dead ends | T5 |
| `apps/core/src/features/delivery-settings/presentation/zones-response.ts` and the new `zones-response.test.ts` | Folded `enabled` | T2 |
| `apps/core/app/components/delivery-zones-section.tsx` and test, `apps/core/app/routes/delivery-settings.tsx`, mobile equivalents | `zonesCoverage`, `coverageWarnings` | T2 |
| `apps/core/src/features/delivery-settings/presentation/quotation-routes.ts` and test, `shared/contracts/quotations.ts`, `apps/core/src/features/delivery-settings/domain/quotation-metrics.ts` (new) and test | `buyer_quotation_created`, `trigger` field, pure count | T3 |

`PeruLocationFields`, the controlled control and meeting contract with the decoupling tasks:

```ts
type LocationLevel = "department" | "province" | "district";
export function PeruLocationFields(props: Readonly<{
  value: PeruArea | null;
  /** The level the person changed; the levels below arrive already cleared. Clearing reports the parent (or null) with the cleared level. */
  onChange: (next: PeruArea | null, level: LocationLevel) => void;
  /** Places it may offer; absent = the whole country. */
  places?: PeruAreaSelection;
  /** Checkout texts: a hint under the group title that describes only Departamento, and the empty text of each level. */
  texts?: Readonly<{ groupHint: string; noResults: Readonly<Record<LocationLevel, string>> }>;
  disabled?: boolean; themed?: boolean;
}>): JSX.Element;
```

- **With `texts`:** the group hint renders right under the legend «Distrito de entrega» with its own id, and is the `describedBy` of Departamento only. The hint under Distrito does not render.
- **Without `texts`:** the current hint and `peruDistrict.noResults`.
- **Option lists:** they are memoized per `places` and per department or province, so they keep their identity across renders (base-ui).
- **`PeruDistrictSelect`:** keeps its props and holds its `PeruArea` in state.

Checkout (`checkout-delivery-fields.tsx`):

- **Offered methods:** «Conservar entrega actual» when there is a saved delivery, plus `home.offered`, `agency.offered` and `store.enabled`, in the current order.
- **Initial method:** `keep`, else `home`, else `agency`, else `store`, else `""`. **Pasar a Entrega a domicilio** appears only with `home.offered`. When nothing is offered, the new `checkoutDelivery.noModes` text shows.
- **Initial `draft.location`:** the saved delivery's district (home or agency), else `null`. If the initial method is home or agency, `enterLocationMethod` is applied **once**, in a lazy `useState` initializer, and its result goes into `defaultValues` (§2, SSR). The initial notice is kept in state, but it only shows once `ready` is true. `districtCode` is derived from `location`.
- **`changeMode(mode)`:** a single handler. For home or agency, it computes `enterLocationMethod(places of the method, draft.location)`. It writes `mode`, `location` and `notice`, and clears rate, agency and quotation. For store or keep, it writes `mode`, sets the notice to `none` and leaves `location` as it is.
- **Control `onChange`:** with the upper-level condition from §2 → `chooseUpperLevel`. Otherwise it stores `next` and sets the notice to `none`.
- **Notice region:** a single `role="status"` (`aria-live="polite"`) element, always mounted between the methods and the fields, outside the block that toggles with home or agency.
  - Its text, and the padding when needed, go in a child that is mounted only when there is a message.
  - The region has no padding or border, and the parent's gap does not apply to it (it sits inside the fields wrapper, glued to the start). While empty, it occupies no space.
  - It does not use `display: none` while empty, because a region hidden that way is not reliably announced.
- **Quotation status region:** a second `role="status"`, always mounted (also during SSR), after the notice in document order. Its text comes from `inFlight`, the state the quotation effect sets when it starts the request and clears when the response arrives. It is no longer derived from `draft.districtCode && !current`. The quotation effect requires `ready`. Effects run after the commit that triggered them, so the loading text always arrives in an update after the notice's (§2 Announcements).
- **`trigger` of the request:** the draft records the source of its district (`districtSource: "picked" | "automatic"`). It is set to `picked` only in the control's `onChange` with `level === "district"` and a new district. Every other write of a district is `automatic`: `enterLocationMethod`, `chooseUpperLevel`, a district kept when switching methods, and the saved delivery's district. The quotation effect sends that source. **Reintentar tarifas** repeats the request with the same source.
- **Notice styles:** `cleared` uses the padded muted block of «No hay opciones de envío…». `preselected` uses the hint's look.
- **Notice text:** it names the method with the same text as the method list and the district with `titleCase` of the catalog name.

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `buyer_quotation_created` | info | `quotation-routes.ts`, third handler, after validating the response, only when `response.locals.quotationOrigin === "buyer"` | `["quotationId", "trigger", "homeRateCount", "agencyRateCount", "agencyRateInDepartmentCount"]`. `companyId` and `operation` come from the logger mixin after `bindCompanyToRequest`, so they are not listed. |
| `checkout_delivery_options_invalid` | error | `checkout.tsx` loader, when the `safeParse` of `checkoutDeliveryOptionsSchema` fails, before responding with the load error | `["field", "issueCode"]`: the path of the first issue (`agency.places.provinceCodes`) and its Zod code. Also `companyId` from the mixin. |

- **Origin:** the order-link branch (second handler) sets `response.locals.quotationOrigin = "buyer"`, and the seller branch sets `"seller"`.
- **`agencyRateInDepartmentCount`:** counts the agency rates that have at least one agency whose district is in the destination's department. It is computed by the pure function `agencyRatesInDestinationDepartment(rates: readonly QuotedDeliveryRate[], destination: PeruDistrictCode): number`, in the new `apps/core/src/features/delivery-settings/domain/quotation-metrics.ts`. The function gets the department from the catalog (`getPeruDistrict`), so the route stays a thin adapter and the country rule stays out of the handler.
- **Why a separate event:** `http_request_completed` describes the HTTP request for every origin. This event is a business metric only for buyers, with counts derived from the result. Binding those counts to the request context would make every seller quotation's completion carry them, and the metric would depend on the HTTP log's shape. It does not duplicate the completion: it carries no status or duration.
- **`trigger`:** the field the client sends, `picked` by default.
- **Measures, only over `trigger = "picked"`:** the share of quotations without a rate is `homeRateCount + agencyRateCount = 0`. The agency dead end is `agencyRateCount > 0 && agencyRateInDepartmentCount = 0`.
- **Exception to `docs/logging.md`:** «logs are diagnostics, not business data». This event is a metric that the gate chose on purpose (Q1). The exception is recorded when the drafts are promoted (Final verification).
- **Never logged:** `orderId` (it works as an order link), district, address, agency names, prices.

## 14. Tests

Each title lists the product criteria it covers and the task that writes it.

### Unit: shared (`shared/*.spec.mjs`, core's `unit` project), T0

- `test("canonical area absorbs provinces and districts inside a whole department, removes duplicates and ignores unknown codes")` (criterion 15)
- `test("codes within departments keep whole departments, provinces and loose districts of those departments and drop the rest")` (criterion 6)
- `test("department of a district comes from the catalog and is null for an unknown code")`
- `test("offered lists show only covered departments, provinces and districts, and a whole department lists all its provinces")` (criteria 1, 2, 7, 15)
- `test("keeping a covered place walks up from district to province to department and returns null when none is covered")` (B2)
- `test("settling a location fills every level with a single offered choice and stops at the first level with several")` (criteria 1, 3, 31)
- `test("settling keeps the levels already chosen and fills only below them")` (criterion 18)
- `test("eligible coverage agencies exclude disabled agencies, agencies of retired catalog couriers and disabled company couriers")` (criterion 14)
- `test("home coverage is the union of enabled zones with an enabled home option and ignores disabled zones and options")` (criteria 15, 19)
- `test("agency coverage of a zone over Arequipa, Cusco and Puno with agencies only in Arequipa is Arequipa")` (criteria 6, 28)
- `test("agency coverage of a whole department with agencies in one province offers every province of the department")` (criterion 7)
- `test("a zone covering only Cusco with agencies only in Arequipa gives no agency coverage, and one agency in Cusco gives Cusco")` (criteria 8, 27)
- `test("an agency option without eligible agencies gives no coverage")` (criterion 14)
- `test("a store covering all of Peru for home returns 25 department codes and no expanded districts")` (criterion 31)
- `test("coverage of 1892 single-district zones with two home options and one agency option each, and the offered lists over it, take at most 10 ms as the minimum of 5 warmed runs")`
- `test("a zone with several qualifying options counts once per method and agency options of a zone add their departments together")`
- `test("area selection contract accepts canonical catalog selections and rejects empty, unknown, non-canonical and oversized ones")`

### Unit: core, T1

- `test("checkout coverage is null for a method whose switch is off even with covered zones")` (criteria 12, 13)
- `test("checkout coverage excludes agencies disabled in the catalog, retired catalog couriers and disabled company couriers")` (criterion 14)
- `test("checkout delivery options return settings and per-method coverage from the shared configuration read")`
- `test("checkout delivery options contract accepts offered methods with places and rejects offered without places, unknown codes and extra fields")` (criterion 34)
- `test("checkout loader maps uncovered methods to not offered, and an invalid projection logs checkout_delivery_options_invalid and shows the load error")`
- `test("checkout offers home only when covered and opens on agency or store pickup when home is uncovered")` (criterion 12)
- `test("checkout shows the kept delivery preselected when its district is no longer covered or its method is no longer offered")` (criteria 16, 17)
- `test("checkout shows the no-method text that tells the buyer to check with the store in Spanish and Portuguese")` (criteria 13, 25)
- `test("the no-agency message offers Pasar a Entrega a domicilio only when home is offered")` (criterion 29)

These T1 tests live in `checkout-delivery-fields.test.tsx` (rendered from static markup), which T1 rewrites onto the new shape. Examples are «hides Envío a agencia when the agency switch is off or the business has no agency coverage» and «opens on the saved delivery». The domain and loader tests live in their own files.

### Unit: location control (web), T4

- `test("location fields list only the given places and the whole country without them")` (criteria 1, 6, 26)
- `test("location fields with checkout texts show the group hint as the description of Departamento only and the checkout empty texts per level")` (criteria 22, 23, 30)
- `test("seller district select keeps its hint, its empty text and the 25 departments")` (criterion 26)
- `test("location fields report the changed level and clear the levels below")`

### Unit: checkout location and draft (web), T5

`checkout-location.test.ts`:

- `test("entering a method keeps a covered district without notice")` (criteria 9, 10)
- `test("entering agency from Miraflores clears it, preselects Arequipa and reports cleared with levels filled")` (criterion 4)
- `test("entering agency where a single district is covered preselects it and reports cleared with district filled")` (criterion 5)
- `test("entering a method keeps a covered department when the province left on the form is not covered")` (B2)
- `test("entering a method with a cleared district keeps the covered department and province and preselects below")` (criterion 32)
- `test("entering home from a saved district outside coverage reports it cleared and preselects Lima and Lima")` (criterion 16)
- `test("choosing a new department preselects a single province and district and reports preselected")` (criterion 18)

`checkout-delivery-fields.interaction.test.tsx` (jsdom, `requestDeliveryQuotation` faked):

- `test("a store covering province Lima opens home with Lima and Lima preselected, the preselection notice and no Huamantanga")` (criterion 1)
- `test("picking a province under a whole department empties the notice and quotes the picked district")` (criterion 2)
- `test("a store covering only Miraflores fills the three levels on load and requests one quotation without buyer action")` (criterion 3)
- `test("switching from home to agency shows a single cleared message and issues no quotation for the old district")` (criterion 4)
- `test("switching methods with a covered district issues exactly one quotation for it")` (criteria 9, 10)
- `test("switching to agency where only Yanahuara is covered preselects it and requests its quotation with trigger automatic")` (criterion 5)
- `test("Pasar a Entrega a domicilio keeps a district covered by home and quotes it, as switching the method does")` (criterion 10)
- `test("the last picked district survives keeping the saved delivery and returning to home")` (criterion 11)
- `test("a fresh form starts home from the saved delivery district")` (criterion 11)
- `test("clearing a preselected district leaves it empty, empties the notice and quotes nothing until it is picked again")` (criterion 18)
- `test("clearing the department clears the three levels and picking it again preselects province and district with the notice")` (criterion 18)
- `test("choosing the same department again changes nothing and does not preselect")` (criterion 18)
- `test("an explicit district clear survives a store pickup round trip with department and province kept")` (criterion 32)
- `test("in a single-district store a store pickup round trip after clearing preselects the district again with the notice")` (criterion 32)
- `test("a catalog order without saved delivery shows the group hint and no text naming a chat or channel")` (criterion 21)
- `test("the checkout empty search shows the per-level checkout text and the hint keeps saying to check with the store")` (criteria 6, 22, 30)
- `test("the notice is one polite status before the quotation status, empty while silent and never moves focus")` (criteria 23, 33)
- `test("in a single-district store the server render has both status regions present and empty, and after hydration the notice text is inserted in an earlier update than the loading text")` (criteria 3, 23). It renders with `renderToString`, hydrates with `hydrateRoot` in jsdom, and records the order of the texts with a `MutationObserver` on both regions. The insertions must happen in different updates, the notice first.
- `test("picking a district shows the loading text only after the request starts, inside the region that already existed")` (criterion 23)
- `test("tabbing from the delivery methods reaches Departamento first even when it is preselected, and the notice is not focusable")` (criterion 23)
- `test("entering Entrega a domicilio from Recojo en tienda in a single-district store inserts the preselection notice once, before the loading text")` (criteria 3, 23)
- `test("cleared messages use the padded muted block and the preselection message uses the hint look")` (criteria 24, 33)
- `test("hint, empty texts and notice messages render in Portuguese")` (criterion 25)
- `test("a store covering all departments shows the hint and preselects nothing")` (criterion 31)
- `test("the server render already shows the preselected levels and computes the initial location once")`
- `test("a picked district is quoted with trigger picked, while preselected, kept-on-switch and saved districts are quoted with trigger automatic, and Reintentar tarifas repeats the trigger of the failed request")`

Criterion 7 (cascade notice in Chivay) is not a new test: it is covered by the existing `checkout-agency-destination.test.tsx:40`, which must stay green. T0's coverage test proves that all provinces of Arequipa are offered.

### Core integration, T1

- `test("checkout loader sends only the covered places per method and no zone, option, price or agency")` (criterion 34, two stores)
- `test("checkout delivery options apply the department bound with agencies read from the catalog")` (criteria 6, 8, 27)
- `test("a direct buyer quotation of an uncovered agency department still returns the option rate and confirms as today")` (criterion 20)
- `test("a direct buyer quotation of an uncovered home district gets no home rate and its confirmation is rejected")` (criterion 20)
- `test("checkout loader keeps store pickup as the only method when home and agency are not offered")` (adjusts `api-routes.integration.test.ts:901`, criterion 12)

### Core unit: zones response and warnings, T2

- `test("zones response marks an agency inactive when its catalog courier is retired")` (criterion 14), in the new `apps/core/src/features/delivery-settings/presentation/zones-response.test.ts`
- `test("web coverage warning flags agency when every eligible agency is outside the departments the zone covers")` (criterion 27)
- `test("web coverage warning clears when the option gets an eligible agency in a covered department")` (criterion 27)
- `test("web coverage warning flags agency when its only agency or courier is retired from the catalog")` (criterion 14)
- `test("web coverage warning stays silent for a zone over Arequipa, Cusco and Puno with agencies in Arequipa")` (criterion 28)
- `test("zones coverage hook returns the same object while zones and couriers keep their identity, and a new one when couriers change after a confirmed save")` (in `apps/core/app/components/delivery-zones-section.test.ts`, with a jsdom root that re-renders the hook and compares references)

### Mobile (Jest), T2

- `test("agency coverage warning appears when the only zone covers Cusco and its agencies are all in Arequipa")` (criterion 27)
- `test("agency coverage warning disappears after adding an eligible agency in Cusco")` (criterion 27)
- `test("agency coverage warning appears when the only agency is inactive because its catalog courier was retired")` (criterion 14)
- `test("a zone over Arequipa, Cusco and Puno with agencies in Arequipa shows no warning")` (criterion 28)
- `test("zones coverage hook returns the same object while zones and couriers keep their identity")` (in `delivery-zones-section.test.tsx`, with `renderHook` from Testing Library)
- `test("delivery settings screen renders the loading state and then the warning without changing the hook order")`

### Core unit: measurement, T3

- `test("buyer quotation logs trigger, rate counts and agency rates in the destination department without the order id")`
- `test("quotation request accepts an optional trigger and rejects unknown values")`
- `test("agency rates in the destination department count rates with at least one agency in that department")` (`quotation-metrics.test.ts`)
- `test("seller quotation does not log the buyer quotation event")`

### Web E2E, T5

- `test("buyer of a store covering province Lima sees Lima preselected, picks Miraflores and confirms home delivery")` (criterion 1, happy path)
- The dead ends that can no longer be reached by picking in the UI move to the path "coverage removed after the page loaded", which is still product behavior:
  - `checkout.spec.ts:655` (Mollendo, agency): the page loads with an agency covered in Arequipa, the test disables those agencies in the catalog, and the buyer picks Mollendo. It still shows «No hay agencias disponibles para envío a MOLLENDO», **Cambiar distrito** and **Pasar a Entrega a domicilio** (criteria 19, 29).
  - `checkout.spec.ts:773` (uncovered home district): the page loads with zone 040110 covered, the test disables the zone, and the buyer picks it. It still shows «No hay opciones de envío para este distrito…» and, in that scenario, keeps distinguishing it from the free rate (criterion 19).
  - Any other scenario that picks a district from a store that does not cover it changes its zones to cover it. None is deleted.

### Pending manual checks

- On a narrow phone with the keyboard closed: the cleared-district notice above the group title and the hint, with no gap while empty (criterion 33).
- With VoiceOver or TalkBack: one announcement of the notice before «Consultando opciones de envío…», focus does not move, and the hint is only on Departamento (criterion 23).
- Contrast of the hint, the notice and the empty texts in the five themes, Noche included (criterion 24).
- On a real phone: settings with the catalog courier of the only agency retired shows the warning (criterion 14).

## 15. Limits and checks during implementation

- **Country rule 5.7:** zones are already a `PeruAreaSelection`, and the checkout and the settings already use the Peru selector. This design does not add a new branch per country, and it keeps the order of the levels inside the country module (`keepCoveredPeruPlace`, `isCompletePeruLocation`, `settlePeruLocation`). The breach is not removed: `PeruArea`, `PeruAreaSelection` and the Peru control still appear in general pieces (the contract, `delivery-coverage.ts`, `checkout-location.ts`). Removing them is the job of the decoupling tasks. The meeting contract with the decoupling tasks is the one in §2, plus the country functions `keepCoveredPeruPlace`, `isCompletePeruLocation` and `settlePeruLocation`. Beyond extracting `PeruLocationFields`, nothing is renamed or restructured.
- **Shared agency picker:** folding `enabled` affects only the zones response. The agency catalog the picker loads by courier (`agency-catalog-response.ts`) does not change: it only lists the couriers available to the company.
- **Memoize `places` per method:** the checkout must memoize the `places` it passes to `PeruLocationFields` per method, so base-ui does not reset the typed query.
- **Reasonable failure:** if the minimum of the warmed runs exceeds 10 ms on CI with the linear algorithm, record the measurement in the pull request and adjust the budget. Do not go back to `selectPeruArea` in a loop, and do not merge pairwise.
- **Hermes:** the budget is measured in Node. On mobile the function runs only when zones or couriers change (§5.2), so its cost is paid once per zones load.
- **No refresh while open:** the places are those at load time.

## 16. Implementation plan

### Order and parallelism

```text
Wave 1:  T0 (shared: area ops, coverage rule, area schema)        T3 (buyer quotation log + trigger field)
Wave 2:  T1 (core + contract + offered methods)   T2 (seller warning web + mobile)   T4 (location control extraction)   ← after T0
Wave 3:  T5 (checkout location behavior)                                                                                ← after T1, T3 and T4
```

- **Disjoint files in wave 2:** T1, T2 and T4 do not share files with each other.
- **Shared files between T1 and T5:** `checkout-delivery-fields.tsx` and `locales.ts`, which is why T5 runs after T1.
- **T3:** does not depend on anything. T5 needs it for the `trigger` field, and they share no files.

### T0. Shared coverage rule, area operations and area schema

**Scope:**
- The §6 functions in `shared/peru-geography.ts`: linear over loose codes, with an index by prefix built once.
- The new `shared/delivery-coverage.ts`, with `eligibleCoverageAgencies` and `deliveryCoverage`.
- In `shared/contracts/peru-location.ts`: the code schemas and `peruAreaSelectionSchema`, with the caps and the canonical transform. `shared/contracts/delivery-settings.ts` imports them, with no change to its shape.
- The "Unit: shared" tests in §14.

**Out of scope:** `order-checkout.ts`, core, web and mobile.

**Acceptance criteria:**
1. Zone «Sur» = 04, 08 and 21, with an agency option whose only eligible agency is in 040101 → `agency = { departmentCodes: ["04"], provinceCodes: [], districtCodes: [] }`, `home = null`.
2. Zone = province 1501 (home) plus a zone = 150122 (home) → `home = { departmentCodes: [], provinceCodes: ["1501"], districtCodes: [] }`.
3. Zone = 080101 with its agency in 040101 → `agency = null`. Adding an eligible agency in 080101 → `agency = { districtCodes: ["080101"] … }`.
4. An agency with `enabled: false` (catalog agency or retired catalog courier) or whose courier is not in `enabledCourierIds` does not count.
5. `settlePeruLocation({ districtCodes: ["150122"] … }, null)` → `{ location: { kind: "district", code: "150122" }, filled: "complete" }`. With department 15 whole → `{ location: { kind: "department", code: "15" }, filled: "partial" }`.
6. 25 whole departments → 25 codes. 1,892 zones of one district each, each with two home options and one agency option → `deliveryCoverage`, plus a full walk of the offered lists of both results, takes ≤ 10 ms as the minimum of 5 warmed runs. The offered lists, `keepCoveredPeruPlace` and `settlePeruLocation` look codes up in sets (the `WeakMap` cache per area), never with `Array.includes`. `deliveryCoverage` does not call `selectPeruArea`, and it canonicalizes once per method.
8. Zone with agency options A (agency in 04) and B (agency in 08) over 04 and 08 → `agency` includes both departments. The zone counts once.
7. `peruAreaSelectionSchema` rejects `{ departmentCodes: ["15"], provinceCodes: ["1501"], districtCodes: [] }` (non-canonical), `["99"]` (unknown) and 26 departments.

**Depends on:** nothing.

### T1. Core coverage, checkout contract and offered methods

**Scope:**
- **Core domain and use case:** `checkoutCoverage` in `quotation.ts`, with `hasAgencyCoverage` removed and the use case returning `coverage`.
- **Contract and loader:** the contract in `order-checkout.ts` (§8), and the loader in `checkout.tsx`, with the `checkout_delivery_options_invalid` log.
- **`checkout-delivery-fields.tsx`, only:** the offered methods, the initial method, **Pasar a Entrega a domicilio** with `home.offered`, and the new `checkoutDelivery.noModes` text in es and pt. Until T5, location fields still show the whole country.
- **Fixtures** and the tests listed in §3 under "Tests on the old shape", including the rewrite of `checkout-delivery-fields.test.tsx`.
- **Tests:** "Unit: core" and "Core integration" in §14.

**Out of scope:** `PeruLocationFields`, location state, preselection and notice (T5). The warning (T2), the log (T3), the quotation and confirmation.

**Acceptance criteria:**
1. Home on without a home zone and agency covered → only «Envío a agencia» and «Recojo en tienda · Gratis», with agency preselected (criterion 12).
2. Nothing offered and no saved delivery → «No hay modalidades de entrega disponibles. Consulta con la tienda cómo recibir tu pedido.», with confirmation disabled (criterion 13).
3. Saved delivery to Miraflores with no home coverage → «Conservar entrega actual» offered and preselected, no «Entrega a domicilio», and confirmation keeps the delivery (criterion 17).
4. Store A's loader JSON contains only codes under 1501 and no `name`, `price` or `agencyIds` (criterion 34).
5. Direct quotation of Cusco in criterion 6's store → «Shalom» rate with an Arequipa agency, and confirmation accepted (criterion 20).
6. The no-agency message without home offered → no **Pasar a Entrega a domicilio** (criterion 29).

**Depends on:** T0.

### T2. Seller warning with the shared rule (web + mobile)

**Scope:**
- **Zones response:** `zones-response.ts` folds the catalog courier into `agencies[].enabled`, with the new `zones-response.test.ts`. The schema comment in `delivery-settings.ts` states the meaning (one line).
- **Warning:** `zonesCoverage` and `coverageWarnings` replace `lacksCoverage` in `apps/core/app/components/delivery-zones-section.tsx` and in `apps/mobile/src/features/delivery-settings/presentation/delivery-zones-section.tsx`.
- **Screens:** `useMemo` of `zonesCoverage` on `(zonesBase, settings.couriers)` in `apps/core/app/routes/delivery-settings.tsx`, and on the equivalent inputs in `delivery-settings-screen.tsx`, before any early return (§5.2).
- **Tests:** "Core unit: zones response and warnings" and "Mobile" in §14.

**Out of scope:** the text, placement or link of the warning. The home warning, beyond deriving it from the same value. The zone editor (except that it receives the folded `enabled`). Any checkout file. The partial-gap signal.

**Acceptance criteria:**
1. Agency on, a single zone = Cusco, «Shalom» with its eligible agency in Arequipa → agency warning on web and mobile. Adding an eligible agency in Cusco → no warning (criterion 27).
2. The only agency of the option belongs to a courier retired from the catalog (`courierEnabled = false` in core) → the zones response sends it with `enabled: false`, and the agency warning appears on web and mobile (criterion 14).
3. Zone = Arequipa, Cusco and Puno with agencies in Arequipa → no warning (criterion 28).
4. Home on with no home option → home warning, as today.
5. Typing in the pickup name or the optimistic render of a toggle does not recompute coverage. A confirmed save recomputes it once, which is accepted.

**Depends on:** T0.

### T3. Buyer quotation measurement

**Scope:**
- **Origin:** `response.locals.quotationOrigin` (`"buyer" | "seller"`), set in the second handler of `quotation-routes.ts`.
- **Contract:** the optional `trigger` field in `createQuotationRequestSchema` (§8).
- **Log:** `buyer_quotation_created` in the third handler, after validating the response, with the fields in §13 (`trigger` defaults to `picked`).
- **Tests:** "Core unit: measurement".

**Out of scope:** the response, the statuses and `createQuotation`.

**Acceptance criteria:**
1. A buyer quotation of Huamantanga without rates → `trigger: "picked", homeRateCount: 0, agencyRateCount: 0`. The same request with `trigger: "automatic"` logs `trigger: "automatic"`.
2. A buyer quotation of Cusco with an agency rate whose only agency is in Arequipa → `agencyRateCount: 1, agencyRateInDepartmentCount: 0`.
3. A seller quotation → no event.
4. No log contains `orderId`.

**Depends on:** nothing.

### T4. Restrictable location control

**Scope:** extract the controlled `PeruLocationFields` in `apps/core/app/components/peru-district-select.tsx` with the props in §12. `PeruDistrictSelect` becomes a wrapper with its current API and state. Tests: "Unit: location control" in §14.

**Out of scope:** any checkout file, the mobile selector, renaming or moving the file.

**Acceptance criteria:**
1. With `places = { provinceCodes: ["1501"] … }` → Departamento lists only «Lima», Provincia only «Lima», and Distrito its 43 districts, without Huamantanga.
2. With `texts` → the group hint is the `aria-describedby` of Departamento only, and an empty search in Distrito shows `texts.noResults.district`.
3. The seller's web order delivery form lists 25 departments with «No hay resultados. Prueba con otro nombre.» (criterion 26).
4. Clearing Provincia reports `{ kind: "department", code }` with `level: "province"`.

**Depends on:** T0.

### T5. Checkout location behavior

**Scope:**
- **Pure functions:** the new `apps/core/app/components/checkout-location.ts`.
- **`checkout-delivery-fields.tsx`:** `location` in the draft, the initial location computed once (SSR), the single `changeMode` handler, the upper-level condition, the two status regions (notice and quotation with `inFlight`) and `PeruLocationFields` with `places` and `texts`.
- **Web `quotation-api.ts`:** sends `trigger`.
- **`locales.ts`:** es and pt texts for the hint, the notice and the empty-search texts, from the product draft (Screens).
- **E2E:** `checkout.spec.ts`, with the happy path and the dead ends moved (§14).
- **Tests:** "Unit: checkout location and draft" and "Web E2E" in §14.

**Out of scope:** the contract and core (T1), the control (T4), the seller forms, the agency cascade.

**Acceptance criteria:** product criteria 1 to 5, 9 to 11, 16, 18, 19, 21 to 25 and 30 to 33 of [checkout-cobertura-ubicacion.md](checkout-cobertura-ubicacion.md), each with the test from §14 that names it. In particular:
1. Home zone in province Lima and agency zone in Arequipa. Miraflores under home, then a switch to agency → a single message, «Envío a agencia no llega a Miraflores. Completamos los campos que tienen una sola opción; elige tu distrito.», and no quotation request for Miraflores under agency (criterion 4).
2. Home zone = all of department Lima, the buyer leaves Lima → Canta without a district, and the agency zone covers province Lima → entering agency keeps Lima and preselects province Lima (B2).
3. A store with only Miraflores → the three fields are filled in the server HTML, both regions are empty in it, the notice is inserted after hydration and the loading text in a later update, and exactly one quotation is requested, with `trigger: "automatic"` (criteria 3, 23).

**Depends on:** T1, T3 (the `trigger` field) and T4.

### Final verification

- Run `scripts/ci.sh` against `main` on the integration branch.
- Do the manual checks in §14, with screenshots in the pull request.
- When merged, promote the drafts with the Documentation skill:
  - Rewrite the rules in the product's «Recorded rules this changes» table (`docs/checkout.md` and `docs/delivery.md`). Add to `docs/delivery.md` that the zones response's `agencies[].enabled` folds in the catalog courier.
  - Add to `docs/logging.md` the exception for `buyer_quotation_created`: a business metric that the gate chose instead of persisting data, with the reason, so the pattern is not copied without that reasoning.
  - Update memories 5d286cde, 7a8a67fb and c52f8fff.

### Deferred items with real risk

This design does not add any of its own. The product's items stand: the partial agency gap, the warning that does not explain its new case, and the catalog buyer with no way to reach the store. They are listed in «Deferred items with real risk» in [checkout-cobertura-ubicacion.md](checkout-cobertura-ubicacion.md).

## Questions decided by the review gate

These answers come from the review gate of the implement-task skill (design and performance reviewers, consolidated by the coordinator), for the founder to confirm in the final pull request.

1. **Where the goal measurement lives.**
   - **Answer:** option 1. An info log, `buyer_quotation_created`, for buyer quotations only. The origin travels in `response.locals.quotationOrigin`, and the optional `trigger: "picked" | "automatic"` field leaves automatic quotations out of the goal (T3).
   - **Who decided:** the design and performance reviewers, in agreement from round 1. Confirmed in rounds 2 and 3.
   - **Reason:** it stores nothing new (product: «nothing new is stored»), needs no migration and adds no query. It is written after the quotation's commit, at the boundary that knows the origin.
   - **Discarded:** marking the origin on each stored quotation, which means a migration and a column just for a metric. Also discarded: not measuring, which leaves the hypothesis unverified.
2. **How the seller clients learn that a catalog courier was retired (criterion 14).**
   - **Answer:** the zones response folds the catalog courier into `agencies[].enabled`, keeping the schema's shape. Eligibility is one shared function, `eligibleCoverageAgencies`, for core, web and mobile.
   - **Who decided:** the design reviewer raised it as round 1's blocker and accepted this answer in rounds 2 and 3. The performance reviewer had no objection.
   - **Reason:** mobile builds already installed parse `catalogAgencySchema` strictly. The catalog courier is the same row as the company courier's `catalogEnabled`. The only visible change, «inactiva» on agencies of retired couriers in the zone editor, is accurate.
   - **Discarded:** a new field in `catalogAgencySchema`, which breaks installed mobile builds. Also discarded: leaving the clients' eligibility as it was, which breaks the founder's single meaning of coverage.
3. **Cost of `deliveryCoverage` and how it is measured.**
   - **Answer:** per-method code sets, with each zone counted once per method, and a single canonicalization. Lookups go through sets, cached per area. The budget is 10 ms, as the minimum of 5 warmed runs, on the adversarial shape (1,892 zones of one district, with several options each), and it includes the offered lists.
   - **Who decided:** the performance reviewer (round 2 blocker, approved in round 3, measured at 0.45 to 0.76 ms). The design reviewer had objected to a single-shot measurement in round 2.
   - **Reason:** a pairwise fold costs 34 to 38 ms and runs inside the `FOR SHARE` lock and on Hermes. The minimum of warmed runs removes the noise from the JIT and GC, while a quadratic regression fails on every run.
   - **Discarded:** a pairwise fold with linear operations, which is quadratic in zones. Also discarded: a single-shot wall-clock assertion, which is flaky in CI.
4. **Order of the announcements with SSR (criterion 23).**
   - **Answer:** two `role="status"` regions, always mounted and empty in SSR. The notice text shows only when `ready`, and the loading text comes from `inFlight`, set by the effect, so it always lands in a later update. This is proven with SSR plus `hydrateRoot` and a `MutationObserver`.
   - **Who decided:** the design reviewer (round 2 blocker, approved in round 3).
   - **Reason:** content already present in a live region when the page loads is not announced, and a region mounted together with its text is not reliable.
   - **Discarded:** keeping the quotation status mounted conditionally, derived from the district in render. Also discarded: filling the location after hydration with no SSR, which causes a layout shift and an extra render.
5. **Optional `trigger` field on the quotation request.**
   - **Answer:** `trigger: "picked" | "automatic"`, optional. Only the web sends it, and the server applies no rule based on it. `picked` is used only for the quotation after a pick in the control. Every other quotation (preselection, a district kept on a switch, the saved district) is `automatic`, and **Reintentar tarifas** repeats the trigger of the failed request.
   - **Who decided:** the performance reviewer proposed it in round 2. Both reviewers approved it in round 3, and the design reviewer specified the automatic cases.
   - **Reason:** automatic quotations are always of covered districts, and counting them would improve the goal metric by construction.
   - **Discarded:** reading the metric per checkout load instead of per quotation, which needs a load log that does not exist. Also discarded: not distinguishing quotations, which biases the metric.
