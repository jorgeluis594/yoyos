# Instant delivery settings save and whole-department zones: technical design

**Status:** design closed, pending implementation. Based on `docs/entregas-guardado-instante-zonas-departamento.md`. Base: `7860429c` (branch `jorgeluis594/tarea-6hpQPg75pr9H38gV`). Tasks: `docs/entregas-guardado-instante-zonas-departamento-tasks.md`.

## 1. Technical goal

Part 1: web and mobile save each delivery method switch and the pickup point as soon as the seller changes them, through the existing `PUT /api/delivery-settings` (mobile) and the `delivery-settings` route action (web), one save at a time, with the existing optimistic version. Core does not change for Part 1. Each client builds the request from the last confirmed settings plus the single change, tracks the save state per method row, reverts on failure and reloads without losing the pickup text or the open zone draft. The coverage warnings move next to the home and agency switches and the agency one requires an eligible agency.

Part 2: a zone stores whole departments and whole provinces as units, next to its loose districts, in two new tables. A buyer district is covered when the zone lists it, its province or its department. The selector, the zone list and the overlap warning work on that selection without expanding it, except to count districts.

```text
seller switch / pickup field ──(one at a time, expectedVersion)──▶ saveDeliverySettings (unchanged) ─▶ DeliverySettings.version + 1
zone editor ──PUT /zones { departmentCodes, provinceCodes, districtCodes }──▶ saveDeliveryZones ─▶ DeliveryZone + DeliveryZoneDepartment
                                                                                                 + DeliveryZoneProvince + DeliveryZoneDistrict
checkout district ──▶ createQuotation / resolveSelectedDeliveryRate ──▶ applicableDeliveryOptions ─▶ zoneCoversDistrict(zone, district)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Order and delivery | One PR. Part 1 (T1 web, T2 mobile) is implemented before Part 2 (T3 core, T4 web, T5 mobile). |
| Part 1 server | No server or contract change. `saveDeliverySettings` keeps its full-replace input with `expectedVersion`; the client sends the last confirmed settings with exactly one change applied. No PATCH endpoint is added: the version already detects any concurrent change, so a full replace built from confirmed state is equivalent to a partial update. |
| One save at a time | Per screen, a single save lane serializes method saves, pickup saves and zone saves. While a save is in flight the three switches and the zone save buttons are disabled; a pickup text change made meanwhile is saved after it ends, with the version it returned. |
| Pickup save moment | On field blur, or 1500 ms after the last keystroke (`PICKUP_SAVE_DELAY_MS`, initial value, adjustable constant in each app). The whole point (name, address, instructions) is saved together. A point equal (after `trim`) to the confirmed one is not sent. |
| Incomplete point | Never sent. The required-field error («Completa los campos obligatorios.») shows only on a field the seller already left (blurred) empty; the idle timer does not mark untouched fields. |
| Store activation intent | Ephemeral client state `activating`. Tapping the store switch without a confirmed point sets it, opens the fields and focuses the first empty one; the first pickup save with name and address sends `store: { enabled: true, pickupPoint }`. Turning the switch off or leaving the screen clears it. |
| Failure classification (web) | `navigator.onLine === false` before sending → not sent. `serverAction` throws in the new `clientAction` → in doubt. `SERVICE_UNAVAILABLE`/`INTERNAL_ERROR` response → not sent (the transaction rolled back). |
| Failure classification (mobile) | `NETWORK_ERROR`, `SERVICE_UNAVAILABLE`, `SERVER_ERROR`, `RATE_LIMITED` → not sent. Mobile has no in-doubt state: `fetch` does not tell a lost response from an unsent request, and both paths revert the switch, never show «Guardado» and retry with the same `expectedVersion`, which turns an already applied change into a conflict. |
| Retry | **Reintentar** resends the same request (same `expectedVersion`). A stale version answers `DELIVERY_SETTINGS_CONFLICT`; nothing is applied twice. |
| Late responses | Each save carries a client attempt number; a result whose number is not the current attempt is ignored. |
| Reload after conflict | Web uses `useRevalidator().revalidate()` instead of `<a href="">`; mobile reuses `load()` without remounting the zones section. Both replace the confirmed settings and zones and keep the pickup text that differs from the previous confirmed point and the open zone draft. |
| Changed zone under the draft | The editor keeps the zone as it was when editing started (`baseline`). After a reload, if the server zone differs from `baseline`, the editor shows «Otra persona cambió esta zona…». Saving sends the draft with the new version and replaces it. |
| Confirmed snapshot (web) | The confirmed settings are the ones with the highest `version` among the loader data, the last settings save and the last zones save. An older loader revalidation never overwrites a newer save. |
| Coverage warnings | Computed in each client from the zones state and the company couriers with the existing `hasEligibleAgency` rule (agency enabled and its company courier enabled). Shown under the home and agency switches only; removed from the zones section. Hidden when the company has no zones state (not Peru). With an empty courier catalog the agency row keeps `deliveryZones.noCatalog` instead. |
| Leaving with unsaved pickup text | Web: `useBlocker` from React Router plus `beforeunload` while a pickup save is pending, in flight or failed. Mobile: `usePreventRemove` with `showConfirmation`, as in `use-product-navigation-guard.ts`. |
| Zone units model | `DeliveryZone` carries `departmentCodes`, `provinceCodes` and `districtCodes`, three flat arrays with the same shape as today's `districtCodes`. A unit is stored as its INEI code, never expanded, so districts added to the catalog later are covered and the zone reopens the same. |
| Zone units storage | Two tables `DeliveryZoneDepartment` and `DeliveryZoneProvince` that mirror `DeliveryZoneDistrict` (composite PK, tenant FK, CHECK on the code format, RLS). |
| Canonical selection | At least one entry; no duplicates; no province whose department is complete; no district whose province or department is complete. Core rejects a non-canonical selection with `INVALID_DELIVERY_ZONE`; clients produce it with `selectPeruArea`, which absorbs covered entries. |
| Contract compatibility | In `PUT /zones`, `departmentCodes` and `provinceCodes` default to `[]` so existing callers and fixtures that send only `districtCodes` keep working. Responses always carry the three arrays. Older mobile builds reject the new zone fields; the app is not in production, so no compatibility shim is added. |
| Geography helpers | `shared/peru-geography.ts` gains the area selection type and pure helpers (parse, includes, expand, select, entries) used by core, web and mobile. `parsePeruDistrictCode` keeps rejecting province and department codes. |
| Overlap warning | Client side: for each other enabled zone, the size of the intersection of both expanded selections. Not enforced by core. Disabled zones are ignored. |
| Existing zones | District-by-district zones read, edit and quote as before. No conversion or backfill. |
| Deferred | Excluding districts from a whole unit; overlap warning on **Reactivar**. Both are product scope cuts with no data risk, so no Todoist task is created. The country-configurable selector (6hhgPHPcVvfJH253) and generic geography (6hjQ2chgJx6Q3qMV) absorb `selectPeruArea` and the unit marks as one of their capabilities. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| `saveDeliverySettings` | `apps/core/src/features/delivery-settings/application/delivery-settings.ts` | Full replace of `home`, `agency`, `store` with `expectedVersion`; `FOR UPDATE` on the settings row; conflict `DELIVERY_SETTINGS_CONFLICT` with `currentVersion`; couriers carried over. Reused unchanged. |
| Settings contract | `shared/contracts/delivery-settings.ts` (`saveDeliverySettingsSchema`, `storeDeliverySettingsSchema`) | `store.enabled: true` requires a complete `pickupPoint`; disabled accepts `pickupPoint: null`. Reused unchanged. |
| `saveDeliveryZones` | `application/delivery-zones.ts` | Saves the complete list of zones with the shared version, derives company couriers. Modified only through the zone type. |
| `DeliveryZone`, `prepareDeliveryZones`, `parseDeliveryZone` | `domain/delivery-zone.ts` | `districtCodes: readonly [PeruDistrictCode, ...]`, non-empty, unique, validated with `getPeruDistrict`. Modified. |
| `applicableDeliveryOptions` | `domain/quotation.ts:104` | `zone.districtCodes.includes(districtCode)`. Used by `buildQuotationWithRates` (`createQuotation`) and `resolveSelectedDeliveryRate` (`domain/selected-delivery-rate.ts:36`). Modified at one point. |
| Zones repository | `infrastructure/delivery-zones-repository.ts` | `readDeliveryConfiguration` loads all zones with `districts`; `writeDeliveryZones` replaces districts with `deleteMany` + `createMany`. Modified. |
| `DeliveryZoneDistrict` | `apps/core/prisma/schema.prisma:131` | PK `(companyId, zoneId, districtCode)`, FK `(companyId, zoneId)`, index `(companyId, districtCode)`, CHECK `^[0-9]{6}$`, RLS. Model for the new tables. |
| Zones contract | `shared/contracts/delivery-settings.ts` (`deliveryZoneSchema`, `deliveryZoneInputSchema`, `deliveryZonesApiErrorSchema`) | `districtCodes` min 1; error `field` enum without units. Modified. |
| Peru catalog | `shared/peru-geography.ts` | Departments (2-digit), provinces (4-digit, private array), districts (6-digit map) with `getPeruProvinces`, `getPeruDistricts`, `getPeruDistrict`. No department/province lookup by code. Extended. |
| Web screen | `apps/core/app/routes/delivery-settings.tsx` | One react-hook-form with the three switches and pickup fields, submit button «Guardar configuración», `isDirty` notice, `<a href="">` reload, no `clientAction`. Modified. |
| Web zones section | `apps/core/app/components/delivery-zones-section.tsx` | Coverage notices `deliveryZones.missing.*` at the top; `hasEligibleAgency`; list joins `Nombre · código` with `, `; `zoneDraftSchema`; reload by `<a href="">`. Modified. |
| Web selector | `apps/core/app/components/peru-district-multi-select.tsx` | Department/province `select` + district `Combobox`; value `readonly PeruDistrictCode[]`. Modified. |
| Mobile screen | `apps/mobile/src/features/delivery-settings/presentation/delivery-settings-screen.tsx` | Draft + footer button `saveDeliverySettings`; `load()` remounts the zones section with `key={zones-${generation}}`. Modified. |
| Mobile zones section and selector | `presentation/delivery-zones-section.tsx`, `apps/mobile/src/components/peru-district-multi-select.tsx` | Same behavior as web with `Switch` rows and `zoneDistrictRemove` rows. Modified. |
| Mobile API adapter | `infrastructure/delivery-settings-api.ts` | Validates zones with `getPeruDistrict` per code. Modified. |
| Navigation guard | `apps/mobile/src/features/products/presentation/use-product-navigation-guard.ts` | `usePreventRemove` + `showConfirmation`. Pattern reused. |
| Lost web response | `apps/core/app/routes/catalog-settings.tsx:39` | `clientAction` catching `serverAction` failures. Pattern reused. |

## 4. Gaps this design closes

1. No per-change save: the web and mobile forms only save with «Guardar configuración» (§10, §12).
2. No per-row save state, revert or retry; a conflict reload discards the pickup text and the zone draft (§10, §11).
3. The store switch can be turned on in the form without a saved point; nothing models the activation intent (§2, §6.4).
4. Coverage notices live in the zones section and ignore agency eligibility (§6.4).
5. A zone cannot hold a whole department or province (§6.1, §7, §8).
6. Quotation coverage matches only loose districts (§5.3).
7. The selector, the list and the summary only know districts; there is no overlap warning (§6.1, §12).

## 5. Use cases

### 5.1 `saveDeliverySettings` (core, unchanged)

Reused as is for every Part 1 save. Input `{ expectedVersion, home, agency, store }`; output the full `DeliverySettings`; errors `INVALID_DELIVERY_SETTINGS`, `DELIVERY_SETTINGS_CONFLICT` (`currentVersion`, `reason: "stale_version"`), `PERSISTENCE_UNAVAILABLE`, `INVALID_STORED_DATA`.

### 5.2 `saveDeliveryZones` (core, modified through the zone type)

Same input envelope; each `DeliveryZoneInput` gains `departmentCodes` and `provinceCodes`. Flow unchanged: validate version, lock, check version, read agencies and catalog, `syncCouriers`, `prepareDeliveryZones`, save settings, save zones, return the state. `prepareDeliveryZones` passes the three arrays to `parseDeliveryZone`, which validates them with `parsePeruAreaSelection`. New error cases, all `INVALID_DELIVERY_ZONE` with `index`:

| Case | `field` |
| --- | --- |
| No entry in any of the three arrays | `districtCodes` |
| Unknown or duplicate department | `departmentCodes` |
| Unknown or duplicate province, or province of a complete department | `provinceCodes` |
| Unknown or duplicate district, or district of a complete province or department | `districtCodes` |

### 5.3 `createQuotation` and `resolveSelectedDeliveryRate` (core, modified at one point)

`applicableDeliveryOptions(configuration, districtCode)` replaces `zone.districtCodes.includes(districtCode)` with `zoneCoversDistrict(zone, districtCode)`. Nothing else changes: rates, snapshots, locks and errors stay as they are. A district absent from the catalog cannot reach this point because `parseQuotationDestination` already rejects it with `INVALID_DISTRICT`.

### 5.4 Client operations (web and mobile)

Not core use cases: the client decides what to send and how to show it; core still decides validity and version.

| Operation | Builds | Sends |
| --- | --- | --- |
| `toggleMethod(method, enabled)` for `home` / `agency` | `{ ...confirmedRequest, [method]: { enabled } }` | Settings save |
| `toggleStore(true)` with confirmed point | `store: { enabled: true, pickupPoint: confirmed }` | Settings save |
| `toggleStore(true)` without confirmed point | `activating = true`, focus first empty field | Nothing |
| `toggleStore(false)` | `activating = false`; if confirmed enabled, `store: { enabled: false, pickupPoint: confirmed }` | Settings save or nothing |
| `commitPickup(draft)` | See §6.4 | Settings save or field error |
| `reload()` | Load settings and zones; keep pickup draft and zone editor | GETs (web: loader revalidation) |

## 6. Domain and typing

### 6.1 Peru area selection (`shared/peru-geography.ts`)

```ts
export type PeruAreaSelection = Readonly<{
  departmentCodes: readonly PeruDepartmentCode[];
  provinceCodes: readonly PeruProvinceCode[];
  districtCodes: readonly PeruDistrictCode[];
}>;
export type PeruArea =
  | Readonly<{ kind: "department"; code: PeruDepartmentCode }>
  | Readonly<{ kind: "province"; code: PeruProvinceCode }>
  | Readonly<{ kind: "district"; code: PeruDistrictCode }>;
