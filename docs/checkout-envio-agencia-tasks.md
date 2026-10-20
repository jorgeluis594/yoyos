# Agency delivery in the buyer checkout: implementation tasks

**Status:** design closed (diseño cerrado), pending implementation. Product: [`docs/checkout-envio-agencia.md`](checkout-envio-agencia.md). Design: [`docs/checkout-envio-agencia-technical.md`](checkout-envio-agencia-technical.md) (`§` references point to it). Integration branch: `jorgeluis594/tarea-6hpQ6v6PCQ55pgM3`.

## Order and parallelism

```text
Wave 1   T1 Agency coverage in contract and loader     T2 Cascade list (pure functions)
               │                                              │
Wave 2         └────────────── T3 Web checkout by method ─────┘
```

Implementers run one at a time in this same worktree, so the execution order is **T1 → T2 → T3**. T1 and T2 share no files and either could go first; T3 needs both.

| Task | Depends on | Files it owns |
|---|---|---|
| T1 Coverage in contract and loader | — | `shared/contracts/order-checkout.ts`, `apps/core/src/features/delivery-settings/domain/quotation.ts` (+ test), `delivery-settings/application/get-checkout-delivery-options.ts` (+ test), `delivery-settings/composition.ts`, `delivery-settings/infrastructure/delivery-zones-repository.integration.test.ts`, `apps/core/app/routes/checkout.tsx`, `apps/core/app/routes/checkout.test.ts`, `checkout-appearance/presentation/preview-fixtures.ts`, `orders/presentation/checkout-contracts.test.ts`, the `options` fixture in `apps/core/app/components/checkout-delivery-fields.test.tsx` |
| T2 Cascade list | — | `apps/core/app/checkout-agency-choices.ts` (+ test) |
| T3 Web checkout by method | T1, T2 | `apps/core/app/components/checkout-agency-destination.tsx` (+ test), `apps/core/app/components/checkout-delivery-fields.tsx` (+ test), `apps/core/app/locales.ts`, `apps/core/tests/e2e/checkout.spec.ts`, `checkout-appearance-buyer.spec.ts`, `delivery-settings.spec.ts` |

T3 only reads what T1 (`CheckoutDeliveryOptions` with `agency.covered`) and T2 (`agencyChoices`, `chosenAgency`, `buyerAgencyLabel`) export and does not edit their files.

## T1. Agency coverage in the public contract and its loader

**Scope:**
- `checkoutDeliveryOptionsSchema.agency` with `covered: boolean` (§8).
- `hasAgencyCoverage` exported from `quotation.ts`, reusing `eligibleAgencies` (§6).
- Use case `getCheckoutDeliveryOptions` and its composition in `deliverySettings` (§5.1).
- The loader in `routes/checkout.tsx` uses `getCheckoutDeliveryOptions` instead of `getForCompany` and builds `agency: { enabled, covered }`; 503 on failure as today. The spies in `checkout.test.ts` move to `getCheckoutDeliveryOptions`.
- `previewDeliveryOptions` and the `options` fixture of `checkout-delivery-fields.test.tsx` get `covered: false` so typecheck stays green.
- The web checkout compiles with no visible change: until T3 the «Envío» radio still uses `home.enabled || agency.enabled`.

**Out of scope:** behavior of `checkout-delivery-fields.tsx`, texts, e2e, quotation, confirmation, `getForCompany` (still used by `orders`), mobile and seller.

**Acceptance criteria:**
1. Business with the agency switch on, an enabled zone with an enabled agency option and an enabled agency of an enabled courier: the loader returns `agency: { enabled: true, covered: true }`.
2. Same business with the only agency's courier disabled for the company: `covered: false`, `enabled: true`.
3. Business without zones or with only home options: `covered: false`.
4. The configuration read fails: the loader answers 503 and returns no delivery options.
5. The response contains no zones, districts, agencies or couriers.
6. Core typecheck, lint, unit and the integration test of `delivery-zones-repository.integration.test.ts` green.

**Tests it leaves green (§14):** the new ones in `quotation.test.ts`, `get-checkout-delivery-options.test.ts`, `checkout-contracts.test.ts`, `routes/checkout.test.ts` and `delivery-zones-repository.integration.test.ts`, plus the existing tests of those files.

**Depends on:** nothing.

## T2. Cascade list of agencies

**Scope:**
- `agencyChoices(rates, districtCode)`, `chosenAgency(choices, agencyId)` and `buyerAgencyLabel` in `apps/core/app/checkout-agency-choices.ts` (§5.2): agency rates only, dedup by agency with lowest price and tie by option name, level district → province → department → `none`, order by price, agency and courier, derived preselection and recovery.
- Unit tests with the product example and real INEI codes from `shared/peru-geography.ts` (Cayma `040103`, Characato `040105`, Yanahuara `040126`, Mollendo `040701`, Callao `070101`, Miraflores `150122`).

**Out of scope:** the checkout components, texts, `app/rate-label.ts` and any server change.

