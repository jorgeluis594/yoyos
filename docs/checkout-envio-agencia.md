# Agency delivery in the buyer checkout: product definition

**Status:** definition ready to implement. 19/10/2026. The seller already turns on «Envío a agencia» in Settings → Delivery methods and defines, per zone, agency options with price and destination agencies. The buyer checkout ([Checkout by link](checkout-por-link.md)) offers a single «Envío» radio that mixes home and agency rates in one «Tarifa de envío» dropdown. This document splits that radio and defines how the buyer picks a destination agency. Zones, options, couriers and agencies keep the rules of [Zones, options, couriers and agencies](refactor-zonas-opciones-agencias.md) and [Couriers and delivery options](couriers-y-opciones-de-entrega-decisiones.md). Todoist task 6hpQ6v6PCQ55pgM3.

## Problem and situation

A buyer in Characato (Arequipa) opens the checkout link from WhatsApp, chooses «Envío», selects their district and gets a «Tarifa de envío» dropdown that mixes «Delivery Arequipa» with «Shalom» and «Olva». If they pick an agency rate, a second dropdown lists every agency of that option, including ones across the city, with no sign of which is close. The buyer does not know that «Shalom» means picking up at an agency, picks blindly, or writes to the seller «¿a qué agencia me lo mandas?». The seller then answers by hand what Yoyos already knows: which agencies the business ships to and where each one is.

## Goal

The buyer of a business with «Envío a agencia» active chooses that delivery method explicitly, indicates their district with the current selector and picks their destination agency from one list that shows the closest agencies first (same district, then province, then department), with the price of the business's option.

Hypothesis: fewer agency orders need a chat message to agree on the agency. It would show as fewer agency orders whose agency the seller changes after confirmation.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Buyer who opened the checkout link from WhatsApp or the catalog, usually in the phone's in-app browser, without an account | Know whether they can pick up at an agency, see which agencies near them are available and what it costs | Public web checkout, mobile and desktop |
| Seller who configured zones and agency options | Receive agency orders with the agency already chosen and priced as configured | No changes: Settings → Delivery methods and order detail stay as they are |

## First-version scope

- In «Forma de entrega», the «Envío» radio becomes two radios: «Entrega a domicilio» and «Envío a agencia». «Conservar entrega actual» and «Recojo en tienda · Gratis» stay.
- «Envío a agencia» appears only when the business has the switch on and has coverage: at least one active zone with an active agency option that has at least one eligible agency.
- «Entrega a domicilio» shows only home rates of the buyer's district.
- «Envío a agencia» shows one list of agencies, filtered by the administrative cascade (district → province → department) with its notices, and the no-agencies case.
- Public web checkout in core, mobile (390 px) and desktop (1280 px), with the current components: the same radios, `PeruDistrictSelect`, dropdowns, buttons and status messages. No visual redesign.
- Texts in Spanish and Portuguese.
- Peru, soles, the INEI geography already used by the district selector.

Meeting points with other features:
- Loading real Shalom and Olva agencies (6hpPJM53WPcwJvJ3) only adds agencies; this flow shows them without changes. Until then, production has no agencies and «Envío a agencia» never has coverage, so the radio does not appear.
- Verification on a real phone (6hpPJM2RjMP4FmwV) covers this flow too.

## Out of this version

- Creating or changing delivery methods, zones, options, rates or seller settings: they stay as they are.
- Pricing by the agency's location or changing quotation by zone: the price stays the one of the zone covering the buyer's district.
- Seller web and mobile delivery forms, and the mobile app: the seller already chooses method first and filters rates.
- Maps, coordinates, geolocation or nearest-agency search: the administrative cascade covers the first version.
- Offering agencies of zones that do not cover the buyer's district: the seller decides coverage by adding districts to a zone.
- Loading real agencies (6hpPJM53WPcwJvJ3), geography refactor (6hjQ2chgJx6Q3qMV), the Escape bug (6hp2wX7FfqChCmW3), new couriers.

## Flow

