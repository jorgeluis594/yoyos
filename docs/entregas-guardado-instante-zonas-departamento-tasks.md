# Instant delivery settings save and whole-department zones: implementation tasks

**Status:** pending. Design: `docs/entregas-guardado-instante-zonas-departamento-technical.md`. Product: `docs/entregas-guardado-instante-zonas-departamento.md`.

## Order and parallelism

```text
T1 (Part 1 web) ─▶ T2 (Part 1 mobile) ─▶ T3 (Part 2 core + shared) ─▶ T4 (Part 2 web) ─▶ T5 (Part 2 mobile)
```

Strictly sequential, one worker at a time in the same worktree and branch. Part 1 is finished before Part 2 starts. Each task leaves typecheck, lint and the tests of the apps it touches green.

## T1. Part 1 web: instant save of methods and pickup point

**Scope:** `apps/core/app/routes/delivery-settings.tsx`, new `apps/core/app/components/use-instant-delivery-settings.ts`, `delivery-zones-section.tsx` (coverage notices moved out, reload by revalidation, changed-zone notice), `apps/core/app/locales.ts`. Design §2 (save lane, pickup moment, activation intent, web failure classification, retry, late responses, confirmed snapshot, coverage warnings, leave guard), §5.4, §6.4, §8 (`clientAction`). Update the affected E2E journeys (`delivery-settings`, `store-delivery`, `agency-delivery`, `checkout`, `delivery-without-tariffs`) and their helpers to the instant save.
**Out of scope:** mobile; any server, contract or schema change; zone units.
**Acceptance criteria:**
1. At 390 and 1280 px, toggling «Entrega a domicilio» shows «Guardando…» then «Guardado» on its row; after reload it stays on. Same for agency and for turning either off. No «Guardar configuración» nor «Tienes cambios sin guardar.».
2. With the browser offline, toggling agency reverts the switch and shows «No se pudo guardar. Revisa tu conexión y vuelve a intentarlo.» with **Reintentar**; online, **Reintentar** saves it.
3. A lost action response reverts to the last confirmed state, shows «No pudimos confirmar el guardado.» and never «Guardado»; **Reintentar** after an applied save ends in the conflict notice.
4. Two tabs: tab A turns agency off; tab B, with a zone draft open and «Av. Ejército 101» typed in the address, toggles home and sees the conflict notice; **Recargar configuración** shows agency off and keeps the draft and the text.
5. Without a pickup point, tapping «Recojo en tienda» keeps it off, opens the fields, shows «Completa el nombre y la dirección para activar el recojo.» and focuses the name; after «Tienda Cercado» and «Calle Mercaderes 210» and leaving the address, the switch turns on with «Guardado» and persists after reload.
6. Editing the instructions saves once after the pause or on blur, not per keystroke; emptying the name with store on shows «Completa los campos obligatorios.» and keeps the saved name.
7. Agency on with the only agency option lacking an eligible agency shows «Falta una opción de agencia activa con cobertura» and **Ir a zonas y tarifas** under the switch; saving a zone option with an eligible agency removes it without reload. The zones section no longer shows coverage notices.
8. Leaving with a pickup text pending or failed asks «Hay cambios del punto de recojo sin guardar.» with **Salir sin guardar** and **Seguir editando**.
**Tests:** the web unit tests of §14 for `settingsRequest` and `pickupCommit`; E2E «seller toggles delivery methods and the pickup point without a save button and they persist after reload» and «seller keeps the pickup text and zone draft when reloading after a conflict from another tab»; the updated existing journeys.
**Depends on:** nothing.

## T2. Part 1 mobile: instant save of methods and pickup point

**Scope:** `apps/mobile/src/features/delivery-settings/application/delivery-settings.ts`, new `presentation/use-instant-delivery-settings.ts`, `delivery-settings-screen.tsx`, `delivery-zones-section.tsx` (notices moved out, no remount on reload, changed-zone notice), `translations.ts`. Design §2 (mobile failure classification), §6.4, §10.
**Out of scope:** web; server; zone units.
**Acceptance criteria:** the T1 criteria 1, 2, 4–8 on the mobile screen (offline = `NETWORK_ERROR`; no in-doubt text on mobile), with per-row status in the small text and errors in the error text the screen already uses, and **Ir a zonas y tarifas** scrolling to the zones section.
**Tests:** the Part 1 mobile tests of §14 (`toggling home delivery…`, `a failed agency save…`, `a conflict reverts…`, `tapping store pickup…`, `pickup text is saved after the pause…`, `leaving with an unsaved pickup text…`, `agency warning shows…`); existing `delivery-settings-screen.test.tsx` updated.
**Depends on:** T1.

## T3. Part 2 core and shared: zones with whole departments and provinces

