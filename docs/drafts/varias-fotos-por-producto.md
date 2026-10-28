# Multiple photos per product: product definition

**Status:** draft with open questions. Today a product has at most one optional photo ([Products](../products.md) «There is one photo per product», [Images](../images.md)); the web form (`product-form.tsx`) and the mobile form (`product-photo.tsx`) upload, replace or remove that single photo. This draft covers part A of Todoist task 6hpQq4RvPqcW98CV (several photos per product, primary photo, migration, where the primary is shown, visual search over every photo). On merge it is promoted into [Products](../products.md), [Images](../images.md), [Public catalog](../public-catalog.md) and [Image product search](../image-product-search.md). Product decisions approved by the founder on 27/10/2026. Technical design: `docs/drafts/varias-fotos-por-producto-technical.md`.

## Problem and situation

On 27/10/2026, while loading 13 products of the Fantastidog store, the founder found that each product accepts a single photo. A seller of pet clothing has a front photo, a back photo, a photo on the dog and a size-chart photo for each product. Today she picks one and sends the others by WhatsApp every time a buyer asks «¿cómo se ve atrás?» or «¿tienes foto puesta?». The buyer who opened the catalog link sees one photo and has to ask in the chat for the rest. And when a buyer sends back the photo on the dog to order, Yoyos does not recognize the product, because only the one uploaded photo is indexed for visual search.

## Goal

When creating or editing a product, the seller uploads up to 8 photos and chooses which one is the primary. The primary is the photo that represents the product everywhere a single photo is shown. Visual search recognizes the product from any of its photos.

Hypothesis: if it works, sellers upload more than one photo for most products of a fresh catalog, and fewer chat images that show a product end as `no_visual_match` in message-to-order. It would show in the share of products with two or more photos and in the message-to-order skip reasons.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Seller loading a catalog, product by product, from the phone or the computer | Upload all the photos of a product at once and pick the one that sells | Web «Nuevo producto» and product page; mobile create product and product page |
| Seller correcting a product already published | Add a missing photo, remove a bad one, change the primary | Same screens, editing |
| Buyer browsing the catalog link from the chat | Recognize the product at a glance in the grid and the cart | Public catalog grid, cart, checkout |
| Buyer who sends a product photo in the chat to order | Have the product added without the seller searching for it | WhatsApp chat (message-to-order, no screen of its own) |

## First-version scope

- Web and mobile, on create and on edit: add photos up to 8 per product, remove any photo, and **Hacer principal** on any photo other than the first.
- The photos keep the order in which they were added. The first is the primary. **Hacer principal** is the only way to change a photo's position.
- Every place that shows a product photo today shows the primary: public catalog grid, public product page (until part B adds the gallery), catalog cart, checkout thumbnails and the mobile seller product list.
- Visual search compares a customer image with every photo of each product.
- Existing products keep their photo as their only and primary photo, without seller action.
- Same file rules as today: JPEG, PNG or WebP, up to 10 MB each, the limits of [Images](../images.md).

Related scope in the same task, without a document (part B, UI only): gallery and lightbox in the public catalog product page. Its acceptance criteria are those of the Todoist task (3 photos shown on the product page; click opens the lightbox on that photo with previous, next and close; accessible lightbox; 5 themes; one photo or no photo look as today). Meeting point: the public product page receives every photo of the product in its saved order, primary first; part A shows only the first of them and part B only adds the gallery over that same list.

## Out of this version

- Reordering photos by dragging or by moving up and down, other than **Hacer principal**. Founder decision.
- Gallery or lightbox on the seller's product page (web or mobile): the seller sees her photos as thumbnails in the form only.
- Photos per color or per variant: Todoist 6hqMVjGfqcR7rF6V. When it exists, the catalog gallery shows the chosen color's photo first.
- Pinch zoom or magnifier, video, cropping or editing photos.
- Changing image storage (R2), thumbnails or conversions.
- Slow product save with photo: Todoist 6hrHg2VVWhgm4mWV, unblocked when this task merges.
- Improving the upload component: Todoist 6hpQpwMxPvgVJFq3 (P4). This task extends the current component.
- Mockups: none; current styles and components are reused.
- Detecting the same photo uploaded twice: it is accepted as two photos; the seller removes the repeated one.

