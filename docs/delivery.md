# Delivery

How a company configures delivery and how an order gets its delivery. The schema lives in [`apps/core/prisma/schema.prisma`](../apps/core/prisma/schema.prisma); the HTTP contracts in [`shared/contracts/delivery-settings.ts`](../shared/contracts/delivery-settings.ts), [`shared/contracts/quotations.ts`](../shared/contracts/quotations.ts) and [`shared/contracts/orders.ts`](../shared/contracts/orders.ts). Server code is in `apps/core/src/features/delivery-settings` and `apps/core/src/features/orders`.

## Delivery methods

A company offers up to three methods, each enabled independently in its delivery settings:

| Method | What the buyer gets |
| --- | --- |
| Home (`home`) | Delivery to an address in a Peru district. |
| Agency (`agency`) | Shipment to a courier agency, where the recipient collects it. |
| Store pickup (`store`) | Pickup at the company's pickup point (name, address, optional instructions). |

- Disabling a method keeps its data (for example the pickup point), so re-enabling it restores the previous configuration.
- Home and agency are priced through zones and options; store pickup has no price.
- Home and agency can be enabled without coverage. Store pickup cannot be enabled without a saved pickup name and address. Reason: a buyer cannot choose a pickup without an address, while a missing zone is shown to the seller as a warning.
- **Coverage:** the places a method delivers to, given by the enabled zones and their enabled options. It is not the price (rate) and not the method itself; a method «has coverage» when at least one place is covered. This one meaning governs what the buyer's [checkout](checkout.md#delivery-choice) offers and the seller's [coverage warnings](#settings-screen) on web and mobile, and is computed by one pure rule in [`shared/delivery-coverage.ts`](../shared/delivery-coverage.ts) that core, web and mobile all call. Reason: a method hidden from buyers must never go unnoticed by the seller, and a second meaning would drift.
  - **Home coverage of a district:** an enabled zone that covers the district has an enabled home option.
  - **Agency coverage of a district:** an enabled zone that covers the district has an enabled agency option with at least one eligible agency (enabled catalog agency, enabled catalog courier, enabled company courier) located in that district's department. Reason: the checkout's agency list never shows agencies outside the buyer's department, so a district without one there would end in «No hay agencias disponibles…»; an agency option without eligible agencies is never quoted, so counting it would hide the gap.
  - **Agency coverage of the company:** at least one district has agency coverage; equivalently, an enabled zone has an enabled agency option with an eligible agency located in a department the zone covers in whole or in part. A zone that covers only Cusco with agencies only in Arequipa gives no agency coverage at all; a zone over Arequipa, Cusco and Puno with agencies only in Arequipa covers Arequipa only.
  - Coverage ignores the method switches; a switched-off method offers nothing to the buyer whatever its zones.
  - The [quotation](#quotation) and [assignment](#assigning-delivery-to-an-order) rules for agency are not bounded by department and are not called coverage.

## Zones and options

- **Zone:** a company-defined area of Peru with a name and an enabled flag. It has no method and no price. Reason: one zone can offer several ways to ship (for example "Lima" with "Home S/10", "Shalom S/8" and "Olva S/9").
- A zone's area combines whole departments, whole provinces and loose districts, with at least one entry. A whole department or province is stored as that unit, never expanded into districts. Reason: the zone reopens as the seller marked it and covers districts the catalog adds later; marking 225 districts one by one was impractical.
- The area is canonical: no duplicates, no province inside a whole department and no district inside a whole province or department. Marking a whole unit absorbs the entries it covers; unmarking it removes all of them and does not restore absorbed entries. The geography helpers live in [`shared/peru-geography.ts`](../shared/peru-geography.ts).
- No district can be excluded from a whole unit. A different price for one district is a separate zone with that district.
- Zones are listed as entries separated by "; ": whole departments ("Arequipa, todos los distritos"), then whole provinces ("Lima (provincia), todos los distritos"), then loose districts ("Miraflores · 150122"), each group by name. "(provincia)" tells the Arequipa province from the Arequipa department. The districts of a whole unit are never listed; the editor only shows their count.
- **Option:** belongs to one zone and has one method (`home` or `agency`), a name, a price and an enabled flag. The price depends only on the option.
- Option names are unique within a zone, case-insensitive. Rates expose the zone name so options with the same name in different zones can be told apart.
- An existing option cannot change its zone or method.
- Zones, options and company couriers are disabled, never deleted. Reason: existing orders and rates reference them.
- A district may belong to several zones; each applicable option produces its own rate. Overlap is allowed; while editing a zone, the editor warns how many districts it shares with each other enabled zone, without blocking the save. Disabled zones are not counted because they produce no rates.
- Districts come from the official Peru district catalog in [`shared/peru-geography.ts`](../shared/peru-geography.ts). Location is never free text; address and reference are.
- A home option has no courier. A courier that delivers to homes, or the company's own delivery, is represented as a home option named after it (for example "Dinsides").

## Couriers and agencies

- **Courier catalog:** a system catalog shared by all companies, defined in [`apps/core/prisma/catalog/couriers.json`](../apps/core/prisma/catalog/couriers.json) and loaded by an idempotent seed that upserts by `code`. A courier is retired with `enabled: false`, never removed. The catalog currently holds Shalom and Olva Courier.
- **Agency catalog:** system data shared by all companies. Each agency belongs to a catalog courier and has a name, an address and a catalog district. The team maintains it with SQL outside the app (rules in [`apps/core/prisma/catalog/README.md`](../apps/core/prisma/catalog/README.md)); the app has read-only access and no route or screen writes agencies. Reason: agencies are the same for every company, so each company should not retype them.
- An agency's district is its physical location, not coverage: it does not depend on the company's zones.
- **Agency option:** the company chooses a courier and some of its agencies for each agency option. The buyer chooses among those agencies; there is no automatic proximity-based list of pickup points (rejected: Shopify-style generated pickup points), because the company decides where it ships from.
  - A new agency option cannot be saved without agencies.
  - Its agencies belong to a single courier. Options stored before this rule with mixed couriers stay saveable until their agencies change.
  - The option name is prefilled with the chosen courier's name until the company edits it.
- **Company couriers** are derived when zones are saved: one company courier per courier referenced by any agency option (even a disabled one), enabled only if an enabled option in an enabled zone uses it. Saving delivery settings does not create or change couriers. A company stops shipping with a courier by disabling or removing its agencies from the option. Reason: the agency choice already says which couriers the company uses, so a separate courier list would drift.
- Enabling agency delivery does not require an enabled courier: an agency option without eligible agencies simply does not apply.

## Settings writes

- Every write to delivery settings or zones increments the company's settings `version` and requires the `expectedVersion` the client read; a mismatch returns `DELIVERY_SETTINGS_CONFLICT` with the current version and nothing is written. Reason: web and mobile can edit the same settings concurrently.
- New IDs (zones, options, company couriers) are generated by the server after the version check.
- A write never drops existing zones, options or couriers; option–agency associations are replaced.
- Catalog changes (couriers, agencies) do not change any company's version; quoting and resolving always read their current state.
- The dispatch label sender is not part of delivery settings: it is saved on its own, without `version` or `expectedVersion`. Saving it never causes `DELIVERY_SETTINGS_CONFLICT`, and saving delivery settings never touches it. Reason: it is company identity used only by labels, and mixing it into the versioned write would create false conflicts between web and mobile.

## Settings screen

The seller configures delivery in Configuración → Entregas, on web (`settings/delivery`) and mobile, with the same behavior, except for the **Remitente** card, which exists only on the web.

- Each method switch saves as soon as it is toggled; there is no save button. Reason: methods turned on in the form but never saved were lost.
- The client sends the last confirmed settings with exactly that one change, through the existing full-replace save with `expectedVersion`. Reason: the version already detects any concurrent change, so no partial-update endpoint is needed.
- One save at a time per screen: method, pickup point and zone saves share one lane, and the switches are disabled while a save is in flight.
- Each method row shows its own state: saving, saved, or an error with **Reintentar**. A failed save reverts the switch. **Reintentar** resends the same request with the same version, so a change that was already applied answers as a conflict and is never applied twice. A response from a superseded attempt is ignored.
- On a version conflict the switch reverts and **Recargar configuración** reloads the methods, pickup point and zones, keeping the unsaved pickup text and the open zone draft. If the zone being edited changed on the server, the editor says so before the draft overwrites it.
- **Pickup point:** saved on blur or after 1.5 seconds without typing, never per keystroke; name, address and instructions are saved together. An incomplete point is never sent: the empty required field shows an error and the last saved point is kept. With store pickup disabled, emptying the three fields clears the point.
- Tapping the store switch without a saved point keeps it off, opens the fields and focuses the first empty one; store pickup turns on with the first save that completes name and address. This intent is not stored: leaving the screen or turning the switch off cancels it.
- Leaving the screen with pickup text pending or failed asks for confirmation.
- **Remitente** (web only): a card after the methods and before the zones, with the sender name and optional phone printed on dispatch labels (rules in [dispatch-preparation.md](dispatch-preparation.md#sender)). The name's placeholder shows the company name, which is used when the name is left empty. It saves on blur or after 1.5 seconds without typing, never per keystroke, outside the delivery settings lane, with the same saving, saved and error with **Reintentar** states; text typed during a save is sent right after it. The print dialog's **Cambiar remitente** link opens this card. Mobile only reads the sender. Reason: sellers configure it once, so editing on mobile would double the screens and tests for a rare change.
- Coverage warnings ("Falta una opción … activa con cobertura", with **Ir a zonas y tarifas**) are shown under the home and agency switches while the method is on without [coverage](#delivery-methods), and update when zones are saved, enabled or disabled. On web and mobile they follow the same department-bounded agency rule as the checkout, so the agency warning appears whenever «Envío a agencia» would reach no buyer, including when every eligible agency sits outside the departments its zone covers. With an empty courier catalog the agency row says no couriers are available instead.
- A zone whose agencies cover only some of its departments (a partial agency gap) shows no warning: the uncovered departments are simply not offered to buyers under agency. Reason: a zone spanning several departments with agencies in only some of them may be intended, and a per-department signal would be a new message in the zone editor.
- In the zones response, an agency's `enabled` means usable: the catalog agency and its catalog courier are both enabled. An agency whose catalog courier was retired therefore shows as inactive in the zone editor, and its option is labelled as having no eligible agencies. Reason: installed mobile builds parse the agency shape strictly, so the catalog courier state is folded into the existing field instead of a new one (rejected: a new field, which breaks installed builds).

## Quotation

Quoting a district returns one rate per applicable option of the enabled zones that cover it, ordered by method (home first), price and ID. A zone covers a district when it lists the district, its province or its department.

- A home option applies when home delivery, its zone and the option are enabled.
- An agency option applies when agency delivery, its zone and the option are enabled and at least one associated agency is enabled, its catalog courier is enabled and the company courier is enabled. Agency rates list their eligible agencies. Unlike [coverage](#delivery-methods), this is not bounded by department: a district in a zone whose agency option has an eligible agency anywhere gets the agency rate. Reason: seller quoting stays as it is, and a request made outside the checkout page carries no money or isolation risk, since the price is the option's and the agency belongs to the company's option.
- A district without coverage returns an empty quotation, never an implicit zero-price rate.
- Rates are immutable snapshots: changing coverage does not alter generated rates, and quoting neither changes `version` nor reserves a price.
- The quotation request accepts an optional `trigger` (`picked` or `automatic`) that only the web checkout sends and only the buyer quotation log records; no rule depends on it ([Observability](#observability)).
- `POST /api/quotations` serves two callers on different hosts: the seller (session or token, with no order) on the app host only, and the buyer (authorized by the order link, with `orderId`) on the brand host of the order's company only, where the [checkout](checkout.md#link-and-access) lives. Any other pairing, including an order of another company, answers `404 CHECKOUT_UNAVAILABLE`. Reason: the buyer quotes from the checkout's own origin, and a brand host never serves seller data.

## Assigning delivery to an order

- The buyer (checkout) or the seller selects a rate by `rateId`; agency also requires `agencyId`. The courier is derived from the agency. There is no "agency pending" state: an agency delivery always has courier and agency.
- Resolution runs under the delivery settings lock held until the order is written: the rate must belong to the company, method and district; the option must still apply; the agency must be associated with the option, enabled and with an enabled courier. The agency's department is not checked against the destination; the checkout only offers districts that have an eligible agency in their department. Otherwise `RATE_UNAVAILABLE`, and the client re-quotes. If the option's current price differs, `TOTAL_CHANGED` with the current price. A settings version change unrelated to the option does not invalidate the rate.
- On web, the destination district is chosen by name with the location comboboxes (Departamento, Provincia, Distrito), the same control the checkout uses; the district code is never shown and is what the quotation receives ([Checkout · Delivery choice](checkout.md#delivery-choice)). The seller's delivery forms on web and mobile list the whole country, with «Escribe para buscar y elige tu distrito en la misma lista.» and «No hay resultados. Prueba con otro nombre.», and learn that a district has no rate from the quotation. Reason: the seller knows their coverage and quoting a gap is informative; filtering only web would break web/mobile parity.
- The location control receives the places it may offer from outside (absent means the whole country) and knows nothing about zones, methods or rates. Reason: zones stay the single source of coverage, and a country-agnostic selector only has to keep accepting that restriction.
- Recipient name and phone are required; agency also requires an identity document (leading zeros preserved). In the checkout the recipient is the buyer unless «Otra persona recibe el pedido» is checked ([Checkout · Buyer and recipient](checkout.md#buyer-and-recipient)); the stored shape is the same either way.
- The order stores a **delivery snapshot**: pricing (`quotationId`, `rateId`, `optionId`, `settingsVersion`), the destination district with names copied from the catalog, and for agency the courier and agency (ID, name, address, location) copied at assignment. Store pickup stores the pickup point and settings version. Reason: later changes to settings or catalogs must not change existing orders.
- The order records who set the delivery (`recordedBy`); another seller editing it replaces the author.
- Delivery can be set or replaced while the order is pending dispatch; it is locked once the order is shipped, delivered or cancelled.
- The order keeps `deliveryCost` (the rate price) and `deliveryCharge` (what the buyer pays: the cost, or zero when the seller absorbs it). Total is items plus charge.
- If no cost resolver is available, assignment fails with `DELIVERY_UNAVAILABLE` instead of inventing a cost.

## Observability

Logging follows [logging conventions](logging.md).

- `buyer_quotation_created` (info) is written after each successful quotation authorized by an order link, never for a seller quotation. Fields: `quotationId`, `trigger`, `homeRateCount`, `agencyRateCount` and `agencyRateInDepartmentCount` (agency rates with at least one agency in the destination's department), plus `companyId` from the request context. `orderId` (it works as an order link), district, address, agency names and prices are never logged. Reason: it measures whether buyers reach places without rates, which the checkout's [coverage filter](checkout.md#delivery-choice) should bring near zero; stored quotations do not tell a buyer's from a seller's (rejected: an origin column on every stored quotation, a migration only for a metric). This event is a deliberate exception to «logs are diagnostics, not business data» ([logging](logging.md#architecture)).
- `trigger` is `picked` only for the quotation that directly follows the buyer choosing a district; preselection, a district kept when switching methods, the saved delivery's district, a re-quotation after a confirmation recovery and any quotation the page repeats on its own are `automatic`. **Reintentar tarifas** repeats the trigger of the failed request, and a request without it counts as `picked`. Reason: automatic quotations are of covered districts by construction and would bias the measure (rejected: one measure per checkout load, which needs a load log that does not exist).
- Measures, read only over `trigger = "picked"`: quotations without rates (`homeRateCount + agencyRateCount = 0`) and the agency dead end (`agencyRateCount > 0` and `agencyRateInDepartmentCount = 0`).