export type PeruAreaSelectionError = Readonly<{
  code: "INVALID_AREA_SELECTION"; message: string;
  field: "departmentCodes" | "provinceCodes" | "districtCodes";
  reason: "empty" | "unknown" | "duplicate" | "covered";
}>;

export function getPeruDepartment(code: string): PeruDepartment | null;
export function getPeruProvince(code: string): PeruProvince | null;
/** Validates codes against the catalog and the canonical rules of §2. */
export function parsePeruAreaSelection(value: unknown): Result<PeruAreaSelection, PeruAreaSelectionError>;
export function peruAreaIncludes(selection: PeruAreaSelection, district: PeruDistrict): boolean;
/** Every catalog district the selection covers, in catalog order; used to count and to intersect. */
export function peruAreaDistricts(selection: PeruAreaSelection): readonly PeruDistrict[];
/** Adds an area absorbing the entries it covers, or removes it with every entry inside it. */
export function selectPeruArea(selection: PeruAreaSelection, area: PeruArea, selected: boolean): PeruAreaSelection;
/** Display order: departments, provinces, districts, each by name (`localeCompare` "es"). */
export function peruAreaEntries(selection: PeruAreaSelection): readonly (PeruArea & Readonly<{ name: string }>)[];
```

- `PeruAreaSelection`: the three arrays already exist as the zone's shape in contracts and UI; one name avoids repeating the triple in core, web and mobile.
- `PeruArea`: one value for "what the seller marked", needed by `selectPeruArea` and `peruAreaEntries`; a pair of nullable codes would be a sentinel.
- `PeruAreaSelectionError`: the catalog has no error that names the field and the reason; core maps it to `INVALID_DELIVERY_ZONE`.
- `selectPeruArea(…, false)` on a department removes the department, its provinces and its districts; on a province, the province and its districts. Absorbed entries are not restored (product rule).
- A selection can be empty in the editor; `parsePeruAreaSelection` rejects empty with `reason: "empty"`.

### 6.2 Delivery zone (`domain/delivery-zone.ts`)

```ts
export type DeliveryZone = Readonly<{ id: DeliveryZoneId; name: string; enabled: boolean; options: readonly DeliveryOption[] }> & PeruAreaSelection;
export type DeliveryZoneInput = (Readonly<{ kind: "new" }> | Readonly<{ kind: "existing"; id: string }>)
  & Readonly<{ name: string; enabled: boolean; departmentCodes: readonly string[]; provinceCodes: readonly string[]; districtCodes: readonly string[]; options: readonly DeliveryOptionInput[] }>;