## Flow

Create a product with three photos (web):

1. Seller opens Productos → **Nuevo producto**. The «Fotos» field shows **Agregar fotos** and «Hasta 8 fotos. La primera es la principal.».
2. She selects three files in the file picker. Each appears as a thumbnail with a progress indicator, in the order the picker returned them, and uploads on its own.
3. When the three finish, the first thumbnail carries «Principal» and the counter reads «3 de 8 fotos».
4. She hovers or focuses the third thumbnail and presses **Hacer principal**: it moves to the first place, the other two keep their relative order (photo 1 becomes second, photo 2 third).
5. She fills the rest and presses **Guardar producto**. The product opens with the three photos in that order; the primary shows in the catalog grid and the cart.

Mobile:

1. The photo strip shows **Agregar fotos** with «Cámara o galería».
2. **Elegir de galería** opens the gallery with multiple selection, limited to the free places («Puedes elegir hasta 5»). **Tomar foto** adds one photo per shot; after each shot the strip offers **Agregar fotos** again.
3. Tapping a thumbnail opens a sheet with **Hacer principal** (absent on the first), **Quitar foto** and **Cancelar**.
4. **Guardar** saves everything together, as today.

Alternative paths:

- Selection over the free places: the first ones up to 8 are added, the rest are left out with «Se agregaron 2 fotos. Un producto puede tener hasta 8.».
- One photo of a batch fails: the others stay; the failed one is not added and a message names how many failed, with the remedy.
- Removing the primary: the second photo becomes the primary at once, without asking.
- Leaving with added, removed or reordered photos asks «¿Descartar cambios?», as any change of the form.

## Screens

**Fotos field (web create and product page):**
- Label «Fotos», hint «Hasta 8 fotos. La primera es la principal.» and **Agregar fotos**, which opens the file picker with multiple selection and the accepted formats.
- Thumbnails in a row that wraps, in saved order. The first carries the text «Principal» (text, not only color). Each thumbnail has **Hacer principal** (except the first) and **Quitar foto**, both reachable by keyboard and with accessible names that include the position («Hacer principal la foto 3 de 5», «Quitar la foto 3 de 5»).
- Counter «3 de 8 fotos». At 8 photos **Agregar fotos** is replaced by «Llegaste al máximo de 8 fotos.».
- No photo yet: only **Agregar fotos** and the hint; the product is valid without photos.
- Uploading: the thumbnail shows «Subiendo…» and cannot be made primary or removed until it finishes; **Guardar producto** / **Guardar cambios** is disabled while any upload runs, as today with one photo.
- Per-photo error under the field, with the existing texts: «La imagen supera el tamaño máximo de 10 MB.», «El archivo debe ser una imagen JPG, PNG o WebP.», «No se pudo subir la imagen. Inténtalo de nuevo.». In a batch with failures: «No se pudieron subir 2 fotos. Elígelas de nuevo.» (plus the reason when all share it).
- Removing and **Hacer principal** are pending until the product is saved and count as form changes for «¿Descartar cambios?».

**Photo strip (mobile create and product page):**
- The current compact strip becomes a horizontal row of thumbnails followed by the **Agregar fotos** tile («Cámara o galería»); at 8 the tile is replaced by «Llegaste al máximo de 8 fotos.».
- The first thumbnail carries «Principal». Tapping a thumbnail opens the native sheet titled «Foto 2 de 5» with **Hacer principal**, **Quitar foto** and **Cancelar**; screen readers get the same actions on the thumbnail.
- Counter «3 de 8 fotos» under the strip.
- Uploading: spinner on the thumbnail; **Guardar** disabled while any upload runs.
- Errors keep today's native alerts («No se pudo subir la foto», «Tus datos siguen intactos. Revisa la conexión e inténtalo otra vez.»; «No se pudo preparar la foto»; «La foto supera el tamaño permitido. Elige una imagen más pequeña.»), once per batch with the count when several fail («No se pudieron subir 2 fotos»).
- A denied camera permission keeps the form and leaves the gallery available, as today.
- **Conservar foto actual** disappears: an unsaved removal is undone with the form's discard, as any other change. Assumption: no seller relies on undoing one removal alone; with several photos a per-photo undo would need its own marks.