1. The buyer opens the checkout. In «Forma de entrega» they see, in this order and only when available: «Conservar entrega actual» (only with a saved delivery, selected by default as today), «Entrega a domicilio», «Envío a agencia», «Recojo en tienda · Gratis». Without a saved delivery, the first available method is preselected as today: «Entrega a domicilio» if available, else «Envío a agencia», else «Recojo en tienda · Gratis».
2. The buyer selects «Envío a agencia». The current district selector appears: Departamento → Provincia → Buscar distrito → Distrito.
3. On choosing the district, the checkout quotes it as today («Consultando opciones de envío…») and keeps only agency rates.
4. Below the selector the «Agencia de destino» dropdown appears with the agencies of the first cascade level that has any. If the level is province or department, a notice above the dropdown says so.
5. The buyer picks an agency. Each entry shows agency, courier, address, district, province and price. If there is only one, it is preselected. The total adds the price.
6. The buyer fills recipient name, phone, document type and document (mandatory) and confirms as today.

Alternative paths:
- **No agencies at any level:** instead of the dropdown, the no-agencies message with **Cambiar distrito** and, if home delivery is active, **Pasar a Entrega a domicilio**.
- **Home delivery:** the buyer selects «Entrega a domicilio», chooses the district and sees «Tarifa de envío» with home rates only, then address and instructions, as today.
- **Changes the district, province or department:** the chosen agency and rate are cleared, the district is quoted again and the cascade is recalculated.
- **Changes the delivery method radio:** rate, agency and quotation are cleared; the chosen district is kept and quoted again for the new method.
- **Leaves and comes back:** as today, the checkout shows the order's saved delivery under «Conservar entrega actual»; an unconfirmed selection is not kept.

## Screens

**Checkout → Entrega (delivery section):**
- Title «Entrega», group «Forma de entrega» with the radios of step 1. Radios carry no price except «Recojo en tienda · Gratis», as today.
- With no available method (no saved delivery, home off, agency off or without coverage, store off): «No hay modalidades de entrega disponibles», as today.
- **«Entrega a domicilio»:** district selector; «Consultando opciones de envío…» while quoting; dropdown «Tarifa de envío» with «Selecciona una tarifa» and only home rates; then «Dirección de entrega» and «Indicaciones de entrega». Without home rates for the district: «No hay opciones de envío para este distrito. Elige otro distrito.» (or «…Elige otro distrito o recojo en tienda.» when store pickup is active), as today.
- **«Envío a agencia»:** district selector; «Consultando opciones de envío…» while quoting; then one of:
  - Agencies in the buyer's district: dropdown «Agencia de destino» with «Selecciona una agencia», no notice.
  - Agencies only in the province: status notice «No hay agencias en CHARACATO; te mostramos las de la provincia de AREQUIPA», then the dropdown.
  - Agencies only in the department: status notice «No hay agencias en CHARACATO ni en la provincia de AREQUIPA; te mostramos las del departamento de AREQUIPA», then the dropdown.
  - No agencies: status message «No hay agencias disponibles para envío a CHARACATO.» with **Cambiar distrito** and, only if home delivery is active, **Pasar a Entrega a domicilio**.
  - Each dropdown entry: «Agencia Cayma · Shalom · Av. Ejército 1020 · CAYMA, AREQUIPA · S/ 12.00». A free option shows «Gratis» instead of the amount, as today.
  - There is no «Tarifa de envío» dropdown in this mode: the rate is the one of the chosen agency.
  - Then «Nombre del destinatario», «Teléfono del destinatario», «Tipo de documento» and «Documento del destinatario», all mandatory.
- Quote error in either mode: «No se pudieron cargar las tarifas. Tus datos siguen aquí.» with **Reintentar tarifas**, as today.
- **Cambiar distrito** moves focus to the district selector, keeping the current department and province; the buyer changes what they need.
- **Pasar a Entrega a domicilio** selects «Entrega a domicilio», like changing the radio: the district is kept and quoted for home.
- Saved delivery summary under «Conservar entrega actual» for an agency order: «Envío a agencia · S/ 12.00» and «Shalom · Agencia Cayma · Av. Ejército 1020», with «Se conserva la entrega y el importe ya asignados.».
- Same layout and controls on mobile and desktop; the notices and the no-agencies message use the current status message style.

## Rules