export type DeliveryZoneError = Readonly<{
  code: "INVALID_DELIVERY_ZONE" | "INVALID_DELIVERY_OPTION"; message: string;
  field?: "id" | "name" | "enabled" | "departmentCodes" | "provinceCodes" | "districtCodes" | "zones" | "options" | "method" | "price" | "agencyIds";
  index?: number; optionIndex?: number;
}>;
export function zoneCoversDistrict(zone: DeliveryZone, districtCode: PeruDistrictCode): boolean;
```

`districtCodes` stops being a non-empty tuple: a zone can be only departments. Non-emptiness moves to the selection as a whole. `zoneCoversDistrict` looks the district up in the catalog and calls `peruAreaIncludes`.

### 6.3 Layers

| Layer | Types and authority |
| --- | --- |
| `shared/peru-geography.ts` | `PeruAreaSelection`, `PeruArea`, catalog checks and canonical form. Pure, no delivery concept. |
| Core domain | `DeliveryZone` (with selection), `zoneCoversDistrict`, `prepareDeliveryZones`. Authority on validity and coverage. |
| Contracts | Three code arrays with format regexes; catalog membership is checked in core and in the mobile adapter. |
| Web and mobile | Draft selection edited with `selectPeruArea`; count, entries and overlap derived with the shared helpers. |

### 6.4 Client save state (web and mobile, presentation)

```ts
type SaveTarget = "store" | "home" | "agency";               // the row that shows the state; pickup saves report on "store"
type RowSaveState =
  | Readonly<{ kind: "idle" }>
  | Readonly<{ kind: "saving"; attempt: number }>
  | Readonly<{ kind: "saved" }>
  | Readonly<{ kind: "failed"; reason: "not_sent" | "in_doubt"; retry: SaveDeliverySettingsRequest }>
  | Readonly<{ kind: "conflict" }>;
