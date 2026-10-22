# Store theme in the public catalog («Apariencia de la tienda»): product definition

**Status:** definition ready to implement; the founder closed every product decision on 21/10/2026. Already in place: five fixed themes and the web editor «Apariencia del checkout» ([Checkout · Appearance](../checkout.md#appearance), PR #111), and the public catalog with the default Yoyos look and the «Publicar catálogo» switch under Settings → Catálogo ([Public catalog](../public-catalog.md)). This draft replaces the catalog rule "does not adopt the checkout themes" and turns the checkout appearance into the store appearance. Todoist task 6hpwfg8pfvjxq9jV. Visual reference approved by the founder: the «Apariencia de la tienda» editor mockups (Catálogo tab with Clásico and Noche, Checkout tab with Clásico); they set the layout, not the final texts.

## Problem and situation

A clothing seller picks Noche for her checkout and shares her catalog link on Instagram. The buyer opens the catalog: white background, default Yoyos buttons, the logo on a plate. She builds a cart, taps **Continuar** and lands on a dark checkout with a cyan button and different fonts. In two taps the store changed its look; the buyer wonders whether she is still in the same shop, right when she is about to pay. The seller has no way to fix it: the theme only reaches the checkout, and to publish or hide the catalog she goes to another settings page (Settings → Catálogo) than the one where she chose her logo and theme.

## Goal

The seller sets up how her store looks in one place, «Apariencia de la tienda», and the buyer sees the same theme from the first product to the payment. Hypothesis: a buyer who goes from catalog to checkout without a visual jump abandons less at the handoff; it would show in the share of catalog orders that get confirmed in the checkout.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Seller setting up her store from the computer | Choose logo and theme, see how catalog and checkout look before publishing, publish or hide the catalog | Web panel: «Apariencia de la tienda» |
| Seller managing her store from the phone | Change logo or theme, publish or hide the catalog without opening the web | Mobile app: Settings → «Apariencia de la tienda» |
| Seller sharing her catalog in a chat | Copy or share the link | Web and mobile: Settings → Catálogo (unchanged) |
| Buyer who opened the catalog link from Instagram or WhatsApp, without an account | Browse, build the cart and continue to pay in a store that looks the same throughout | Public catalog `/catalogo/:companyId` and checkout |

## First-version scope

1. **One store theme.** The theme the company chose (Clásico, Boutique, Antojo, Suave, Noche) and its logo apply to the checkout and to the public catalog. There is no separate theme per surface.
2. **Themed catalog.** Header, search, product grid, product cards, «Ver más», product page, cart (floating button and sheet), and the catalog's notices take the theme's values over today's layout. Same screens, order, texts and flow; only styles change.
3. **«Apariencia de la tienda» on web.** The «Apariencia del checkout» editor is renamed and gains the «Publicar catálogo» card, moved from Settings → Catálogo. Everything else in the editor stays as it is today.
4. **Preview with «Catálogo | Checkout».** The editor preview gets a selector that opens on Catálogo; the catalog view is a short version with real products or sample products.
5. **«Apariencia de la tienda» on mobile.** A new settings screen with logo, theme and the «Publicar catálogo» switch moved from Settings → Catálogo, built from the settings components the app already has.
6. **Settings → Catálogo** keeps only the link, on web and mobile.
7. **Docs.** [public-catalog.md](../public-catalog.md) and [checkout.md](../checkout.md#appearance) state the new rule and its reason when the feature is merged.

Launch: for every company at once, with no notice. Each catalog takes the theme its company already chose for the checkout (most are on Clásico). No company loses theme, logo or publication state.

## Out of this version

- Redesigning the checkout, the catalog or any other screen; new themes, editable themes, free colors, custom domains, per-product settings. Trigger: a separate founder decision.
- Moving the catalog link or the visible store name. They stay where they are.
- Theming the seller panel, the editor itself, «Enlace no disponible», «Catálogo no disponible» or any mobile app screen.
- A live preview in the mobile app. The mobile screen shows the static theme samples; the seller sees the result with **Ver catálogo**. Trigger: sellers asking to see the theme before saving from the phone.
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
2. Changes logo or theme; **Guardar cambios** appears with «Cambios sin guardar».
3. **Guardar cambios** publishes them («Apariencia actualizada»).
4. **Publicar catálogo** saves at once, with the same confirmation on hide as today.

**Buyer**

1. Opens `/catalogo/:companyId`; the catalog of a company on Noche is dark from the first paint, whatever the phone's light or dark setting.
2. Browses, opens a product, adds it, opens the cart: all in Noche.
3. **Continuar** takes them to the checkout, also in Noche.

## Screens

**«Apariencia de la tienda» (web)**: Settings → «Apariencia de la tienda», in the panel menu at the position «Apariencia del checkout» had. The old address of the checkout appearance editor opens this screen.

- Title «Apariencia de la tienda»; description «Tu logo y tu tema se aplican a tu catálogo y a tu checkout.»; note «Se aplicará a tu catálogo y a todos tus enlaces de checkout, incluidos los ya compartidos.»
- **Logo** section: unchanged except the hint, «PNG, JPG o WEBP · hasta 10 MB. Tus clientes verán este logo en tu catálogo y en tu checkout.»
- **Tema** section: unchanged (five options in the fixed order, static samples, name, one-line description, check mark). The list's accessible name is «Temas de la tienda».
- **Restablecer apariencia**: unchanged; it resets logo and theme only, never the publication.
- **Publicar catálogo** card, after **Tema**: the current switch with its current texts («Publicar catálogo», «Cualquier persona con el link podrá ver tus productos y hacer pedidos.», «Catálogo publicado» / «Catálogo oculto», confirmation «¿Ocultar tu catálogo?» with **Ocultar catálogo** / **Mantener publicado**, error «No pudimos guardar el cambio» with **Reintentar**), plus the line «Este cambio se guarda al momento.» It sits outside the draft: **Descartar**, **Guardar cambios** and the leave confirmation ignore it.
- **Guardar cambios**, **Descartar**, «Cambios sin guardar», the leave confirmation and every save error keep their current texts and behavior.
- States: loading as today. If the appearance fails to load: «No se pudo cargar la apariencia» with **Reintentar** (as today). If only the publication state fails to load, the card shows «No pudimos cargar la configuración del catálogo» with **Reintentar** and the rest of the editor works.
- Phone width: the existing **Editar** and **Vista previa** tabs; the **Publicar catálogo** card is in **Editar**.

**Editor preview (web)**

- At the top, a two-option selector **Catálogo** | **Checkout**. It opens on **Catálogo** every time the editor loads; switching keeps the draft and the device choice.
- Below the selector, the label of the active view: «Vista previa del catálogo · Tema Boutique» or «Vista previa del checkout · Tema Boutique».
- Both views paint the draft theme and logo; choosing a theme updates whichever view is visible and the other when shown. Nothing published changes until **Guardar cambios**.
- The phone/desktop switch applies to both views. The review/payment switch exists only in **Checkout**.
- **Catálogo** view: short version built with the real catalog components: header (logo plate and store name), search field, the first three products in the catalog's own order (newest first, only products the catalog would show) and the floating cart button with one sample unit. Label «Vista previa · Tus productos».
  - A company with one or two visible products sees those only; sample products are never mixed with real ones.
  - A company with no visible products, or whose products fail to load, sees three sample products with the label «Vista previa · Datos de ejemplo». A product-load failure never blocks the editor.
  - Hidden catalog: the preview shows it all the same; it previews the look, not the publication.
  - Nothing in the preview navigates, searches, adds to a cart or creates orders. Tapping does nothing.
- **Checkout** view: the current preview, unchanged.

**«Apariencia de la tienda» (mobile)**: Settings tab → «Apariencia de la tienda».

- Settings menu rows, in order: the delivery row, «Apariencia de la tienda» (description «Logo, tema y publicación de tu catálogo»), «Catálogo».
- Title «Apariencia de la tienda»; description «Tu logo y tu tema se aplican a tu catálogo y a tu checkout.»
- **Logo**: the logo on its white plate, or «Sin logo»; **Subir logo** (or **Cambiar**) with gallery or camera, as product photos; **Quitar logo**. Same limits and errors as web: «Usa una imagen PNG, JPG o WEBP.», «El logo debe pesar hasta 10 MB.», «No pudimos subir el logo. Inténtalo de nuevo.» with **Reintentar**. Uploading does not publish.
- **Tema**: the five themes in the fixed order, each with the same static sample, name and description as web and a check mark on the selected one. Touch targets of at least 44 pt.
- With changes: «Cambios sin guardar», **Guardar cambios** and **Descartar**. Leaving the screen, or switching tabs, with changes asks «Tienes cambios sin guardar» with **Seguir editando** / **Descartar y salir**.
- **Publicar catálogo**: the current card moved as is (switch, hint, hide confirmation, error with **Reintentar**), plus «Este cambio se guarda al momento.»
- States: «Cargando…» while loading; appearance load error «No se pudo cargar la apariencia» with **Reintentar**; publication load error confined to its card, as on web.
- The screen keeps the app's own look; the selected theme shows only in the samples.

**Settings → Catálogo (web and mobile)**

- Keeps the link, **Copiar link**, **Ver catálogo** and, on mobile, **Compartir**. Description «Comparte el link de tu catálogo para que tus clientes hagan pedidos.»
- The switch is no longer here. When the catalog is hidden: «Tu catálogo está oculto. Quienes abran el link verán que no está disponible.» with **Ir a Apariencia de la tienda**.

**Public catalog (buyer)**: every screen of a published catalog, with the theme of the company.

- Header: logo on the theme's plate (size, rounding, border, shadow, position) and store name in the heading font, exactly as in the checkout header.
- Search field, «Cargando productos», «Ver más», the no-results and load-error messages with **Reintentar**: theme colors, fonts, rounding and borders.
- Product cards: theme surface, border, rounding, shadow and fonts; photo with the theme's thumbnail shape (Boutique 4:5, the rest square) and photo filter at the size the catalog layout gives it today; the neutral block with the initial when there is no photo. «Desde» and «Agotado» with the theme's colors (semantic tone for «Agotado»).
- Product page: photo with the theme's rounding and border; name in the heading font; price in the body font; attribute selectors and quantity with the theme's control, selected and focus styles; **Agregar** as the theme's primary button.
- Cart: floating button as the theme's primary button; sheet with lines (thumbnail in the theme's shape), quantity controls, «Producto quitado» with **Deshacer**, rejected-line notices, «Subtotal de productos» and **Continuar**.
- «Catálogo no disponible» is never themed.

## Rules

| Aspect | Behavior |
| --- | --- |
| One theme | The company has one theme and one logo, shared by catalog and checkout. Saving Antojo changes both. |
| What the theme changes in the catalog | Colors, fonts, type sizes and weights, rounding, borders, shadows, spacing, logo plate and photo shape, exactly the values the checkout uses for that theme. Screens, order, texts, fields and flow are identical in the five themes and identical to today. |
| Fixed mode | Noche is always dark; Clásico, Boutique, Antojo and Suave always light, in the catalog as in the checkout. The buyer's system preference does not change them. |
| Contrast floor | The same floor as the checkout applies to every catalog element in the five themes: text 4.5:1 against its surface, controls, selected states and focus 3:1. |
| Semantic colors | Errors, warnings, success and «Agotado» keep their meaning in every theme, in the theme's tones that meet the floor. |
| Fonts | The buyer's browser downloads only the fonts of the active theme. If a font fails, the theme's fallback system font keeps the layout. |
| Logo | Whole, never cropped or recolored, on the white plate shaped by the theme. Without a logo, or if it fails to load, the store name alone. |
| Default | A company that never saved an appearance is on Clásico without logo, in catalog and checkout. |
| Unknown theme | An unknown stored theme shows Clásico, in catalog and checkout. |
| Appearance read fails | The catalog loads with Clásico without logo, is never hidden and still lets the buyer browse and continue. Same as the checkout. |
| When a change shows | The catalog and the checkout show the last published theme and logo on every load. A buyer with the catalog already open sees the change on the next page load; the cart in their browser is untouched. |
| Draft | Logo and theme are published only with **Guardar cambios**, on web and mobile, as one unit. The preview shows the draft. |
| Publication switch | Saved at once, independent of the draft, with confirmation on hide and return to its previous position on failure. Same behavior as today, now in «Apariencia de la tienda» on web and mobile. |
| Concurrent edits | The last completed save wins, also between web and mobile. There is no lock or merge. |
| Preview products | Up to three real products in the catalog's order; none → three sample products. Real and sample are never mixed. |
| Seller surfaces | The seller panel, the web editor and the mobile app keep the Yoyos look. |

## When something fails

| Situation | What the user sees | What they can do |
| --- | --- | --- |
| **Guardar cambios** succeeds (web or mobile) | «Apariencia actualizada»; the badge disappears | Keep editing |
| Save rejected: unknown theme | «Revisa el tema e inténtalo de nuevo.»; draft kept | Choose again and save |
| Save rejected: invalid logo | «No pudimos usar ese logo. Súbelo de nuevo.»; draft kept, logo marked | Upload another logo |
| Save not sent or no response | «No pudimos guardar la apariencia. Conservamos tu borrador.» with **Reintentar**; nothing presented as published | **Reintentar** publishes the same logo and theme; repeating cannot duplicate or mix |
| Logo upload fails | «No pudimos subir el logo. Inténtalo de nuevo.» with its own **Reintentar**; the theme is untouched | Retry the upload |
| Switch saved | «Catálogo publicado» / «Catálogo oculto» | — |
| Switch save fails or gets no response | The switch returns to its previous position; «No pudimos guardar el cambio» with **Reintentar** (no new confirmation) | Retry; publishing twice leaves it published |
| Appearance fails to load in the editor | «No se pudo cargar la apariencia» with **Reintentar** | Retry |
| Publication state fails to load | Only the card shows «No pudimos cargar la configuración del catálogo» with **Reintentar** | Retry; the rest of the screen works |
| Products fail to load for the preview | Sample products labeled «Vista previa · Datos de ejemplo» | Nothing needed |
| Buyer: appearance cannot be read | Catalog in Clásico without logo, fully usable | Browse and continue |
| Buyer: theme font fails | Same layout with the fallback font | — |
| Seller leaves with unsaved logo or theme | «Tienes cambios sin guardar» with **Seguir editando** / **Descartar y salir** | Choose |

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Seller who manages the company's settings (web or mobile) | Published appearance, draft, publication state, preview with their own products | Change logo and theme, publish or hide the catalog | Edit theme values; change another company's appearance |
| Buyer | The catalog and checkout of the company with its theme and logo | Browse, build the cart, continue to the checkout | See whether an unpublished catalog's company exists: «Catálogo no disponible» stays unthemed so it reveals nothing |

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
| On mobile the section is created with logo, theme and switch, reusing existing settings components | Parity of a seller setting on both platforms without redesigning other screens. |
| The theme applies to the catalog header, grid, cards, product page and cart | They are every screen the buyer goes through before the checkout. |
| One preview with a «Catálogo | Checkout» selector, opening on Catálogo, short catalog view with real or sample products | Compare both surfaces without leaving the editor; the catalog is what the buyer sees first. |
| Launch for every company at once, with no notice; each catalog adopts the theme already chosen | There are no customers yet. |
| Only styles change in the catalog; same rules as the checkout (fixed mode, contrast floor, semantic colors, unknown theme → Clásico, read failure → default look without hiding) | The themes are already tested and accessible; a visual failure never blocks a sale. |

## Acceptance criteria

1. In the web panel, the menu shows «Apariencia de la tienda» and no «Apariencia del checkout»; the screen shows Logo, the five themes, **Restablecer apariencia** and the **Publicar catálogo** card. Opening the old checkout appearance address lands on this screen.
2. The seller opens the editor: the preview is on **Catálogo** with «Vista previa del catálogo · Tema Clásico». She chooses Noche: the catalog preview turns dark; she switches to **Checkout**: it is Noche too; she switches back and the draft is intact. In another tab, the published catalog is still Clásico.
3. She taps **Guardar cambios**: «Apariencia actualizada». Reloading `/catalogo/:companyId` shows Noche in header, grid, cards, product page and cart, and the checkout of order #1001 shows Noche.
4. A company with five visible products sees its three newest in the catalog preview with «Vista previa · Tus productos»; one with two sees those two; one with none sees three sample products with «Vista previa · Datos de ejemplo».
5. For each of the five themes, the catalog's header, cards, product page and cart use the same colors, fonts, rounding, logo plate and photo shape as the checkout of the same company; every text and control meets the contrast floor.
6. A buyer with the phone in dark mode opens a Boutique catalog: it is light. A buyer in light mode opens a Noche catalog: it is dark.
7. In every theme, the catalog shows the same screens, texts, order of products, search, «Ver más», «Desde», «Agotado», cart limits and **Continuar** behavior as before this change.
8. Reading the appearance fails while a buyer opens the catalog: it loads in Clásico without logo, they can add a product and continue to the checkout.
9. On web, the seller turns off **Publicar catálogo**: «¿Ocultar tu catálogo?»; **Ocultar catálogo** hides it («Catálogo oculto») without touching the draft or showing «Cambios sin guardar». With the network down, the switch returns to on and shows «No pudimos guardar el cambio» with **Reintentar**.
10. On mobile, Settings shows «Apariencia de la tienda»; the seller uploads a logo from the gallery, chooses Suave and taps **Guardar cambios**: the catalog and the checkout show Suave with that logo. Leaving with an unsaved theme asks **Seguir editando** / **Descartar y salir**.
11. On mobile, hiding the catalog from «Apariencia de la tienda» asks for confirmation and works as it did in Settings → Catálogo; Settings → Catálogo keeps the link with **Copiar link**, **Ver catálogo** and **Compartir**, and shows «Tu catálogo está oculto…» with **Ir a Apariencia de la tienda** while hidden.
12. A company on Antojo with a logo and a published catalog before the change opens the panel after the release: the editor shows Antojo, its logo and the switch on, and its catalog shows Antojo. A company that never saved an appearance shows Clásico without logo.
13. «Catálogo no disponible» and «Enlace no disponible» keep the unthemed Yoyos look and follow the buyer's system preference.
14. [public-catalog.md](../public-catalog.md) and [checkout.md](../checkout.md#appearance) state that the catalog uses the store theme and why, and that the switch lives in «Apariencia de la tienda».
