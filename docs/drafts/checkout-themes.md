# Fixed checkout themes: product definition

**Status:** definition ready to implement. Replaces the brand color and background of the checkout appearance described in [Checkout](../checkout.md#appearance) (nine colors and three backgrounds). Source: Todoist task 6hphRPP56CR9MR2V, with the CTO's closed decisions of 20/10/2026 and the visual reference approved by the founder on 20/10/2026 in [checkout-themes-reference/](checkout-themes-reference/) (`temas.css` holds the exact values of each theme; `checkout.html` is a visual reference only). Written and closed with the founder's answers on 21/10/2026.

## Problem and situation

A seller opens **Apariencia del checkout** to make the page their buyers pay on look like their store. Today they pick one of nine colors and one of three backgrounds. The result is the same Yoyos checkout tinted in another color: a bakery, a jewelry store and a phone-case shop all get the same shapes, type and density, only in a different hue. The seller has no way to express "elegant", "playful" or "dark" and spends time trying color and background pairs that end up looking alike. Meanwhile the buyer, who arrived from a WhatsApp link, reviews a product list with names and prices but no photo, so they check what they are buying by scrolling back up the chat.

## Goal

The seller chooses one of five fixed checkout themes, each a closed set of colors, fonts, corner rounding, shadows, spacing and thumbnail shape, and edits nothing else. The only things of the seller's own that the buyer sees are the logo and the product photos, which now appear as a thumbnail in each product row.

Hypothesis: if it works, sellers who change the appearance pick a theme on the first visit and do not come back to try combinations; it would show as fewer appearance saves per company after the first one and a spread of companies across the five themes rather than all staying on Clásico.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Seller setting up how their checkout looks, from the computer or the phone browser | Pick the theme that matches their store and see it before publishing | Web settings → **Apariencia del checkout** (as today; no mobile app editor) |
| Buyer who opened a checkout link from WhatsApp or Instagram, without an account | Recognize the store and the products they are buying, complete and confirm the order, and pay | Public checkout, mostly on a phone browser |

## First-version scope

- Five fixed themes, all in this version: **Clásico** (default), **Boutique**, **Antojo**, **Suave** and **Noche**, with the values of `temas.css`, adjusted only where a value fails the contrast floor.
- In the editor, the brand color control and the background control are replaced by one theme selector. Logo upload, preview, save, discard, reset and leave confirmation stay as they are.
- The theme applies to the whole buyer checkout in every state: pending, delivery choice (home, agency, store), confirmed with payment instructions and receipt upload, cancelled, and the total-changed and rate-error notices.
- Each product row of the checkout shows a thumbnail of the product photo, or a neutral marker with the initial when there is no photo.
- Each theme defines how the logo is presented so it reads well, including transparent and dark logos on Noche.
- Every existing company ends up on Clásico without action, keeping its logo.
- The public catalog stops depending on the brand color and background: it shows the default Yoyos appearance with the company's logo and name.
- The steps, fields, texts, order and screens of the checkout do not change. Only styles change, plus the thumbnail.

## Out of this version

- Editing any value of a theme per company (accent, font, background, radius). Not planned: a closed set is what guarantees contrast and an unbreakable checkout.
- Themes created by the seller or more than five themes. Trigger: usage shows sellers asking for a look none of the five covers.
- Themes in the public catalog. Trigger: a separate task when the founder decides the catalog should match the checkout; it would reuse the same five themes with no new editor control.
- Themes in the seller panel. Not planned: the panel keeps the Yoyos identity.
- A light and a dark version of the same theme. Trigger: buyers or sellers ask for it; today the mode is part of each theme.
- Photo per variant. Trigger: when variants get their own photo in [Products](../products.md); until then the row shows the product photo.
- Delivery lead time next to «Envío a agencia» or any other method. Trigger: a task that adds a lead time to delivery settings; Yoyos records none today, so this task shows the cost only.
- Editing the appearance from the mobile app. Trigger: sellers ask to do it from the app; today it is web only, as before this task.

## Flow

Seller, usual path:

1. Settings → **Apariencia del checkout**. The selector shows the five themes with the published one marked; the preview shows the checkout with that theme.
2. The seller taps another theme. The preview changes at once; the badge «Cambios sin guardar» appears.
3. Optionally the seller switches the preview between phone and desktop, and between review and payment, to see the theme in both states.
4. **Guardar cambios** publishes logo and theme together. «Apariencia actualizada». Every checkout link of the company, including links already shared, shows the new theme from the next load.

Alternative paths:

- **Descartar cambios** returns the draft to the published theme and logo.
- **Restablecer apariencia** puts Clásico and no logo in the draft; it still needs **Guardar cambios**.
- Leaving with unsaved changes asks «Seguir editando» or «Descartar y salir», as today.
- Save fails: the draft and the selected theme stay, the published appearance is unchanged and **Reintentar** is offered.

Buyer, usual path:

1. The buyer opens the link. The checkout appears in the company's published theme: its colors, fonts, shapes and logo presentation.
2. The product list shows each product with its thumbnail, name, variant, quantity by price and subtotal.
3. The buyer completes details and delivery, confirms and pays exactly as today.

## Screens

**Apariencia del checkout (seller, web):**

- Header: title «Apariencia del checkout», description «Tu logo y el tema de la página donde tus clientes revisan y pagan su pedido.», actions **Descartar cambios** and **Guardar cambios**, note «Se aplicará a todos tus enlaces de checkout», badge «Cambios sin guardar» while there are changes. Unchanged except the description, which drops «tus colores».
- **Logo** section: unchanged (upload, replace, remove; PNG, JPG or WEBP up to 10 MB).
- **Tema** section, replacing «Color de marca» and «Fondo»: a single-choice list of five options in this fixed order: Clásico, Boutique, Antojo, Suave, Noche. Each option shows:
  - a small static sample painted with the theme's real values: page background, a card, the primary button and the thumbnail shape;
  - the name and a one-line description:
    - «Clásico» · «Blanco y negro, sobrio. El tema por defecto.»
    - «Boutique» · «Editorial, con títulos en serif y tonos crema.»
    - «Antojo» · «Alegre, con formas redondeadas y acento coral.»
    - «Suave» · «Calmo, con fondo pastel y sombras suaves.»
    - «Noche» · «Oscuro y compacto, con acento celeste.»
  - a check mark on the selected one. One theme is always selected; tapping the selected one again changes nothing.
- The list is one column on the phone (in the **Editar** tab) and in the side panel on desktop, with touch targets of at least 44 px. It reuses the editor's existing card, controls and layout.
- **Restablecer apariencia** with its note: unchanged; it now restores Clásico and no logo.
- The editor itself keeps the Yoyos identity; the selected theme is seen only in the samples and the preview.
- States: loading and load error of the editor are as today. There is no empty state: a company always has a theme.

**Preview (inside the editor):**

- Label «Vista previa · Datos de ejemplo», phone/desktop switch and review/payment switch: unchanged.
- The light/dark switch is removed: each theme has a fixed mode, so the preview always shows the theme as the buyer sees it.
- The sample order includes one product with a sample photo and one without photo, so the seller sees both the thumbnail and the marker in the theme's shape.

**Checkout (buyer):**

- Same sections, fields, texts and order as today, in every state, styled with the published theme.
- **Header:** logo and store name presented as the theme defines (see Rules). Without a logo, only the store name, as today; no initials mark is invented.
- **Product row:** thumbnail at the left inside the existing row, then name, variant, quantity by price and subtotal. Size and shape per theme: Clásico 56 px square, Boutique 56 px at 4:5, Antojo 76 px square, Suave 64 px square, Noche 48 px square, each with the theme's rounding, border and photo filter from `temas.css`. A product without photo, or whose photo fails to load, shows a neutral block of the same size and shape with the first letter of the product name in capitals; never a broken image.
- On a phone, in all five themes: labels above their fields, the total visible before the payment action, and «Envío a agencia» listed together with the other delivery methods with its cost. No lead time is shown; Yoyos does not record one.
- «Enlace no disponible» (invalid, unknown or not enabled link) keeps the unbranded Yoyos look, as today.

## Rules

| Aspect | Behavior |
| --- | --- |
| What the seller chooses | A logo and exactly one of the five themes. No color, background, accent, font or any other value can be edited. |
| What a theme is | A closed set defined in the product: colors, fonts, sizes, weights, rounding, shadows, spacing, borders, logo presentation and thumbnail size and shape. The exact values are those of `temas.css`, translated to the checkout, except where a value fails the contrast floor. |
| Default | Clásico. A company that never saved an appearance, and every company existing before this change, is on Clásico. |
| Existing companies | Move to Clásico automatically, keeping their logo, whatever color and background they had. No mapping from colors to themes is attempted and no notice is shown. |
| Fixed mode | Noche is always dark; Clásico, Boutique, Antojo and Suave are always light. The buyer's system light/dark setting changes nothing. |
| Fonts | Clásico uses the system sans. Boutique: Playfair Display in titles, Inter in the body. Antojo: Fredoka in titles, Nunito in the body. Suave: Outfit. Noche: Inter. Only the active theme's fonts are loaded. All are free, served by Yoyos, with no external provider. |
| Serif in Boutique | Only in titles and the store name, never in fields, labels, prices or totals. Example: «S/ 120.00» in the total uses Inter. Product names in Boutique use the title font, as in `temas.css`; the price next to them uses Inter. |
| Contrast floor | In all five themes: text at least 4.5:1 against its surface; borders of fields and controls and the keyboard focus at least 3:1 against card and background. Decorative borders and separators only need to be visible. Checked automatically for the five themes. When a `temas.css` value fails, the floor wins: only that value moves to the nearest tone of the same hue that passes, and every adjusted value is listed in the PR with before/after captures of its theme. Values measured as failing on the reference: Clásico field border #cfcfcf (1.6:1), option border #dcdcdc (1.4:1) and radio #9a9a9a (2.8:1); Antojo white button text on coral #ff5a4e (3.1:1) and «Gratis» green #1f8a4c (4.4:1); Suave option border (1.3:1) and secondary text on the page gradient (4.4:1); Noche field group border (1.4:1); placeholders in all five (2.6 to 3.9:1). |
| Antojo button | Keeps its coral #ff5a4e background with dark brown text #2a1a12 (5.4:1) instead of white. |
| Logo presentation | The logo is always shown whole: never cropped, distorted or recolored. It sits on a white plate in every theme, so dark, light and transparent logos read the same way they do today; each theme sets the plate's size, rounding, border and shadow and where it goes. Clásico: left, 8 px rounding, thin border. Boutique: centered above the store name, square corners, thin dark border. Antojo: left, pill-shaped plate with dark border and hard shadow. Suave: centered, pill-shaped plate with a soft shadow. Noche: left, 8 px rounding, the white plate standing out on the dark header. A pill-shaped plate is a circle for a square logo and a capsule for a horizontal one, so a long horizontal logo is never cut. |
| Logo that fails to load | The store name alone identifies the business, as today. |
| Thumbnail photo | The product's current photo (one per product, see [Products](../products.md)). It is not copied into the order: if the seller replaces the photo, open links show the new one next to the product name the order keeps. |
| Thumbnail marker | Neutral block, same size and shape as the theme's thumbnail, with the first letter of the product name as saved in the order, in capitals. Example: «Polo básico» without photo shows «P». |
| Thumbnail meaning | Decorative: the name next to it identifies the product, so the photo adds no text for screen readers. |
| Semantic colors | Errors, warnings, success, information and payment states keep their meaning and icons in every theme, in tones that meet the contrast floor on that theme (dark-surface tones on Noche). «Gratis» uses the theme's free color. |
| Payment images, QR and receipts | Keep their original colors and are shown on a white plate in every theme, so a QR stays scannable on Noche. |
| Where the theme applies | The buyer checkout and the editor preview only. The seller panel and the «Enlace no disponible» page keep the Yoyos look. |
| Public catalog | Shows the default Yoyos appearance with the company's logo and name, for every company. A company that had a brand color sees its catalog in Yoyos colors from this change on. |
| Publishing | Logo and theme are published together with **Guardar cambios**; the last completed save wins. Opening or reloading any checkout link shows the latest published theme, including links shared earlier and historical orders. |
| Structure | The checkout's steps, fields, texts, validations and screen order are the same in the five themes. A theme only changes styles; the thumbnail is the only added content. |

## When something fails

| Situation | What the user sees | What they can do |
| --- | --- | --- |
| Save succeeds | «Apariencia actualizada»; the badge disappears; the selector marks the saved theme as published | Keep editing or leave |
| Save rejected because the theme is not one of the five (stale page, tampered request) | «Revisa el tema e inténtalo de nuevo.» (replaces today's «Revisa el color y el fondo e inténtalo de nuevo.»); the draft is kept | Choose a theme again and save |
| Save rejected because the logo is no longer valid | «No pudimos usar ese logo. Súbelo de nuevo.», unchanged; the theme selection is kept | Upload another logo or remove it, then save |
| Save not sent or no response (in doubt) | «No pudimos guardar la apariencia. Conservamos tu borrador.» with **Reintentar**, unchanged; draft and selection intact; the published appearance is whatever the server last completed | **Reintentar**. Repeating the same save publishes the same logo and theme again, so it cannot duplicate or mix anything |
| Logo upload fails | Current upload messages with **Reintentar**; the theme selection is not touched | Retry the upload |
| Seller leaves with unsaved theme change | «Seguir editando» / «Descartar y salir» | Choose one |
| Buyer: the company's appearance cannot be read, or the stored theme is unknown | The checkout in Clásico, without the logo if it cannot be resolved | Confirm and pay normally: a visual failure never blocks a sale |
| Buyer: a theme font does not load | The same text in the theme's fallback system font; layout, steps and amounts unchanged | Continue normally |
| Buyer: a product photo does not load | The marker with the initial, in the theme's shape | Continue normally |
| Buyer: the logo does not load | Only the store name | Continue normally |

## Who sees and does what

| Actor | Can see | Can do | Cannot |
| --- | --- | --- | --- |
| Seller with access to the company settings | The published theme and logo, the five themes, the preview with sample data | Choose a theme, upload or remove the logo, save, discard, reset | Change any value of a theme; give a theme to a single order |
| Buyer with the checkout link | That order with the company's theme, logo and the photos of the products in that order | What the checkout allows today | See other products' photos, the theme of another company, or anything the link did not open before |

- The public checkout adds only the photo of each product in the order. Product photos are already public images (the catalog shows them), so no internal data is exposed; purchase price, SKU, stock and internal IDs stay out, as today.
- No new role or permission: whoever could edit the appearance before can choose a theme now.

## Information that is kept

- **Per company:** the logo and the chosen theme. Nothing else about appearance.
- **Not kept:** the brand color and background each company had before. They are not converted or kept for later.
- **Per order:** nothing new. The order does not store the theme nor the photo; the theme and the product photo are always shown current, because they are presentation, not part of what was agreed. The product name, variant, quantities and prices stay as the order copied them.
- **Per device:** nothing. The editor's draft lives only in that browser session, as today.

## Vocabulary

- Theme («Tema»): one of the five closed looks of the checkout. Always called «tema» in the interface; never «estilo», «plantilla» or «diseño».
- Theme names: «Clásico», «Boutique», «Antojo», «Suave», «Noche». They are proper names and are shown the same in every language.
- Thumbnail («miniatura»): the small product photo at the left of a checkout row.
- Marker: the neutral block with the initial shown instead of a missing or failed photo. No visible name.
- Logo plate: the white surface the logo sits on; its shape is the theme's, its color is always white.

## Closed decisions

| Decision | Why |
| --- | --- |
| The appearance is a logo plus one of five fixed themes; color and background disappear from the product | A closed set gives each business a distinct look while every combination stays tested and accessible |
| All existing companies go to Clásico, which is also the default; colors are not mapped to themes | No color maps cleanly to a theme, and Clásico is neutral for any brand |
| Noche is always dark and the other four always light, regardless of the buyer's system | The mode is part of the theme's identity and keeps one tested version per theme |
| Fonts are free, served by Yoyos, and only the active theme's are loaded; Clásico uses the system sans | No external dependency or cost, and no weight for the buyer's phone from unused fonts |
| Boutique uses serif only in titles, never in fields, labels, prices or totals | Serif harms the reading of data and numbers on a phone |
| A thumbnail per product row, with a marker with the initial when there is no photo, is the only added content | The buyer recognizes what they are buying without changing the checkout structure |
| Each theme defines how the logo is presented, including on Noche | A logo that cannot be read defeats the purpose of branding |
| The public catalog does not adopt themes and shows the default Yoyos look | Keeps this task to the checkout; the catalog stops depending on the removed color |
| The contrast floor of the previous appearance (4.5:1 text, 3:1 field and control borders and focus) applies to the five themes, with an automatic check | The buyer must be able to read and use the checkout in any theme |
| When a `temas.css` value fails the floor, the floor wins; only that value moves to the nearest passing tone of the same hue, listed in the PR with before/after captures | Keeps each approved look while meeting the closed contrast decision; no large-text exception for buttons |
| Antojo's button is coral with dark brown text #2a1a12 | White on coral reaches only 3.1:1; dark brown keeps the coral identity at 5.4:1 |
| Agency delivery shows its cost only; no lead time | Yoyos records no lead time, and adding one would change delivery settings on web and mobile |
| Steps, fields, texts and screens of the checkout do not change | Themes are a visual layer only; the buyer flow was not redesigned |

## Acceptance criteria

1. A seller opens **Apariencia del checkout**: they see Logo and Tema; the Tema list shows Clásico, Boutique, Antojo, Suave and Noche in that order, each with its sample and description, and there is no color, background, accent or light/dark control.
2. A company that had «Ciruela» color with «De marca» background before the change opens its checkout without anyone touching anything: it shows in Clásico with its logo, and the order can be confirmed and paid.
3. The seller selects Antojo: the preview changes to Antojo at once and «Cambios sin guardar» appears; a buyer who reloads a checkout link of that company still sees Clásico until the seller taps **Guardar cambios**, and sees Antojo on the next load after «Apariencia actualizada».
4. The seller selects Noche, then taps **Descartar cambios**: the selector and preview return to the published theme.
5. The seller selects Suave and tries to leave the page: they are asked «Seguir editando» or «Descartar y salir»; choosing to keep editing leaves Suave selected.
6. The save of a theme change gets no response: the message with **Reintentar** appears, Suave stays selected, and retrying publishes Suave once.
7. A request saving a theme «neon» is rejected: nothing is published and the draft is kept.
8. With each of the five themes, a checkout is opened in the pending state, with agency delivery chosen, confirmed with payment instructions, and cancelled: every visible element uses that theme's colors, fonts, rounding, shadows, spacing and thumbnail shape, and none keeps values of another theme.
9. A buyer whose phone is in dark mode opens a Boutique checkout: it is light. A buyer whose phone is in light mode opens a Noche checkout: it is dark.
10. In a Boutique checkout, the field labels, the typed values, the product prices and «S/ 120.00» in the total are in Inter; the section titles and the store name are in Playfair Display.
11. The automatic contrast check passes for the five themes: text 4.5:1 against its surface, field and control borders and focus 3:1 against card and background. In Antojo the primary button is coral with dark brown #2a1a12 text, and the PR lists every value adjusted from `temas.css` with before/after captures.
12. On a 390 px wide phone, in each of the five themes: every label sits above its field, the total is visible before the payment action, and «Envío a agencia» appears among the delivery methods with its cost.
13. An order with «Polo básico» (with photo) and «Taza blanca» (without photo) shows, in Antojo, a 76 px rounded thumbnail with the polo photo and a block of the same size and shape with «T»; in Boutique, 56 px at 4:5 with square corners.
14. A product's photo URL fails to load in the buyer's browser: the row shows the marker with the initial, never a broken image, and the row keeps its name, quantity and subtotal.
15. A company with a transparent PNG logo in dark gray chooses Noche: the logo appears whole on its white plate and is readable on the dark header. A company with a long horizontal logo chooses Suave: the logo is not cropped.
16. The company's logo fails to load: the header shows only the store name, in any theme.
17. Reading the company's appearance fails when a buyer opens the checkout: the checkout shows in Clásico and the buyer can confirm and pay.
18. The checkout's steps, fields, texts and section order are identical in the five themes and the same as before the change; the only new element is the thumbnail.
19. The public catalog of a company that had a brand color shows the default Yoyos appearance with its logo and name; it does not change when the company chooses a theme.
20. The seller panel looks the same before and after choosing any theme.
