# Products: sequential implementation tasks

Requirements source: [products-implementation.md](products-implementation.md).
This plan organizes the implementation; it does not claim that these capabilities already exist.

Each task delivers a testable flow and groups the data, logic, persistence, and
presentation changes needed to complete it. Task 1 is tested through application
operations and a real database; subsequent tasks add browser flows. Execute in
order: **1 → 2 → 3 → 4 → 5**.

The U, I, and E IDs refer to the test matrix in the source document. When a case
spans multiple tasks, each task verifies the part it adds, and the final task
completes the scenario. The source document retains all boundaries and contracts.

## 1. Create a product and retrieve its complete state

**Flow:** trusted company context → `createProduct` → atomic persistence →
`getProduct` → product with all its variants and stock.

**Dependencies:** no previous tasks.

**Included work**

- Generate and review the Product, ProductVariant, and ProductStock migration
  according to the repository's Prisma procedure. Include company-scoped composite
  relations, including the relation to Image; enabled and forced RLS; `core_app`
  permissions; and constraints on prices, quantities, text, and normalized SKU
  uniqueness.
- Implement readonly domain types, nominal identifiers, nonempty variants, nested
  stock, and pure rules. Reuse Money and Result; add Currency and the typed
  country-to-currency map without changing the existing monetary representation
  or arithmetic.
- Implement `createProduct` and `getProduct`, their contracts and specific errors,
  the `create` and `get` methods of the single repository, and their explicit
  composition. Add the other methods when implementing their flows, without
  functional stubs.
- Accept multiple variants at creation through the application layer: validate
  attributes, equivalent combinations, and duplicate SKUs before persistence.
  Generate independent IDs and QRs and assign both timestamps from a single clock
  reading.
- Enforce monetary limits and precision, safe integer stock values, and text lengths
  with counting compatible with the database, including Unicode beyond the Basic
  Multilingual Plane. Collect all safely detectable errors with typed reasons.
- Map prices, optional fields, and entities exactly, without mutating inputs or
  exposing persistence objects. Reuse existing transactions and isolation.
- Resolve an existing image through a dependency: verify its company when linking
  it and return its URL in the product management screen without persisting the URL on the
  product. Interactive photo upload is added in task 5.

**Acceptance criteria and tests**

- [ ] Create with minimal data and retrieve one active variant, zero stock, absent
  optional fields, and the IDs, QR, and timestamps supplied by dependencies.
- [ ] Create and retrieve several distinct variants with exact prices and stock;
  reject empty variants, equivalent combinations, and invalid attributes.
- [ ] Reject invalid prices, text, currency, or stock without leaving records.
  Preserve input objects and their nested values.
- [ ] Verify against a real database that a failure in a later variant or stock
  entry rolls back the entire creation. Test SKU uniqueness even with concurrent
  writes, multiple missing SKUs, and reuse of the same SKU in another company.
- [ ] Company A cannot retrieve or link records belonging to B. Access is denied
  without authorized context. Test constraints using the application role.
- [ ] Distinguish a missing product (`ok(null)`), a product without a photo, an
  unavailable image (`IMAGE_NOT_FOUND`), and a propagated technical failure.
- [ ] Apply the migration to a disposable database with the previous schema and
  verify that existing company and image data remain valid.

**Coverage:** U01–U13, U20–U21; I01–I03, I05–I08, I10–I11, and I17 for
creation/reading. Type checks for entities, identifiers, currency, nonempty tuple,
readonly properties, and creation/detail errors. Verify existing Money consumers,
including mobile, against the shared changes.

## 2. Create a product from the web and open its management screen

**Flow:** sign in → private navigation → new product → save → product management screen →
reload and verify persistence.

**Dependencies:** task 1.

**Included work**

- Register creation and product management routes within the feature. Adapt locale resolution
  to preserve the requested route and provide a navigation entry for product
  creation; task 3 connects the final Products navigation entry to the catalog.
- Build the shared form with name, description, SKU, sale price, purchase price,
  and initial stock. The UI submits exactly one variant with `attributes: {}` and
  the explicit currency corresponding to the company's country.
- Implement the creation JSON parser with a separate InputError: reject malformed
  JSON, invalid types and identifiers, and unknown or disallowed keys.
- Connect the action and loader to the composed operations. Obtain the company
  from the session and reject company identity submitted by the client.
