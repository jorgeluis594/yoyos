# Multiple photos per product: product definition

**Status:** definition ready to implement. Today a product has at most one optional photo ([Products](../products.md) «There is one photo per product», [Images](../images.md)); the web form (`product-form.tsx`) and the mobile form (`product-photo.tsx`) upload, replace or remove that single photo. This draft covers part A of Todoist task 6hpQq4RvPqcW98CV (several photos per product, primary photo, migration, where the primary is shown, visual search over every photo). On merge it is promoted into [Products](../products.md), [Images](../images.md), [Public catalog](../public-catalog.md), [Checkout](../checkout.md) (product thumbnails, public response and appearance preview say «primary photo») and [Image product search](../image-product-search.md). Product decisions approved by the founder on 27/10/2026; review gate closed on 27/10/2026 (see [Review gate](#review-gate)). Technical design: `docs/drafts/varias-fotos-por-producto-technical.md`.

## Problem and situation

On 27/10/2026, while loading 13 products of the Fantastidog store, the founder found that each product accepts a single photo. A seller of pet clothing has a front photo, a back photo, a photo on the dog and a size-chart photo for each product. Today she picks one and sends the others by WhatsApp every time a buyer asks «¿cómo se ve atrás?» or «¿tienes foto puesta?». The buyer who opened the catalog link sees one photo and has to ask in the chat for the rest. And when a buyer sends back the photo on the dog to order, Yoyos does not recognize the product, because only the one uploaded photo is indexed for visual search.

## Goal

When creating or editing a product, the seller uploads up to 8 photos and chooses which one is the primary. The primary is the photo that represents the product everywhere a single photo is shown. Visual search recognizes the product from any of its photos.

Hypothesis: if it works, sellers upload more than one photo for most products of a fresh catalog, and fewer chat images that show a product end as `no_visual_match` in message-to-order. It would show in the share of products with two or more photos and in the message-to-order skip reasons, read 30 days after the first business loads its catalog with this version.

## Users and surfaces

| User | Need | Surface |
| --- | --- | --- |
| Seller loading a catalog, product by product, from the phone or the computer | Upload all the photos of a product at once and pick the one that sells | Web «Nuevo producto» and product page; mobile create product and product page |
| Seller correcting a product already published | Add a missing photo, remove a bad one, change the primary | Same screens, editing |
| Buyer browsing the catalog link from the chat | Recognize the product at a glance in the grid and the cart | Public catalog grid, cart, checkout |
| Buyer who sends a product photo in the chat to order | Have the product added without the seller searching for it | WhatsApp chat (message-to-order, no screen of its own) |

## First-version scope

- Web and mobile, on create and on edit: add photos up to 8 per product, remove any photo (with **Deshacer** until saving), and **Hacer principal** on any photo other than the primary.
- The photos keep the order in which they were added. The first is the primary. **Hacer principal** is the only way to change a photo's position.
- Every place that shows a product photo today shows the primary (list in [Where the primary is shown](#where-the-primary-is-shown)).
- Visual search compares a customer image with every photo of each product.
- Existing products keep their photo as their only and primary photo, without seller action.
- Same file rules as today: JPEG, PNG or WebP, up to 10 MB, up to 8,000 px per side and 24 MP, the limits of [Images](../images.md).
- New texts ship in Spanish and Portuguese, like every current text of both apps ([Texts](#texts)).

Related scope in the same task, without a document (part B, UI only): gallery and lightbox in the public catalog product page. It is governed by the task's «Alcance B» (including: with one photo the lightbox opens without navigation, the «2 de 5» indicator, closing with X, Esc, a click outside or swiping down, no photo filter on the product page) and its acceptance criteria (3 photos shown on the product page; click opens the lightbox on that photo with previous, next and close; accessible lightbox; 5 themes; one photo or no photo look as today). Meeting point: the public product page receives every photo of the product in its saved order, primary first; part A shows only the first of them and part B only adds the gallery over that same list.

## Out of this version

- Reordering photos by dragging or by moving up and down, other than **Hacer principal**. Founder decision.
- Gallery or lightbox on the seller's product page (web or mobile): the seller sees her photos as thumbnails in the form only.
- Photos per color or per variant: Todoist 6hqMVjGfqcR7rF6V. When it exists, the catalog gallery shows the chosen color's photo first.
- Pinch zoom or magnifier, video, cropping or editing photos.
- Changing image storage (R2), thumbnails or conversions, including deleting the files of removed photos.
- Slow product save with photo: Todoist 6hrHg2VVWhgm4mWV, unblocked when this task merges.
- Improving the upload component: Todoist 6hpQpwMxPvgVJFq3 (P4). This task extends the current component.
- Mockups: none; current styles and components are reused.
- Detecting the same photo uploaded twice: it is accepted as two photos; the seller removes the repeated one.
- Product photos on seller order screens: none shows one today and none gains one (see [Where the primary is shown](#where-the-primary-is-shown)).

## Flow

Create a product with three photos (web):

1. Seller opens Productos → **Nuevo producto**. The «Fotos» field shows **Agregar fotos** and «Hasta 8 fotos. La primera es la principal.».
2. She selects three files in the file picker. Each appears at once as a thumbnail in the order the picker returned them, marked «Subiendo…», and uploads on its own. The first carries «Principal» from that moment. The hint gives way to the counter «3 de 8 fotos».
3. Once the three have finished uploading, she presses **Hacer principal** under the third thumbnail: it moves to the first place, the other two keep their relative order (photo 1 becomes second, photo 2 third). Focus stays on the moved thumbnail and the screen reader announces «Foto 1 de 3, ahora es la principal.».
4. She fills the rest and presses **Guardar producto**. The product opens with the three photos in that order; the primary shows in the catalog grid and the cart.

Mobile:

1. The photo strip shows the **Agregar fotos** tile («Cámara o galería») at its left.
2. Tapping it opens the sheet «Fotos» with «Puedes agregar hasta 8 fotos. La primera es la principal.» on a product without photos (or «Puedes agregar 5 fotos más.» once there are some), **Elegir de galería**, **Tomar foto** and **Cancelar**.
3. **Elegir de galería** opens the gallery with multiple selection, capped by the picker itself at the free places. **Tomar foto** adds one photo per shot.
4. Thumbnails appear to the right of the tile, in order, uploading. Tapping one opens a sheet «Foto 2 de 5» with its actions; for a failed photo the sheet also carries the full reason.
5. **Guardar** saves everything together, as today.

Alternative paths:

- Selection over the free places (web): the first ones up to 8 are added; at selection time, before any upload result, the field says «Elegiste 4 fotos y quedan 2 lugares. Se agregan las 2 primeras.».
- One photo of a batch fails: it stays in its place as a failed thumbnail with its reason, and **Reintentar** when retrying can work. The others continue.
- An upload takes longer than 2 minutes, or the seller presses **Cancelar subida**: see [When something fails](#when-something-fails).
- Removing a photo: it stays in its place marked «Se quitará» or «Se eliminará» with **Deshacer** until saving. Removing the primary makes the next unmarked photo the primary at once, without asking.
- Leaving with added, removed or reordered photos, or with uploads running, asks «¿Descartar cambios?», as any change of the form.

## Screens

### Thumbnail

The same unit on both platforms. Each thumbnail is one of these states:

| State | What it shows | Actions | Accessible name |
| --- | --- | --- | --- |
| Uploading | The photo dimmed with a spinner and «Subiendo…» | **Cancelar subida** | «Foto 4 de 5, subiendo» |
| Kept | The photo | **Hacer principal**, **Quitar foto** | «Foto 3 de 5» |
| Marked for removal | The photo dimmed with «Se quitará» (photo added in this session) or «Se eliminará» (photo already saved), as text | **Deshacer** | «Foto 3 de 5, se quitará al guardar» or «Foto 3 de 5, se eliminará al guardar» |
| Failed | The photo dimmed when the device can show it (otherwise a neutral block) with a warning icon and «No se subió» | **Reintentar** (only when retrying can work) and **Quitar** | Web, with the file name: «Foto 4 de 5, grande.jpg, no se subió: pesa más de 10 MB»; mobile, where gallery photos have no meaningful name: «Foto 4 de 5, no se subió: no se pudo subir» |

- **Primary:** the first thumbnail that is not marked carries «Principal», whatever its state: kept, uploading or failed. It has no **Hacer principal** and its accessible name adds «principal» («Foto 1 de 5, principal», «Foto 1 de 5, principal, subiendo»). «Principal» never jumps when an upload finishes or fails: it shows which photo the catalog will use once the field is ready to save. A failed first photo keeps «Principal» until it is retried or removed; removing it passes «Principal» to the next unmarked photo.
- «Principal», «Se quitará», «Se eliminará», «Subiendo…» and «No se subió» sit on a solid surface (a caption or badge with the field's colors), never as bare text over the photo, so they read on any photo.
- Positions («3 de 5») count every thumbnail in the field, whatever its state, in visual order.
- A marked photo cannot be made primary. Only **Deshacer** returns it to normal, in its place; if it is then the first unmarked photo, it is the primary again.
- **Hacer principal** works on kept photos only, not on uploading or failed ones.

### Fotos field (web create and product page)

- Label «Fotos». Without photos it shows **Agregar fotos** and the hint «Hasta 8 fotos. La primera es la principal.». With at least one thumbnail the hint gives way to the counter «3 de 8 fotos», or with marks «5 de 8 fotos · 1 se eliminará» (when any marked photo was already saved) or «5 de 8 fotos · 1 se quitará» (when every marked photo was added in this session).
- **Agregar fotos** opens the file picker with multiple selection and the accepted formats. It stays available while uploads run, a change from today, where the file input is disabled while uploading. Every thumbnail (uploading, failed or marked) takes a place until it leaves or the product is saved; at 8 places **Agregar fotos** is replaced by «Llegaste al máximo de 8 fotos.», or, when some of the 8 are marked, «Llegaste al máximo de 8 fotos. Guarda los cambios para liberar lugar.».
- Thumbnails 112 px square in a row that wraps, in saved order. Under each square, outside it, sits a bar of actions always visible, at least 32 px tall, never shown only on hover so touch browsers reach them:
  - **Hacer principal**, **Deshacer**, **Cancelar subida** and **Reintentar** are text buttons, the same text link style as **Deshacer** in the rest of the form.
  - **Quitar foto** and **Quitar** are a trash icon button, the icon the form already uses for removals, with the accessible name «Quitar la foto 3 de 5» and a tooltip that only repeats it.
  - Accessible names include the position: «Hacer principal la foto 3 de 5», «Deshacer quitar la foto 3 de 5», «Cancelar la subida de la foto 4 de 5», «Reintentar la foto 4 de 5».
- A failed thumbnail shows, under the square and above its actions, the file name (truncated in the middle if it does not fit, full in its tooltip and accessible name) and the full reason, wrapping on as many lines as needed. Nothing but «No se subió» sits over the photo.
- One uploading text: today's field-level «Subiendo imagen…» disappears; each thumbnail says «Subiendo…».
- **Guardar producto** / **Guardar cambios** stays enabled while uploads run or failures remain, a change from today, where it is disabled while the photo uploads. Pressing it sends nothing and says, next to the field, «Espera a que terminen de subir las fotos.» or «Reintenta o quita las fotos que no se subieron.», scrolls the field into view and moves focus to the first uploading or failed thumbnail's first action.
- Removing, **Deshacer** and **Hacer principal** are pending until the product is saved and count as form changes for «¿Descartar cambios?».

Focus and announcements (one polite live region for the field):

| Action | Focus goes to | Announcement |
| --- | --- | --- |
| **Hacer principal** | The **Quitar foto** button of the moved thumbnail, now first | «Foto 1 de 5, ahora es la principal.» |
| **Quitar foto** | **Deshacer** of the same thumbnail, which stays in its place | «Foto 3 de 5 se quitará al guardar.» or «Foto 3 de 5 se eliminará al guardar.», matching its mark; when it was the primary, adds «La foto 2 ahora es la principal.» |
| **Deshacer** | **Quitar foto** of the same thumbnail | «Foto 3 de 5 se conservará.»; when it becomes primary again, adds «Ahora es la principal.» |
| **Cancelar subida** or **Quitar** on a failed thumbnail | The first action of the next thumbnail, or of the previous one if it was the last, or **Agregar fotos** if none is left | «Foto quitada. Quedan 4 fotos.» |
| Upload finished or failed | Focus does not move | Failures only: «La foto 4 no se subió: pesa más de 10 MB.» |
| Selection added | Focus does not move, except when the selection fills the last place: **Agregar fotos** is replaced, so focus goes to the limit text | «Se agregaron 3 fotos.» (or the over-limit notice); when the limit is reached, adds «Llegaste al máximo de 8 fotos.» |
| **Guardar** with uploads or failures | First uploading or failed thumbnail | The message shown next to the field |
| Save rejected by core for a photo | The marked thumbnail's first action, or the field message when no thumbnail is identified | The rejection message |

### Photo strip (mobile create and product page)

- The compact strip keeps its height. The **Agregar fotos** tile («Cámara o galería») stays fixed at the left; the thumbnails, 64 px, scroll horizontally to its right, so adding is always visible. At 8 places the tile disappears, leaving the whole strip to the 8 thumbnails, and the counter says the limit; when the picker or camera returns with the strip full, accessibility focus goes to the line under the strip.
- On a 64 px thumbnail, an uploading photo shows only a centered spinner and a failed one only a centered warning icon; their text is in the accessible name, the line under the strip and the sheet. A band at the bottom of the tile, on a solid surface, carries one text: the mark («Se quitará», «Se eliminará») or «Principal» (a marked photo is never the primary). The band text wraps to two lines if needed, at the app's small text size, and is never truncated or shrunk, also in Portuguese.
- Under the strip, once there is a thumbnail, one line in this order of precedence:
  1. Right after a selection over the free places (only on Android galleries that ignore the cap): «Elegiste 4 fotos y quedan 2 lugares. Se agregan las 2 primeras.», until the next action on the strip or save.
  2. With failed photos: «1 foto no se subió. Tócala para ver por qué.» (plural «2 fotos no se subieron. Tócalas para ver por qué.»), in the error color.
  3. Otherwise the counter «3 de 8 fotos» or «5 de 8 fotos · 1 se eliminará» (marks worded as on web); at 8 «8 de 8 fotos. Llegaste al máximo.», or with marks «8 de 8 fotos · 1 se eliminará. Guarda para liberar lugar.».
- On mobile the hint «Hasta 8 fotos. La primera es la principal.» is not under the strip, which keeps «Cámara o galería» like today; the same information is the message of the source sheet on a product without photos («Puedes agregar hasta 8 fotos. La primera es la principal.»). This is the one intended text difference with web.
- The source sheet «Fotos» shows «Puedes agregar 5 fotos más.» (singular «Puedes agregar 1 foto más.») once there are photos. The gallery itself caps the selection at those places; Yoyos shows no text inside the picker.
- Tapping a thumbnail opens the native sheet titled «Foto 2 de 5» with the thumbnail's actions from the table above (**Hacer principal**, **Quitar foto**; **Deshacer**; **Cancelar subida**; **Reintentar**, **Quitar**) and a dismiss button, **Cancelar**, except on an uploading photo, where it is **Seguir subiendo** so it is not confused with **Cancelar subida**. Every sheet has at most two actions plus dismiss, the three-button limit of Android alerts. For a failed photo the sheet's message is the full reason («No se pudo subir. Revisa la conexión.»), so a sighted seller reads it in full before choosing **Reintentar** or **Quitar**. The thumbnail is a button with the accessible name of the table and the hint «Abre las acciones de la foto»; screen readers also get the actions directly on the thumbnail.
- After an action, accessibility focus returns to the thumbnail that was acted on (in its new place after **Hacer principal**), or to the next one when it left, and the same announcements as web are spoken.
- Failures show on their thumbnail, in the line under the strip and in the thumbnail's sheet, not as alerts that interrupt the batch. The only native alert kept is the camera permission: a denied permission keeps the form and leaves the gallery available, as today.
- **Conservar foto actual** disappears: **Deshacer** on the marked photo replaces it.
- **Guardar** stays enabled while uploads run or failures remain, a change from today, where it is disabled while the photo is busy. Pressing it sends nothing; the form-level message at the top of the form, right above the strip, says «Espera a que terminen de subir las fotos.» or «Reintenta o quita las fotos que no se subieron.»; the form scrolls to the top so the strip is visible, the strip scrolls to the first uploading or failed thumbnail, and accessibility focus moves to that thumbnail after the message is announced.
- The **X** of the top bar stays enabled during uploads (today it is disabled while the photo is busy) and asks «¿Descartar cambios?».

### Where the primary is shown

No new screen. The primary replaces today's single photo, with each surface's current size, shape, theme and placeholder:

- Public catalog grid card (no carousel) and public product page photo (until part B adds the gallery).
- Catalog cart thumbnail and checkout product thumbnail.
- «Apariencia de la tienda» preview, which renders real products as catalog cards.
- Mobile seller product list thumbnail. It keeps its dashed placeholder with the photo icon when there is no photo.

The public catalog, cart and checkout keep the neutral block with the product initial when there is no photo. The task's «pedidos» is met by the order checkout, the only order surface that shows product photos: no seller order screen (web or mobile) shows a product photo today and none gains one.

## Rules

| Aspect | Behavior |
| --- | --- |
| Limit | Up to 8 photos per product, on create and on edit, on web and mobile. In the form, every thumbnail takes a place until it leaves or the product is saved: uploading, failed and marked ones included. Core rejects a save with more than 8 from any client. |
| Files | Each photo follows the current image rules: JPEG, PNG or WebP, up to 10 MB, up to 8,000 px per side and 24 MP. Mobile keeps re-encoding to JPEG before upload. The seller sees which rule failed: weight, dimensions or format are different texts. |
| Order | Photos keep the order in which they were added to the form: the picker's order inside one selection, then the order of later selections. Not the order in which uploads finish: a thumbnail takes its place when chosen. Example: she selects «frente.jpg», «espalda.jpg», «puesto.jpg»; if «puesto.jpg» finishes first it is still third. A failed photo keeps its place, so **Reintentar** keeps the intended order. |
| Primary | In a saved product, the first photo. No separate mark is stored. In the form, the first unmarked thumbnail, whatever its state. A product with photos always has a primary; a product without photos has none and shows each surface's placeholder as today. |
| Hacer principal | Moves that photo to the first place; the others keep their relative order. Example: [A, B, C, D], **Hacer principal** on C → [C, A, B, D]. It is the only way to change positions. Only on kept photos. |
| Removing | Any photo can be removed. It stays visible in its place, marked «Se quitará» (added in this session) or «Se eliminará» (already saved), with **Deshacer** until saving, the same pattern as values, options and combinations in [Products](../products.md). On save, marked photos leave the product and the rest close up in order. Removing the primary makes the next unmarked photo the primary, without asking. Removing every photo leaves the product without photo. |
| Removed files | Removing a photo takes it off the product; it does not delete the file, as today. Its public address keeps working for whoever already has it, because image addresses are public ([Images](../images.md)). «Se eliminará» means removed from the product, not erased. Accepted limit: deleting files belongs to a future image cleanup, out of this version. |
| Uploading and failed photos | Never saved. Saving waits until no thumbnail is uploading or failed. **Cancelar subida** and **Quitar** on a failed photo take it out of the field at once, without a mark, because it was never part of the product. |
| Unanswered upload | An upload that has not finished after 2 minutes (initial value, adjustable) becomes a failed thumbnail «No se pudo subir. Revisa la conexión.» with **Reintentar**. The seller can also drop it earlier with **Cancelar subida**. A late answer for a cancelled or expired upload changes nothing on screen. |
| Saving | Photos, their order and removals are saved with the rest of the form, all or nothing, with **Guardar producto** / **Guardar cambios** (web) or **Guardar** (mobile). Nothing about photos is saved before. |
| Photos only when touched | A save changes the product's photos only when the form changed them: the photo list it would save (which photos and in which order) differs from the one loaded. Any sequence of actions that ends at the loaded list counts as untouched, for example **Hacer principal** on B and then on A of [A, B, C], or marking a photo and undoing it. The same criterion decides whether the photos count for «¿Descartar cambios?», on both platforms. A form that did not touch the photos leaves them as they are in core, even if another device changed them meanwhile. Example: photos are added from the computer while the phone has the product open; the phone saves a price change; the computer's photos stay. |
| Repeated photo in a save | A save that lists the same photo twice is rejected like an unusable photo, with the form intact. The forms never send it; it protects against other clients and malformed requests. |
| Duplicates | The same file uploaded twice is two different photos and counts twice. |
| Current, not copied | Cart, checkout and every other view show the current primary. Orders do not copy photos: changing the primary changes the thumbnail of open checkout links, as today with the single photo. |
| Public catalog | The grid card, the cart and the checkout show only the primary, never a carousel. The full set of photos, in saved order, is offered only on the public product page (part B). The photo filter rule of themes is unchanged. |
| Visual search, indexing | Every photo of a product is indexed when the product is saved with it. This is the reading of the founder's «un embedding por foto al subirla»: a photo uploaded but never saved to a product, or discarded with the form, never identifies anything. Indexing runs one photo at a time after the save, so a product becomes recognizable by its new photos after a delay, not at once. Assumption: a few seconds per photo, so a load of 13 products with 4 photos each is fully recognizable within a few minutes; the technical design measures it. |
| Visual search, recovery | The existing reindex command covers every photo of every active product, not only the primary: any photo without an index of the configured model is indexed again. |
| Visual search, matching | A customer image matching any photo of a product identifies that product, and a product counts once even if several of its photos match. For each candidate, the vision model sees at least that product's photo closest to the customer image, so a customer photo of the dog wearing it is compared with «puesto», not with «frente». Cost bound: one product photo per candidate, as today (up to 5 candidates plus the customer image per message). The other rules are unchanged: active product, exactly one active variant, minimum confidence. |
| Removed photos in search | A removed photo stops identifying the product as soon as the save without it completes. |
| Migration | Each existing product's photo becomes its only and primary photo; products without photo stay without. No seller action, no notice. Its current search indexing keeps working. |
| Parity | Web and mobile apply the same limit, order, primary rule, marks and texts, except the hint's place described in the photo strip. On both, **Guardar** and the add control stay enabled during uploads and explain instead of being disabled, a change from today on both. Core is the source of truth. |
| Concurrency | Photo changes are part of the product save and follow [Products concurrency](../products.md#concurrency); photo edits do not change the structure version. Between two forms that both changed the photos, the last save wins. |

## When something fails

| Situation | What the seller sees | What she can do |
| --- | --- | --- |
| Photo uploaded | Thumbnail in its place | Continue; it is saved only with the product |
| Over the free places | At selection time, before any upload: «Elegiste 4 fotos y quedan 2 lugares. Se agregan las 2 primeras.» On web next to the field, until the next selection or save. On mobile the picker caps the selection; Android galleries that ignore the cap show the notice first in the line under the strip. It speaks of what was added to the field, not of uploads; their outcome shows on each thumbnail afterwards | Remove or mark photos to make room |
| Photo rejected for weight | Failed thumbnail with «Pesa más de 10 MB.» (web under the square; mobile in the sheet), with **Quitar** | Choose a lighter file |
| Photo rejected for dimensions | Failed thumbnail with «Supera 8000 px por lado o 24 MP.», with **Quitar**. Note for the technical design: core answers the same `413 IMAGE_TOO_LARGE` for both limits; the web client knows the file size before uploading and mobile re-encodes to fit, so the dimensions text must not fall back to the 10 MB one | Choose a smaller image |
| Photo rejected for format or corrupt file | Failed thumbnail with «No es una imagen JPG, PNG o WebP válida.», with **Quitar** | Choose another file |
| Photo could not be prepared (mobile) | Failed thumbnail with «No se pudo preparar la foto.», with **Quitar** | Choose another photo |
| Upload not sent, storage unavailable, or no answer after 2 minutes | Failed thumbnail with «No se pudo subir. Revisa la conexión.», with **Reintentar** and **Quitar** | **Reintentar** uploads it again in the same place. A retry never adds a second copy of that photo to the product; an orphaned file from an earlier attempt is harmless |
| Retry of a photo the device can no longer read | The thumbnail keeps failing with «Ya no encontramos esta foto. Quítala y elígela de nuevo.», with **Quitar** only | Choose it again; it goes to the end |
| Several failures with different reasons | Each failed thumbnail carries its own reason; on mobile the line under the strip counts them | Act on each one |
| **Guardar** with uploads running | «Espera a que terminen de subir las fotos.»; focus on the first uploading thumbnail; nothing is sent | Wait, or cancel the stuck upload |
| **Guardar** with failed thumbnails | «Reintenta o quita las fotos que no se subieron.»; focus on the first failed thumbnail; nothing is sent | **Reintentar** or **Quitar** |
| Save rejected for more than 8 photos (another client) | «Un producto puede tener hasta 8 fotos. Quita alguna y guarda de nuevo.» with the form intact, next to the field on web and in the form-level message above the strip on mobile, with focus moved there | Remove photos and save |
| Save rejected because a photo no longer exists, belongs to another business or is repeated | That thumbnail shows «No pudimos usar esta foto. Quítala o súbela de nuevo.» with the form intact. If core cannot say which photo (to be resolved in implementation), the same text names the field instead: «No pudimos usar una de las fotos. Quítala o súbela de nuevo.», next to the field on web and in the form-level message on mobile, with focus moved there | Remove or re-upload |
| Save not sent or in doubt | Today's product save behavior, unchanged | Today's remedy (**Recargar producto**, retry) |
| Indexing a photo fails after the save | Nothing; the product is saved. The photo is recovered by the reindex command, which covers every photo | None; the product is identified by its other indexed photos meanwhile |
| Leaving mid-upload | «¿Descartar cambios?»; discarding drops the uploads in progress | **Seguir editando** keeps them |

## Information that is kept

- Per product: its photos and their order. The first is the primary.
- Marks, failed and uploading thumbnails live only in the open form; they are not kept as a draft.
- Orders keep copying name, combination, SKU and price only; photos are presentation and are always shown current.
- Removed photos: the file stays stored and its public address keeps working, as today; it no longer belongs to the product nor identifies it in visual search.
- Existing products: their photo becomes photo 1 of 1.
- Nothing new on the phone: the selected files are not kept after upload.

## Vocabulary

- Photo: «foto». The new texts say «foto», not «imagen».
- Primary photo: «Principal». The first photo of the product, shown wherever a single photo of the product is shown; in the form, the first unmarked thumbnail.
- **Hacer principal**: the action that moves a photo to the first place.
- «Se quitará» / «Se eliminará»: the existing marks of the product form; for photos, «Se quitará» is a photo added in this session and «Se eliminará» a photo already saved. Both are undone with **Deshacer** until saving. Neither erases the file.

## Texts

Spanish and Portuguese. Marks and **Deshacer** reuse the existing keys of the product form. Texts with a count have a singular form; «n» stands for the number.

| Use | Spanish | Portuguese |
| --- | --- | --- |
| Field label, mobile sheet title | «Fotos» | «Fotos» |
| Add button and mobile tile | **Agregar fotos** | **Adicionar fotos** |
| Hint without photos (web) | «Hasta 8 fotos. La primera es la principal.» | «Até 8 fotos. A primeira é a principal.» |
| Mobile sheet message, no photos | «Puedes agregar hasta 8 fotos. La primera es la principal.» | «Você pode adicionar até 8 fotos. A primeira é a principal.» |
| Mobile sheet message, with photos | «Puedes agregar 1 foto más.» · «Puedes agregar n fotos más.» | «Você pode adicionar mais 1 foto.» · «Você pode adicionar mais n fotos.» |
| Counter | «1 de 8 fotos» · «n de 8 fotos»; marks «· 1 se eliminará» · «· n se eliminarán» when any marked photo was saved, otherwise «· 1 se quitará» · «· n se quitarán» | «1 de 8 fotos» · «n de 8 fotos»; marks «· 1 será excluída» · «· n serão excluídas», otherwise «· 1 será removida» · «· n serão removidas» |
| Limit (web) | «Llegaste al máximo de 8 fotos.» · with marks «Llegaste al máximo de 8 fotos. Guarda los cambios para liberar lugar.» | «Você chegou ao máximo de 8 fotos.» · with marks «Você chegou ao máximo de 8 fotos. Salve as alterações para liberar espaço.» |
| Limit (mobile counter) | «8 de 8 fotos. Llegaste al máximo.» · with marks «8 de 8 fotos · 1 se eliminará. Guarda para liberar lugar.» | «8 de 8 fotos. Você chegou ao máximo.» · with marks «8 de 8 fotos · 1 será excluída. Salve para liberar espaço.» |
| Uploading sheet dismiss (mobile) | **Seguir subiendo** | **Continuar enviando** |
| Over the free places, one place | «Elegiste n fotos y queda 1 lugar. Se agrega la primera.» | «Você escolheu n fotos e resta 1 lugar. A primeira foi adicionada.» |
| Over the free places, several | «Elegiste n fotos y quedan m lugares. Se agregan las m primeras.» | «Você escolheu n fotos e restam m lugares. As m primeiras foram adicionadas.» |
| Mobile failures line | «1 foto no se subió. Tócala para ver por qué.» · «n fotos no se subieron. Tócalas para ver por qué.» | «1 foto não foi enviada. Toque nela para ver o motivo.» · «n fotos não foram enviadas. Toque nelas para ver o motivo.» |
| Primary label | «Principal» | «Principal» |
| Failed badge | «No se subió» | «Não enviada» |
| Actions | **Hacer principal**, **Quitar foto**, **Cancelar subida**, **Reintentar**, **Quitar** | **Tornar principal**, **Remover foto**, **Cancelar envio**, **Tentar novamente**, **Remover** |
| Uploading | «Subiendo…» | «Enviando…» |
| Weight | «Pesa más de 10 MB.» | «Tem mais de 10 MB.» |
| Dimensions | «Supera 8000 px por lado o 24 MP.» | «Passa de 8000 px por lado ou 24 MP.» |
| Format | «No es una imagen JPG, PNG o WebP válida.» | «Não é uma imagem JPG, PNG ou WebP válida.» |
| Prepare (mobile) | «No se pudo preparar la foto.» | «Não foi possível preparar a foto.» |
| Connection or no answer | «No se pudo subir. Revisa la conexión.» | «Não foi possível enviar. Verifique a conexão.» |
| File gone | «Ya no encontramos esta foto. Quítala y elígela de nuevo.» | «Não encontramos mais esta foto. Remova e escolha de novo.» |
| Save while uploading | «Espera a que terminen de subir las fotos.» | «Aguarde o envio das fotos terminar.» |
| Save with failures | «Reintenta o quita las fotos que no se subieron.» | «Tente novamente ou remova as fotos que não foram enviadas.» |
| Over 8 on save | «Un producto puede tener hasta 8 fotos. Quita alguna y guarda de nuevo.» | «Um produto pode ter até 8 fotos. Remova alguma e salve de novo.» |
| Unusable photo on save | «No pudimos usar esta foto. Quítala o súbela de nuevo.» · field: «No pudimos usar una de las fotos. Quítala o súbela de nuevo.» | «Não foi possível usar esta foto. Remova ou envie de novo.» · field: «Não foi possível usar uma das fotos. Remova ou envie de novo.» |
| Mobile thumbnail hint | «Abre las acciones de la foto» | «Abre as ações da foto» |
| Accessible names, marks | «Foto 3 de 5, se quitará al guardar» · «Foto 3 de 5, se eliminará al guardar» | «Foto 3 de 5, será removida ao salvar» · «Foto 3 de 5, será excluída ao salvar» |
| Announcements | «Foto 1 de 5, ahora es la principal.» · «Foto 3 de 5 se quitará al guardar.» · «Foto 3 de 5 se eliminará al guardar.» · «La foto 2 ahora es la principal.» · «Foto 3 de 5 se conservará.» · «Foto quitada. Queda 1 foto.» / «Foto quitada. Quedan n fotos.» / «Foto quitada. No quedan fotos.» · «Se agregó 1 foto.» / «Se agregaron n fotos.» | «Foto 1 de 5, agora é a principal.» · «Foto 3 de 5 será removida ao salvar.» · «Foto 3 de 5 será excluída ao salvar.» · «A foto 2 agora é a principal.» · «Foto 3 de 5 será mantida.» · «Foto removida. Resta 1 foto.» / «Foto removida. Restam n fotos.» / «Foto removida. Não restam fotos.» · «1 foto adicionada.» / «n fotos adicionadas.» |

## Closed decisions

| Decision | Why |
| --- | --- |
| The product draft and the technical draft cover only the multiple-photo part; gallery and lightbox carry no document | Founder decision, 27/10/2026; the gallery is UI over the same list |
| Up to 8 photos per product, with today's size and formats (10 MB) | Founder decision, 27/10/2026 |
| Photos keep upload order; no reordering by drag or move, on web or mobile | Founder decision, 27/10/2026 |
| The primary is the first photo, without a separate mark; **Hacer principal** moves it first and is the only way to change positions; a product with photos always has a primary | Founder decision, 27/10/2026 |
| Removing the primary promotes the next photo automatically, without asking | Founder decision, 27/10/2026 |
| Each existing product's photo becomes its only and primary photo automatically | Founder decision, 27/10/2026 |
| Catalog grid, cart, checkout and orders show only the primary, no carousel in the card; the gallery goes only on the public product page | Founder decision, 27/10/2026. «Orders» is met by the order checkout; no order screen gains a photo |
| Visual search indexes every photo of the product, one embedding per photo | Founder decision, 27/10/2026. «Al subirla» is read as when the product is saved with it |
| Buyer mobile gallery: large swipeable photo with thumbnails below; full-screen lightbox closed with X or swiping down; no pinch zoom | Founder decision, 27/10/2026 (part B) |
| No mockups; current styles and components | Founder decision, 27/10/2026 |
| The upload component improvement (6hpQpwMxPvgVJFq3) does not block; this task extends the current component | Founder decision, 27/10/2026 |
| The first unmarked thumbnail shows «Principal» as text on a solid surface, part of its accessible name | Review gate round 1, 27/10/2026; it shows what is stored, it stores nothing |
| Removing a photo marks it with **Deshacer** until saving | Same pattern as every other removal of the product form; a mistaken removal must not cost the other edits |
| A save changes photos only when the form changed them | Review gate round 2, 27/10/2026; avoids silently losing photos added from another device |
| A save listing the same photo twice is rejected | Review gate round 2, 27/10/2026; keeps the 8-place count and the primary unambiguous |

## Acceptance criteria

1. On web, the seller creates «Polo perro rayas» selecting «frente.jpg», «espalda.jpg» and «puesto.jpg» at once: after saving, the product shows the three in that order, «frente.jpg» carries «Principal», and the catalog grid, the cart and the «Apariencia de la tienda» preview show «frente.jpg».
2. On mobile, the seller creates a product choosing 3 photos from the gallery and taking 1 with the camera: the product is saved with 4 photos in that order and the first gallery photo is the primary in the seller's product list.
3. A product with photos [A, B, C]: **Hacer principal** on C and save → [C, A, B]; the catalog grid, the cart and an open checkout link of an order with that product show C. No seller order screen shows a product photo.
4. A product with [A, B, C]: **Quitar foto** on A marks it «Se eliminará» in its place, «Principal» moves to B at once, without a confirmation dialog; saving leaves [B, C] with B as primary.
5. A product with [A, B, C]: **Quitar foto** on A, then **Deshacer**: A is first again and carries «Principal»; saving changes nothing. Name and prices edited before stay as typed.
6. A product with 6 photos on web: the seller selects 4 more files → only the first 2 appear as thumbnails, «Elegiste 4 fotos y quedan 2 lugares. Se agregan las 2 primeras.» is shown before any upload finishes, the counter reads «8 de 8 fotos» and **Agregar fotos** is replaced by «Llegaste al máximo de 8 fotos.». With 7 photos and 3 selected, the notice reads «Elegiste 3 fotos y queda 1 lugar. Se agrega la primera.».
7. A product with 7 saved photos: marking one «Se eliminará» does not free a place until saving; after saving, the counter reads «6 de 8 fotos» and **Agregar fotos** is back.
8. A save sent with 9 photos by any client is rejected; nothing changes in the product and the form keeps its data.
9. On web, the seller selects «frente.jpg», «grande.jpg» (12 MB) and «puesto.jpg»: «grande.jpg» stays second as a failed thumbnail with «No se subió» over it and, under it, «grande.jpg» and «Pesa más de 10 MB.»; the others upload; name, description and prices stay as typed. **Guardar producto** says «Reintenta o quita las fotos que no se subieron.» and focuses that thumbnail; after **Quitar** it saves [frente, puesto].
10. A 6 MB, 48 MP photo is rejected with «Supera 8000 px por lado o 24 MP.», not with the 10 MB text.
11. The connection drops while the second of 3 photos uploads: it becomes a failed thumbnail in second place with «No se pudo subir. Revisa la conexión.»; **Reintentar** with connection uploads it and the order stays [1, 2, 3].
12. On mobile, a photo fails to upload: the strip shows «1 foto no se subió. Tócala para ver por qué.»; tapping the thumbnail opens «Foto 2 de 3» with the message «No se pudo subir. Revisa la conexión.», **Reintentar**, **Quitar** and **Cancelar**.
13. On mobile with a failed photo scrolled out of view, **Guardar** shows «Reintenta o quita las fotos que no se subieron.» at the top of the form, the strip scrolls to the failed thumbnail and accessibility focus lands on it; nothing is saved.
14. An upload with no answer for 2 minutes becomes a failed thumbnail with **Reintentar**; before that, **Cancelar subida** removes it at once and **Guardar** saves the other photos.
15. While an upload runs, **Agregar fotos** stays available, and **Guardar producto** (web) or **Guardar** (mobile) is enabled but says «Espera a que terminen de subir las fotos.» and sends nothing.
16. The first of 3 selected photos is still uploading while the second finishes: «Principal» stays on the first and the second offers **Hacer principal**; if the first then fails, it keeps «Principal» until **Reintentar** or **Quitar**, and after **Quitar** the second carries «Principal».
17. The seller adds a photo and presses **Cancelar**: «¿Descartar cambios?» appears; **Descartar** leaves the product as it was saved.
18. A product created before the change with one photo opens with that photo as «1 de 8 fotos» and «Principal», and the catalog grid keeps showing it, with no seller action.
19. A product created before the change without photo keeps showing the neutral block with its initial in the catalog, the cart and the checkout, and the dashed placeholder in the mobile seller list.
20. The phone has a product open with [A]; the computer adds B and C and saves; the phone changes only the price and saves → the product keeps [A, B, C] with the new price. The same holds if the phone pressed **Hacer principal** on a photo and then on A again, ending at its loaded list.
21. A save listing the same photo twice is rejected with «No pudimos usar una de las fotos. Quítala o súbela de nuevo.» (or on that thumbnail) and changes nothing.
22. A product with one active variant and photos [frente, puesto]: a few minutes after saving, a buyer sends by WhatsApp a photo of the dog wearing it, similar to «puesto» → the product is added to the chat's order.
23. Indexing of «puesto» failed after the save; running the reindex command indexes it and AC22 then holds.
24. The seller removes «puesto» and saves; a new customer image similar only to «puesto» no longer identifies the product.
25. On web with only the keyboard, on a product with [A, B, C, D, E]: Tab to **Hacer principal** of C, press it → focus is on **Quitar foto** of C, now first, and «Foto 1 de 5, ahora es la principal.» is announced; press **Quitar foto** → focus is on its **Deshacer** and «Foto 1 de 5 se eliminará al guardar. La foto 2 ahora es la principal.» is announced; Tab reaches the next thumbnail's actions and **Guardar cambios**, and saving leaves [A, B, D, E]. **Hacer principal** and **Deshacer** are visible text; no action is reachable only by hover.
26. On a new product, removing a photo added in this session shows «Se quitará» and announces «Foto 2 de 3 se quitará al guardar.».
27. With a screen reader on mobile, each thumbnail is announced with its position and state («Foto 1 de 5, principal», «Foto 4 de 5, subiendo») and the hint «Abre las acciones de la foto»; after **Hacer principal** in the sheet, focus returns to that thumbnail in its new place.
28. On mobile at 8 photos the **Agregar fotos** tile is gone, the 8 thumbnails use the strip and the line under it reads «8 de 8 fotos. Llegaste al máximo.»; with one saved photo marked it reads «8 de 8 fotos · 1 se eliminará. Guarda para liberar lugar.».
29. On web, a selection that fills the last place moves focus to «Llegaste al máximo de 8 fotos.» and announces it; focus is never lost to the page.
30. On the public product page, a product with 3 photos shows the primary as today's photo until part B adds the gallery; the page receives the three in saved order.
31. In Portuguese, the field, the marks, the failures, the singular and plural counts and the announcements show the texts of [Texts](#texts).

## Questions decided by the review gate

These answers come from the review gate of the implement-task skill, not from the founder, and are kept here so the founder can confirm them in the final pull request.

1. **Does the first thumbnail in the seller's form show the text «Principal»?**
   - Answer: (1) show «Principal» on the first unmarked thumbnail, with no other control, as text on a solid surface and part of the thumbnail's accessible name.
   - Decided by: both reviewers, UX/UI reviewer and product reviewer, in round 1 (27/10/2026).
   - Reason: the seller sees which photo the catalog uses without remembering a rule, **Hacer principal** needs a visible counterpart, and screen-reader users need the same information; the founder's «sin marca aparte» governs what is stored, and a label stores nothing.
   - Discarded: (2) no label, with the hint «La primera es la principal.» as the only cue, which leaves screen readers without the primary.
2. **Does a save from a stale form overwrite the photos?**
   - Answer: no. A save carries the photo list only when the form changed it (the list to save differs from the loaded one); a form that did not touch the photos leaves them as they are.
   - Decided by: the coordinator, on the product reviewer's round 2 finding (27/10/2026), as the conservative option.
   - Reason: it avoids silently losing photos added from another device, which with up to 8 photos loaded one by one is a larger loss than today.
   - Discarded: overwriting the whole photo list with every save, as name and description work today.
3. **What happens with a save that lists the same photo twice?**
   - Answer: it is rejected like an unusable photo, with the form intact.
   - Decided by: the coordinator, on the product reviewer's round 2 finding (27/10/2026).
   - Reason: a repeated photo would take two of the 8 places and make the primary and the removal marks ambiguous; the forms never send it.
   - Discarded: counting the repeat once.

## Review gate

| Round | UX/UI reviewer | Product reviewer | Outcome |
| --- | --- | --- | --- |
| 1 | Rejected (4 blockers: removal without undo, failures only as a count, hung upload blocking save, focus and announcements) | Approved with suggestions | Removal marks with **Deshacer**, per-photo failures in place, 2-minute timeout and **Cancelar subida**, focus table; question 1 decided |
| 2 | Rejected (1 blocker: no readable place for a failed photo's reason on mobile) | Approved with suggestions | Reason in the thumbnail's sheet and the line under the strip; questions 2 and 3 decided by the coordinator |
| 3 | Approved with suggestions | Approved with suggestions | Clarifications applied: criterion for touched photos, focus at the limit, freeing a place when full with marks, **Seguir subiendo**, Android over-limit notice, mark wording in the counter, file name in accessible names, place of save-time errors, pointer to «Alcance B» |

## Decided unless objected

- Over the free places on web: the first photos up to 8 are added and «Elegiste 4 fotos y quedan 2 lugares. Se agregan las 2 primeras.» (singular «queda 1 lugar. Se agrega la primera.») is shown at selection time, before upload results; at 8 places **Agregar fotos** is replaced by «Llegaste al máximo de 8 fotos.». On mobile the picker caps the selection and the sheet says «Puedes agregar 5 fotos más.» (or «Puedes agregar hasta 8 fotos. La primera es la principal.» without photos).
- Every thumbnail (uploading, failed, marked) takes a place and counts in the counter until it leaves or the product is saved; **Agregar fotos** stays available during uploads.
- Multi-select on the web file picker and the mobile gallery; the camera adds one photo per shot.
- Order inside a selection is the picker's order; a thumbnail takes its place when chosen, not when its upload finishes.
- «Principal» sits on the first unmarked thumbnail whatever its state, so it never jumps when an upload finishes or fails.
- A failed photo stays in its place with its own reason (weight, dimensions, format, preparation, connection) and **Reintentar** when retrying can work, so the order is kept. Web shows the file name and the full reason under the square; mobile shows «No se subió» on the thumbnail, a count line under the strip and the full reason as the message of the thumbnail's sheet. No automatic retry and no interrupting alerts.
- An upload unanswered after 2 minutes (initial value, adjustable) becomes failed; **Cancelar subida** drops it earlier.
- **Guardar** stays enabled on both platforms (a change from today) and, while uploads run or failures remain, sends nothing, says why (web next to the field; mobile in the form-level message above the strip) and takes focus to the first uploading or failed thumbnail. The mobile **X** stays enabled during uploads and asks to discard.
- Removal follows the form's pattern: «Se quitará» / «Se eliminará» with **Deshacer** until saving, with matching accessible names and announcements; a marked first photo passes «Principal» to the next unmarked one at once. **Hacer principal** and removing have no confirmation. Mobile drops **Conservar foto actual**.
- Web thumbnails 112 px with an always-visible action bar under the square: **Hacer principal**, **Deshacer**, **Cancelar subida** and **Reintentar** as text, removal as the form's trash icon. Mobile 64 px thumbnails scrolling to the right of a fixed **Agregar fotos** tile that disappears at 8, each opening a sheet «Foto 2 de 5».
- Focus and announcements after each action as in the table of [Screens](#fotos-field-web-create-and-product-page); mobile returns focus to the acted-on thumbnail.
- The web hint shows only without photos and the counter replaces it; on mobile the same hint is the source sheet's message on a product without photos. One uploading text, «Subiendo…», on the thumbnail.
- Every count text has a singular form in Spanish and Portuguese. The counter words marks as «se eliminará» when any marked photo was saved, otherwise «se quitará»; at the limit with marks it says that saving frees a place.
- The mobile sheet of an uploading photo dismisses with **Seguir subiendo**; on 64 px tiles the band shows one text (mark or «Principal») and state is shown by icon.
- A save rejected for an unusable or repeated photo marks that thumbnail when core can identify it; otherwise the field.
- The vision chooser sees, per candidate, the product photo closest to the customer image; one photo per candidate, as today.
- Indexing on save, one photo at a time; a product becomes recognizable by new photos within minutes, not instantly. The reindex command covers every photo of every active product.
- A removed photo stops identifying the product once the save completes; its file, its public address and any computed index data stay, but the product no longer uses them.
- A product counts once among visual search candidates even if several of its photos match.
- The same file uploaded twice counts as two photos; no duplicate detection.
- Seller order screens keep showing no product photo; the task's «pedidos» is the order checkout.
- A save changes photos only when the list to save differs from the loaded one; between two forms that both changed the photos, the last save wins.
- New texts in Spanish and Portuguese.
