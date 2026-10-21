# Products

A product is something a company sells. Products are managed from the core web app (`/products`) and from the mobile app (**Productos** tab). Core is the source of truth for validation, identifiers, prices, stock, images and persistence; mobile adapts navigation and controls but follows the same rules through `/api/products`.

Code: `apps/core/src/features/products/` (core), `apps/mobile/src/features/products/` (mobile). JSON contracts: `shared/contracts/products.ts`. Schema: `Product`, `ProductVariant` and `ProductStock` in `apps/core/prisma/schema.prisma`.

## Model

- A product has a name, an optional description, an optional photo (one `imageId`, see [Images](images.md)), a currency and at least one variant.
- A variant has its attributes (for example `{ "talla": "M", "color": "Azul" }`; empty for a product without options), an optional SKU, a sale price, an optional purchase price and exactly one stock record.
- Products and variants each have an immutable QR identifier, separate from the internal id and the SKU. The variant QR is what product labels print and what [message-to-order](message-to-order.md) reads from photos.
- Products and variants start active. There is no deletion, archiving or category in the product module.

## Rules

| Aspect | Rule |
| --- | --- |
| Access | Any authenticated user of the company can create, view and edit its products. The company comes from the session, never from the request. A product of another company behaves as non-existent. |
| Name | Required, up to 200 characters. Duplicate names are allowed. |
| Description | Optional, up to 5,000 characters. |
| SKU | Optional, up to 100 characters, never generated. Unique per company ignoring case and surrounding spaces (database constraint); many variants may have none. |
| Prices | Sale price greater than zero; purchase price optional and zero or more. Two decimals at most, maximum 999,999,999.99 in the product currency. Excess precision is rejected, never rounded. |
| Currency | The client sends the currency explicitly, taken from the company's country (PE→PEN, US→USD, CO→COP, AR→ARS, CL→CLP, BR→BRL). Core validates the code. It cannot be edited. Reason: the contract allows a currency selector later without changing the API. |
| Stock | Initial stock is an optional whole number of zero or more (default zero). Users cannot edit stock after creation; it changes only when an order deducts it and when a cancelled order that had deducted it restores it. |
| Attributes | Combinations must be unique within a product, comparing names and values trimmed and case-insensitive, regardless of key order. Only one variant may have empty attributes. Names that collide after normalization are rejected. |
| Creation | Product, variants and stock are written atomically; all detectable validation issues are reported together. |
| Editing | Name, description, photo, and per variant SKU, sale price and purchase price. Stock, currency, attributes, status, ids and QR are not editable. An edit is a patch: an omitted field keeps its value, `null` clears an optional one. An edit with no effective change succeeds without writing. |
| Concurrency | No edit locks or version checks. Reason: concurrent editing of one product is not an expected workflow. |

## Screens

Web and mobile behave the same:

- **List:** newest first; name, SKU («Varias variantes» when there are several, «Sin SKU» when absent), sale price («Desde» the minimum when variant prices differ) and total stock across variants. Search is partial and case-insensitive over the product name and any variant SKU; each product appears once and its summary always covers all variants. Pages of 20 (web numbered pages, mobile **Cargar más**). An empty catalog, a search without results and a load failure are distinct states.
- **Create:** name, description, photo, SKU, sale price, purchase price and initial stock. The forms create exactly one variant with empty attributes. Saving opens the product.
- **Product management** (`/products/:productId` on web): editable from the start. With one variant, SKU and prices are editable; with several, every variant's attributes, SKU, prices and stock are shown and only general fields and the photo are editable. The form never picks a variant implicitly. Saving stays on the screen. Stock is read-only.
- **Photo:** uploaded before saving through the image API, then only `imageId` is sent. It can be replaced or removed; removing does not delete the stored file. Mobile can pick from the gallery or take a photo with the camera; a denied camera permission keeps the form and allows the gallery.
- Mobile asks for confirmation before discarding unsaved changes (back, cancel, tab change), and mobile prints a variant's label (name, SKU and QR) on a Brother printer from the product screen.

## API

`/api/products` requires a session (Bearer token for mobile, cookie for web) and an active company. Responses carry `Cache-Control: no-store`. Request bodies are strict (unknown or non-editable fields are rejected); responses may gain optional fields, which older mobile versions ignore.

| Operation | Route | Success |
| --- | --- | --- |
| List | `GET /api/products?search=&page=&pageSize=` (page size default 20, max 100) | `200 { items, page, pageSize, total }` |
| Detail | `GET /api/products/:productId` | `200 { product, image? }` |
| Create | `POST /api/products` | `201 { id }` |
| Edit | `PATCH /api/products/:productId` | `200 { id }` |

- On create, mobile generates the product UUID; core generates variant ids and QR codes. A second `POST` with an id already used returns `409 PRODUCT_ID_CONFLICT`, whatever the body. Reason: a retry after a lost response cannot create a duplicate product. Mobile shows the conflict and offers to review the list; it does not treat it as success or generate a new id.
- Errors use the shared `{ code, error }` envelope; field errors add `issues` with scope, field, variant index and typed reason, so the client chooses the visible message by code and reason, never by the `error` text. Codes and statuses are defined in `apps/core/src/features/products/presentation/api-routes.ts`.
- Mobile does not retry writes automatically.