- Show all variants, attributes, prices, and stock on the product management screen; if the
  product has a previously linked image, display it from Detail.
- Translate errors by code, field, and typed reason into Spanish messages.
  Preserve values after failures, associate errors with fields, and show a
  duplicate SKU error on the SKU field.
- Implement pending submission, Save, and Cancel. Save stays on the product
  management route and confirms success; Cancel writes nothing and returns to
  an existing private route.
- Include keyboard access, visible focus, labels, and narrow-screen layout.

**Acceptance criteria and tests**

- [ ] Create with a name and price; verify zero stock and absent optional fields
  in the product management screen, as well as the submitted currency and the single variant
  with no attributes.
- [ ] Create with all available fields, reload the product management screen, and verify values.
- [ ] Submit several errors at once, correct them, and save without losing form
  values or creating a partial product. Also test a duplicate SKU.
- [ ] A product with multiple variants prepared through the application layer
  displays all of them.
- [ ] Access and submission without a session create no products; a URL for
  another company's product reveals no data, and a manipulated payload is
  rejected before the use case.
- [ ] Cancel creates no records. A loading or saving failure displays an error
  and allows retry without success navigation or a false not-found state.

**Coverage:** U24–U25 for creation and detail; I16–I17 for these routes;
E01–E05 for the steps available without photo upload, E07 in detail,
E12–E13, and E16–E17 for creation/detail. E02 is completed when the product
appears in the catalog after task 3; E03 is completed with photo upload in task 5.

## 3. Find products in the catalog and view their details

**Flow:** private navigation → Products → search → paginate → open product management screen →
create product → verify its appearance in the catalog.

**Dependencies:** task 2.

**Included work**

- Implement `listProducts`, normalized criteria, a dedicated ListError, and the
  repository's `list` method. Defaults: page 1 and page size 20; maximum size
  100. Reject invalid explicit values and calculations outside the safe integer
  range.
- Search partially by name or SKU, case-insensitively, trimming only the ends
  of the search string. Each product appears only once.
- Calculate the summary across all variants even if only one matches: variant
  count, SKU when there is only one, minimum price, whether prices differ, and
  total stock.
- Apply the same filter and company to rows and total, ordered by creation time
  descending with ID as the tiebreaker. A shared snapshot is not required.
- Implement a table without photos, search box, numbered pages, total, detail
  link, and creation button. Show “Multiple variants,” “From” only when prices
  differ, and an indication of a missing SKU where applicable.
- Connect the Products navigation entry and its active state; adjust creation's
  Cancel action to return to the list. Distinguish an empty catalog, a search
  with no results, and a loading failure. Keep the table and controls usable on
  mobile and with a keyboard.

**Acceptance criteria and tests**

- [ ] Create a product from the web, find it by name and SKU, and open its detail
  view.
- [ ] Several matching variants do not duplicate rows; prices and stock still
  summarize the entire product. Verify equal and differing prices.
- [ ] Test multiple pages, tied timestamps, searches with no results, and invalid
  criteria; total and rows correspond to the same filter and company.
- [ ] No search or total reveals another company's records.
- [ ] A technical failure does not appear as an empty catalog; retry is possible.

**Coverage:** U22 and U25 for listing; I06 and I08 for listing/counting,
I12–I14, I16–I17 for listing; complete E01–E02 for navigation/catalog,
E06–E07 for the table, and E12–E13, E16–E17 for listing.

## 4. Edit a product and preserve unchanged data

**Flow:** catalog → product management screen → change or clear fields → save →
confirmation on the same screen → save again without changes.

**Dependencies:** task 3.

**Included work**

- Implement an explicit UpdateInput, `updateProduct`, the repository's `update`
  method, composition, edit parser, and action on the product management route
  with the shared form. Redirect legacy `/edit` visits to that route.
- Load through `getProduct`. Allow name and description; for a single variant,
  enable SKU and prices. Show stock as read-only.
- For multiple variants, allow only general fields in the web UI, without
  implicitly selecting a variant or submitting variant changes. The application
  contract does allow patches to existing variants identified by ID.
- Preserve fields that are omitted or undefined; clear optional fields with null;
  validate and replace concrete values. Translate intentional clearing of form
  controls to null.
- Reject duplicate or foreign variant IDs and noneditable or unknown fields.
  Validate everything before writing and persist related changes atomically.