```

`RowSaveState`: the screen today has one global `saved`/`error`; per-row state with its retry request is new and has no existing equivalent.

Pickup commit rule (pure function per app, `pickupCommit(confirmed, draft, activating)`):

| Situation | Result |
| --- | --- |
| Draft equal to confirmed point (trimmed) and not `activating` | Nothing |
| Name and address present | Save `store: { enabled: confirmed.enabled \|\| activating, pickupPoint: draft }` |
| Recojo disabled, not `activating`, three fields empty | Save `store: { enabled: false, pickupPoint: null }` |
| Otherwise | Field error on blurred empty required fields; nothing sent; confirmed point kept |

## 7. Persistence

Migration `add_delivery_zone_departments_and_provinces`, generated with `prisma migrate dev --create-only` per the database-migrations skill.

```prisma
model DeliveryZoneDepartment {
  companyId String @default(dbgenerated("(NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid")) @db.Uuid
  company Company @relation(fields: [companyId], references: [id])
  departmentCode String @db.VarChar(2)
  zoneId String @db.Uuid
  zone DeliveryZone @relation(fields: [companyId, zoneId], references: [companyId, id], onDelete: Restrict, onUpdate: NoAction)
  @@id([companyId, zoneId, departmentCode])
}
model DeliveryZoneProvince {
  // same shape with provinceCode VarChar(4)
  @@id([companyId, zoneId, provinceCode])
}
```

- `DeliveryZone` gains `departments DeliveryZoneDepartment[]` and `provinces DeliveryZoneProvince[]`; `Company` gains the back relations.
- SQL additions: `CHECK ("departmentCode" ~ '^[0-9]{2}$')`, `CHECK ("provinceCode" ~ '^[0-9]{4}$')`, `ENABLE` + `FORCE ROW LEVEL SECURITY` and the `delivery_zone_department_company_isolation` / `delivery_zone_province_company_isolation` policies, in the same transaction as `CREATE TABLE`. Grants come from the default privileges of `provision-role.sql`.
- No lookup index by code: quotation reads every zone of the company and filters in memory, as today; the PK prefix `(companyId, zoneId)` serves the per-zone include.
- Canonical form and catalog membership are not enforced in SQL: they depend on the catalog, which lives in code.
- `readDeliveryConfiguration` includes `departments` and `provinces` ordered by code and passes the three arrays to `parseDeliveryZone`; invalid stored codes keep returning `INTERNAL_ERROR` with `delivery_zones_stored_data_invalid`.
- `writeDeliveryZones` replaces the three child sets per zone with `deleteMany` + `createMany`, like districts today (`createMany` skipped for an empty array).
- No production data: no backfill. Existing district-only zones read with empty unit arrays.

## 8. Contracts between applications

`shared/contracts/delivery-settings.ts`:

```ts
const peruDepartmentCodeSchema = z.string().regex(/^\d{2}$/);
const peruProvinceCodeSchema = z.string().regex(/^\d{4}$/);
export const deliveryZoneSchema = z.strictObject({
  id: z.uuid(), name: z.string().min(1).max(120), enabled: z.boolean(),
  departmentCodes: z.array(peruDepartmentCodeSchema), provinceCodes: z.array(peruProvinceCodeSchema),
  districtCodes: z.array(peruDistrictCodeSchema), options: z.array(deliveryOptionSchema),
}).refine(zone => zone.departmentCodes.length + zone.provinceCodes.length + zone.districtCodes.length > 0);
const zoneInputFields = { name: z.string(), enabled: z.boolean(),
  departmentCodes: z.array(peruDepartmentCodeSchema).default([]), provinceCodes: z.array(peruProvinceCodeSchema).default([]),
  districtCodes: z.array(peruDistrictCodeSchema), options: z.array(deliveryOptionInputSchema) };
