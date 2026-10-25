# Public catalog

Each company can publish one public catalog at its brand address, `https://{subdomain}.yoyos.lat/`, where the subdomain is chosen by the seller (for example `fantasio.yoyos.lat`). A buyer without an account opens the link (usually from Instagram or WhatsApp), browses the company's products, builds a cart and taps **Continuar**: core creates an order and opens the existing [checkout](checkout.md) on the same brand host. The seller receives the order once the buyer confirms it there.

Code: `apps/core/src/features/catalog/` (publication, catalog link, brand host resolution, browsing, continue to checkout), catalog read models in `apps/core/src/features/products/`, catalog orders in `apps/core/src/features/orders/`, web routes `apps/core/app/routes/catalog*.tsx` and `legacy-catalog-*.ts`, brand host middleware `apps/core/app/middleware/storefront.ts`, mobile settings in `apps/mobile/src/features/catalog/`. Subdomain rules shared by core, web and mobile: `shared/catalog-subdomain.ts`. Settings contract: `shared/contracts/catalog.ts`. Theme and logo: the [store appearance](checkout.md#appearance) (`apps/core/src/features/store-appearance/`).

## Scope

- One catalog per company with a fixed layout defined by Yoyos. The seller configures only its link, whether it is published, and the [store appearance](checkout.md#appearance) (logo and theme) it shares with the checkout. Reason: zero configuration for the seller; personalization is applied over the same layout.
- The catalog uses the company's store theme and logo, the same ones as the checkout (see [Theme](#theme)). Reason: the store must look the same from the first product to the payment, so the buyer never wonders at the handoff whether they are still in the same shop (rejected: a theme per surface, or the default Yoyos look in the catalog).
- The catalog is served at the root of a brand host, `https://{subdomain}.yoyos.lat/`, chosen by the seller. Reason: a company-id link cannot be remembered, typed from a story or said out loud, and does not show the store's name; the brand address is the only part of the catalog that still looked like Yoyos (rejected: `app.yoyos.lat/catalogo/:companyId`).
- The checkout lives on the same brand host, `https://{subdomain}.yoyos.lat/checkout/:orderId`, with the same screens, steps and rules, and **Continuar** opens it there. Reason: the buyer stays at the store's address from the first product to the payment (rejected: keeping the checkout on `app.yoyos.lat`). The app host does not serve it ([Checkout · Link and access](checkout.md#link-and-access)).
- The public pages are web only (React Router loaders and actions). There is no public JSON API.
- Not supported: merchant custom domains (`mitienda.com`), indexable SEO, notifications or emails that mention the brand address, measuring visits by origin, a redirect from a previous subdomain to the new one, and moving the buyer's cart between hosts.

## Seller

The interface calls the brand address «Link de tu catálogo» everywhere: the field label, the label in Settings → Catálogo and the messages. «Tu link» and «link» are its short form. The interface never says «subdominio»; documents and code call it the subdomain. Reason: sellers already know «link del catálogo»; «subdominio» is jargon, and a third name («Dirección de tu tienda») would be confused with the delivery address.

### Publicar catálogo card

Choosing the link and publishing live in the **Publicar catálogo** card of «Apariencia de la tienda», on web and mobile ([Checkout · Editing and publishing](checkout.md#editing-and-publishing)). Reason: one place to set up how the store looks, where it lives and whether it is open.

- The card sits at the end of the editor, is drawn as its own surface apart from Logo and Tema, loads independently and is outside the logo and theme draft: the header's **Guardar cambios**, «Cambios sin guardar» badge, save bar and **Descartar** never touch it. It has two groups separated by a divider, and each says how it saves.
- **Link group**, in order:
  1. Label «Link de tu catálogo» and an input with the fixed suffix `.{domain}` (on mobile below the input when it does not fit on one line). The input has no character limit, so a long paste is never cut. On mobile the keyboard has no autocorrect or auto-capitalization and the input type is URL.
  2. The status line (see [Link field states](#link-field-states)).
  3. **Guardar link**, a secondary button, always visible, enabled only in the available and check-failed states, with «El link se guarda con este botón.» under it. While saving it reads «Guardando…», and the field, the button and the switch are disabled.
  4. «Tu link: https://fantasio.yoyos.lat/» once a subdomain is saved; it always shows the saved value, even while the field is being edited. While published, **Copiar link** and **Ver catálogo** sit next to it and behave exactly as in Settings → Catálogo («Link copiado», announced politely; a copy the system refuses fails silently). While hidden, «Tu link» is shown without them: a hidden catalog's link is never offered for copying. Reason: copying the link is the goal of the first set-up, and it saves going to Settings → Catálogo right after publishing.
- **Publication group:** the switch «Publicar catálogo», with its hint and «Este cambio se guarda al momento.». It saves at once. Without a saved subdomain the switch is disabled and «Elige el link de tu catálogo para poder publicarlo.» is shown as its accessible description; it is also disabled while a link save is in progress or in doubt. Hiding asks for confirmation («¿Ocultar tu catálogo?»). A failed publish or hide returns the switch to its previous position with «No pudimos guardar el cambio» and **Reintentar**, which resends the same value without asking again. A publish rejected because there is no saved subdomain (an outdated screen or another client) turns the switch off with «Elige el link de tu catálogo para poder publicarlo.».
- The card loads and works independently of the appearance: if logo and theme cannot be read, the seller can still choose the link, publish or hide. A failed first load shows «No pudimos cargar la configuración del catálogo» with **Reintentar** only inside the card. After the first load, no error replaces the card or clears a typed value. Reason: it is the only place to hide the catalog, and a failing logo or theme read must never stop the seller from closing the store.
- **Enter / return:** Enter in the web field runs **Guardar link** when it is enabled and otherwise does nothing; it never submits the logo and theme draft. On mobile the return key reads «Guardar», runs **Guardar link** when enabled, and otherwise only closes the keyboard.
- **Mobile keyboard:** while typing, the field, the status line and **Guardar link** stay visible above the keyboard and above the save bar.
- **Screen readers:** the field's accessible name is «Link de tu catálogo» and its description is the suffix followed by the current status line. Only final verdicts are announced politely (available, in use, reserved, invalid, check failed, «Link guardado», and the not-saved and in-doubt messages); «Revisando…» is never announced. The switch keeps the accessible name «Publicar catálogo».
- **Contrast and targets:** the success mark uses the success token (4.5:1) and the text, not the mark, carries the meaning. On mobile, **Guardar link**, **Reintentar**, **Copiar link** and **Ver catálogo** have touch targets of at least 44 px.

### Link field states

| Field state | Status line | **Guardar link** |
| --- | --- | --- |
| Empty | «Usa el nombre de tu marca: letras, números y guiones.» | Disabled |
| 1–2 valid characters, not starting with a hyphen | Same help text, not an error | Disabled |
| Checking (after the pause) | «Revisando…» | Disabled |
| Invalid | One reason, by the priority in [Link rules](#link-rules) | Disabled |
| Reserved | «Ese nombre está reservado. Prueba con otro.» | Disabled |
| In use | «fantasio.yoyos.lat ya está en uso. Prueba con otro.» | Disabled |
| Available | «fantasio.yoyos.lat está disponible», with a success mark | Enabled |
| Equal to the saved one, right after saving it | «Link guardado», with a success mark | Disabled |
| Equal to the saved one, any other time | «Es tu link actual» | Disabled |
| Check failed (no connection, no answer, or rate-limited) | «No pudimos revisar si está disponible.» with **Reintentar** | Enabled (the save checks again) |

The saved-value state is the only success state. «Link guardado» stays until the next edit of the field or until the seller leaves the screen.

- **Real-time check:** after a 400 ms pause without typing (adjustable), the value is checked without saving. Every edit immediately drops the previous verdict: until the pause ends, the status line shows the help text and **Guardar link** is disabled (Enter does nothing), so a value is never saved under another value's verdict. Format reasons also appear only after the pause, so typing `fantasio-store` never flashes the hyphen reason at `fantasio-`. Only the answer for the latest typed value updates the line; an older answer is ignored.
- Invalid, reserved and current are decided on the device with the shared rules, without a request. Only a valid, non-reserved value that differs from the saved subdomain is sent to the server. Reason: the instant state never disagrees with the server, and no request is spent on what the rules already decide.

### Saving, changing and failures

- **Suggestion:** when the company has no subdomain, the field starts with the company name converted (lowercase, accents removed, spaces and other characters turned into single hyphens, cut to 30 characters, no hyphen at either end): «Café Fantasío» → `cafe-fantasio`. It is shown only if it is available when the card loads; when it is taken, reserved, shorter than 3 characters, or its check fails, the field starts empty with the help text. Core computes it; clients never derive it. It is saved only with **Guardar link**.
- **Change confirmation:** every save that would replace a saved subdomain, published or hidden, first asks «¿Cambiar el link de tu catálogo?» / «fantasio.yoyos.lat dejará de ser tuyo y otra tienda podrá usarlo. Los links de tu catálogo y de tus pedidos que ya compartiste dejarán de funcionar.», with **Cambiar link** (destructive style, like **Ocultar catálogo**) and **Mantener link actual**. The first subdomain is saved without asking. **Mantener link actual** saves nothing and keeps the typed value. Focus behaves as in the hide confirmation: back to **Guardar link** after **Mantener link actual** or a failed save, to the field after a successful change. A new attempt after a save rejected as taken asks again. **Reintentar** after a save that was not sent or is in doubt resends the already confirmed change without asking again. The confirmation is a client rule; the server saves the same way for any client.
- **Scope of each save:** **Guardar link** saves only the link, the switch only the publication, and **Guardar cambios** only logo and theme. «Apariencia actualizada» does not mean the link was saved: a pending link keeps its status line.
- **Unsaved link:** a link counts as unsaved only when the seller edited the field and its value differs from the initial value (the saved subdomain, else the suggestion, else empty). Editing it back clears it, and an untouched suggestion never counts. An unsaved link triggers the leave confirmation (web in-app navigation, reload or tab close; mobile back) with its own description (see [Checkout · Editing and publishing](checkout.md#editing-and-publishing)). It never counts for the «Cambios sin guardar» badge, **Guardar cambios** or **Descartar**. A typed but unsaved link is not kept after leaving the screen.

| Situation | What the seller sees | What they can do |
| --- | --- | --- |
| **Guardar link** succeeds | «Link guardado»; «Tu link: …» updated; the switch is enabled | Publish |
| Rejected: invalid or reserved | The reason in the status line; the value stays | Correct it |
| Rejected: taken in the meantime | «Alguien acaba de tomar fantasio.yoyos.lat. Prueba con otro.» when the last check said available; the plain in-use text when the last check had failed, because no race can be claimed. The value stays in the in-use state and the previous link stays | Type another |
| Not sent (device offline) | «No pudimos guardar tu link. Revisa tu conexión.» with **Reintentar**; the value stays | Retry; nothing changed |
| Answered with any other error (session expired, email not verified, no company, malformed request) | «No pudimos guardar tu link. Inténtalo de nuevo.» with **Reintentar**; the value stays. Never the in-doubt state, and no re-read | Retry |
| No answer (no response, timeout, server error, or `503`) | «No sabemos si tu link se guardó. Lo estamos revisando…». The card re-reads the saved subdomain; the field, **Guardar link** and the switch stay disabled and the typed value stays | Wait |
| → the re-read shows the typed value | Same as success | Publish |
| → the re-read shows the previous value or none | «Tu link no se guardó.», which stays until the next edit; the field is checked again and its verdict joins the same line («Tu link no se guardó. fantasio.yoyos.lat está disponible»). «Tu link» shows the previous value or nothing | Save again |
| → the re-read fails | «No sabemos si tu link se guardó. Revisa tu conexión.» with **Reintentar**; the card is never replaced by its load error | **Reintentar** resends the same save, which is safe because saving the current value succeeds without writing |
| Changed from another device | The next load or return shows the current link; a late answer from an earlier check or save does not change the screen | — |

On web, the link group calls the JSON API directly instead of the editor's loader and action, and never revalidates the editor. Reason: a network failure must stay inside the card and never reach the editor's error boundary, clear the logo and theme draft or the typed link (the editor already loads its preview cards the same way). The publication switch keeps the editor's action.

### Settings → Catálogo

Sharing stays in Settings → Catálogo, on web and mobile. Reason: sharing the link is a separate daily action.

- **Published:** the label «Link de tu catálogo» and the full brand URL as selectable text that wraps, never truncated and never a single-line input (at phone width an input scrolls sideways). Below it, web **Copiar link**, **Ver catálogo**; mobile **Copiar link**, **Compartir** (system share sheet), **Ver catálogo**. Then «Para cambiar el link u ocultar tu catálogo, ve a Apariencia de la tienda.».
- **Hidden with a subdomain:** no link, and «Tu catálogo está oculto. Publícalo desde Apariencia de la tienda.».
- **Hidden without a subdomain:** «Tu catálogo está oculto. Elige su link y publícalo desde Apariencia de la tienda.».
- Every state offers **Ir a Apariencia de la tienda**, which opens the editor scrolled to the **Publicar catálogo** card (web anchor `#catalog-publication`; mobile `focus=catalog`) without moving focus into the field, so no keyboard opens on its own. Reason: a seller looking for the switch or the link must find where it lives.
- On mobile, Catálogo re-reads the settings every time the seller returns to it, keeping the last known state meanwhile, so it never offers a hidden catalog's link or an address changed from another device.

### Other seller rules

- Any user who can manage the company's settings can choose the link and publish; the company always comes from the session.
- Existing companies start with the catalog off and without a subdomain. No company ever gets a subdomain automatically.
- Catalog orders show «Desde el catálogo» in the seller's order list and detail, on web and mobile, and have no seller user. They do not store the address the buyer came from.
- Mobile builds older than the catalog link cannot read the settings response and cannot publish. Accepted: the seller updates the app.

## Link rules

| Aspect | Rule |
| --- | --- |
| Format | Lowercase `a-z`, digits and hyphens; 3–30 characters; no hyphen at the start or end; no two hyphens in a row. Reason: only valid one-level DNS labels. Typed letters become lowercase as the seller types; any other character makes the value invalid and is never removed silently (`pañales` must not become `paales`). The same rules apply on save, whatever the client, and the database enforces the format too. |
| Invalid reason | Only one, the first that applies: (1) contains a dot or `://`: «Escribe solo el nombre, sin https:// ni .yoyos.lat.»; (2) contains a space: «Sin espacios: usa guiones en su lugar.»; (3) any other character outside `a-z`, `0-9`, `-`: «Usa solo letras sin tildes, números y guiones.»; (4) over 30 characters: «Usa hasta 30 caracteres.»; (5) starts or ends with a hyphen: «No puede empezar ni terminar con guion.»; (6) two hyphens in a row: «No uses dos guiones seguidos.». A leading hyphen shows (5) even with one or two characters. Otherwise fewer than 3 characters shows the help text while typing, and a save is rejected. |
| Reserved names | Never available: `www`, `api`, `app`, `admin`, `mail`, `smtp`, `ftp`, `cdn`, `static`, `assets`, `status`, `docs`, `help`, `support`, `billing`, `pay`, `checkout`, `catalogo`, `catalog`, `yoyos`, `landing`, `auth`, `login`, `signup`, `webhook`, `webhooks`, `dev`, `staging`, `test`. Reason: protects infrastructure and Yoyos names. The list lives only in `shared/catalog-subdomain.ts`; names may be added, never removed. It applies only when a company chooses a name, never when a host is resolved, so adding a name never takes away a subdomain a company already saved, and that company can keep saving it. |
| Uniqueness | One subdomain per company, and one company per subdomain. Available means valid, not reserved and not saved by another company. The availability answer never says which company holds a name. |
| Saving | Everything is checked again on save. The value is assigned only if still available; the database's unique index decides a race, so of two companies saving the same name at once exactly one gets it, and the other keeps its previous subdomain. Saving the current value changes nothing and succeeds. |
| Change | Allowed at any time, published or hidden, as often as wanted, after the confirmation. The previous subdomain is released in the same save, with no redirect and no waiting period: its address shows «Catálogo no disponible» until another company takes it, and the checkout links already shared under it stop working (the order detail always shows the link under the current subdomain). The confirmation says so because it leaves buyers with pending orders without a way to pay. The publication state does not change. Only the latest value is kept. |
| Removal | A saved subdomain can be changed but never emptied, and hiding does not release it. Reason: an empty value would leave a published catalog with no address. |
| Publishing | Requires a saved subdomain, whatever the client; the database rejects a published catalog without one. Reason: "published" always means "reachable at its address". Hiding is always allowed. |

## Brand host

The base domain comes from `CATALOG_BASE_URL` (see [Environments](#environments)); production is `yoyos.lat`.

- **Which host is a store:** a hostname of exactly one valid label under the base hostname, other than the app hostname, is a store host. A label that fails the format, or a deeper name (`a.b.yoyos.lat`), is an invalid host. Every other hostname (`app.yoyos.lat`, IPs, `localhost`, the base apex) is the app host. The port is ignored. Classification judges format only; reserved names with no owner resolve as unavailable.
- **Store chosen by the host:** the store is the company whose subdomain matches the host, resolved in one lookup per request (not cached, so hiding takes effect on the next request). A product id or variants of another company behave as nonexistent there: the product page shows «Este producto ya no está disponible», and **Continuar** with those lines creates no order and marks them as no longer available.
- **What it serves:** the grid at `/`, the product page at `/productos/:productId` (the cart is a sheet on both), the cart requests at `/carrito`, and the store's [checkout](checkout.md) at `/checkout/:orderId` with the buyer APIs it calls on the same origin: `/api/buyer/orders/:orderId/...` and the buyer-mode `POST /api/quotations` (authorized by the order). The seller panel and sign-in stay on `app.yoyos.lat`. Any other path on a published brand host (`/login`, `/settings`) shows the store's «No encontramos esta página» and answers 404; on an unavailable host it shows «Catálogo no disponible». The app's generic «Página no encontrada» is never shown on a brand host.
- **Checkout and buyer APIs:** they work for the host's company whether its catalog is published or hidden, because hiding closes the shop window, not the sales already shared by link. The checkout and the buyer APIs answer only orders of the company that holds the host: another company's order answers like a missing one (`404`), whether the catalog is published or hidden. An id that is not a valid UUID also answers `404` on the checkout and the order routes; the buyer-mode quotation rejects it as invalid input (`400`), which reveals nothing about any order. On a published host, a checkout link that does not resolve to an enabled order of the host's company shows the checkout's "Enlace no disponible". On an unavailable host, a checkout path that is not an order of the host's own company shows the byte-identical «Catálogo no disponible», and a host nobody holds answers the buyer APIs like any other `/api/*` path. Reason: only someone with a valid link sees the store's checkout, and an invented URL never reveals whether a company is behind a host.
- **«No encontramos esta página»:** the same layout as «Este producto ya no está disponible»: the store header in the store's theme, «No encontramos esta página», «Revisa el link o mira los productos de la tienda.» and **Volver al catálogo**, which opens `/`. It is themed because the catalog is published, so theming reveals nothing; if theme or logo cannot be read it falls back to Clásico without logo.
- **Unavailable host:** an unknown subdomain, a malformed host, a reserved name nobody owns, a hidden catalog and a released subdomain all show the same «Catálogo no disponible» (404), byte-identical, so the response never reveals whether a company exists. The only exception is the checkout of a hidden catalog's own order, reached with its valid link.
- **Edge answers:** before the web routes, a store host answers every `/api/*` path except the buyer APIs above, and an invalid host every `/api/*` path, with `404 {"code":"NOT_FOUND"}`, `/robots.txt` with `Disallow: /`, and common scanner paths (`*.php`, `/.env`, `/.git/*`, `/wp-*`) with a plain 404, without a database lookup. A brand host never signs anyone in and never serves seller data.
- **Session cookies** stay host-only on the app host, so a brand host never receives a seller session.
- **Privacy:** every brand host answer sends `Referrer-Policy: no-referrer`, and catalog pages are `noindex`.
- **HTTPS:** every brand host works over HTTPS through Cloudflare (see the deployment procedure in the [README](../README.md#catalog-brand-hosts)). One level only: the format forbids dots.
- On the app host, `/` keeps redirecting to the language-prefixed home, and the storefront paths, `/checkout/...` and `/api/buyer/orders/...` answer 404, with no redirect to a brand host. The buyer-mode quotation is refused there too (`404 CHECKOUT_UNAVAILABLE`); the seller's quotation is served only on the app host.

### Legacy links

- `/catalogo/:companyId` and `/catalogo/:companyId/productos/:productId` redirect with 308 to `https://{subdomain}.yoyos.lat/` and `https://{subdomain}.yoyos.lat/productos/:productId`, keeping the query, only when the company has a subdomain and its catalog is published. In every other case they show «Catálogo no disponible». Reason: old links keep reaching the store, and they are never a second way to see an active catalog. Old `yoyos.lat/catalogo/...` links reach `app.yoyos.lat` through the existing apex redirect and then follow this rule.
- The redirect carries `Cache-Control: no-store`, so browsers do not keep its target indefinitely. It does not check the product: another company's product redirects anyway, and the brand host answers «Este producto ya no está disponible».
- The cart has no page of its own, so there is no cart page to redirect. A legacy tab's cart requests and **Continuar** get the catalog-turned-off outcome (`GET` 404, `POST` 409 `CATALOG_UNAVAILABLE`), and the buyer opens the store's brand address.

### Environments

Each environment has its own base domain in `CATALOG_BASE_URL` (scheme, host and optional port, no path): production `https://yoyos.lat`; Docker dev `http://localhost:${WEB_PORT}`; E2E `http://localhost:4173`. Every visible text (the field suffix, «Tu link», the status line, the change confirmation, Settings → Catálogo and the copied link) uses the current environment's domain, so a link copied in development never points to production.

- It is required in production with no default; core refuses to start without a valid `https` value, and the deploy's `migrate` step fails before any schema change without one. Reason: a default would let a deploy that forgot the variable publish wrong links. Other environments fall back to `http://localhost:3000`, like `BETTER_AUTH_URL`.
- In development and tests, brand hosts are `http://{subdomain}.localhost:{port}/`: `*.localhost` resolves to loopback in browsers and curl with no DNS, and E2E maps it explicitly in Chromium. A phone on the LAN cannot open `*.localhost`; set `CATALOG_BASE_URL=http://<ip>.nip.io:3000` for that.

## Buyer

- **Catalog page:** store header, product grid (newest first, 24 per page, **Ver más**), search by product name. A product shows «Desde» the minimum price when variants differ and «Agotado» when every variant is out of stock; a product without photo shows a neutral block with its initial. Search, loaded pages and scroll position are kept when returning from a product.
- **Product page:** photo, name, price, description, one selector per attribute. Combinations that do not exist and variants without stock cannot be selected. Quantity from 1 up to the variant's available stock, never above 99.
- **Cart:** lives only in the buyer's browser (`localStorage`); it is not sent to Yoyos before **Continuar**. Reason: the buyer has no account and an abandoned cart needs no storage. One line per variant, at most 30 lines. It shows «Subtotal de productos»; «Total» is reserved for the checkout, where delivery is added.
- **Cart ownership:** the cart belongs to the store (the company), not to the address: it is stored per company, so a cart left at an address is never shown in another company's store that later takes the same subdomain, and a cart is never carried to a new address. Reason: a released and reused address must not show the previous store's cart.
- **Continuar** opens the full checkout URL on the same brand host, built from the store the host resolved to.
- **Cart after confirming:** once the buyer confirms the order in the checkout, the cart for that order is empty the next time the buyer opens the store in that browser (back button, the link again, or a reload); the same products again create a new order. A cart whose order was not confirmed stays intact and reopens the same pending order. Reason: the end of the usual purchase must not depend on how the checkout page and the cart share state (rejected: a cart that reopens the confirmed order). Mechanism: the cart remembers that its current order was sent to **Continuar**; only then the store asks core whether that order was confirmed, once per page load and again when the back button restores the page from the browser cache, and empties the cart on a confirmed answer. A cart that was never continued sends nothing. The checkout never touches the cart: the confirmation check is the single mechanism.
- A product that no longer exists or is no longer shown, inside a published catalog, shows «Este producto ya no está disponible» with **Volver al catálogo**, in the store theme with the store name, and answers 404.
- A load failure shows an error with **Reintentar**, never an empty catalog. A failed store lookup on a page answers 503 with that error; on the cart requests it answers `503 SERVICE_UNAVAILABLE` and the cart keeps its lines. Reason: a database failure must not look like a hidden catalog.

### Accepted limitations

- **Confirmed in another browser:** if the buyer confirmed in a different browser (for example an in-app browser that handed the checkout to the system browser), or the confirmation check fails or is rate-limited, the first browser's cart keeps its lines, and **Continuar** there opens the already confirmed order's checkout, which shows it as confirmed. No money is lost and no order is duplicated.
- **Open page on a changed address:** a buyer whose page was open when the seller hid the catalog or changed the subdomain cannot continue from it. While the old name is free, the cart gets the catalog-turned-off outcome; if another company already took it, the host resolves to that company, so no order is created and the lines show as no longer available. Nothing is ordered from the wrong store and no data leaks.
- **Cart on an old host:** a cart built on an old address stays in that host's browser storage and is not visible on the new one; the buyer builds it again.

## Theme

The catalog renders the company's [store appearance](checkout.md#appearance): one of the five themes and the logo, exactly the values the checkout uses for that theme, through the same theme scope. There is no second theming mechanism and nothing in the catalog is configurable on its own.

- **Only styles change.** Colors, fonts, type sizes and weights, rounding, borders, shadows, spacing of the header and cards, logo plate, photo filter and cart thumbnail shape. The catalog controls (search field, buttons, quantity control, cart lines) keep the height, padding and spacing they had before themes in all five themes; the checkout's field and button sizes do not reach them. Screens, order, texts, fields, rules and flow are identical in the five themes. Reason: the themes are already tested and accessible.
- **Themed screens:** header (logo on the theme's plate and store name in the heading font, as in the checkout header), search field, «Cargando productos», product grid and cards, «Ver más», the empty and no-results messages, product page, «Este producto ya no está disponible», «No encontramos esta página», and the cart (floating button as the theme's primary button, sheet, lines, «Producto quitado» with **Deshacer**, rejected-line notices, «Subtotal de productos» and **Continuar**). Reason: they are every screen the buyer goes through before the checkout.
- **Not themed:** «Catálogo no disponible» and the full-page load error keep the unbranded Yoyos look and follow the buyer's system preference. Reason: the first must not reveal whether a company exists, and the second appears before Yoyos knows whether the company exists and has its catalog published, so both look the same for every link. «Este producto ya no está disponible» and «No encontramos esta página» are themed because they happen inside a known published catalog, so theming reveals nothing.
- **Fixed scheme:** every themed screen uses the theme's fixed mode (Noche always dark; Clásico, Boutique, Antojo and Suave always light) from the first paint, whatever the buyer's system preference, as in the checkout.
- **Card photos** stay square in every theme, as before themes, with no rounding of their own: the card's rounding clips their top corners, so Suave never shows a round card photo. Card text keeps a small inset from the card edge only in themes that draw a card frame (a border, a shadow, or a card color different from the page); in frameless themes text aligns with the photo. Reason: it is what the approved mockup shows, and a 4:5 or round card photo would crop clothing photos and change the grid.
- **Cart thumbnails** take the theme's thumbnail shape, rounding and photo filter, as in the checkout, with the product's initial when the photo is missing.
- **Photo filter:** applied to card photos and cart thumbnails, never to the product page photo. Reason: the product page photo is where the buyer judges color and variant, so it shows the colors as uploaded (rejected: no filter anywhere, which departs from the approved mockup and the checkout thumbnails).
- **Product page photo:** today's shape with the theme's card rounding and border, never the thumbnail's (Suave 16 px); it is never a circle in any theme. Reason: the large photo must show the whole product.
- **Contrast floor:** the [checkout floor](checkout.md#contrast-floor) applies to every catalog element in the five themes. «Agotado» uses an opaque warning surface with warning text instead of a translucent badge over the photo, so its contrast is computable per theme. The search field always draws a border in the control color (3:1), also in themes whose fields have no border (Boutique, Noche).
- **Fonts:** the buyer's browser downloads only the fonts of the active theme; if one fails, the theme's fallback system font keeps the layout.
- **Fallback:** a company that never saved an appearance, an unknown stored theme, invalid stored data or a failed read all render Clásico without logo; the catalog is never hidden and the buyer can browse and continue. A stored logo whose image cannot be resolved shows the stored theme without logo. Reason: same rule as the checkout, so both surfaces stay identical, and a visual failure never blocks a sale.
- **When a change shows:** every load reads the latest published theme and logo. A buyer with the catalog open sees a change on the next page load; the cart in their browser is untouched.

## Rules

| Aspect | Rule |
| --- | --- |
| What is shown | Active products with at least one active variant, priced in the company's currency. Name, photo, description, attributes and sale price. Never purchase price, SKU, stock quantity or QR. |
| Search | Product name only, contains the typed text, case and accent insensitive, 2 to 80 characters. |
| Prices | The order is created with the prices current at **Continuar**, without comparing them with what the cart showed. Reason: same rule as every order; the checkout shows the real total before confirming. |
| Stock | Checked at **Continuar** to reject unavailable lines; not reserved and not deducted by the catalog. Reason: same stock rule as every order; two buyers may order the last unit and the seller resolves it in the chat. |
| Rejected cart | If a line is sold out, short of stock or no longer available, no order is created, the cart stays intact and each line shows its issue. A rejected cart consumes no order number. |
| Catalog order | Created with a visible number, checkout enabled, no buyer, no seller and no delivery. |
| Pending catalog order | A catalog order the buyer has not confirmed in the checkout. It is invisible to the seller: lists, detail and every seller action treat it as non-existent. Reason: before confirming it has no name or phone, and abandoned carts must not fill the seller's list. |
| Repeating **Continuar** | The browser derives the order id from the cart; the same cart opens the same order, a changed cart creates a new one. Reason: a retry after a lost response never duplicates the order. |
| Changing products | Done in the cart before continuing again, which creates a new order. The checkout does not allow product changes. |
| Expiry | Pending catalog orders without payments are deleted 7 days after creation (`CATALOG_ORDER_TTL_DAYS`) by a daily worker job at 04:00 `America/Lima`. Their numbers are not reused, so the seller may see gaps. An order being confirmed is never deleted. |
| Catalog turned off | The brand address shows «Catálogo no disponible»; an open cart cannot refresh (`404 CATALOG_UNAVAILABLE`), continue or check its order (`409 CATALOG_UNAVAILABLE`), and keeps its lines. Orders already created keep their checkout links, which keep working on the same host. |
| Abuse | **Continuar** is limited per client IP (20 per 10 minutes, `CATALOG_ORDER_RATE_LIMIT`). The confirmation check has its own per-IP limit (120 per 10 minutes, `CATALOG_ORDER_CHECK_RATE_LIMIT`) and never spends the **Continuar** budget. Reason: a cheap unauthenticated read must not refuse the write that creates sales, but stays bounded on a public host. The availability check is limited per seller user (60 per minute, `CATALOG_SUBDOMAIN_CHECK_RATE_LIMIT`), and its 429 shows the check-failed state. Limits are kept in process memory. |
| Privacy | Pages send `Referrer-Policy: no-referrer` and `noindex`; the order id is never logged because the checkout URL works as a credential. |

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Seller (manages settings) | Their subdomain, and the availability of any value they type | Choose, change, publish, hide | Take a subdomain another company saved; publish without a subdomain |
| Buyer without an account | The published catalog at its brand address | Browse, use the cart, **Continuar** | Learn whether a company exists behind a hidden, released or unknown address |

- The availability check answers only signed-in sellers with a company, and only says "in use", never which company. That is not real protection: anyone can create a seller account and learn that some store, perhaps a hidden one, holds a name. Accepted because a name in use reveals no company data or catalog content. No other feature may rely on it as protection.
- The public address is guessable on purpose, because it is the brand name. Only published catalogs answer, and a published catalog is public by the seller's decision.

## Data and API

- Per company: `Company.catalogSubdomain` (nullable, unique) next to `Company.catalogPublished`; see `apps/core/prisma/schema.prisma`. The subdomain is an attribute of the company's catalog with no identity of its own, so it has no table. Database `CHECK`s enforce the format and "published requires a subdomain". Reason: a published catalog without an address cannot be stored, whatever the code does.
- Brand host and availability lookups cross companies through one `SECURITY DEFINER` function, `resolve_catalog_subdomain`, which returns owner, publication, name and country in one round trip, following the pattern of the buyer order resolver `resolve_buyer_order_company` (see [company data isolation](rls-with-prisma.md)). Every other read and write of the settings stays under the `Company` RLS policy.
- Seller JSON API (seller session or bearer token with a company, `Cache-Control: no-store`); request, response and error schemas in `shared/contracts/catalog.ts`. Web uses it for the link group; mobile for the whole card and Settings → Catálogo.

| Route | Answers |
| --- | --- |
| `GET /api/catalog/settings` | Publication, subdomain, brand URL, environment domain and suggestion |
| `PUT /api/catalog/settings` `{ published }` | The settings; `409 SUBDOMAIN_REQUIRED` when publishing without a subdomain |
| `GET /api/catalog/subdomain-availability?value=` | A verdict: `available`, `current`, `in_use`, `reserved` or `invalid` with its reason (verdicts, not errors); `429 RATE_LIMITED` |
| `PUT /api/catalog/subdomain` `{ subdomain }` | The settings (the same value succeeds with no change); `422 INVALID_SUBDOMAIN` with the reason in `issues`, `422 SUBDOMAIN_RESERVED`, `409 SUBDOMAIN_TAKEN` |

- Statuses: a well-formed request a business rule rejects answers 422, a malformed body 400, a race lost to another company 409. Errors use the repository's `apiError` envelope.
- Both clients treat a `503` on the save as "no answer" and re-read the settings. Reason: the commit may have happened, and the save is idempotent.
- On web, publication is saved through the «Apariencia de la tienda» editor's action. The cart's requests on the brand host (`/carrito`: refresh, `continue`, `check_order`) are a web route, not part of the JSON API.

## Observability

Logging follows [logging conventions](logging.md).

- Seller events: `catalog_subdomain_saved` (with `change`: `first` or `replaced`; saving the current value does not log), `catalog_subdomain_rejected` and `catalog_publication_rejected` (debug), `catalog_publication_changed`, and `unable_to_save_catalog_subdomain`.
- `unable_to_read_catalog` is the single log of read failures, with `operation` `read_settings`, `resolve_subdomain` (no company: it is unknown before the lookup), `read_appearance`, `read_preview_store` or `read_preview_cards`. `unable_to_check_cart_order` logs a failed confirmation check.
- The two newer limiters log `catalog_subdomain_check_rate_limited` and `catalog_order_check_rate_limited` (warn) only for the first rejection per key per window, so a scripted client cannot turn each 429 into a log line.
- `http_request_completed` carries the operations `get_catalog_settings`, `check_catalog_subdomain`, `save_catalog_subdomain`, `set_catalog_publication`, `browse_catalog`, `get_catalog_product`, `resolve_storefront`, `legacy_catalog_link` and `check_cart_order`, and `storeHost` (`app`, `store` or `invalid`).
- Never logged: the typed or saved subdomain (it can be a person's name), the `Host` header and request URL of a brand host, the order id and order number, and cart contents. Resolution misses for unknown hosts and the edge answers are not logged: they are expected and come from anyone.

## Known risks

- **Reuse of a released subdomain.** Right after a seller changes the link, another company can take the old one, with no redirect or waiting period. Buyers with the old brand link, and buyers whose browser cached a legacy `/catalogo/<id>` 308 to the old subdomain, then land in the other store and could order from the wrong business without either seller seeing it. Accepted: changing a shared link is rare, and buyers there would see a different store's name and theme.
- **Per-IP limits behind Cloudflare.** Express trusts only loopback and private proxies, so behind Cloudflare and Traefik the client IP is most likely a Cloudflare edge address, and the **Continuar** and confirmation-check limits are shared by every buyer behind the same edge, so a shared **Continuar** budget can refuse unrelated buyers' orders. The fix changes how the whole app trusts proxies (sign-in, logs, every limiter) and needs a maintained list of Cloudflare ranges; `CF-Connecting-IP` must never be trusted blindly, because the origin is reachable directly. Accepted only while catalog traffic is low.
- **Cart image lookups.** Refreshing the cart resolves each line's image with its own query (up to 30 sequential lookups).

## Decisions

| Decision | Reason |
| --- | --- |
| The catalog creates a normal order and hands over to the existing checkout | Buyer data, delivery and payment already work there; nothing is duplicated, and checkout improvements apply to catalog orders. |
| Pending state derived from "from catalog and not confirmed", no new order state | Confirmation already exists; a draft state would touch every order flow. |
| Order number allocated at creation | The checkout shows the number from the start and confirmation stays unchanged. |
| Every active product appears; no per-product visibility | Zero configuration for the seller. |
| No WhatsApp contact button | The checkout does not configure a WhatsApp contact either. |
| No notification to the seller of a new catalog order | Yoyos has no notifications; the checkout has none either. |
| One store theme for catalog and checkout, no theme per surface | The store must look the same from the first product to the payment. |
| The catalog lives at a seller-chosen brand subdomain, at the root of the host | A brand address the buyer can remember and the seller can say out loud. |
| Choosing the link and publishing live in the **Publicar catálogo** card; copying and sharing stay in Settings → Catálogo | One place to set up the store; sharing is a separate daily action. |
| The link saves with its own button, outside the logo and theme draft | Each save says what it saves; an untouched suggestion or a pending link never mixes with the appearance. |
| Publishing requires a saved subdomain | "Published" always means "reachable at its address". |
| The same «Catálogo no disponible» for every unavailable host, `noindex` and `no-referrer` | A hidden or unknown address never reveals whether a company exists. |
| The legacy company-id link only redirects, and only to a published catalog | Old links keep working without becoming a second way to see a catalog. |
| The brand host learns about the confirmation by asking core, only for a continued cart | The cart does not depend on the checkout page; asking only after **Continuar** keeps unauthenticated reads rare. |
| The checkout and the buyer APIs live on the store's brand host, for published and hidden catalogs | The buyer stays at the store's address until paying; hiding the shop window must not break sales already shared by link. |
| The cart is stored per company, not per address | A reused address never shows another store's cart. |
