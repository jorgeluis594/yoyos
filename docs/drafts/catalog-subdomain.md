# Public catalog by brand subdomain: product definition

**Status:** definition ready to implement, pending round 2 of the review gate. 22/10/2026. Replaces the "link by company id" decision of [Public catalog](../public-catalog.md) and extends the **Publicar catálogo** card of [Checkout · Editing and publishing](../checkout.md#editing-and-publishing). Today the catalog lives at `https://app.yoyos.lat/catalogo/:companyId`. Todoist task `6hq6qJJqpP6W8wmV` («Refactor del catálogo público por subdominio de marca»). The founder closed decisions 6–19 and the acceptance criteria of that task on 22/10/2026; they are transcribed here as closed. The review gate answered the two open questions (see "Questions decided by the review gate").

## Problem and situation

A seller who sells clothes through Instagram writes a link like `app.yoyos.lat/catalogo/3f9c2a71-8b0e-4d55-9a1c-0c7e5b2d4f10` in their bio and in every WhatsApp reply. Buyers can't remember it or type it from a story. It doesn't show the store's name either, so a buyer who taps it from a forwarded message isn't sure it belongs to the shop they were talking to. The seller copies and pastes the link every time because there's no way to say it out loud. The catalog already looks like the store (theme and logo); the address is the only part that still looks like Yoyos.

## Goal

The seller picks an address that names their brand, such as `fantasio.yoyos.lat`, in the same place where they publish the catalog, and sees while typing whether it's available. Buyers open the catalog at that address.

Hypothesis: if this works, sellers put the brand address in their Instagram bio and say it in chat instead of pasting a long link. It would show in what the founder sees in active sellers' bios and in their conversations with them. Yoyos doesn't measure catalog visits by origin, and this version adds no measurement.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Seller setting up their store for the first time | Choose a short address with the brand name and publish | «Apariencia de la tienda», web and mobile |
| Seller replying in chat with the customer waiting | Copy or share the brand address | Settings → Catálogo, web and mobile; also next to the saved link in «Apariencia de la tienda» |
| Seller who renamed their brand | Change the address | «Apariencia de la tienda», web and mobile, reachable from Settings → Catálogo |
| Buyer who saw the address in a bio or a message and has no account | Open the store, browse, order | `https://{subdominio}.yoyos.lat/` in their phone browser |
| Buyer with an old `/catalogo/:companyId` link | Arrive at the same store | Redirect to the brand address |

## First-version scope

- The catalog (grid and product page, with the cart as a sheet on both, and **Continuar**) is served at `https://{subdominio}.yoyos.lat/`, at the root of the host. Same layout, theme, logo, rules and texts as today, including the rule that confirming in the checkout empties the cart.
- One subdomain per company, chosen by the seller, with format, reserved-name and availability checks while typing.
- The field lives inside the **Publicar catálogo** card of «Apariencia de la tienda», on web and mobile, next to the switch.
- Publishing requires a saved subdomain.
- Settings → Catálogo shows and shares the brand address, and leads to the card to change it.
- `/catalogo/:companyId` and its product pages redirect to the brand address when the company has a subdomain and the catalog is published.
- Wildcard HTTPS for `*.yoyos.lat` through Cloudflare is verified, or configured if missing, in this same work.
- The change applies to every company at once at deploy time, with no grace period.
- Documents updated: `docs/public-catalog.md`, and the related parts of `docs/checkout.md`.

The checkout's screens, steps, rules and address on `app.yoyos.lat` don't change. **Continuar** keeps opening it. The only new requirement at the boundary is that the buyer's cart on the brand host is emptied once the order is confirmed in the checkout (see Rules → Cart after confirming). How the brand host learns about the confirmation is to be resolved in implementation. Meeting point: if the checkout moves to the brand host one day, only the target of **Continuar** changes.

## Out of this version

- Merchant custom domains (`mitienda.com`). Trigger: a seller asking for one.
- Moving the checkout to the subdomain, or redesigning the checkout, the catalog or other screens. Trigger: a separate task.
- Indexable SEO, notifications, and emails that mention the subdomain. The catalog stays `noindex`.
- A redirect from a previous subdomain to the new one, and a waiting period before a released subdomain can be taken again. **Real risk:** right after a change, another company can take the old address. Two groups of buyers would then land in that other store and could order from the wrong business, with neither seller seeing it:
  - buyers who have the old brand link;
  - buyers who once opened a legacy `app.yoyos.lat/catalogo/<id>` link. The legacy redirect is permanent (decision 13), so their browser keeps sending that link to the subdomain it first pointed to, even after the server would send it to the new one.

  Decisions 11 and 13 stand. This item is listed so the founder can decide whether to create a task. Trigger: the first seller who changes their address after sharing it widely.
- Moving the buyer's cart between hosts. A cart built on an old address (an old `/catalogo/` link, or a subdomain the seller changed) stays in that host's browser storage and isn't visible on the new one. Accepted: there are no buyers yet, and changing the address is rare.
- Merge and deploy (founder's decision).

## Flow

Usual path: a seller sets up their catalog for the first time.

1. The seller opens «Apariencia de la tienda» (web: Settings → Apariencia de la tienda; mobile: Ajustes → Apariencia de la tienda, **Editar** tab).
2. The **Publicar catálogo** card shows the **Link de tu catálogo** field with the fixed suffix `.yoyos.lat`. When a suggestion derived from the company name is available, the field is prefilled with it and the status line says «cafe-fantasio.yoyos.lat está disponible». The switch is off and disabled, with «Elige el link de tu catálogo para poder publicarlo.».
3. The seller types `fantasio`. After a short pause, the status line shows «Revisando…» and then «fantasio.yoyos.lat está disponible».
4. The seller taps **Guardar link**, or presses Enter (web) or return (mobile). The status line shows «Link guardado», and the line «Tu link: https://fantasio.yoyos.lat/» appears. The switch becomes enabled.
5. The seller turns on **Publicar catálogo**. It saves at once, as it does today. **Copiar link** and **Ver catálogo** appear next to «Tu link».
6. The seller taps **Copiar link** right there. Later, in a chat, they use Settings → Catálogo: **Copiar link**, or **Compartir** on mobile.
7. The buyer opens `https://fantasio.yoyos.lat/`, browses, adds to the cart and taps **Continuar**. The current checkout opens, and the buyer confirms.
8. If the buyer returns to `https://fantasio.yoyos.lat/` (back button, or the link again), the cart is empty. A new purchase creates a new order.

Alternative paths:

- **Unavailable value:** the seller types `pay`, `fa` or a name in use. The status line says why (see Screens), and **Guardar link** stays disabled.
- **Someone took it first:** between «disponible» and **Guardar link**, another company saves `fantasio`. The save fails with «Alguien acaba de tomar fantasio.yoyos.lat. Elige otro.». The field keeps `fantasio` with the in-use state, nothing is assigned, and the previous link stays, if there was one.
- **Change of a saved link (published or hidden):** the seller types `fantasio-store` and taps **Guardar link**. A confirmation opens before anything is saved: «¿Cambiar el link de tu catálogo?» / «fantasio.yoyos.lat dejará de ser tuyo y otra tienda podrá usarlo. Si ya lo compartiste, tendrás que compartir el nuevo.», with **Cambiar link** (destructive style, like **Ocultar catálogo**) and **Mantener link actual**. Once confirmed, the new address is current, the old one is free, and the publication state doesn't change. **Mantener link actual** closes the dialog, saves nothing and keeps the typed value. Each attempt to replace a saved link asks again, including a new attempt after the confirmed save failed because the name was taken.
- **Leaving with an edited, unsaved link:** see Rules → Unsaved link.
- **Buyer abandons the checkout without confirming:** returning to the store keeps the cart as it was, and **Continuar** with the same cart reopens the same pending order, as today.

## Screens

**«Apariencia de la tienda» → Publicar catálogo card (web and mobile).** The card keeps its position at the end of the editor, its independent loading, and its place outside the logo and theme draft. It is drawn as its own surface, apart from Logo and Tema, so that the header's **Guardar cambios**, the «Cambios sin guardar» badge and the save bar are visibly not part of it. Inside, it has two groups separated by a divider, and each says how it saves.

*Group 1, link.* In order:

1. Field label «Link de tu catálogo», and an input with the fixed suffix `.yoyos.lat` next to it (mobile: below the input when it doesn't fit on one line). The input has no character limit, so a long paste is never cut. On mobile, the keyboard has no autocorrect or auto-capitalization, and the input type is URL.
2. Status line under the field (see the table).
3. **Guardar link**, a secondary button, always visible. It's enabled only in the "available" and "check failed" states. Under it: «El link se guarda con este botón.» While saving, it reads «Guardando…», and the field, the button and the switch are disabled.
4. «Tu link: https://fantasio.yoyos.lat/», once a subdomain is saved. It always shows the saved value, even while the seller edits the field. While the catalog is published, **Copiar link** («Link copiado») and **Ver catálogo** sit next to it. Reason: copying the link is the goal of the first-time flow, and it saves going to Settings → Catálogo right after publishing. Settings → Catálogo stays the place for sharing day to day, and it's the only place with **Compartir** on mobile.

*Group 2, publication.* The switch, labeled «Publicar catálogo», with the existing hint and «Este cambio se guarda al momento.». Without a saved subdomain, the switch is disabled, and «Elige el link de tu catálogo para poder publicarlo.» is shown and works as its accessible description. Hiding keeps its current confirmation («¿Ocultar tu catálogo?»).

Status line states:

| Field state | Text | **Guardar link** |
| --- | --- | --- |
| Empty | «Usa el nombre de tu marca: letras, números y guiones.» | Disabled |
| 1–2 valid characters | Same help text, not an error | Disabled |
| Checking (after a 400 ms pause, initial value, adjustable) | «Revisando…» | Disabled |
| Invalid | One reason, picked by the priority in Rules → Format | Disabled |
| Reserved | «Ese nombre está reservado. Prueba con otro.» | Disabled |
| In use | «fantasio.yoyos.lat ya está en uso. Prueba con otro.» | Disabled |
| Available | «fantasio.yoyos.lat está disponible», with a success mark | Enabled |
| Equal to the saved one, right after saving it | «Link guardado», with a success mark | Disabled |
| Equal to the saved one, any other time (on load, or typed back) | «Es tu link actual» | Disabled |
| Check failed (no connection or no answer) | «No pudimos revisar si está disponible.» with **Reintentar** | Enabled (the save checks again) |

The "equal to the saved one" state is the only success state. «Link guardado» stays until the next edit of the field, or until the seller leaves the screen.

Keyboard and accessibility:

- **Enter/return:** Enter in the web field runs **Guardar link** when it's enabled, and otherwise does nothing. It never submits the logo and theme draft. On mobile, the return key reads «Guardar». It runs **Guardar link** when it's enabled, and otherwise only closes the keyboard.
- **Mobile keyboard:** while the seller types, the field, the status line and **Guardar link** stay visible above the keyboard and above the save bar, if the bar is shown. Ajustes → Catálogo and **Ir a Apariencia de la tienda** open the **Editar** tab already scrolled to the card.
- **Screen readers:** the field's accessible name is «Link de tu catálogo». Its description is the suffix «.yoyos.lat» followed by the current status line. Only final verdicts are announced politely: available, in use, reserved, invalid, check failed, «Link guardado», and the in-doubt and not-saved messages. «Revisando…» is never announced. The switch keeps the accessible name «Publicar catálogo».
- **Contrast and targets:** the success mark uses the existing success token (4.5:1), and the text, not the mark, carries the meaning. On mobile, **Guardar link**, **Reintentar**, **Copiar link** and **Ver catálogo** have touch targets of at least 44 px.

Other card states:

- The card's current loading state and its load failure («No pudimos cargar la configuración del catálogo» with **Reintentar**) apply to the first load of the field and the switch. After that first load, no error replaces the card or clears a typed value.
- A known rejection shows its reason in the status line and keeps the value.

**Settings → Catálogo (web and mobile).**

- Published: the label «Link de tu catálogo» and `https://fantasio.yoyos.lat/` shown in full as selectable text that wraps when it doesn't fit. It's never truncated with an ellipsis. The web's single-line read-only input is replaced by this text, because at phone width that input scrolls sideways. Below it: **Copiar link**, **Ver catálogo**, **Compartir** (mobile), then «Para cambiar el link u ocultar tu catálogo, ve a Apariencia de la tienda.» and **Ir a Apariencia de la tienda**.
- Hidden, with a saved subdomain: as today, no link. It shows «Tu catálogo está oculto. Publícalo desde Apariencia de la tienda.» and **Ir a Apariencia de la tienda**.
- Hidden, without a subdomain: «Tu catálogo está oculto. Elige su link y publícalo desde Apariencia de la tienda.» and **Ir a Apariencia de la tienda**.
- **Ir a Apariencia de la tienda** opens the editor at the **Publicar catálogo** card: scrolled to it on web, and on the **Editar** tab scrolled to it on mobile. It doesn't move focus into the field, so no keyboard opens on its own.
- On mobile, Catálogo keeps re-reading on every return, so a link changed from the web shows the current address and the old one is never offered for sharing.
- The mobile Ajustes row for «Apariencia de la tienda» reads «Logo, tema, link y publicación de tu catálogo».

**Leave confirmation of «Apariencia de la tienda».** The title stays «Tienes cambios sin guardar», with **Seguir editando** and **Descartar y salir**. The description depends on what's pending:
- only logo or theme: «Si sales ahora, perderás los cambios que no publicaste.» (today's text);
- only the link: «Si sales ahora, no se guardará el link que escribiste.»;
- both: «Si sales ahora, perderás los cambios que no publicaste y el link que escribiste.».

**Buyer pages at `https://{subdominio}.yoyos.lat/`.** The same grid (`/`) and product page (`/productos/:productId`) as today, with the cart as a sheet on both. Same states and texts. «Catálogo no disponible» keeps its unbranded look.

Copy is written in Spanish. The pt-BR texts are translated with the same meaning in implementation, like the existing card's texts.

## Rules

| Aspect | Behavior |
| --- | --- |
| Canonical address | `https://{subdominio}.yoyos.lat/`, at the root of the host. Grid, product page, cart and **Continuar** live on that host. The link the seller copies and shares is always this one. |
| Format | Lowercase `a-z`, digits `0-9` and hyphens; 3–30 characters; no hyphen at the start or end; no two hyphens in a row. Typed letters become lowercase as the seller types. Any other character makes the value invalid. It's never removed silently: `pañales` would become `paales`. The same rules apply when saving, whatever the client. |
| Invalid reason, priority | Only one reason is shown. The first that applies, in this order: (1) contains `.yoyos.lat`, `://` or a dot: «Escribe solo el nombre, sin https:// ni .yoyos.lat.»; (2) contains a space: «Sin espacios: usa guiones en su lugar.»; (3) contains another character outside `a-z`, `0-9` and `-`: «Usa solo letras sin tildes, números y guiones.»; (4) more than 30 characters: «Usa hasta 30 caracteres.»; (5) starts or ends with a hyphen: «No puede empezar ni terminar con guion.»; (6) two hyphens in a row: «No uses dos guiones seguidos.». Examples: `Café-` → (3); `fantasio ` (pasted with a trailing space) → (2); `fantasio.yoyos.lat` → (1). Fewer than 3 valid characters isn't an error while typing: the help text shows and **Guardar link** stays disabled. A save request with fewer than 3 is rejected. |
| Reserved names | Never available: `www`, `api`, `app`, `admin`, `mail`, `smtp`, `ftp`, `cdn`, `static`, `assets`, `status`, `docs`, `help`, `support`, `billing`, `pay`, `checkout`, `catalogo`, `catalog`, `yoyos`, `landing`, `auth`, `login`, `signup`, `webhook`, `webhooks`, `dev`, `staging`, `test`. Implementation may add names. Adding a name never takes away a subdomain a company already saved. |
| Uniqueness | One subdomain, one company. Available means: valid format, not reserved, and not saved by another company. |
| Real-time check | After a 400 ms pause with no typing (initial value, adjustable), the value is checked without saving. Only the answer for the latest typed value updates the status line; an answer for an older value is ignored. |
| Saving | Everything is checked again at that moment. The value is assigned only if it's still available. If another company took it first, the save fails without assigning anything, and the previous subdomain stays. Saving the value that's already current changes nothing and counts as success. |
| Change confirmation | Asked every time a save would replace a saved subdomain, whether the catalog is published or hidden, and before the save is sent. It isn't asked for the first subdomain. |
| Suggestion | When the company has no subdomain, the field starts with the company name converted: lowercase, accents removed (`é`→`e`, `ñ`→`n`), spaces and other characters turned into single hyphens, cut to 30 characters, with no hyphen at either end. Example: «Café Fantasío» → `cafe-fantasio`. It's shown only if it's available when the card loads. If it's taken, reserved, or shorter than 3 characters, or if the check fails, the field starts empty with the help text. It's saved only with **Guardar link**. |
| Unsaved link | A link counts as unsaved only when the seller edited the field and its value differs from the initial value: the saved subdomain, or else the suggestion, or else empty. Editing the field back to the initial value clears it. An untouched suggestion never counts. An unsaved link triggers the leave confirmation (web navigation, reload or tab close; mobile back), with the description for the link. It doesn't count for the «Cambios sin guardar» badge, **Guardar cambios** or **Descartar**. |
| Scope of each save | **Guardar link** saves only the link. The switch saves only the publication, at once. **Guardar cambios** saves only logo and theme, and «Apariencia actualizada» doesn't mean the link was saved: a pending link keeps its status line and stays pending. |
| Change | Allowed at any time, published or hidden, as many times as wanted, after the confirmation. On save, the previous subdomain is released immediately, and its address shows «Catálogo no disponible» until another company takes it. The link in Settings → Catálogo becomes the new one. There's no redirect from the old subdomain. |
| Removal | A saved subdomain can be changed but not emptied. Hiding the catalog doesn't release it. Reason: an empty value would leave a published catalog with no address. |
| Publishing | The switch turns on only with a saved subdomain, and is disabled while a link save is in progress or in doubt. A publish request without a saved subdomain is rejected, whatever the client. |
| Hiding | Always allowed, with or without a subdomain, as today. |
| Cart after confirming | Once the buyer confirms the order in the checkout, the cart for that order on the brand host is empty the next time the buyer opens the store in that browser (back button, the link again, or a reload). **Continuar** never reopens an order the buyer already confirmed: the same products again create a new order. A cart whose order wasn't confirmed stays intact and reopens the same pending order, as today. This is the buyer's experience today on a single host, kept across hosts. The mechanism is to be resolved in implementation. |
| Legacy `/catalogo/:companyId` | If the company has a subdomain and the catalog is published, `/catalogo/:id` redirects permanently to `https://{subdominio}.yoyos.lat/`, and `/catalogo/:id/productos/:productId` to `https://{subdominio}.yoyos.lat/productos/:productId`, with the query kept. In every other case it shows «Catálogo no disponible». It's never a second way to see an active catalog. Old `yoyos.lat/catalogo/...` links already reach `app.yoyos.lat` through the existing redirect and then follow this rule. The cart has no page of its own, so there's no cart path to redirect. |
| Brand host | Serves only the catalog's grid and product pages, and the cart requests they make. Any other path on `{subdominio}.yoyos.lat` (for example `/login`, `/settings` or `/checkout/...`) shows the catalog's not-found page when the catalog is published, and «Catálogo no disponible» otherwise. The seller panel and the checkout stay on `app.yoyos.lat`. |
| Unknown or hidden host | These all show the same «Catálogo no disponible»: an unknown subdomain, a malformed host, a reserved name with nothing behind it, a company without a published catalog, and a released subdomain. The response is the same whether or not the company exists. |
| Privacy | `noindex` and `Referrer-Policy: no-referrer` stay on every catalog page on the brand host. |
| Checkout | **Continuar** creates the order as today and opens the current checkout at its current address on `app.yoyos.lat`. The checkout's screens, steps and rules don't change. |
| HTTPS | Every subdomain works over HTTPS with the Cloudflare wildcard for `*.yoyos.lat`. Without it, brand addresses don't work in production. Verifying or configuring it is part of this work. |
| Environments | Each environment has its own base domain; `yoyos.lat` is production. To be resolved in implementation. |
| Who edits | Any user who can manage the company's settings, as with the rest of «Apariencia de la tienda». The company always comes from the session. |

## States

The catalog keeps its two states, published and hidden. The subdomain adds a condition, not a state:

| Situation | Seller sees | Buyer at the brand address | Buyer at `/catalogo/:id` |
| --- | --- | --- | --- |
| No subdomain, hidden | Field with the suggestion or empty, switch disabled | Not applicable | «Catálogo no disponible» |
| Subdomain, hidden | «Tu link: …», switch off | «Catálogo no disponible» | «Catálogo no disponible» |
| Subdomain, published | «Tu link: …» with **Copiar link** and **Ver catálogo**, switch on | The catalog | Redirect to the brand address |

Published without a subdomain never exists. Allowed transitions:
- choosing a subdomain, or changing it after the confirmation, in any state;
- publishing, only with a subdomain;
- hiding, always.

**At deploy time:** catalogs that were published without a subdomain become hidden. Their companies have no subdomain until the seller chooses one, and the seller turns on the switch again. Catalogs that weren't published stay hidden. No company gets a subdomain automatically.

## When something fails

| Situation | What the seller sees | What they can do |
| --- | --- | --- |
| The availability check fails or doesn't answer | «No pudimos revisar si está disponible.» with **Reintentar**. The typed value stays. | Retry, or tap **Guardar link**, which checks again |
| **Guardar link** succeeds | Status line «Link guardado»; «Tu link: https://fantasio.yoyos.lat/»; the switch becomes enabled | Publish |
| Save rejected: invalid or reserved | The reason in the status line. The value stays. | Correct it |
| Save rejected: taken in the meantime | «Alguien acaba de tomar fantasio.yoyos.lat. Elige otro.» The value stays, in the in-use state. The previous link stays. | Type another; replacing a saved link asks for confirmation again |
| Save not sent (no connection) | «No pudimos guardar tu link. Revisa tu conexión.» with **Reintentar**. The value stays. | Retry. Nothing changed. |
| Save without an answer | «No sabemos si tu link se guardó. Lo estamos revisando…». The card re-reads the saved subdomain. Meanwhile the field, **Guardar link** and the switch are disabled, and the typed value stays. | Wait |
| → the re-read shows the typed value as saved | Same as success: «Link guardado», «Tu link: …» updated, switch enabled | Publish |
| → the re-read shows the previous value, or none | «Tu link no se guardó.» The field keeps the typed value and is checked again. «Tu link» shows the previous value or nothing. | Save again when it's available |
| → the re-read fails | «No sabemos si tu link se guardó. Revisa tu conexión.» with **Reintentar**. The typed value stays in the field, the rest of the card stays as it was, and the field, **Guardar link** and the switch stay disabled. The card is never replaced by its load error. | **Reintentar** sends the same save again. It's safe: the same value for the same company is recognized as already saved, and it's never assigned twice or to another company. The seller can also leave, and the leave confirmation counts the link as unsaved. |
| Publish attempted without a subdomain (an outdated screen or another client) | The switch goes back to off with «Elige el link de tu catálogo para poder publicarlo.» | Choose and save the link |
| The subdomain was changed from another device | The next load or return shows the current one. A late answer from an earlier check or save doesn't change the screen. | — |
| Buyer opens an old subdomain or an unknown host | «Catálogo no disponible» | — |
| Buyer has a cart on an old host | The cart isn't on the new address | Build it again |

Publishing and hiding keep their current outcomes: the switch goes back, with «No pudimos guardar el cambio» and **Reintentar**.

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Seller (manages settings) | Their subdomain, and the availability of any value they type | Choose, change, publish, hide | Take a subdomain another company saved; publish without a subdomain |
| Buyer without an account | The published catalog at its brand address | Browse, use the cart, **Continuar** | Learn whether a company exists behind a hidden, released or unknown address |

- The availability check answers only signed-in sellers, and only says "in use", never which company uses it. That isn't real protection: anyone can create a seller account and see whether a name is taken, which reveals that some store, perhaps a hidden one, holds it. It's accepted because a name in use reveals no company data and no catalog content. The check only keeps the answer out of reach of anonymous automated requests. No other feature should rely on it as protection.
- The public address is guessable on purpose, because it's the brand name. That's fine: only published catalogs answer, and a published catalog is public by the seller's decision.

## Information that is kept

- New, per company: the chosen subdomain. It's account data that applies on every device, and only the latest value is kept. The previous one isn't kept after a change.
- Orders created from the catalog don't store the address the buyer came from.
- The cart stays in the buyer's browser as today, separately on each host, and is never carried from one address to another. A cart whose order was confirmed is emptied (see Rules).
- A typed but unsaved link isn't kept after leaving the screen.
- What existed before: no company gets a subdomain automatically, and published catalogs without one become hidden at deploy time.

## Vocabulary

- **Link de tu catálogo** (`fantasio.yoyos.lat`): the brand address the seller chooses. It's the only name in the interface: the field label, the label in Settings → Catálogo (which replaces «Link del catálogo») and the messages. «Tu link» and «link» in messages are its short form, not another concept. The interface never says «subdominio»; documents and code call it the subdomain.
- **Disponible / en uso / reservado**: available means valid, not reserved and free; in use means another company saved it; reserved means a name Yoyos keeps for itself.

## Closed decisions

| Decision | Why |
| --- | --- |
| The catalog is served at `https://{subdominio}.yoyos.lat/`, at the root | A brand address the buyer can remember and the seller can say out loud (founder, decisions 1 and 6) |
| Choosing, checking and saving the subdomain live in the **Publicar catálogo** card in «Apariencia de la tienda», web and mobile. Settings → Catálogo keeps copy, view and share. | One place to set up how the store looks and whether it's open (founder, requirement 4) |
| Serving, choosing, checking and the UX ship as one refactor, with no child tasks | Founder, requirement 5 |
| Format: `a-z`, digits and hyphens; 3–30; no hyphen at either end; no double hyphen; lowercased while typing | Valid DNS labels only (founder, decisions 6 and 7) |
| The reserved list is closed at its minimum; implementation can only add to it | Protects infrastructure names and Yoyos names (founder, decision 8) |
| One subdomain per company, unique | Founder, decision 9 |
| Real-time check without saving; saving checks again and fails without assigning on a race | Founder, decision 10 |
| Changing is allowed, and the previous subdomain is released on save | Founder, decision 11 |
| Publishing requires a saved subdomain | Founder, decisions 7 and 12 |
| The legacy `/catalogo/:companyId` redirects only when there is a subdomain and the catalog is published; it's never an active catalog | Founder, decision 13 |
| The checkout doesn't move or change | Founder, decision 14 |
| No custom domains | Founder, decision 15 |
| `noindex`, `no-referrer`, and the same «Catálogo no disponible» for every unavailable host | Founder, decision 16 |
| Wildcard SSL through Cloudflare for `*.yoyos.lat`, verified or configured in this work | Founder, decisions 8 and 18 |
| Applies to every company at once, with no grace period | There are no customers yet (founder, decisions 9 and 19) |
| The interface name is «Link de tu catálogo», with the fixed suffix `.yoyos.lat` | Review gate, question 1 |
| At deploy time, published catalogs without a subdomain become hidden | Review gate, question 2 |
| After confirming in the checkout, returning to the store shows an empty cart, as on a single host today | Review gate (coordinator); the end of the usual purchase must not change |

## Acceptance criteria

1. Company «Fantasio» has its catalog published with the subdomain `fantasio`. `https://fantasio.yoyos.lat/` shows its catalog with its theme and logo. A product opens at `https://fantasio.yoyos.lat/productos/<id>`, the cart sheet works, and **Continuar** opens the current checkout on `app.yoyos.lat`.
2. A buyer confirms an order in the checkout, then goes back to `https://fantasio.yoyos.lat/` with the back button, or by opening the link again. The cart is empty. Adding the same products and tapping **Continuar** creates a new order with a new number and doesn't reopen the confirmed one. A buyer who leaves the checkout without confirming finds the cart intact, and **Continuar** reopens the same pending order.
3. On web and on mobile, the seller chooses and saves `fantasio` in «Apariencia de la tienda», in the same card as **Publicar catálogo**. After publishing, the card offers **Copiar link** next to «Tu link: https://fantasio.yoyos.lat/». Settings → Catálogo shows the address in full, copies it, and leads back to the card with **Ir a Apariencia de la tienda**.
4. Typing these values shows these results:
   - `pay`: «Ese nombre está reservado. Prueba con otro.»;
   - `fa`: the help text;
   - `fantasio-`: «No puede empezar ni terminar con guion.»;
   - `café`: «Usa solo letras sin tildes, números y guiones.»;
   - `fantasio ` (pasted with a trailing space): «Sin espacios: usa guiones en su lugar.»;
   - `fantasio.yoyos.lat`: «Escribe solo el nombre, sin https:// ni .yoyos.lat.»;
   - a name another company saved: «… ya está en uso. Prueba con otro.»;
   - a free name: «… está disponible».

   **Guardar link** stays visible throughout and is enabled only in the last case. Typing `Fantasio` shows `fantasio`. A 40-character paste is kept whole and shows «Usa hasta 30 caracteres.».
5. A save request with `pay`, `fa`, `-fantasio`, `fan--tasio`, `café` or a name in use is rejected, whatever the client, and nothing is assigned.
6. Two companies save `fantasio` at the same moment. Exactly one gets it. The other sees «Alguien acaba de tomar fantasio.yoyos.lat. Elige otro.» and keeps its previous link, or still has none.
7. A company without a subdomain sees the switch disabled, with «Elige el link de tu catálogo para poder publicarlo.». A publish request sent from an outdated screen is rejected, and the switch goes back to off with that same message. Settings → Catálogo offers no link to share.
8. Fantasio, published, changes to `fantasio-store`. The confirmation «¿Cambiar el link de tu catálogo?» appears. After **Cambiar link**:
   - `https://fantasio-store.yoyos.lat/` shows the catalog;
   - `https://fantasio.yoyos.lat/` shows «Catálogo no disponible»;
   - another company can now save `fantasio`;
   - Settings → Catálogo shows the new address, also on mobile after returning to the screen.

   With the catalog hidden, the same change also asks for confirmation. **Mantener link actual** saves nothing and keeps the typed value.
9. A save that gets no answer shows «No sabemos si tu link se guardó. Lo estamos revisando…», with the switch disabled.
   - If the re-read finds it saved: «Link guardado».
   - If it isn't saved: «Tu link no se guardó.», with the typed value kept.
   - If the re-read also fails: the typed value stays, with **Reintentar**, and the card isn't replaced. Saving the same value again doesn't fail and doesn't assign it twice.
10. A seller without a subdomain opens «Apariencia de la tienda», changes only the theme, saves and leaves: no leave confirmation appears, even though the field shows the suggestion `cafe-fantasio`. If they edit the field to `fantasio` and leave without saving, they see «Tienes cambios sin guardar» / «Si sales ahora, no se guardará el link que escribiste.». Editing it back to `cafe-fantasio` and leaving asks nothing.
11. A seller whose suggested name is already in use by another company opens the card for the first time. The field is empty, with the help text, and no in-use message.
12. With a link typed and not saved, tapping the header's **Guardar cambios** saves logo and theme only: the link remains pending, with its status line, and «Tu link» doesn't change.
13. `https://app.yoyos.lat/catalogo/<Fantasio id>/productos/<id>?x=1` redirects permanently to `https://fantasio.yoyos.lat/productos/<id>?x=1`. With the catalog hidden, or without a subdomain, `/catalogo/<id>` shows «Catálogo no disponible».
14. With Fantasio published, `https://fantasio.yoyos.lat/login` and `https://fantasio.yoyos.lat/settings` show the catalog's not-found page, and never the seller panel or a sign-in. With the catalog hidden, they show «Catálogo no disponible».
15. `https://no-existe.yoyos.lat/`, the address of a hidden catalog, and a just-released subdomain all show the same «Catálogo no disponible», with no difference that reveals whether the company exists.
16. Catalog pages on the brand host send `noindex` and `Referrer-Policy: no-referrer`.
17. Cloudflare's wildcard certificate for `*.yoyos.lat` is verified, or configured, and a test subdomain opens over HTTPS with no certificate warning.
18. After the deploy, a company that had its catalog published without a subdomain has it hidden, and no company has an active catalog that can be reached only through `/catalogo/:companyId`.
19. On mobile, while typing in the field, the status line and **Guardar link** stay visible above the keyboard. The return key runs **Guardar link** when it's enabled. A screen reader announces «fantasio.yoyos.lat está disponible», but not «Revisando…».
20. `docs/public-catalog.md` and `docs/checkout.md` describe the brand address, the field next to the switch, the wildcard SSL, the cart after confirming, and the reason. CI is green.

## Questions decided by the review gate

The founder confirms these in the final pull request.

1. **Interface name.** Answer: «Link de tu catálogo», with the fixed suffix `.yoyos.lat`. Decided by the product and UX/UI reviewers (round 1). Reason: sellers already know «link del catálogo»; «subdominio» is jargon; a third name breaks the one-name rule. Discarded:
   - «Subdominio»: a technical word on seller screens;
   - «Dirección de tu tienda»: a third name, easily confused with the delivery «Dirección».
2. **Deploy-time catalogs published without a subdomain.** Answer: they become hidden. Decided by the product and UX/UI reviewers (round 1). Reason: "published" always means "reachable at its address", and there are no customers to warn. Discarded: keeping "published" saved but not served, which creates a saved state that doesn't match what buyers see.
3. **Cart after confirming on another host.** Answer: from the buyer's point of view it stays as today. Returning to the store after confirming shows an empty cart, and a new purchase creates a new order. The mechanism is for implementation. Decided by the coordinator, from the product reviewer's blocker. Reason: the end of the usual purchase must not change because the checkout is on another host. Discarded: accepting a cart that reopens the confirmed order.

## Open items and questions

Decided unless objected:

- The field is prefilled with a suggestion from the company name («Café Fantasío» → `cafe-fantasio`), only if it's available when the card loads; otherwise it starts empty. It's saved only with **Guardar link**.
- The link saves with its own **Guardar link** button, always visible, in its own group of the card, outside the logo and theme draft. **Guardar cambios**, **Descartar** and the badge don't touch it.
- Only a link the seller edited away from its initial value (the saved link or the suggestion) counts as unsaved for the leave confirmation, which has its own description for the link.
- Replacing a saved link always asks «¿Cambiar el link de tu catálogo?», published or hidden, with **Cambiar link** in destructive style. Every new attempt asks again.
- A save in doubt keeps the typed value and disables the field, **Guardar link** and the switch until the re-read resolves it. A failed re-read offers **Reintentar** and never replaces the card.
- A saved subdomain can be changed but not emptied. Hiding doesn't release it.
- Disallowed characters make the value invalid, with a single reason picked by a fixed priority (including dedicated reasons for spaces and for a pasted `.yoyos.lat` or `https://`). Nothing is removed silently, and the input has no character limit.
- One success state («Link guardado» right after saving, «Es tu link actual» otherwise).
- **Copiar link** and **Ver catálogo** sit next to «Tu link» in the card while published. **Compartir** stays only in Settings → Catálogo.
- Enter or return runs **Guardar link** when it's enabled, and never submits the appearance draft.
- On mobile, the field, the status line and **Guardar link** stay visible above the keyboard. **Ir a Apariencia de la tienda** opens the editor at the card, without opening the keyboard.
- Screen readers hear only final verdicts, never «Revisando…».
- The web Settings → Catálogo shows the link as wrapping, selectable text instead of a single-line input. Its label becomes «Link de tu catálogo».
- The real-time check runs after a 400 ms pause (initial value, adjustable). Only the answer for the latest value counts.
- If the availability check fails, **Guardar link** stays enabled, and the save checks again.
- The legacy redirect maps the grid and product pages, with the query kept. The cart has no page to redirect.
- The brand host serves only the catalog. Any other path shows the catalog's not-found page, or «Catálogo no disponible» when the catalog isn't published.
- The availability check answers only signed-in sellers. This is stated as limited protection, not something to rely on.
- No company gets a subdomain automatically at deploy time.
- No redirect from a previous subdomain and no waiting period before another store can reuse it. This is flagged as a deferred item with real risk, covering both old brand links and cached legacy redirects.
- The cart isn't carried between hosts.
