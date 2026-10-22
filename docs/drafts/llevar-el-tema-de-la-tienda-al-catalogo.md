# Store theme in the public catalog («Apariencia de la tienda»): product definition

**Status:** definition ready to implement; the founder closed every product decision on 21/10/2026. Already in place: five fixed themes and the web editor «Apariencia del checkout» ([Checkout · Appearance](../checkout.md#appearance), PR #111), and the public catalog with the default Yoyos look and the «Publicar catálogo» switch under Settings → Catálogo ([Public catalog](../public-catalog.md)). This draft replaces the catalog rule "does not adopt the checkout themes" and turns the checkout appearance into the store appearance. Todoist task 6hpwfg8pfvjxq9jV. Visual reference approved by the founder: the «Apariencia de la tienda» editor mockups (Catálogo tab with Clásico and Noche, Checkout tab with Clásico); they set the layout, not the final texts.

## Problem and situation

A clothing seller picks Noche for her checkout and shares her catalog link on Instagram. The buyer opens the catalog: white background, default Yoyos buttons, the logo on a plate. She builds a cart, taps **Continuar** and lands on a dark checkout with a cyan button and different fonts. In two taps the store changed its look; the buyer wonders whether she is still in the same shop, right when she is about to pay. The seller has no way to fix it: the theme only reaches the checkout, and to publish or hide the catalog she goes to another settings page (Settings → Catálogo) than the one where she chose her logo and theme.

## Goal

The seller sets up how her store looks in one place, «Apariencia de la tienda», and the buyer sees the same theme from the first product to the payment.

Hypothesis: a buyer who goes from catalog to checkout without a visual jump abandons less at the handoff. There are no businesses operating yet, so there is no before/after to compare and this effect cannot be measured at launch. Signals that need no baseline: the share of published catalogs whose company chose a theme other than Clásico (sellers use the theme once it reaches the catalog), and, once sellers operate, whether they or their buyers mention that the catalog and the checkout look like different shops. The share of catalog orders confirmed in the checkout becomes readable only with real volume, as a level, not as an improvement.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Seller setting up her store from the computer | Choose logo and theme, see how catalog and checkout look before publishing, publish or hide the catalog | Web panel: «Apariencia de la tienda» |
| Seller managing her store from the phone | Change logo or theme, publish or hide the catalog without opening the web | Mobile app: Settings → «Apariencia de la tienda» |
| Seller sharing her catalog in a chat | Copy or share the link | Web and mobile: Settings → Catálogo |
| Buyer who opened the catalog link from Instagram or WhatsApp, without an account | Browse, build the cart and continue to pay in a store that looks the same throughout | Public catalog `/catalogo/:companyId` and checkout |

## First-version scope

1. **One store theme.** The theme the company chose (Clásico, Boutique, Antojo, Suave, Noche) and its logo apply to the checkout and to the public catalog. There is no separate theme per surface.
2. **Themed catalog.** Header, search, product grid, product cards, «Ver más», product page (including «Este producto ya no está disponible»), cart (floating button and sheet), and the catalog's notices take the theme's values over today's layout. Same screens, order, texts and flow; only styles change.
3. **«Apariencia de la tienda» on web.** The «Apariencia del checkout» editor is renamed and gains the «Publicar catálogo» card, moved from Settings → Catálogo. Everything else in the editor stays as it is today.
4. **Preview with «Catálogo | Checkout».** The editor preview gets a selector that opens on Catálogo; the catalog view is a short version with real products or sample products.
5. **«Apariencia de la tienda» on mobile.** A new settings screen with logo, theme and the «Publicar catálogo» switch moved from Settings → Catálogo, built from the settings components the app already has.
6. **Settings → Catálogo** keeps the link, on web and mobile, and points to where publication now lives.
7. **Languages.** Every new or changed text exists in Spanish and in Brazilian Portuguese (pt-BR), in the web panel and in the mobile app, as every current text does. This document gives the Spanish text; the pt-BR text is its equivalent.
8. **Docs.** [public-catalog.md](../public-catalog.md) and [checkout.md](../checkout.md#appearance) state the new rule and its reason when the feature is merged.

Launch: for every company at once, with no notice. Each catalog takes the theme its company already chose for the checkout (most are on Clásico). No company loses theme, logo or publication state.

## Out of this version

- Redesigning the checkout, the catalog or any other screen; new themes, editable themes, free colors, custom domains, per-product settings. Trigger: a separate founder decision.
- Moving the catalog link or the visible store name. They stay where they are.
- Theming the seller panel, the editor itself, «Enlace no disponible», «Catálogo no disponible», the full-page catalog load error, or any mobile app screen.
- **A way to see the theme from the phone before publishing.** The mobile screen has only the static theme samples, with no live preview. After saving, a seller with a published catalog sees the result in Settings → Catálogo → **Ver catálogo**; a seller with a hidden catalog, and the checkout look in any case, cannot be seen from the phone until the catalog is published (or from the web editor). This gap is accepted. Trigger: sellers who work only from the phone asking to see the theme before publishing.
- **Restablecer apariencia** in the mobile app. The seller gets the same result by choosing Clásico and removing the logo. Trigger: none expected.
- A notice to merchants about the change. Merge and deployment are the founder's decision.

## Flow

**Seller on web**

1. Settings → «Apariencia de la tienda». The editor loads the published logo and theme, the catalog publication state and the preview on **Catálogo**.
2. The seller chooses Boutique. The preview of the catalog repaints at once; «Cambios sin guardar» appears.
3. She switches the preview to **Checkout**: it shows the same draft theme. She switches back to **Catálogo** without losing anything.
4. **Guardar cambios** publishes logo and theme together («Apariencia actualizada»). The catalog and every checkout link show Boutique from the next load.
5. Independently, she turns on **Publicar catálogo**. It saves at once, as today; it neither needs nor triggers **Guardar cambios**.

- Leaving with unsaved logo or theme asks «Seguir editando» / «Descartar y salir» (as today). The switch never counts as an unsaved change.
- Hiding the catalog asks for confirmation; a failed save returns the switch to its previous position.

**Seller on mobile**

1. Settings → «Apariencia de la tienda».
2. Changes logo or theme; the bottom bar appears with «Cambios sin guardar», **Descartar** and **Guardar cambios**.
3. **Guardar cambios** publishes them («Apariencia actualizada») and the bar disappears.
4. **Publicar catálogo** saves at once, with the same confirmation on hide as today.

**Buyer**

1. Opens `/catalogo/:companyId`; the catalog of a company on Noche is dark from the first paint, whatever the phone's light or dark setting.
2. Browses, opens a product, adds it, opens the cart: all in Noche.
3. **Continuar** takes them to the checkout, also in Noche.

## Screens

**«Apariencia de la tienda» (web)**: Settings → «Apariencia de la tienda», in the panel menu at the position «Apariencia del checkout» had. The old address of the checkout appearance editor opens this screen, in both its plain and its language-prefixed form.

- Title «Apariencia de la tienda»; description «Tu logo y tu tema se aplican a tu catálogo y a tu checkout.»; note «Se aplicará a tu catálogo y a todos tus enlaces de checkout, incluidos los ya compartidos.»
- **Logo** section: unchanged except the hint, «PNG, JPG o WEBP · hasta 10 MB. Tus clientes verán este logo en tu catálogo y en tu checkout.»
- **Tema** section: unchanged (five options in the fixed order, static samples, name, one-line description, check mark). The list's accessible name is «Temas de la tienda».
- **Restablecer apariencia**: unchanged; it resets logo and theme only, never the publication.
- **Publicar catálogo** card, after **Tema**: the current switch with its current texts («Publicar catálogo», «Cualquier persona con el link podrá ver tus productos y hacer pedidos.», «Catálogo publicado» / «Catálogo oculto», confirmation «¿Ocultar tu catálogo?» with **Ocultar catálogo** / **Mantener publicado**, error «No pudimos guardar el cambio» with **Reintentar**), plus the line «Este cambio se guarda al momento.» It sits outside the draft: **Descartar**, **Guardar cambios** and the leave confirmation ignore it.
- **Guardar cambios**, **Descartar**, «Cambios sin guardar», the leave confirmation and every save error keep their current texts and behavior.
- **Loading the two parts independently.** The appearance (logo, theme, preview) and the publication card load and fail separately; a failure in one never hides the other:
  - Appearance fails to load (no connection, service down, or stored data that cannot be read): the Logo, Tema and preview area shows «No se pudo cargar la apariencia» with **Reintentar**; **Guardar cambios**, **Descartar** and **Restablecer apariencia** are not shown. The **Publicar catálogo** card loads and works as usual, so the seller can always publish or hide the catalog.
  - Publication state fails to load: the card shows «No pudimos cargar la configuración del catálogo» with **Reintentar**; the rest of the editor works.
- **Unknown stored theme.** If the stored theme is not one of the five, the editor opens with Clásico selected (what buyers are seeing), the stored logo, and the notice «Tu tienda se está mostrando con el tema Clásico. Elige un tema y guarda para confirmarlo.» with «Cambios sin guardar» active, so **Guardar cambios** stores a valid theme. It is never a load error.
- Phone width: the existing **Editar** and **Vista previa** tabs; the **Publicar catálogo** card is in **Editar**.

**Editor preview (web)**

- At the top, a two-option selector **Catálogo** | **Checkout**, with accessible name «Vista previa», each option announced with its selected state, and touch targets of at least 44 px like the **Editar** and **Vista previa** tabs. It opens on **Catálogo** every time the editor loads; switching keeps the draft and the device choice.
- Below the selector, one label for the active view: the theme and the origin of the data. Catálogo: «Tema Boutique · Tus productos» or «Tema Boutique · Datos de ejemplo». Checkout: «Tema Boutique · Datos de ejemplo» (replaces the checkout's current «Vista previa · Datos de ejemplo»; the selector already says which surface it is).
- Both views paint the draft theme and logo; choosing a theme updates whichever view is visible and the other when shown. Nothing published changes until **Guardar cambios**.
- The phone/desktop switch applies to both views. The review/payment switch exists only in **Checkout**.
- **Catálogo** view: short version built with the real catalog components: header (logo plate and store name), search field, the first three products in the catalog's own order (newest first, only products the catalog would show) and the floating cart button.
  - While the products load, the view shows the header and three empty card placeholders in the draft theme with «Cargando productos»; it never shows sample products first and swaps them for real ones.
  - A company with one or two visible products sees those only; sample products are never mixed with real ones.
  - A company with no visible products, or whose products fail to load, sees three sample products. A product-load failure never blocks the editor.
  - The cart button shows one unit of the first product shown and its price: a real product with real products, a sample with samples.
  - Hidden catalog: the preview shows it all the same; it previews the look, not the publication.
  - The preview is inert: nothing navigates, searches, adds to a cart or creates orders; its search field, cards and cart button are out of the keyboard focus order and hidden from screen readers, which announce only the label of the view.
- **Checkout** view: the current preview, unchanged except its label.

**«Apariencia de la tienda» (mobile)**: Settings tab → «Apariencia de la tienda».

- Settings menu rows, in order: the delivery row, «Apariencia de la tienda» (description «Logo, tema y publicación de tu catálogo»), «Catálogo» (description unchanged).
- Title «Apariencia de la tienda»; description «Tu logo y tu tema se aplican a tu catálogo y a tu checkout.»
- **Logo**: the logo on its white plate, or «Sin logo»; **Subir logo** (or **Cambiar**) with gallery or camera, as product photos; **Quitar logo**. Same limits and errors as web: «Usa una imagen PNG, JPG o WEBP.», «El logo debe pesar hasta 10 MB.», «No pudimos subir el logo. Inténtalo de nuevo.» with **Reintentar**. While uploading: «Subiendo logo…». Uploading does not publish.
- **Tema**: the five themes in the fixed order, each with a static sample, name, the same description as web and a check mark on the selected one. The sample uses the theme's real colors, rounding, button shape and thumbnail shape with the phone's system font; the app bundles no theme fonts. The list is announced as «Temas de la tienda», a single-choice group: each option is read with its name, description and whether it is selected. Touch targets of at least 44 pt.
- **Publicar catálogo**: the current card moved as is (switch, hint, hide confirmation, error with **Reintentar**), plus «Este cambio se guarda al momento.»
- **Save bar**: while the draft has changes, a bar fixed at the bottom of the screen, above the tab bar and always visible without scrolling, shows «Cambios sin guardar», **Descartar** and **Guardar cambios**. Without changes the bar is not shown.
  - While saving: **Guardar cambios** reads «Guardando…»; both buttons, the logo actions and the theme list are disabled. The **Publicar catálogo** switch stays usable.
  - While a logo uploads: **Guardar cambios** is disabled until the upload finishes or fails; the theme list stays usable.
- **Leaving with changes**: when the screen leaves the settings stack (back, or navigating away from it) with unsaved changes, «Tienes cambios sin guardar» with **Seguir editando** / **Descartar y salir**, the same pattern the app's forms use. Switching to another tab does not ask: the screen stays open and the draft is kept.
- **Loading**: «Cargando…» while loading. The appearance and the publication card load and fail separately, as on web: an appearance load error («No se pudo cargar la apariencia» with **Reintentar**) replaces only Logo and Tema, and the **Publicar catálogo** card keeps working; a publication load error stays inside its card.
- **Unknown stored theme**: same as web: Clásico selected, the notice «Tu tienda se está mostrando con el tema Clásico. Elige un tema y guarda para confirmarlo.» and the save bar shown.
- The screen keeps the app's own look; the selected theme shows only in the samples.

**Settings → Catálogo (web and mobile)**

- Title and description unchanged: «Catálogo», «Comparte un link con tus productos para que tus clientes hagan pedidos.»
- The switch is no longer here. As today, the link, **Copiar link**, **Ver catálogo** and, on mobile, **Compartir** show only while the catalog is published.
- Published: the link and its buttons, then «Para ocultar tu catálogo, ve a Apariencia de la tienda.» with **Ir a Apariencia de la tienda**.
- Hidden: «Tu catálogo está oculto. Publícalo desde Apariencia de la tienda.» with **Ir a Apariencia de la tienda**.
- Load error: as today («No pudimos cargar la configuración del catálogo» with **Reintentar**).

**Public catalog (buyer)**: every screen of a published catalog, with the theme of the company.

- Header: logo on the theme's plate (size, rounding, border, shadow, position) and store name in the heading font, exactly as in the checkout header.
- Search field, «Cargando productos», «Ver más» and the no-results message: theme colors, fonts, rounding and borders.
- Product cards: theme surface, border, rounding, shadow and fonts. The card photo keeps today's square shape in every theme and has no rounding of its own: its corners follow the card's (the card's rounding clips the photo's top corners), so Suave cards never show a round photo. The photo takes the theme's photo filter. The neutral block with the initial replaces a missing photo, with the same shape. «Desde» and «Agotado» with the theme's colors (semantic tone for «Agotado»).
- Product page: photo with the theme's rounding and border and **no photo filter**; name in the heading font; price in the body font; attribute selectors and quantity with the theme's control, selected and focus styles; **Agregar** as the theme's primary button.
- «Este producto ya no está disponible» with **Volver al catálogo**: themed. The company and its published catalog are already known at that point, so theming reveals nothing, and the buyer stays in the same store.
- Cart: floating button as the theme's primary button; sheet with lines, each thumbnail with the theme's thumbnail shape, rounding and photo filter (as in the checkout), quantity controls, «Producto quitado» with **Deshacer**, rejected-line notices, «Subtotal de productos» and **Continuar**.
- Not themed, with the unbranded Yoyos look that follows the buyer's system preference:
  - «Catálogo no disponible»: an unpublished catalog must not reveal that the company exists.
  - The full-page catalog load error with **Reintentar**: it appears when the catalog could not be read, before Yoyos knows whether the company exists and has its catalog published, so it is shown the same way for every link.

## Rules

| Aspect | Behavior |
| --- | --- |
| One theme | The company has one theme and one logo, shared by catalog and checkout. Saving Antojo changes both. |
| What the theme changes in the catalog | Colors, fonts, type sizes and weights, rounding, borders, shadows, spacing, logo plate, photo filter and cart thumbnail shape, exactly the values the checkout uses for that theme. Screens, order, texts, fields and flow are identical in the five themes and identical to today. |
| Card photos | Square in every theme, as today, with no rounding of their own; the card's corners clip them. Example: in Suave the card has rounded corners and its photo fills the top of the card, never a circle. |
| Photo filter | Applies to card photos and cart thumbnails. Never to the product page photo: that is the large photo where the buyer chooses color and variant, so it shows the colors as uploaded. The filters are mild (saturation 0.8 to 1.15, brightness 0.88 to 1.03) and Clásico has none. |
| Fixed mode | Noche is always dark; Clásico, Boutique, Antojo and Suave always light, in the catalog as in the checkout. The buyer's system preference does not change them. |
| Contrast floor | The same floor as the checkout applies to every catalog element in the five themes: text 4.5:1 against its surface, controls, selected states and focus 3:1. |
| Semantic colors | Errors, warnings, success and «Agotado» keep their meaning in every theme, in the theme's tones that meet the floor. |
| Fonts | The buyer's browser downloads only the fonts of the active theme. If a font fails, the theme's fallback system font keeps the layout. |
| Logo | Whole, never cropped or recolored, on the white plate shaped by the theme. Without a logo, or if it fails to load, the store name alone. |
| Default | A company that never saved an appearance is on Clásico without logo, in catalog and checkout. |
| Unknown theme | An unknown stored theme shows Clásico in catalog and checkout; the editor opens on Clásico and asks to save to confirm. |
| Appearance read fails | The catalog loads with Clásico without logo, is never hidden and still lets the buyer browse and continue. Same as the checkout. |
| When a change shows | The catalog and the checkout show the last published theme and logo on every load. A buyer with the catalog already open sees the change on the next page load; the cart in their browser is untouched. |
| Draft | Logo and theme are published only with **Guardar cambios**, on web and mobile, as one unit. The preview shows the draft. |
| Publication switch | Saved at once, independent of the draft and of whether the appearance loaded, with confirmation on hide and return to its previous position on failure. Same behavior as today, now in «Apariencia de la tienda» on web and mobile. |
| Concurrent edits | The last completed save wins, also between web and mobile. There is no lock or merge. |
| Preview products | Up to three real products in the catalog's order; none → three sample products. Real and sample are never mixed, also in the cart button. |
| Seller surfaces | The seller panel, the web editor and the mobile app keep the Yoyos look. |
| Languages | Every new or changed text has its Spanish and pt-BR version, on web and mobile. |

## When something fails

| Situation | What the user sees | What they can do |
| --- | --- | --- |
| **Guardar cambios** succeeds (web or mobile) | «Apariencia actualizada»; the badge (or the mobile save bar) disappears | Keep editing |
| Save rejected: unknown theme | «Revisa el tema e inténtalo de nuevo.»; draft kept | Choose again and save |
| Save rejected: invalid logo | «No pudimos usar ese logo. Súbelo de nuevo.»; draft kept, logo marked | Upload another logo |
| Save not sent or no response | «No pudimos guardar la apariencia. Conservamos tu borrador.» with **Reintentar**; nothing presented as published | **Reintentar** publishes the same logo and theme; repeating cannot duplicate or mix |
| Logo upload fails | «No pudimos subir el logo. Inténtalo de nuevo.» with its own **Reintentar**; the theme is untouched | Retry the upload |
| Switch saved | «Catálogo publicado» / «Catálogo oculto» | — |
| Switch save fails or gets no response | The switch returns to its previous position; «No pudimos guardar el cambio» with **Reintentar** (no new confirmation) | Retry; publishing twice leaves it published |
| Appearance fails to load in the editor (web or mobile) | Logo, Tema and preview replaced by «No se pudo cargar la apariencia» with **Reintentar**; the **Publicar catálogo** card keeps working | Retry; publish or hide the catalog meanwhile |
| Stored theme is unknown | Editor on Clásico with «Tu tienda se está mostrando con el tema Clásico. Elige un tema y guarda para confirmarlo.» | Choose a theme and save |
| Publication state fails to load | Only the card shows «No pudimos cargar la configuración del catálogo» with **Reintentar** | Retry; the rest of the screen works |
| Products fail to load for the preview | Three sample products labeled «Tema … · Datos de ejemplo» | Nothing needed |
| Buyer: appearance cannot be read | Catalog in Clásico without logo, fully usable | Browse and continue |
| Buyer: catalog cannot be read | Unthemed full-page error with **Reintentar** (as today) | Retry |
| Buyer: theme font fails | Same layout with the fallback font | — |
| Seller leaves with unsaved logo or theme | «Tienes cambios sin guardar» with **Seguir editando** / **Descartar y salir** (mobile: only when the screen leaves the stack) | Choose |

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Seller who manages the company's settings (web or mobile) | Published appearance, draft, publication state, preview with their own products | Change logo and theme, publish or hide the catalog | Edit theme values; change another company's appearance |
| Buyer | The catalog and checkout of the company with its theme and logo | Browse, build the cart, continue to the checkout | Learn whether an unpublished catalog's company exists: «Catálogo no disponible» and the full-page load error stay unthemed so they reveal nothing |

No new role or permission appears. The preview shows the seller's own products inside their session; it reveals nothing to buyers.

## Information that is kept

- The theme and the logo belong to the company, as today. Nothing is copied into orders or carts; every load shows the current ones.
- The publication state belongs to the company, as today, and is not touched by saving or resetting the appearance.
- The draft lives only on the open editor screen; it is lost if the seller discards or leaves.
- No new information is stored. Existing companies keep their theme, logo and publication state; their catalog simply starts showing that theme. To be resolved in implementation: whether the module or its stored data is renamed; if so, without losing any company's theme, logo or publication state.

## Vocabulary

- Store appearance, «Apariencia de la tienda»: the company's logo and theme, applied to catalog and checkout, plus the catalog publication switch on the same screen. Replaces «Apariencia del checkout».
- Theme, «tema»: one of the five fixed looks. The interface always says «tema», never «estilo», «plantilla» or «diseño» (the mockup's «Elige el estilo de tu tienda» is not used).
- Store, «tienda»: what the buyer sees of the company, catalog and checkout together.
- Publish the catalog, «Publicar catálogo»: make the catalog link work. It is not the same as saving the appearance.

## Closed decisions

| Decision | Why |
| --- | --- |
| One theme shared by catalog and checkout, no theme per surface | The store must look the same from first product to payment. |
| The section is «Apariencia de la tienda» with logo, theme and «Publicar catálogo», and replaces «Apariencia del checkout» | One place to set up how the store looks and whether it is open. |
| «Publicar catálogo» moves to «Apariencia de la tienda» on web and mobile; the link and the store name stay where they are | Publishing belongs with the store's look; sharing the link is a separate daily action. |
| The publication card loads and works even when the appearance cannot be loaded | After the move it is the only place to hide the catalog; a failing logo or theme read must never stop the seller from closing the store. |
| On mobile the section is created with logo, theme and switch, reusing existing settings components | Parity of a seller setting on both platforms without redesigning other screens. |
| The theme applies to the catalog header, grid, cards, product page and cart | They are every screen the buyer goes through before the checkout. |
| Card photos stay square with no rounding of their own; the theme's thumbnail shape applies only to cart thumbnails | It is what the approved mockup shows; a 4:5 or round card photo would crop clothing photos and change the grid layout. |
| The theme's photo filter applies to card photos and cart thumbnails, never to the product page photo | The approved mockup filters the cards; the product page photo is where the buyer judges color, so it keeps the uploaded colors. Discarded: no filter anywhere in the catalog (most faithful colors, but the grid departs from the approved mockup and from the checkout thumbnails). |
| One preview with a «Catálogo | Checkout» selector, opening on Catálogo, short catalog view with real or sample products | Compare both surfaces without leaving the editor; the catalog is what the buyer sees first. |
| A store with one or two products sees only those in the preview, departing from the literal «2–3 tarjetas» | Padding with sample products would show the seller a store that is not theirs; real and sample are never mixed. |
| Launch for every company at once, with no notice; each catalog adopts the theme already chosen | There are no customers yet. |
| Only styles change in the catalog; same rules as the checkout (fixed mode, contrast floor, semantic colors, unknown theme → Clásico, read failure → default look without hiding) | The themes are already tested and accessible; a visual failure never blocks a sale. |

## Acceptance criteria

1. In the web panel, the menu shows «Apariencia de la tienda» and no «Apariencia del checkout»; the screen shows Logo, the five themes, **Restablecer apariencia** and the **Publicar catálogo** card. Opening the old checkout appearance address, plain or with the language prefix, lands on this screen.
2. The seller opens the editor: the preview is on **Catálogo** with «Tema Clásico · Tus productos». She chooses Noche: the catalog preview turns dark; she switches to **Checkout**: it is Noche too; she switches back and the draft is intact. In another tab, the published catalog is still Clásico.
3. She taps **Guardar cambios**: «Apariencia actualizada». Reloading `/catalogo/:companyId` shows Noche in header, grid, cards, product page and cart, and the checkout of order #1001 shows Noche.
4. A company with five visible products sees its three newest in the catalog preview with «Tus productos» and the cart button with one unit of the newest at its price; one with two sees those two; one with none sees three sample products with «Datos de ejemplo». While products load, the view shows empty placeholders, never samples.
5. For each of the five themes, the catalog's header, cards, product page and cart use the same colors, fonts, rounding, logo plate and filter as the checkout of the same company; card photos are square with the card's corners (in Suave too); the product page photo has no filter; every text and control meets the contrast floor.
6. A buyer with the phone in dark mode opens a Boutique catalog: it is light. A buyer in light mode opens a Noche catalog: it is dark.
7. In every theme, the catalog shows the same screens, texts, order of products, search, «Ver más», «Desde», «Agotado», cart limits and **Continuar** behavior as before this change.
8. Reading the appearance fails while a buyer opens the catalog: it loads in Clásico without logo, they can add a product and continue to the checkout.
9. A buyer on a Noche catalog opens a product that was just deactivated: «Este producto ya no está disponible» with **Volver al catálogo** shows in Noche. A link to a hidden catalog shows «Catálogo no disponible» unthemed.
10. On web, the seller turns off **Publicar catálogo**: «¿Ocultar tu catálogo?»; **Ocultar catálogo** hides it («Catálogo oculto») without touching the draft or showing «Cambios sin guardar». With the network down, the switch returns to on and shows «No pudimos guardar el cambio» with **Reintentar**.
11. The appearance cannot be read (stored data unreadable or service down): on web and mobile, «No se pudo cargar la apariencia» replaces Logo and Tema, and the seller still hides the catalog from the **Publicar catálogo** card.
12. A company whose stored theme is unknown opens the editor: Clásico is selected with «Tu tienda se está mostrando con el tema Clásico…» and «Cambios sin guardar»; choosing Suave and saving stores Suave.
13. On mobile, Settings shows «Apariencia de la tienda»; the seller uploads a logo from the gallery («Subiendo logo…», **Guardar cambios** disabled meanwhile), chooses Suave and taps **Guardar cambios** in the bottom bar without scrolling: the catalog and the checkout show Suave with that logo. With an unsaved theme, switching to the Orders tab and back keeps the draft without asking; going back out of the screen asks **Seguir editando** / **Descartar y salir**.
14. On mobile, a screen reader announces the theme list as «Temas de la tienda» and each theme with its selected state; the samples render with the system font.
15. On mobile, hiding the catalog from «Apariencia de la tienda» asks for confirmation and works as it did in Settings → Catálogo. Settings → Catálogo, published, shows the link with **Copiar link**, **Ver catálogo**, **Compartir** and «Para ocultar tu catálogo, ve a Apariencia de la tienda.»; hidden, shows no link and «Tu catálogo está oculto. Publícalo desde Apariencia de la tienda.»; both with **Ir a Apariencia de la tienda**. The same on web, without **Compartir**.
16. A company on Antojo with a logo and a published catalog before the change opens the panel after the release: the editor shows Antojo, its logo and the switch on, and its catalog shows Antojo. A company that never saved an appearance shows Clásico without logo.
17. With the panel or the app in Portuguese, every new or changed text of this feature shows in pt-BR.
18. [public-catalog.md](../public-catalog.md) and [checkout.md](../checkout.md#appearance) state that the catalog uses the store theme and why, and that the switch lives in «Apariencia de la tienda».