**Scope:** `shared/peru-geography.ts` helpers (§6.1) and their tests; `shared/contracts/delivery-settings.ts` (§8); Prisma schema and migration `add_delivery_zone_departments_and_provinces` with the database-migrations skill (§7); `domain/delivery-zone.ts`, `domain/quotation.ts`, `infrastructure/delivery-zones-repository.ts`, `presentation/zones-response.ts`, `presentation/api-routes.ts`; mobile adapter validation in `infrastructure/delivery-settings-api.ts` and the `field` union in mobile `application/delivery-settings.ts` so mobile keeps typechecking. Web `toDraft`/`toZoneInput` pass empty unit arrays through so the web keeps compiling, with no UI change.
**Out of scope:** selector, list, summary and overlap UI on web and mobile.
**Acceptance criteria:**
1. `PUT /api/delivery-settings/zones` with a new zone `departmentCodes: ["04", "08"]`, no districts, and a home option of S/ 15.00 returns 200 with those codes unexpanded; `GET` returns the same.
2. A quotation for Cayma (`040103`) and one for a Cusco district return the «Zona sur» rate; Miraflores (`150122`) does not.
3. A zone with `provinceCodes: ["1501"]` quotes Miraflores and not Huaral.
4. Sending `departmentCodes: ["04"]` with `districtCodes: ["040103"]` returns 422 `INVALID_DELIVERY_ZONE` with `field: "districtCodes"` and the zone `index`.
5. A request without the unit arrays saves a district-only zone as before; existing fixtures and E2E pass unchanged.
6. Unit rows are invisible to another company.
**Tests:** the shared and core unit tests and the core integration tests of §14.
**Depends on:** T2.

## T4. Part 2 web: department and province marks, list, overlap

**Scope:** `apps/core/app/components/peru-district-multi-select.tsx`, `delivery-zones-section.tsx` (draft schema with selection, list entries, overlap `Alert`, empty message), `apps/core/app/locales.ts`; E2E for the Zona sur journey. Design §6.1 usage, §12.
**Out of scope:** mobile; exclusions inside a unit; overlap on **Reactivar**.
**Acceptance criteria:**
1. Marking **Todos los distritos de Arequipa** and **Todos los distritos de Cusco** shows «225 distritos seleccionados: Arequipa, todos los distritos; Cusco, todos los distritos» and never lists their districts; with Arequipa visible, its province select and district list are disabled with «Arequipa ya está completo en la zona.».
2. After saving «Zona sur» the list shows «Arequipa, todos los distritos; Cusco, todos los distritos»; **Editar** reopens with both complete, on Arequipa.
3. Province Lima complete shows «Lima (provincia), todos los distritos» in summary, list and reopen.
4. With Cayma loose, marking Arequipa leaves «109 distritos seleccionados: Arequipa, todos los distritos»; unmarking leaves no Arequipa entries.
5. With «Arequipa ciudad» enabled covering Cayma, marking Arequipa shows «Comparte 1 distrito con Arequipa ciudad. Esos distritos recibirán las tarifas de ambas zonas.» above **Guardar zona**; saving is allowed.
6. Saving with no entry shows «Selecciona al menos un distrito, provincia o departamento.».
7. A district-by-district zone with Miraflores and San Isidro lists «Miraflores · 150122; San Isidro · 150131» and edits as before.
**Tests:** web unit tests of §14 for the list, overlap and draft; E2E «seller creates Zona sur with Arequipa and Cusco complete and a Cayma buyer gets its rate at checkout».
**Depends on:** T3.

## T5. Part 2 mobile: department and province marks, list, overlap

**Scope:** `apps/mobile/src/components/peru-district-multi-select.tsx`, `features/delivery-settings/presentation/delivery-zones-section.tsx`, `translations.ts`. Same behavior as T4 with `Switch` rows for the whole marks and summary rows with **Quitar {entrada}**.
**Out of scope:** web; server.
**Acceptance criteria:** T4 criteria 1–7 on mobile, with **Quitar Arequipa** removing the department and all its districts.
**Tests:** the Part 2 mobile tests of §14 (`marking Arequipa complete…`, `saved zone with Arequipa and Cusco reopens…`, `overlap notice counts…`); existing selector and zones section tests updated.
**Depends on:** T4.

## Final verification

- `pnpm --dir apps/core typecheck lint test:unit`, `sh scripts/run-tests.sh integration`, `sh scripts/run-tests.sh e2e` (including `delivery-settings`, `agency-delivery`, `store-delivery`, `checkout`, `delivery-without-tariffs`); `pnpm --dir apps/mobile typecheck lint test`.
- Manual on device: offline toggle with revert and **Reintentar**; back gesture with unsaved pickup text; Zona sur with Arequipa and Cusco created on mobile and quoted from the web checkout for Cayma.
- Web at 390 px: row status, coverage warnings and whole-department checkbox without horizontal scroll.