| Aspect | Behavior |
| --- | --- |
| When «Envío a agencia» appears | Switch on and coverage: at least one active zone with an active agency option with at least one eligible agency. Without the switch or without coverage the radio does not appear. Coverage is decided when the checkout loads, before the buyer picks a location. |
| When «Entrega a domicilio» appears | When its switch is on, as today. |
| Eligible agency | Associated with the option, enabled, with its courier enabled in the courier catalog and in the business. The cascade never adds agencies outside the business's options. |
| Source of the agencies | Only the agency rates of the buyer's district: active agency options of active zones covering that district, with their eligible agencies. A district whose zone has no agency option sees the no-agencies case, even with agencies in its province. |
| Price | The price of the agency option that includes the agency, quoted for the buyer's district. The agency's location never changes the price. |
| Agency in two options | Shown once, with the lowest price. On equal price, the option whose name comes first alphabetically. |
| Cascade | One list. Shows the first level with agencies: same district as the buyer; else same province; else same department; else no-agencies case. Agencies of lower levels are never mixed with those of a higher level. No groups or headings per level. |
| Location of an agency | The district where the agency is. Province and department come from that district. It is location, not coverage. |
| Place names | District, province and department names appear as in the INEI catalog the district selector uses (uppercase: «CHARACATO», «AREQUIPA»). |
| Agency outside the buyer's department | Never shown. If it is the only one, the buyer sees the no-agencies case. Example: a buyer in Callao (department Callao) does not see agencies in Lima province. |
| Order inside the level | By price ascending, then by agency name, then by courier name. |
| Preselection | With a single agency in the list, it is preselected. |
| Mixed couriers and options | All in the same list, each agency with its courier and its price. |
| Document | Mandatory for agency delivery, as today. |
| Home delivery | Shows only home rates of the district. Agency rates never appear under «Entrega a domicilio». |
| Implicit free shipping | Never. Agency delivery always comes from an option with its configured price; S/ 0.00 only if the seller set it. |
| Clearing on change | District, province or department change: clears agency and rate, quotes again, recalculates the cascade. Delivery method change (radio or **Pasar a Entrega a domicilio**): clears rate, agency and quotation, keeps the district and quotes it again. |

Example with real data: a zone covering Cayma and Characato has option «Shalom» (S/ 12.00, agencies in Cayma and Yanahuara) and option «Olva» (S/ 10.00, agency in Cayma).
- Buyer in Arequipa → Arequipa → Cayma: sees «Olva Cayma · Olva · … · CAYMA, AREQUIPA · S/ 10.00» and «Agencia Cayma · Shalom · … · CAYMA, AREQUIPA · S/ 12.00», no notice, without Yanahuara.
- Buyer in Characato: notice «No hay agencias en CHARACATO; te mostramos las de la provincia de AREQUIPA» and the three agencies of Cayma and Yanahuara, ordered S/ 10.00, S/ 12.00, S/ 12.00 (by agency name on equal price).
- Buyer in Mollendo (Islay province), covered by a zone with that same Shalom option: notice of the department of Arequipa and the agencies of Cayma and Yanahuara.

## When something fails

| Situation | What the buyer sees | What they can do |
| --- | --- | --- |
| Success | The confirmed order with the chosen agency and the total including the option price, as today | Continue to payment |
| Agency disabled or removed from the option before confirming | The checkout quotes again keeping recipient data and location; the cascade is recalculated; the agency is cleared and the buyer is told to pick again, as today with an unavailable rate | Pick another agency or district and confirm |
| Price changed before confirming | The new-total notice, with the form intact, as today | Review and confirm again |
| Agency delivery turned off during the checkout | Rejected on confirm as today; the form keeps the data | Choose another delivery method |
| Quote did not load | «No se pudieron cargar las tarifas. Tus datos siguen aquí.» | **Reintentar tarifas** |
| Confirmation without response | As today in the checkout: verified before repeating, never shown as success | As today |
| Coverage gone between loading and quoting | The no-agencies case for the district | **Cambiar distrito** or **Pasar a Entrega a domicilio** |

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Buyer with the link | Whether the business offers agency delivery with coverage; the eligible agencies for their district with courier, address, district, province and price | Choose method, district and agency; confirm | See zones, option names used internally, disabled agencies or couriers, or agencies of districts not covered |
| Seller | The order with the agency chosen, as today | Nothing new | — |

The coverage the checkout exposes says only whether agency delivery is available, not which zones or districts are covered.

## Information that is kept

Nothing new. On confirm, the order keeps what it keeps today: destination = the buyer's district (the quoted one), the courier and agency chosen with the agency's location, and the option with its price. The label uses the agency's location. Old orders are not changed or migrated. The cascade level and its notice are not stored.

## Vocabulary

- Delivery method: how the buyer receives; «Entrega a domicilio», «Envío a agencia», «Recojo en tienda». «Envío a agencia» is the same name as in the seller's settings, and the saved-delivery summary uses it too.
- Agency: the courier's branch where the buyer picks up; shown in the checkout as «Agencia de destino».
- Coverage: which districts a zone covers. It decides which agencies are offered; the agency's own district does not.
- Cascade level: district, province or department of the buyer used to filter agencies by their location.