**Where the primary is shown (no new screen):** public catalog grid card, public product page photo (until part B), catalog cart thumbnail, checkout product thumbnail, mobile seller product list thumbnail. Each keeps its current size, shape, theme and neutral block with the initial when the product has no photo. Seller order screens show no product photo today and this feature adds none.

## Rules

| Aspect | Behavior |
| --- | --- |
| Limit | Up to 8 photos per product, on create and on edit, on web and mobile. Core rejects a save with more than 8 from any client. |
| Files | Each photo follows the current image rules: JPEG, PNG or WebP, up to 10 MB, up to 8,000 px per side and 24 MP. Mobile keeps re-encoding to JPEG before upload. |
| Order | Photos keep the order in which they were added to the form: the picker's order inside one selection, then the order of later selections. Not the order in which uploads finish. Example: she selects «frente.jpg», «espalda.jpg», «puesto.jpg»; if «puesto.jpg» finishes first it is still third. |
| Primary | The first photo. No separate mark is stored. A product with photos always has a primary; a product without photos has none and shows the neutral block as today. |
| Hacer principal | Moves that photo to the first place; the others keep their relative order. Example: [A, B, C, D], **Hacer principal** on C → [C, A, B, D]. It is the only way to change positions. |
| Removing | Any photo can be removed. Removing the primary makes the next photo the primary, without asking. Removing the last photo leaves the product without photo. Removing does not delete the stored file, as today. |
| Saving | Photos, their order and removals are saved with the rest of the form, all or nothing, with **Guardar producto** / **Guardar cambios** (web) or **Guardar** (mobile). Nothing about photos is saved before. |
| Duplicates | The same file uploaded twice counts as two photos. |
| Current, not copied | Cart, checkout and every other view show the current primary. Orders do not copy photos: changing the primary changes the thumbnail of open checkout links, as today with the single photo. |
| Public catalog | The grid card, the cart and the checkout show only the primary, never a carousel. The full set of photos, in saved order, is offered only on the public product page (part B). The photo filter rule of themes is unchanged. |
| Visual search | Every photo of a product is indexed when the product is saved with it. A customer image matching any photo of a product identifies that product, and a product counts once even if several of its photos match. The other rules are unchanged: active product, exactly one active variant, minimum confidence. A removed photo stops identifying the product as soon as the save without it completes. Which photos the vision model receives per candidate is to be resolved in implementation. |
| Migration | Each existing product's photo becomes its only and primary photo; products without photo stay without. No seller action, no notice. Its current search indexing keeps working. |
| Parity | Web and mobile apply the same limit, order, primary rule and texts; core is the source of truth. |
| Concurrency | Photo changes are part of the product save and follow [Products concurrency](../products.md#concurrency); photo-only edits do not change the structure version. Assumption: like prices, they are last-write-wins between two devices. |

## When something fails

| Situation | What the seller sees | What she can do |
| --- | --- | --- |
| Photo uploaded | Thumbnail in its place, counter updated | Continue; it is saved only with the product |
| Photo rejected (size, format, dimensions) | That photo is not added; message with the reason (texts above); the rest of the form and the other photos stay | Choose another file |
| Selection over the limit | The photos up to 8 are added; «Se agregaron 2 fotos. Un producto puede tener hasta 8.» | Remove a photo to make room |
| Upload not sent (no connection) | That photo is not added; «No se pudo subir la imagen. Inténtalo de nuevo.» (web) or the native alert (mobile); other photos stay | Choose it again |
| Upload with no response | Treated as not uploaded: the photo is not added. An uploaded but unused file is harmless (it is not associated with any product) | Choose it again; it never duplicates a photo in the product |
| Save rejected for more than 8 photos (another client) | «Un producto puede tener hasta 8 fotos. Quita alguna y guarda de nuevo.» with the form intact | Remove photos and save |
| Save rejected because a photo no longer exists or belongs to another business | «No pudimos usar una de las fotos. Quítala o súbela de nuevo.» with the form intact | Remove or re-upload |
| Save not sent or in doubt | Today's product save behavior, unchanged | Today's remedy (**Recargar producto**, retry) |
| Indexing a photo fails after the save | Nothing; the product is saved. The photo is recovered by the existing reindex command | None; the product is identified by its other indexed photos meanwhile |
| Leaving mid-upload | «¿Descartar cambios?»; discarding drops the uploads in progress | **Seguir editando** keeps them |

## Information that is kept

- Per product: its photos and their order. The first is the primary.
- Orders keep copying name, combination, SKU and price only; photos are presentation and are always shown current.
- Removed photos: the file stays stored, as today; it no longer belongs to the product nor identifies it in visual search.
- Existing products: their photo becomes photo 1 of 1.
- Nothing new on the phone: the selected files are not kept after upload.

## Vocabulary

- Photo: «foto». The interface keeps «foto», not «imagen», except in the existing web error texts.
- Primary photo: «Principal». The photo in the first place, shown wherever a single photo of the product is shown.
- **Hacer principal**: the action that moves a photo to the first place.

## Closed decisions

| Decision | Why |
| --- | --- |
| The product draft and the technical draft cover only the multiple-photo part; gallery and lightbox carry no document | Founder decision, 27/10/2026; the gallery is UI over the same list |
| Up to 8 photos per product, with today's size and formats (10 MB) | Founder decision, 27/10/2026 |
| Photos keep upload order; no reordering by drag or move, on web or mobile | Founder decision, 27/10/2026 |
| The primary is the first photo, without a separate mark; **Hacer principal** moves it first and is the only way to change positions; a product with photos always has a primary | Founder decision, 27/10/2026 |
| Removing the primary promotes the next photo automatically, without asking | Founder decision, 27/10/2026 |
| Each existing product's photo becomes its only and primary photo automatically | Founder decision, 27/10/2026 |
| Catalog grid, cart, checkout and orders show only the primary, no carousel in the card; the gallery goes only on the public product page | Founder decision, 27/10/2026 |
| Visual search indexes every photo of the product, one embedding per photo | Founder decision, 27/10/2026 |
| Buyer mobile gallery: large swipeable photo with thumbnails below; full-screen lightbox closed with X or swiping down; no pinch zoom | Founder decision, 27/10/2026 (part B) |
| No mockups; current styles and components | Founder decision, 27/10/2026 |
| The upload component improvement (6hpQpwMxPvgVJFq3) does not block; this task extends the current component | Founder decision, 27/10/2026 |

## Acceptance criteria

1. On web, the seller creates «Polo perro rayas» selecting «frente.jpg», «espalda.jpg» and «puesto.jpg» at once: after saving, the product shows the three in that order, «frente.jpg» carries «Principal», and the catalog grid and the cart show «frente.jpg».
2. On mobile, the seller creates a product choosing 3 photos from the gallery and taking 1 with the camera: the product is saved with 4 photos in that order and the first gallery photo is the primary in the seller's product list.
3. A product with photos [A, B, C]: **Hacer principal** on C and save → [C, A, B]; the catalog grid, the cart and an open checkout link of an order with that product show C.
4. A product with [A, B, C]: removing A and saving leaves [B, C] with B as primary, without a confirmation dialog.
5. A product with 6 photos: the seller selects 4 more files → 2 are added, «Se agregaron 2 fotos. Un producto puede tener hasta 8.» is shown, the counter reads «8 de 8 fotos» and **Agregar fotos** is replaced by «Llegaste al máximo de 8 fotos.».
6. A save sent with 9 photos by any client is rejected; nothing changes in the product and the form keeps its data.
7. The seller selects 3 photos and the second is a 12 MB file: the first and third are added in that order; «La imagen supera el tamaño máximo de 10 MB.» is shown; name, description and prices stay as typed.
8. The connection drops while the third of 3 photos uploads: the first two stay, the third is not added, the error offers choosing it again, and **Guardar producto** is enabled once no upload is running.
9. With an upload in progress, **Guardar producto** (web) and **Guardar** (mobile) are disabled.
10. The seller adds a photo and presses **Cancelar**: «¿Descartar cambios?» appears; **Descartar** leaves the product as it was saved.
11. A product created before the change with one photo opens with that photo as «1 de 8 fotos» and «Principal», and the catalog grid keeps showing it, with no seller action.
12. A product created before the change without photo keeps showing the neutral block with its initial in the catalog, the cart and the checkout.
13. A product with one active variant and photos [frente, puesto]: a buyer sends by WhatsApp a photo of the dog wearing it, similar to «puesto» → the product is added to the chat's order.
14. The seller removes «puesto» and saves; a new customer image similar only to «puesto» no longer identifies the product.
15. On web, every thumbnail action is reachable by keyboard and the screen reader announces «Hacer principal la foto 3 de 5» and «Quitar la foto 3 de 5»; «Principal» is text, not only color.
16. On the public product page, a product with 3 photos shows the primary as today's photo until part B adds the gallery; the page receives the three in saved order.

## Open items and questions

```
Questions (answer with the option number):

1. Does the first thumbnail in the seller's form show the text «Principal»?
   The closed decision says the primary is the first photo "sin marca aparte"; this asks only about the visible label in the form, not about the stored model.
   (1) Show «Principal» on the first thumbnail, with no other control. Recommended: the seller sees which photo the catalog will use without knowing the rule, and «Hacer principal» needs a visible counterpart.
   (2) No label; the hint «La primera es la principal.» is the only cue. Less UI; the seller must remember the rule, and screen readers lose which photo is primary.

Decided unless objected:
- Rejection of photos beyond the 8th: the photos up to 8 are added and «Se agregaron 2 fotos. Un producto puede tener hasta 8.» is shown; at 8 **Agregar fotos** is replaced by «Llegaste al máximo de 8 fotos.» (same pattern as the 3-option limit). A save with more than 8 from any client: «Un producto puede tener hasta 8 fotos. Quita alguna y guarda de nuevo.».
- Multi-select: web file picker and mobile gallery allow selecting several photos at once, limited to the free places; the camera adds one photo per shot.
- Order inside a selection is the picker's order, not the order in which uploads finish.
- An upload failing mid-batch does not stop the others: successful photos stay in their order, failed ones are not added and one message names how many failed; the seller chooses them again. No automatic retry.
- An upload with no response counts as not uploaded; re-choosing never duplicates a photo in the product.
- Removing a photo and **Hacer principal** have no confirmation and are pending until the product is saved; leaving with them asks «¿Descartar cambios?». Mobile drops **Conservar foto actual**.
- **Hacer principal** and **Quitar foto** are per thumbnail on web; on mobile, tapping a thumbnail opens a sheet «Foto 2 de 5» with **Hacer principal**, **Quitar foto**, **Cancelar**.
- Counter «3 de 8 fotos» and hint «Hasta 8 fotos. La primera es la principal.» on both platforms.
- A removed photo stops identifying the product in visual search once the save completes; its file and any computed index data stay stored but are ignored, as with a replaced photo today.
- A product counts once among visual search candidates even if several of its photos match.
- Each photo is indexed when the product is saved with it; an indexing failure does not fail the save and is recovered by the existing reindex command.
- The same file uploaded twice counts as two photos; no duplicate detection.
- Seller order screens keep showing no product photo; this feature adds none.
- Photo-only edits are last-write-wins between two devices, like prices.
```