// deliveryZonesApiErrorSchema.field adds "departmentCodes" | "provinceCodes"
```

- Response: always the three arrays. Request: unit arrays optional, defaulting to `[]`.
- Settings contract (`deliverySettingsSchema`, `saveDeliverySettingsSchema`) unchanged.
- HTTP statuses unchanged: `INVALID_DELIVERY_ZONE` 422, conflict 409.
- Core validates the request with the contract and the domain; the mobile adapter validates the response with the contract and `parsePeruAreaSelection` (replacing the per-code `getPeruDistrict` loop); the web loader builds the response with `deliveryZonesSchema`.
- The web route action keeps its intents; a new `clientAction` turns a lost `serverAction` into `{ error: "in_doubt" }` for settings and `{ zonesError: { code: "INTERNAL_ERROR" } }` for zones, so neither replaces the page with the error boundary.

## 9. Events and cross-feature integration

No events. `orders` keeps consuming `createQuotation` and `resolveSelectedDeliveryRate` through `features/delivery-settings/composition.ts`; their signatures do not change.

## 10. Mobile

| File | Change |
| --- | --- |
| `features/delivery-settings/application/delivery-settings.ts` | `DeliverySettingsDraft` and `saveDeliverySettings` replaced by `settingsRequest(confirmed, change)` and `pickupCommit` (§6.4). `DeliveryZonesError.field` gains the unit fields. |
| `features/delivery-settings/infrastructure/delivery-settings-api.ts` | Zones response validated with `parsePeruAreaSelection` per zone. |
| `features/delivery-settings/presentation/use-instant-delivery-settings.ts` (new) | Save lane: attempt numbers, `RowSaveState` per row, pickup debounce, `activating`, retry, conflict flag; uses `deliverySettings.save`. |
| `features/delivery-settings/presentation/delivery-settings-screen.tsx` | Footer button and global saved/error removed; per-row status text (`ThemedText type="small"`, error with `theme.error`) and **Reintentar**; coverage warnings under the home and agency switches with **Ir a zonas y tarifas** (scrolls to the zones section); `load()` keeps the pickup draft and stops remounting the zones section; `usePreventRemove` guard. |
| `features/delivery-settings/presentation/delivery-zones-section.tsx` | Missing notices removed; list shows `peruAreaEntries` joined with `; `; editor keeps `baseline` and shows the changed-zone notice after reload; overlap notice above **Guardar zona**; empty-selection message. |
| `components/peru-district-multi-select.tsx` | Value becomes `PeruAreaSelection`; `Switch` rows **Todos los distritos de {departamento}** / **de la provincia {provincia}**; disabled province/district controls with the complete text; summary rows with **Quitar {entrada}**. |
| `features/delivery-settings/presentation/translations.ts` | New texts from the product document. |

No local SQLite and no sync queue: delivery settings are online-only, as today.

| Situation | Decision |
| --- | --- |
| Save fails with `NETWORK_ERROR` / `SERVICE_UNAVAILABLE` / `SERVER_ERROR` / `RATE_LIMITED` | Revert the switch, «No se pudo guardar…», **Reintentar** resends the same request |
| `DELIVERY_SETTINGS_CONFLICT` | Revert, conflict notice, switches disabled until **Recargar configuración** |
| Response for a superseded attempt | Ignored |

## 11. Transactions and concurrency

1. Settings save: unchanged transaction (`transaction(companyId)` → `findForUpdate` locks the settings row → version check → write → commit).
2. Zones save: unchanged transaction; the zone write now also replaces department and province rows inside it.
3. Two tabs: each save carries the version the client confirmed; the second gets `DELIVERY_SETTINGS_CONFLICT`. Zone saves and settings saves from the same screen go through the same lane, so they never race each other.
4. Lost response then retry: the retry carries the old version; if the first attempt committed, the retry is a conflict and nothing is applied twice.
5. Quotation: unchanged shared lock on the settings row; coverage is evaluated on the zones read inside that transaction.

## 12. Code organization

| File | Change |
| --- | --- |
| `shared/peru-geography.ts` | §6.1 helpers; province list exposed through `getPeruProvince`. |
| `shared/peru-geography.spec.mjs` | Tests for the helpers. |
| `shared/contracts/delivery-settings.ts` | §8. |
| `apps/core/prisma/schema.prisma`, new migration | §7. |
| `apps/core/src/features/delivery-settings/domain/delivery-zone.ts` | `DeliveryZone` with selection, `zoneCoversDistrict`, parsing with `parsePeruAreaSelection`, new error fields. |
| `apps/core/src/features/delivery-settings/domain/quotation.ts` | `applicableDeliveryOptions` uses `zoneCoversDistrict`. |
| `apps/core/src/features/delivery-settings/infrastructure/delivery-zones-repository.ts` | Read and write the unit rows. |
| `apps/core/src/features/delivery-settings/presentation/zones-response.ts`, `api-routes.ts` | Pass the new fields and error fields through. |
| `apps/core/app/routes/delivery-settings.tsx` | Part 1 web: `clientAction`, settings `useFetcher`, save lane hook, per-row status in `MethodRow` (`FieldDescription` for «Guardando…»/«Guardado», destructive `Alert` + **Reintentar**), coverage warnings, `useRevalidator` reload, `useBlocker` guard; submit button and `isDirty` notice removed. |
| `apps/core/app/components/use-instant-delivery-settings.ts` (new) | Web save lane hook and pure `settingsRequest` / `pickupCommit`, unit tested. |
| `apps/core/app/components/delivery-zones-section.tsx` | Missing notices removed (moved to rows, `hasEligibleAgency` exported and reused); `toDraft`/`toZoneInput`/`zoneDraftSchema` carry the selection; list with `peruAreaEntries` and `; `; overlap `Alert` (informative variant); changed-zone notice; revalidate instead of `<a href="">`. |
| `apps/core/app/components/peru-district-multi-select.tsx` | Value `PeruAreaSelection`; `Checkbox` for whole department/province; disabled controls; summary «{N} distritos seleccionados: {entradas}». |
| `apps/core/app/locales.ts` | New texts. |
| Mobile | §10. |

`delivery-settings/composition.ts` is unchanged. No new feature, port or endpoint.

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `delivery_settings_request_failed` (existing) | error | `api-routes.ts`, web action | `["operation", "entryPoint", "userId", "errorCode", "err"]` |
| `delivery_zones_request_failed` (existing) | error | `api-routes.ts`, web action | `["operation", "entryPoint", "userId", "errorCode", "err"]` |
| `delivery_zones_stored_data_invalid` (existing) | error | `readDeliveryConfiguration` | `["companyId", "zoneId"]`; now also fires for invalid department or province rows |
| `delivery_zones_read_failed` / `delivery_zones_write_failed` (existing) | error | zones repository | `["companyId", "err"]` |

No new events: instant save produces more requests of the same kind, already covered. Clients do not log. Never logged: pickup point text, prices, district lists.

## 14. Tests

### Unit, shared (`shared/peru-geography.spec.mjs`)

- `test("parsePeruAreaSelection accepts departments, provinces and loose districts together")`
- `test("parsePeruAreaSelection rejects an empty selection")`
- `test("parsePeruAreaSelection rejects unknown and duplicate department and province codes")`
- `test("parsePeruAreaSelection rejects a province inside a complete department and a district inside a complete province")`
- `test("peruAreaDistricts counts 225 districts for Arequipa and Cusco complete")`
- `test("peruAreaIncludes covers Cayma through its department and Miraflores through its province, not Huaral")`
- `test("selectPeruArea absorbs loose Cayma when Arequipa is marked and does not restore it when unmarked")`
- `test("peruAreaEntries orders departments, then provinces, then districts by name")`
- `test("parsePeruDistrictCode still rejects province and department codes")`

### Unit, core

- `test("parseDeliveryZone accepts a zone with only whole departments")`
- `test("prepareDeliveryZones reports the index and field of a non-canonical selection")`
- `test("applicableDeliveryOptions applies a zone to a district of its complete department")`
- `test("applicableDeliveryOptions applies a zone to a district of its complete province and not to another province of the department")`
- `test("applicableDeliveryOptions keeps applying district-by-district zones")`
- `test("applicableDeliveryOptions yields one rate per zone when a whole department overlaps a loose district")`
- `test("saveDeliveryZones accepts an input without unit arrays as districts only")`

### Unit, web (`apps/core/app`)

- `test("settingsRequest changes only the toggled method over the confirmed settings")`
- `test("pickupCommit activates store when name and address are saved during an activation attempt")`
- `test("pickupCommit does not send an incomplete point and keeps the confirmed one")`
- `test("pickupCommit clears the point when the three fields are emptied with store disabled")`
- `test("pickupCommit sends nothing when the draft equals the confirmed point")`
- `test("delivery zones section lists whole departments as one entry separated by semicolons")`
- `test("zone overlap counts shared districts with each other enabled zone and ignores disabled ones")`
- `test("zone draft rejects an empty selection with the department, province or district message")`

### Core integration

- `test("delivery zones repository stores and reads whole departments and provinces as units")`
- `test("delivery zone unit rows are isolated by company")`
- `test("PUT /api/delivery-settings/zones saves Arequipa and Cusco complete and returns them unexpanded")`
- `test("PUT /api/delivery-settings/zones rejects a district inside a complete department with 422 and field districtCodes")`
- `test("quotation for Cayma returns the rate of a zone with Arequipa complete and Miraflores gets none")`
- `test("resolving a rate quoted through a complete province succeeds at order creation")`
- `test("settings saves with a stale version after a zones save return a conflict and keep the zones")`

### Mobile (Jest + RNTL)

- `test("toggling home delivery saves it and shows Guardado on its row")`
- `test("a failed agency save reverts the switch and Reintentar resends the same version")`
- `test("a conflict reverts the switch, disables switches and reload keeps the pickup text and zone draft")`
- `test("tapping store pickup without a point opens the fields and activates after name and address are saved")`
- `test("pickup text is saved after the pause and not on every keystroke")`
- `test("leaving with an unsaved pickup text asks for confirmation")`
- `test("agency warning shows next to the switch when the only agency option has no eligible agency")`
- `test("marking Arequipa complete shows one entry and disables its provinces and districts")`
- `test("saved zone with Arequipa and Cusco reopens with both departments complete")`
- `test("overlap notice counts districts shared with another enabled zone")`
- `test("zones response with an unknown department code is an invalid response")`

### Web E2E (Playwright, happy paths)

- `test("seller toggles delivery methods and the pickup point without a save button and they persist after reload")` (`delivery-settings.spec.ts`, replaces the explicit-save journey)
- `test("seller keeps the pickup text and zone draft when reloading after a conflict from another tab")` (`delivery-settings.spec.ts`)
- `test("seller creates Zona sur with Arequipa and Cusco complete and a Cayma buyer gets its rate at checkout")` (`checkout.spec.ts` or `delivery-settings.spec.ts`)
- Existing `agency-delivery`, `store-delivery`, `checkout`, `delivery-without-tariffs` journeys updated to the instant save.

### Pending manual checks

- Mobile on device: toggle a method offline (airplane mode), see the revert and **Reintentar**; back gesture with unsaved pickup text shows the confirmation.
- Web at 390 px: row status, warnings and the whole-department checkbox fit without horizontal scroll.

## 15. Limits and checks during implementation

- Verify that `useBlocker` works with the app's React Router 7 data router setup; if it does not, use `beforeunload` plus the in-app link guard and say so in the task report.
- Verify that `NETWORK_ERROR` is what mobile `api-client.ts` returns offline (line 59) so the not-sent path is reached.
- The web loader revalidates after every fetcher action; the confirmed-snapshot rule (§2) must hold when a revalidation resolves after a newer save.
- The product counts (Arequipa 109, Cusco 116) come from the pinned INEI catalog; the shared test asserts them, so a catalog change updates the test, not the code.
- Out of scope: excluding districts from units, overlap on **Reactivar**, other countries, server-side coverage computation, a PATCH settings endpoint.