**Acceptance criteria:**
1. Rates Shalom (S/ 12.00: Agencia Cayma, Agencia Yanahuara) and Olva (S/ 10.00: Olva Cayma); district Cayma: `level: "district"` with Olva Cayma then Agencia Cayma.
2. Same rates, district Characato: `level: "province"` with Olva Cayma, Agencia Cayma, Agencia Yanahuara.
3. Same rates, district Mollendo: `level: "department"` with the three agencies.
4. Only agency in Miraflores (Lima), district Mollendo: `level: "none"`. Agency in Miraflores, district Callao: `level: "none"`.
5. Only home rates: `level: "none"`.
6. Agencia Cayma also in «Shalom express» at S/ 15.00: appears once with the S/ 12.00 `rateId` and price; with two options at equal price, the one whose name sorts first wins.
7. One choice: `chosenAgency` returns it with an empty `agencyId`; an `agencyId` absent after requote returns `null`; a present one returns the choice with the requoted price.
8. `buyerAgencyLabel` produces «Agencia Cayma · Shalom · Av. Ejército 1020 · CAYMA, AREQUIPA · S/ 12.00» and «Gratis» for price 0.
9. Core typecheck, lint and unit green.

**Tests it leaves green (§14):** those of `checkout-agency-choices.test.ts`.

**Depends on:** nothing.

## T3. Web checkout by delivery method with the cascade list

**Scope:**
- `CheckoutAgencyDestination` (§5.3): notices, dropdown and no-agencies case with **Cambiar distrito** and **Pasar a Entrega a domicilio**.
- `CheckoutDeliveryFields` with modes `home` and `agency` instead of `ship` (§5.4): radios «Entrega a domicilio» and «Envío a agencia» (the latter with `enabled && covered`), today's preselection mapped to the new modes (`keep`, else `home`, else `agency` with coverage, else `store`), home with home rates only, agency with `agencyChoices` and `chosenAgency`, document fields in agency mode, draft with the choice's `rateId` and price.
- Clearing on district or method change and recovery after `recoveryVersion`, with the current behavior; **Cambiar distrito** focuses the «Distrito» select.
- Texts of §12 in `app/locales.ts` (es and pt); `method.agency` becomes «Envío a agencia»; `ship` removed.
- New e2e of §14 and migration of the existing buyer checkout e2e listed there.

**Out of scope:** contract, loader, `checkout-agency-choices.ts` (used as T1 and T2 leave them; a defect is reported to the coordinator), `PeruDistrictSelect`, `rate-label.ts`, seller form, mobile, quotation, confirmation and visual style.

**Acceptance criteria:**
1. Business with home, agency with coverage and store, no saved delivery: radios «Entrega a domicilio» (selected), «Envío a agencia», «Recojo en tienda · Gratis», no «Envío». Without home, «Envío a agencia» is selected; with only store, «Recojo en tienda · Gratis».
2. Agency switch off or `covered: false`: no «Envío a agencia».
3. Buyer in Cayma with the example zone: «Agencia de destino» lists Olva Cayma and Agencia Cayma, no notice, no «Tarifa de envío»; confirms Olva Cayma with DNI, reaches payment and the order keeps Cayma, Olva, the agency with its location and the S/ 10.00 option.
4. Buyer in Characato: notice «No hay agencias en CHARACATO; te mostramos las de la provincia de AREQUIPA» and the three agencies.
5. Covered district without agencies in its department: «No hay agencias disponibles para envío a {DISTRITO}.» with **Cambiar distrito** and, only with home on, **Pasar a Entrega a domicilio**, which selects home and quotes the same district.
6. With an agency chosen, Cayma → Characato clears the agency and shows the province notice; switching to «Entrega a domicilio» clears agency and rate, keeps the district and lists only home rates.
7. A single agency in the list is preselected and the total includes it.
8. Agency disabled before confirming: unavailable-rate notice, district and recipient kept, list recalculated without that agency, buyer picks another and confirms.
9. Order with a saved agency delivery: opens on «Conservar entrega actual» with «Envío a agencia · {price}» and «courier · agency · address».
10. «Recojo en tienda» and «Conservar entrega actual» work as today.
11. The agency flow works at 390 px.
12. Core typecheck, lint, unit, integration and e2e green.

**Tests it leaves green (§14):** those of `checkout-agency-destination.test.tsx` and `checkout-delivery-fields.test.tsx`, the new e2e of `checkout.spec.ts`, the migrated ones of `checkout.spec.ts` and `checkout-appearance-buyer.spec.ts`, plus `delivery-settings.spec.ts`, `buyer-payment.spec.ts`, `public-catalog.spec.ts`, `mobile-checkout.spec.ts`, `agency-delivery.spec.ts` and `store-delivery.spec.ts` unchanged.

**Depends on:** T1 and T2.

## Final verification

- Manual local check with test agencies in Cayma, Yanahuara and Lima (as `apps/core/prisma/catalog/agencies-example.sql`) and the example zone, at 390 px and 1280 px: Cayma, Characato, a district without zone, district change, method change and an agency disabled before confirming; check order detail and label.
- Production: the radio appears only once real agencies exist (`6hpPJM53WPcwJvJ3`). Real phone verification (`6hpPJM2RjMP4FmwV`) covers this flow.
