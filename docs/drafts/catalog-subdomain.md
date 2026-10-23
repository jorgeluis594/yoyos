# Public catalog by brand subdomain: product definition

**Status:** draft with open questions. 22/10/2026. Replaces the "link by company id" decision of [Public catalog](../public-catalog.md) and extends the **Publicar catálogo** card of [Checkout · Editing and publishing](../checkout.md#editing-and-publishing). Today the catalog lives at `https://app.yoyos.lat/catalogo/:companyId`. Todoist task `6hq6qJJqpP6W8wmV` («Refactor del catálogo público por subdominio de marca»). The founder closed decisions 6–19 and the acceptance criteria of that task on 22/10/2026; they are transcribed here as closed.

## Problem and situation

A seller who sells clothes through Instagram writes in their bio and in every WhatsApp reply a link like `app.yoyos.lat/catalogo/3f9c2a71-8b0e-4d55-9a1c-0c7e5b2d4f10`. Buyers can't remember it, can't type it from a story, and it doesn't show the store's name, so a buyer who taps it from a forwarded message isn't sure it belongs to the shop they were talking to. The seller copies and pastes the link every time because there's no way to say it out loud. The catalog already looks like the store (theme and logo); the address is the only part that still looks like Yoyos.

## Goal

The seller picks an address that names their brand, such as `fantasio.yoyos.lat`, in the same place where they publish the catalog, and sees while typing whether it's available. Buyers open the catalog at that address.

Hypothesis: if this works, sellers write the address in their bio and dictate it in chat instead of pasting a long link. That would show as more catalog visits that arrive without a referrer from a pasted link and in sellers stopping to ask for help finding the link (qualitative, from the founder's conversations with sellers).

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Seller setting up their store for the first time | Choose a short address with the brand name and publish | «Apariencia de la tienda», web and mobile |
| Seller replying in chat with the customer waiting | Copy or share the brand address | Settings → Catálogo, web and mobile |
| Seller who renamed their brand | Change the address | «Apariencia de la tienda», web and mobile |
| Buyer who saw the address in a bio or a message and has no account | Open the store, browse, order | `https://{subdominio}.yoyos.lat/` in their phone browser |
| Buyer with an old `/catalogo/:companyId` link | Arrive at the same store | Redirect to the brand address |

## First-version scope

- The catalog (grid, product page, cart and **Continuar**) is served at `https://{subdominio}.yoyos.lat/`, at the root of the host. Same layout, theme, logo, rules and texts as today.
- One subdomain per company, chosen by the seller, with format, reserved-name and availability checks while typing.
- The field lives inside the **Publicar catálogo** card of «Apariencia de la tienda», on web and mobile, next to the switch.
- Publishing requires a saved subdomain.
- Settings → Catálogo shows and shares the brand address.
- `/catalogo/:companyId` (and its product and cart paths) redirects to the brand address when the company has a subdomain and the catalog is published.
- Wildcard HTTPS for `*.yoyos.lat` through Cloudflare is verified, or configured if missing, in this same work.
- The change applies to every company at once at deploy time; no grace period.
- Documents updated: `docs/public-catalog.md`, and the related parts of `docs/checkout.md`.

The checkout isn't part of this work: **Continuar** keeps opening the current checkout at its current address. Meeting point: if the checkout moves to the brand host one day, only the target of **Continuar** changes.

## Out of this version

- Merchant custom domains (`mitienda.com`). Trigger: a seller asking for one.
- Moving the checkout to the subdomain, or redesigning the checkout, the catalog or other screens. Trigger: a separate task.
- Indexable SEO, notifications, and emails that mention the subdomain. The catalog stays `noindex`.
- A redirect from a previous subdomain to the new one, and a waiting period before a released subdomain can be taken again. **Real risk:** right after a change, another company can take the old address, and buyers with the old link would land in that other store. Decision 11 releases the old address immediately; this item is listed so the founder can decide whether to create a task. Trigger: the first seller who changes their address after sharing it widely.
- Moving the buyer's cart between hosts. A cart built on the old address (an old `/catalogo/` link, or a subdomain the seller changed) stays in that host's browser storage and is not visible on the new one. Accepted: there are no buyers yet, and changing the address is rare.
- Merge and deploy (founder's decision).

## Flow

Usual path: a seller sets up their catalog for the first time.

1. The seller opens «Apariencia de la tienda» (web: Settings → Apariencia de la tienda; mobile: Ajustes → Apariencia de la tienda, **Editar** tab).
2. The **Publicar catálogo** card shows the **Link de tu catálogo** field with the suffix `.yoyos.lat`, prefilled with a suggestion derived from the company name (see Rules). The switch is off and disabled, with «Elige el link de tu catálogo para poder publicarlo.».
3. The seller types `fantasio`. Under the field, after a short pause, it shows «Revisando…» and then «fantasio.yoyos.lat está disponible».
4. The seller taps **Guardar link**. The card shows «Link guardado» and the address `fantasio.yoyos.lat` as the current link. The switch becomes enabled.
5. The seller turns on **Publicar catálogo**. It saves at once, as it does today.
6. In Settings → Catálogo, the seller taps **Copiar link** and gets `https://fantasio.yoyos.lat/`, or taps **Compartir** on mobile.
7. The buyer opens `https://fantasio.yoyos.lat/`, browses, adds to the cart and taps **Continuar**. The current checkout opens.

Alternative paths:

- **Unavailable value:** the seller types `pay`, `fa` or a taken name. The message under the field says why (see Screens), and **Guardar link** stays disabled.
- **Someone took it first:** between «disponible» and **Guardar link**, another company saves `fantasio`. The save fails with «Alguien acaba de tomar fantasio.yoyos.lat. Elige otro.». The field keeps `fantasio` with the taken state, nothing is assigned, and the previous link (if there was one) stays.
- **Change while published:** the seller types `fantasio-store` and taps **Guardar link**. A confirmation opens: «¿Cambiar el link de tu catálogo?» / «fantasio.yoyos.lat dejará de funcionar y otra tienda podrá usarlo. Tendrás que compartir el nuevo link.» with **Cambiar link** and **Mantener link actual**. Once confirmed, the new address is current, the old one is free, and the catalog stays published.
- **Change while hidden:** no confirmation. Nobody can open a hidden catalog, so no shared link breaks for buyers.
- **Leaving with a typed, unsaved value:** the editor's leave confirmation («Seguir editando» / «Descartar y salir») also counts a subdomain that was typed and not saved.

## Screens

**«Apariencia de la tienda» → Publicar catálogo card (web and mobile).** The card keeps its current position, its independent loading and its behavior outside the logo and theme draft. Order inside the card:

1. Title «Publicar catálogo» and the existing hint.
2. Field **Link de tu catálogo**: an input with the fixed suffix `.yoyos.lat` shown next to it (mobile: below the input when it doesn't fit on one line). On mobile the keyboard has no autocorrect or auto-capitalization, and the input type is URL.
3. A status line under the field (announced to screen readers when it changes):

| Field state | Text | **Guardar link** |
| --- | --- | --- |
| Empty | «Usa el nombre de tu marca: letras, números y guiones.» | Disabled |
| Fewer than 3 characters while typing | Same help text, not an error | Disabled |
| Checking (after a 400 ms pause, initial value, adjustable) | «Revisando…» | Disabled |
| Invalid format | The specific reason: «Usa solo letras sin tildes, números y guiones.», «Usa entre 3 y 30 caracteres.», «No puede empezar ni terminar con guion.», «No uses dos guiones seguidos.» | Disabled |
| Reserved | «Ese nombre está reservado. Prueba con otro.» | Disabled |
| Taken | «fantasio.yoyos.lat ya está en uso. Prueba con otro.» | Disabled |
| Available | «fantasio.yoyos.lat está disponible» with a success mark | Enabled |
| Equal to the saved one | «Es tu link actual» | Hidden |
| Check failed (no connection or no response) | «No pudimos revisar si está disponible.» with **Reintentar** | Enabled (the save checks again) |

4. **Guardar link**, a secondary button inside the card. While saving: «Guardando…», the field and the button are disabled.
5. Current link: «Tu link: fantasio.yoyos.lat» once a subdomain is saved. It isn't shown before.
6. The switch **Publicar catálogo** and «Este cambio se guarda al momento.». Without a saved subdomain the switch is disabled with «Elige el link de tu catálogo para poder publicarlo.». Hiding keeps its current confirmation («¿Ocultar tu catálogo?»).

Other card states:

- Loading and load failure: the card's current «No pudimos cargar la configuración del catálogo» with **Reintentar** covers both the field and the switch.
- Typed values are not cleared by an error. A known rejection shows its reason in the status line and keeps the value.
- The field text is the typed value after lowercasing. The value goes through no other transformation on save.

**Settings → Catálogo (web and mobile).**

- Published: «Link del catálogo» shows `https://fantasio.yoyos.lat/` in full (never truncated with an ellipsis; it wraps if it doesn't fit), with **Copiar link**, **Ver catálogo** and **Compartir** (mobile). The rest stays as today.
- Hidden with a saved subdomain: as today, no link, with «Tu catálogo está oculto. Publícalo desde Apariencia de la tienda.» and **Ir a Apariencia de la tienda**.
- Hidden without a subdomain: «Tu catálogo está oculto. Elige su link y publícalo desde Apariencia de la tienda.» and **Ir a Apariencia de la tienda**.
- On mobile it keeps re-reading on every return, so a link changed from the web shows the current address and never offers to share the old one.

**Buyer pages at `https://{subdominio}.yoyos.lat/`.** The same grid, product page and cart as today, at `/`, `/productos/:productId` and `/carrito` on the brand host. Same states and texts. «Catálogo no disponible» keeps its unbranded look.

Copy is written in Spanish. The pt-BR texts are translated with the same meaning in implementation, as the existing card's texts are.

## Rules

| Aspect | Behavior |
| --- | --- |
| Canonical address | `https://{subdominio}.yoyos.lat/` at the root of the host. Product, cart and **Continuar** live on that host. The link the seller copies and shares is always this one. |
| Format | Lowercase `a-z`, digits `0-9` and hyphens; 3–30 characters; doesn't start or end with a hyphen; no two consecutive hyphens. What the seller types is converted to lowercase as they type. Any other character (spaces, `ñ`, accents, dots, `_`, emoji) makes the value invalid with its reason. It isn't removed silently, because `pañales` would become `paales`. The same rules are enforced when saving, whatever the client. |
| Reserved names | Never available: `www`, `api`, `app`, `admin`, `mail`, `smtp`, `ftp`, `cdn`, `static`, `assets`, `status`, `docs`, `help`, `support`, `billing`, `pay`, `checkout`, `catalogo`, `catalog`, `yoyos`, `landing`, `auth`, `login`, `signup`, `webhook`, `webhooks`, `dev`, `staging`, `test`. Implementation may add more names. Adding a name never takes away a subdomain already saved by a company. |
| Uniqueness | One subdomain, one company. Available = valid format, not reserved, and not saved by another company. |
| Real-time check | After a 400 ms pause with no typing (initial value, adjustable), the field is checked without saving. Only the answer to the latest typed value updates the status line. An answer for an older value is ignored. |
| Saving | Checks everything again at that moment. It's assigned only if it's still available. If another company took it first, it fails without assigning, and the previous subdomain stays. Saving the value that's already current changes nothing. |
| Suggestion | When the company has no subdomain, the field starts with the company name converted: lowercase, accents removed (`é`→`e`, `ñ`→`n`), spaces and other characters turned into single hyphens, cut to 30 characters, with no hyphen at either end. Example: «Café Fantasío» → `cafe-fantasio`. It's checked like any typed value and isn't saved until **Guardar link**. If the result has fewer than 3 characters or is reserved, the field starts empty. |
| Change | Allowed at any time, published or hidden, as many times as wanted. On save, the previous subdomain is released immediately, and its address shows «Catálogo no disponible» until another company takes it. The link in Settings → Catálogo becomes the new one. There's no redirect from the old subdomain. |
| Removal | A saved subdomain can be changed but not emptied. Hiding the catalog doesn't release it. Reason: an empty value would leave a published catalog with no address. |
| Publishing | The switch can only be turned on with a saved subdomain. A publish request without a saved subdomain is rejected, whatever the client. |
| Hiding | Always allowed, with or without a subdomain, as today. |
| Legacy `/catalogo/:companyId` | If the company has a subdomain and the catalog is published, it redirects permanently to `https://{subdominio}.yoyos.lat/`, keeping the path after the company id: `/catalogo/:id/productos/:productId` → `/productos/:productId`, `/catalogo/:id/carrito` → `/carrito`, query included. In every other case it shows «Catálogo no disponible». It's never a second way to see an active catalog. Old `yoyos.lat/catalogo/...` links already reach `app.yoyos.lat` through the existing redirect and then follow this rule. |
| Brand host | Serves only the catalog pages. Any other path on `{subdominio}.yoyos.lat` (for example `/login` or `/settings`) shows the catalog's not-found page if the catalog is published, and «Catálogo no disponible» otherwise. The seller panel stays on `app.yoyos.lat`. |
| Unknown or hidden host | An unknown subdomain, a malformed host, a reserved name with no service behind it, a company without a published catalog, or a released subdomain: all show the same «Catálogo no disponible». The response is the same whether or not the company exists. |
| Privacy | `noindex` and `Referrer-Policy: no-referrer` stay on every catalog page on the brand host. |
| Checkout | **Continuar** creates the order as today and opens the current checkout at its current address on `app.yoyos.lat`. Nothing in the checkout changes. |
| HTTPS | Every subdomain works over HTTPS with the Cloudflare wildcard for `*.yoyos.lat`. Without it, brand addresses don't work in production. Verifying or configuring it is part of this work. |
| Environments | Each environment has its own base domain. `yoyos.lat` is production. To be resolved in implementation. |
| Who edits | Any user who can manage the company's settings, as with the rest of «Apariencia de la tienda». The company always comes from the session. |

## States

The catalog keeps its two states, published and hidden. The subdomain adds a condition, not a state:

| Situation | Seller sees | Buyer at the brand address | Buyer at `/catalogo/:id` |
| --- | --- | --- | --- |
| No subdomain, hidden | Field with the suggestion, switch disabled | Not applicable | «Catálogo no disponible» |
| Subdomain, hidden | «Tu link: …», switch off | «Catálogo no disponible» | «Catálogo no disponible» |
| Subdomain, published | «Tu link: …», switch on | The catalog | Redirect to the brand address |

Published without a subdomain never exists. Allowed transitions: choosing or changing the subdomain in any state; publishing only with a subdomain; hiding always.

**At deploy time** (see question 2): companies whose catalog was published without a subdomain become hidden, and keep no subdomain until the seller chooses one. Companies that weren't published stay hidden. Existing companies get no subdomain by default. The seller chooses it.

## When something fails

| Situation | What the seller sees | What they can do |
| --- | --- | --- |
| Availability check fails or doesn't answer | «No pudimos revisar si está disponible.» with **Reintentar**. The typed value stays. | Retry, or tap **Guardar link**, which checks again |
| **Guardar link** succeeds | «Link guardado». «Tu link: fantasio.yoyos.lat». The switch becomes enabled. | Publish |
| Save rejected: invalid or reserved | The reason in the status line. The value stays. | Correct it |
| Save rejected: taken in the meantime | «Alguien acaba de tomar fantasio.yoyos.lat. Elige otro.» The value stays with the taken state, and the previous link stays. | Type another |
| Save not sent (no connection) | «No pudimos guardar tu link. Revisa tu conexión.» with **Reintentar**. The value stays. | Retry. Nothing changed. |
| Save without an answer | «No sabemos si tu link se guardó.» The card re-reads the current subdomain and shows it. If the re-read fails, the card load error is shown with **Reintentar**. | Saving again is safe: the same value for the same company is recognized as already saved, and is never assigned twice or to another company |
| While a save is in progress | The field, **Guardar link** and the switch are disabled | Wait |
| Publish attempted without a subdomain (an outdated screen or another client) | «Elige el link de tu catálogo para poder publicarlo.» The switch goes back to off. | Choose and save the link |
| The subdomain was changed from another device | The next load or return shows the current one. A late answer from an earlier check doesn't change the screen. | — |
| Buyer opens an old subdomain or an unknown host | «Catálogo no disponible» | — |
| Buyer has a cart on the old host | The cart isn't on the new address | Build it again |

Publishing and hiding keep their current outcomes: the switch goes back with «No pudimos guardar el cambio» and **Reintentar**.

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Seller (manages settings) | Their subdomain, availability of any value they type | Choose, change, publish, hide | Take a subdomain saved by another company, publish without a subdomain |
| Buyer without an account | The published catalog at its brand address | Browse, cart, **Continuar** | Learn whether a company exists behind a hidden, released or unknown address |

- The availability check only answers signed-in sellers. It reveals only that a name is in use, never which company uses it. The risk it closes is anonymous enumeration of stores.
- The public address is guessable on purpose: it's the brand name. That's fine because only published catalogs answer, and a published catalog is public by the seller's decision.

## Information that is kept

- New, per company: the chosen subdomain. It's account data that applies on every device, and only the latest value is kept. The previous one isn't kept after a change.
- Orders created from the catalog don't store the address the buyer came from.
- The cart stays in the buyer's browser as today. It belongs to each host, so it isn't carried across addresses.
- A typed but unsaved value isn't kept after leaving the screen.
- What existed before: no company gets a subdomain automatically. See the deploy rule under States.

## Vocabulary

- **Link de tu catálogo** (`fantasio.yoyos.lat`): the brand address the seller chooses. Internally and in documents it's called the subdomain. The interface never says «subdominio» (see question 1).
- **Disponible / en uso / reservado**: available = valid, not reserved and free; in use = saved by another company; reserved = a name Yoyos keeps for itself.

## Closed decisions

| Decision | Why |
| --- | --- |
| The catalog is served at `https://{subdominio}.yoyos.lat/`, at the root | A brand address the buyer can remember and the seller can say out loud (founder, decisions 1 and 6) |
| Choosing, checking and saving the subdomain live in the **Publicar catálogo** card in «Apariencia de la tienda», web and mobile. Copy, view and share stay in Settings → Catálogo. | One place to set up how the store looks and whether it's open (founder, requirement 4) |
| Serving, choosing, checking and the UX ship as one refactor, with no child tasks | Founder, requirement 5 |
| Format: `a-z`, digits and hyphens, 3–30, no hyphen at either end, no double hyphen, lowercased while typing | Valid DNS labels only (founder, decisions 6 and 7) |
| The reserved list is closed in its minimum; implementation can only add to it | Protects infrastructure and Yoyos names (founder, decision 8) |
| One subdomain per company, unique | Founder, decision 9 |
| Real-time check without saving; saving re-checks and fails without assigning on a race | Founder, decision 10 |
| Changing is allowed; the previous subdomain is released on save | Founder, decision 11 |
| Publishing requires a saved subdomain | Founder, decisions 7 and 12 |
| Legacy `/catalogo/:companyId` redirects only when there is a subdomain and the catalog is published. It's never an active catalog. | Founder, decision 13 |
| The checkout doesn't move or change | Founder, decision 14 |
| No custom domains | Founder, decision 15 |
| `noindex`, `no-referrer`, and the same «Catálogo no disponible» for every unavailable host | Founder, decision 16 |
| Wildcard SSL through Cloudflare for `*.yoyos.lat`, verified or configured in this work | Founder, decisions 8 and 18 |
| Applies to every company at once, with no grace period | There are no customers yet (founder, decisions 9 and 19) |

## Acceptance criteria

1. Company «Fantasio» with the catalog published and subdomain `fantasio`: `https://fantasio.yoyos.lat/` shows its catalog with its theme and logo. A product opens at `https://fantasio.yoyos.lat/productos/<id>`, the cart works, and **Continuar** opens the current checkout on `app.yoyos.lat`.
2. On web and on mobile, the seller chooses and saves `fantasio` in «Apariencia de la tienda», in the same card as **Publicar catálogo**. After publishing, Settings → Catálogo shows and copies `https://fantasio.yoyos.lat/`.
3. Typing `pay` shows «Ese nombre está reservado. Prueba con otro.»; `fa` keeps the help text; `fantasio-` shows «No puede empezar ni terminar con guion.»; `café` shows «Usa solo letras sin tildes, números y guiones.»; a name saved by another company shows «… ya está en uso. Prueba con otro.»; a free name shows «… está disponible». **Guardar link** is enabled only in the last case. Typing `Fantasio` shows `fantasio`.
4. A save request with `pay`, `fa`, `-fantasio`, `fan--tasio`, `café` or a taken name is rejected, whatever the client, and assigns nothing.
5. Two companies save `fantasio` at the same moment: exactly one gets it. The other sees «Alguien acaba de tomar fantasio.yoyos.lat. Elige otro.» and keeps its previous link, or keeps having none.
6. A company with no subdomain sees the switch disabled with «Elige el link de tu catálogo para poder publicarlo.», and a publish request is rejected. Settings → Catálogo offers no link to share.
7. Fantasio, published, changes to `fantasio-store` and confirms «Cambiar link»: `https://fantasio-store.yoyos.lat/` shows the catalog; `https://fantasio.yoyos.lat/` shows «Catálogo no disponible»; another company can now save `fantasio`; Settings → Catálogo shows the new address, also on mobile after returning to the screen.
8. A save that gets no answer shows «No sabemos si tu link se guardó.» and then the current subdomain read again. Saving the same value again doesn't fail and doesn't assign it twice.
9. `https://app.yoyos.lat/catalogo/<Fantasio id>/productos/<id>?x=1` redirects permanently to `https://fantasio.yoyos.lat/productos/<id>?x=1`. With the catalog hidden, or without a subdomain, `/catalogo/<id>` shows «Catálogo no disponible».
10. `https://no-existe.yoyos.lat/`, the address of a hidden catalog, and a just-released subdomain show the same «Catálogo no disponible», with no difference that reveals whether the company exists.
11. Catalog pages on the brand host send `noindex` and `Referrer-Policy: no-referrer`.
12. Cloudflare's wildcard certificate for `*.yoyos.lat` is verified, or configured, and a test subdomain opens over HTTPS with no certificate warning.
13. After the deploy, a company that had its catalog published without a subdomain has it hidden, and no company has an active catalog that can only be reached through `/catalogo/:companyId`.
14. A seller who typed an unsaved subdomain and leaves «Apariencia de la tienda» gets «Seguir editando» / «Descartar y salir».
15. `docs/public-catalog.md` and `docs/checkout.md` describe the brand address, the field next to the switch, the wildcard SSL and the reason. CI is green.

## Open items and questions

Questions (answer with the option number):

1. What does the interface call the subdomain?
   (1) «Link de tu catálogo», with the fixed suffix `.yoyos.lat` next to the field. Recommended: sellers already know «link del catálogo» from Settings → Catálogo, and «subdominio» is a technical term most of them don't know.
   (2) «Subdominio». Precise, but it adds a technical word to the seller's screens, and the texts in this document change.
   (3) «Dirección de tu tienda». Neutral, but it introduces a third name next to «link del catálogo».

2. What happens at deploy time to a catalog that is published without a subdomain?
   (1) It becomes hidden. When the seller saves a subdomain, they turn on the switch again. Recommended: "published" always means "reachable at its address", there are no customers to warn, and the rule "no publishing without a subdomain" holds for every record.
   (2) It keeps "published" saved but isn't served until a subdomain is saved, and then it goes live by itself. The seller doesn't have to publish again, but a saved state appears that doesn't match what buyers see, and the card would have to explain it.

Decided unless objected:

- The field is prefilled with a suggestion from the company name («Café Fantasío» → `cafe-fantasio`), checked like any value, and saved only with **Guardar link**.
- The subdomain saves with its own **Guardar link** button inside the card, outside the logo and theme draft. **Guardar cambios** and **Descartar** don't touch it, but leaving with a typed, unsaved value asks for confirmation.
- Changing the subdomain while published asks «¿Cambiar el link de tu catálogo?». While hidden, it doesn't ask.
- A saved subdomain can be changed but not emptied. Hiding doesn't release it.
- Disallowed characters make the value invalid with a specific reason. They're never removed silently. Only letter case is converted.
- Real-time check after a 400 ms pause (initial value, adjustable). Only the answer to the latest value counts.
- If the availability check fails, **Guardar link** stays enabled, and the save re-checks.
- The legacy redirect keeps the product and cart path and the query.
- The brand host serves only the catalog. Any other path behaves as not-found or «Catálogo no disponible».
- The availability check answers only signed-in sellers.
- No company gets a subdomain automatically at deploy time.
- No redirect from a previous subdomain and no waiting period before reuse (flagged above as a deferred item with real risk).
- The cart isn't carried between hosts.