- Detect effective changes after validation: a no-op returns the ID without
  writing or reading the clock. A real edit preserves createdAt and supplies a
  new updatedAt. Do not mutate the loaded product, patch, or their nested values.
- Implement imageId semantics in the application layer as well; controls for
  replacing/removing a photo arrive in task 5.
- Show editable fields on the product management screen. Cancel returns to
  the catalog without writing; errors preserve entered data and allow correction or retry.

**Acceptance criteria and tests**

- [ ] Change data and prices, clear optional fields, and verify that omission
  preserves values; a purchase price of zero remains valid.
- [ ] Stock, currency, attributes, QR, IDs, and createdAt remain unchanged.
  Reject manipulated requests even if there are no controls for those fields.
- [ ] Edit general fields of a multivariant product from the web without changing
  variants. From the application layer, change one variant by ID and preserve
  the others.
- [ ] A duplicate SKU, foreign variant, foreign image, or failure in a later
  write rejects/rolls back the entire edit, including updatedAt.
- [ ] An empty patch, equal normalized values, and clearing an already absent
  optional field cause no writes. Invalid fields or references still fail;
  a missing target returns PRODUCT_NOT_FOUND even with an empty patch.
- [ ] Test editing without a session and from another company; no records change.

**Coverage:** U14–U20, U23–U25; I04–I09 and I15–I17 for editing;
E01 for access to editing, E05 and E08–E09, E12–E17 for editing.
Complete type checks for the patch, nullability, readonly properties, and
UpdateError.

## 5. Create, replace, and remove a product photo

**Flow:** new product → upload photo → preview → save → product management screen →
replace photo → save → remove photo → save.

**Dependencies:** task 4.

**Included work**

- Integrate the existing image upload into the shared form. Upload bytes before
  the product transaction and submit only imageId in its JSON.
- Show a preview and upload/error states. Validate company ownership using the
  image capabilities already connected in the previous tasks.
- Keep the photo when imageId is omitted, replace it with a valid ID, and remove
  the association with null. Do not delete the file when removing the association.
- Allow recovery after a failed upload and cancellation after a successful one.
  Uploaded images without an association are acceptable; do not add automatic
  cleanup.
- Complete the integrated catalog, creation, detail, and editing flow, including
  image failures and the accumulated navigation and accessibility checks.

**Acceptance criteria and tests**

- [ ] Create with all fields and a photo, see the preview, and open the saved
  product management screen; the list retains its columns without a photo.
- [ ] Replace and then remove the photo; verify the result after reloading.
  An edit that omits imageId preserves the previous photo.
- [ ] A failed upload preserves the form and allows retry. Cancel after uploading
  neither creates nor edits products and does not require deleting the uploaded
  file.
- [ ] A nonexistent image or one belonging to another company produces
  IMAGE_NOT_FOUND without changes. Technical resolution failures are distinct
  from absence and reach the server boundary.
- [ ] Run the full flow with controlled image storage, without depending on a
  remote provider's availability.

**Coverage:** complete U20–U21 and U25 for images; I07, I16–I17 for
association/composition; E03, E10–E12, and E16–E17 for photo controls.

## Completion criteria for each task

- Run the relevant type and lint checks and the unit, integration, and browser
  tests corresponding to the added flow.
- Keep tests next to the behavior they verify and browser flows in
  `apps/core/tests/e2e/`, following repository conventions.
- Test constraints, isolation, and rollback with a real disposable database and
  the application role; mocked repositories do not demonstrate these guarantees.
  Reuse generic coverage for the isolation mechanism, without duplicating a
  suite per table or adding product-specific branches to the shared module.
- Verify expected errors through Result and technical errors at the server
  boundary, with diagnostics and a safe response that exposes no internal details.
- Record what ran, the result, and any unavailable checks. A check that did not
  run does not count as passed.
- When closing task 5, review coverage of U01–U25, I01–I17, E01–E17, and all
  type contracts. This review completes the tests distributed among tasks; tests
  are not deferred to a separate delivery.

## Out of scope

Categories; managing multiple variants from the form; currency selection or editing;
inventory adjustments; product deletion or archiving; QR display, download, or
printing; mobile endpoints; locks or resolution for concurrent editing; list
snapshot synchronization; automatic image cleanup. SKU uniqueness under concurrent
writes is required.