## Closed decisions

| Decision | Why |
| --- | --- |
| «Envío a agencia» is the method the seller already turns on; no new model | Reuses zones, options and agencies already configured |
| The buyer picks department → province → district with the current selector | Same geography and component already in the checkout |
| One list filtered by administrative cascade, no groups or headings | Shows the closest agencies without a map and without extra structure |
| Only the buyer checkout changes; seller forms do not | The seller already chooses method first |
| Price is the option's, quoted for the buyer's district | Coverage and price are per zone; the agency's location is not a price |
| The radio is called «Envío a agencia» | Same name as in settings |
| A district whose zone has no agency option sees the no-agencies case | Coverage is per zone; the seller decides it |
| An agency in two options is shown once with the lowest price | The buyer picks a place, not an option |
| No checkout redesign | The flow adapts to the current components and styles |

## Acceptance criteria

1. A business with home, agency (with coverage) and store active: a buyer without saved delivery sees «Entrega a domicilio», «Envío a agencia» and «Recojo en tienda · Gratis», with «Entrega a domicilio» selected. Without home, «Envío a agencia» is selected; with only store, «Recojo en tienda · Gratis».
2. The same business with the agency switch off, or with the switch on and no active agency option with eligible agencies: «Envío a agencia» does not appear.
3. Zone covering Cayma with «Shalom» S/ 12.00 (agencies in Cayma and Yanahuara) and «Olva» S/ 10.00 (agency in Cayma). Buyer chooses «Envío a agencia», Arequipa → Arequipa → Cayma: sees only the two Cayma agencies, Olva S/ 10.00 first, each with name, courier, address, district, province and price, no notice, without Yanahuara.
4. Same zone also covering Characato: buyer in Characato sees «No hay agencias en CHARACATO; te mostramos las de la provincia de AREQUIPA» and the three agencies of Cayma and Yanahuara.
5. Zone covering Mollendo with the same Shalom option: buyer in Mollendo sees the department notice and the agencies of Cayma and Yanahuara.
6. Zone covering Mollendo whose option has only an agency in Lima: buyer in Mollendo sees «No hay agencias disponibles para envío a MOLLENDO.» with **Cambiar distrito** and, with home active, **Pasar a Entrega a domicilio**; with home off, only **Cambiar distrito**.
7. Buyer in Yura (Arequipa), covered only by a zone with home options, while another zone of the province has agency options: sees the no-agencies case.
8. The Cayma agency of Shalom also belongs to a second option «Shalom express» at S/ 15.00 that covers Cayma: it appears once, at S/ 12.00.
9. A disabled agency, an agency of a disabled courier or an agency not associated with any option never appears.
10. Buyer in Cayma with a single eligible agency: it is preselected and the total includes its price.
11. Buyer in Cayma picks the Olva agency, fills name, phone, DNI and confirms: the order keeps Cayma as destination, Olva and its agency with its location, and the Olva option at S/ 10.00; the total includes S/ 10.00.
12. Buyer picks an agency and changes the district to Characato: agency and rate are cleared, the district is quoted again and the province notice appears.
13. Buyer picks an agency in Cayma and switches to «Entrega a domicilio»: agency and rate are cleared, Cayma stays selected and home rates of Cayma are shown.
14. Buyer in the no-agencies case presses **Pasar a Entrega a domicilio**: «Entrega a domicilio» is selected with the same district and home rates are shown.
15. Before confirming, the seller disables the chosen agency: on confirm the checkout quotes again, keeps recipient data and district, recalculates the list without that agency and asks to pick again.
16. Before confirming, the seller changes the Olva price to S/ 11.00: the buyer sees the new-total notice with the form intact.
17. Under «Entrega a domicilio» in Cayma, «Tarifa de envío» lists only home rates; under «Envío a agencia» there is no «Tarifa de envío» dropdown.
18. Checkout link of an order with a saved agency delivery: «Conservar entrega actual» is selected and shows «Envío a agencia · S/ 12.00» and «Shalom · Agencia Cayma · Av. Ejército 1020»; the buyer can switch to the new flow.
19. «Recojo en tienda» and «Conservar entrega actual» behave as today; old orders show as today.
20. The flow works at 390 px and 1280 px with the current components and styles.
