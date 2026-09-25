# Products — Core Implementation

The first product module includes the database migration, data structures, types,
validation, and web screens to create, list, view, and edit products in core.
These are agreed requirements, not a claim that the module is implemented.
Product API endpoints for mobile are outside this release.

## Data and Rules

- Keep `Product`, `ProductVariant`, and `ProductStock` in the product module.
  Every product has at least one variant. The initial form creates exactly one
  variant with no distinguishing attributes; the model permits multiple variants
  for a later release.
- Products belong to a company. Any authenticated user of that company may
  create, view, and edit its products. Preserve company isolation without adding
  a roles or permissions system.
- Product name is required; duplicate names within a company are allowed.
  Description and one photo are optional. The photo uses the existing images
  module and can be replaced or removed during editing.
  Name accepts up to 200 characters, SKU up to 100, and description up to 5,000.
  Validate these limits at the input boundary and in domain rules.
- SKU belongs to the variant and is optional. Blank means absent, with no
  automatic generation. A supplied SKU must be unique within the company,
  ignoring letter case and trimming leading/trailing spaces. Enforce uniqueness
  on creation and editing, including concurrent writes through a database
  constraint. Multiple products may have no SKU.
- Sale price must be greater than zero. Purchase price is optional and must be
  nonnegative when supplied. Both accept at most two decimal places.
  Both prices have a maximum of 999,999,999.99 in the product currency.
- The frontend explicitly sends the product currency, initially using the
  company's country currency: PE → PEN, US → USD, CO → COP, AR → ARS, CL → CLP,
  BR → BRL. There is no currency selector yet. The backend validates the supplied
  currency against supported codes; it does not replace it with a derived value.
  This contract permits adding a selector later.
- Initial stock is optional, defaults to zero, and accepts only nonnegative whole
  quantities. Each variant has its own stock record. After creation, stock is
  read-only in this release; inventory adjustments belong to a separate scope.
- Products and variants start active. Each receives its own automatically
  generated, immutable QR identifier, separate from its internal ID and SKU.
- Create the product, its variant, and initial stock atomically so a failed
  operation cannot leave a partially created product.
- Editing permits changes to name, description, photo, SKU, and prices. Stock,
  currency, QR identifiers, and internal IDs remain unchanged.

## Web Screens

| Screen | Agreed behavior |
| --- | --- |
| List | Table without photos, showing name, SKU, sale price, and stock. Search by name or SKU, pagination, and newest products first. |
| Product management | `/products/:productId` shows editable product data and photo from the start. With one variant, SKU and prices are editable; with several, every variant's attributes, prices, and stock are visible. Stock is read-only. Save stays on the same route and confirms success. |
| Create | Separate page using the shared product form, including optional initial stock. Save and Cancel buttons; successful save opens the product management screen. |

Existing `/products/:productId/edit` links redirect to the product management route.

For products with multiple variants, the management screen displays every variant's attributes,
SKU, prices, and stock. The form permits changes to the general
product fields (name, description, and image), but only enables SKU and price
editing when the product has exactly one variant. It must not arbitrarily select
a variant or submit variant changes when editing a multi-variant product.
The application update contract still supports explicitly identified variant
updates; this restriction belongs to the initial web form.

## Excluded from This Release

Categories, including their data model and product field; managing multiple
variants in the form; selecting or editing currency; inventory adjustments;
deleting or archiving products; displaying, downloading, or printing QR codes;
and product API endpoints for mobile. Concurrent editing is not an expected
workflow in this release; do not add version checks, edit locks, or conflict
resolution. This exclusion does not remove atomic writes, database constraints,
or the rule that omitted update fields remain unchanged.

## Application Architecture

Use plain functions with explicit inputs, outputs, and dependencies, following
`docs/programming-style.md`. Fallible operations return `Result<T, E>` or
`Promise<Result<T, E>>` with typed errors.

| Use case | Input | Success result |
| --- | --- | --- |
| `createProduct` | Product data, currency, and a nonempty array of variants, each with optional initial stock | Created `ProductId` |
| `listProducts` | Search and pagination criteria | Page of rows with name, SKU, sale price, and stock |
| `getProduct` | `ProductId` | Product detail, or `null` when absent within the company |
| `updateProduct` | `ProductId` and editable product/variant fields | Updated `ProductId` |

Each operation receives trusted company context separately from its input. The
web boundary derives that context from the session, never from a submitted
company ID. Dependencies are supplied as arguments. Creation and editing persist
their related changes atomically. `getProduct` also loads the product management form.

Define separate `CreateInput` and `UpdateInput` contracts in their use-case files. Do not
use `Partial<Product>` for editing: stock, currency, QR identifiers, and internal
IDs must not become writable fields. A failed lookup remains distinct from a
successful lookup whose result is `null`.

The web boundary parses and validates external input; the use case applies
business rules and coordinates effects; the repository handles persistence and
queries within the company. Pure business rules remain independent of database
and UI code.

### Functional Immutability

Treat domain and application data as immutable values. Transformations return
new objects and collections instead of modifying their inputs or previously
returned results. This applies to nested variants, stock, attributes, monetary
values, validation results, and repository outputs as well as the root product.

An update represents a new value; it must not mutate the product loaded earlier,
the submitted patch, or objects retained by another consumer. Unchanged nested
values may be shared only while treated as immutable; changed branches receive
new objects. Repositories return newly mapped domain values rather than exposing
mutable persistence objects or a shared mutable cache.

Express this intent with readonly properties and collections in the concrete
types. The type sketches in this document describe field shapes; they do not
authorize mutation. Immutability is a functional programming contract, not a
requirement to add a deep-cloning library or recursively freeze every object.
Check input preservation in behavioral tests of transformations and updates.

### Creation Variants

```ts
type CreateVariantInput = {
  attributes: Readonly<Record<string, string>>;
  sku?: string;
  salePrice: number;
  purchasePrice?: number;
  initialStock?: number;
};

type CreateInput = {
  name: string;
  description?: string;
  imageId?: ImageId;
  currency: Currency;
  variants: readonly [CreateVariantInput, ...CreateVariantInput[]];
};
```

The creation input receives `variants` as a nonempty array, not a singular
`variant` object. Type it as
`readonly [CreateVariantInput, ...CreateVariantInput[]]` and validate that it
is nonempty at runtime. Each variant supplies its own attributes, optional SKU,
sale price, optional purchase price, and optional initial stock. Prices use the
product currency.

The initial web form submits one entry with `attributes: {}`. The application
contract accepts multiple entries; the one-variant limitation belongs to the
initial form. Create all supplied variants and their stock records atomically
with the product. Enforce SKU uniqueness both within the submitted array and
against existing variants in the company.

Reject repeated attribute combinations within the same product, even when the
variants have different SKUs. Attribute key order does not make a combination
distinct: `{ talla: "M", color: "Azul" }` and
`{ color: "Azul", talla: "M" }` describe the same combination. Only one variant
may have empty attributes `{}`. Validate the whole submitted array before
writing so rejection leaves no partially created product.

Compare attribute names and values after trimming leading/trailing whitespace
and ignoring case. Attribute order is irrelevant. For example,
`{ Color: " Azul " }` and `{ color: "azul" }` are the same combination.
Reject a variant with attribute names that collide under this normalization
rather than silently overwriting a value. This comparison does not remove
internal spaces or accents.

### Update Contract

```ts
type UpdateVariantInput = {
  id: VariantId;
  sku?: string | null;
  salePrice?: number;
  purchasePrice?: number | null;
};

type UpdateInput = {
  name?: string;
  description?: string | null;
  imageId?: ImageId | null;
  variants?: readonly UpdateVariantInput[];
};
```

Receive the target `ProductId` and trusted company context separately. Each
variant entry patches only the supplied fields of an existing variant. Omitted
variants remain unchanged; the array does not replace the collection and cannot
create or delete variants. An omitted or empty variants array makes no variant
changes. Preserve the undefined/null/value semantics described below.

Validate that variant IDs are not repeated and that every supplied variant
belongs to the target product within the company. Reject an invalid update
without partial writes. Persist product and variant changes atomically. Stock,
currency, attributes, and QR identifiers are not editable through this contract.
Variant price inputs use the product's existing currency when constructing Money.

After loading the target and validating the request, detect whether any supplied
editable value actually changes the current state. An empty patch, an omitted or
empty variants array with no other changes, or values equal to those already
stored returns the product ID successfully without writing or updating updatedAt.
Compare normalized values; clearing an already absent optional value is also
a no-op. Validate supplied fields and variant references before this decision:
invalid input must not be accepted just because it would produce no changes.
An absent target still returns PRODUCT_NOT_FOUND. Read the clock and call the
update repository only when there are effective changes.

### Detail Contract

```ts
type Detail = {
  product: Product;
  image?: {
    id: ImageId;
    url: string;
  };
};
```

Define detail errors in `application/get.ts`:

```ts
type DetailError = {
  readonly code: "IMAGE_NOT_FOUND";
  readonly message: string;
};
```

`getProduct` returns `Promise<Result<Detail | null, DetailError>>`.
The product contains all its variants and their stock records. The domain
stores only the optional image identifier; the use case resolves its URL through
the existing images module using a supplied dependency. Do not persist the URL
on the product. The product management screen consumes this output.

Return successful `null` when the product is absent within the company. A product
without an image omits `image` from the detail result. Failure to resolve a
referenced image must remain distinguishable from a product with no image.
An image that does not exist within the company yields `IMAGE_NOT_FOUND`.
Unexpected technical failures propagate to the server boundary; they are not
converted to missing-image errors. Detail does not expose creation/editing
errors such as duplicate SKU or invalid product fields.

### Listing Contract

```ts
type ListInput = {
  search?: string;
  page?: number;     // Default: 1
  pageSize?: number; // Default: 20; maximum: 100
};

type ProductListItem = {
  id: ProductId;
  name: string;
  variantCount: number;
  sku?: string;
  minSalePrice: Money;
  hasDifferentPrices: boolean;
  totalStock: number;
};

type ListOutput = {
  items: readonly ProductListItem[];
  page: number;
  pageSize: number;
  total: number;
};
```

`ProductListItem` provides product ID, name, variant count, optional SKU for a
single variant, minimum sale price as `Money`, whether variant sale prices differ,
and total stock across all variants. The presentation rules are:

- One variant: show its SKU when present, otherwise indicate no SKU.
- Multiple variants: show "Varias variantes" instead of choosing a SKU.
- Equal variant sale prices: show that price normally. Different prices: show
  the minimum with "Desde". A single variant shows its price normally.
- Stock: sum the quantities of all the product's variants.

Search matches partial product names or any variant SKU without case
sensitivity. A product appears only once even if multiple variants match.
Matching a variant does not restrict the variants used to calculate price or
stock: the row always summarizes the entire product. Order by creation date
descending, then product ID as a deterministic tie-breaker.

Return the total number of distinct matching products so the UI can display numbered
pages. Rows and count must use the same company scope and search criteria.
They may be queried independently; no shared snapshot or special transaction
is required to synchronize the rows and count. A temporary difference caused
by changes between those queries is acceptable in this release.
Normalize and validate listing input before passing it to the repository;
defaults apply to omitted pagination fields. Page and page size must be positive
integers, with page size no greater than 100.

### Contract Boundaries

Keep distinct concepts and operation contracts isolated. Similar technical
shapes do not justify combining their meanings. In particular, listing criteria
and product creation/editing fields have different owners and validation errors.
Do not add search or pagination fields to ProductField, or criteria issues to
the product/variant validation union. Reuse Result as a transport-independent
result shape while keeping each operation's error type specific to its contract.

### Typed Errors

Keep shared product/variant validation types in `domain/errors.ts`, and define
each write operation's error union in its own application file:

```ts
type ValidationIssue = (
  | { readonly scope: "product"; readonly field: ProductField; readonly message: string }
  | {
      readonly scope: "variant";
      readonly index: number;
      readonly field: VariantField;
      readonly message: string;
    }
) & ProductValidationReason;

type ValidationError = {
  readonly code: "VALIDATION_ERROR";
  readonly issues: readonly [ValidationIssue, ...ValidationIssue[]];
  readonly message: string;
};

// application/create.ts
type CreateError =
  | ValidationError
  | { readonly code: "DUPLICATE_SKU"; readonly message: string }
  | { readonly code: "IMAGE_NOT_FOUND"; readonly message: string };

// application/update.ts
type UpdateError =
  | ValidationError
  | { readonly code: "DUPLICATE_SKU"; readonly message: string }
  | { readonly code: "IMAGE_NOT_FOUND"; readonly message: string }
  | { readonly code: "PRODUCT_NOT_FOUND"; readonly message: string };
```

`createProduct` returns `Promise<Result<ProductId, CreateError>>`;
`updateProduct` returns `Promise<Result<ProductId, UpdateError>>`. There is no
catch-all ProductError union across operations. Creation never declares
PRODUCT_NOT_FOUND; detail and listing keep their separate error contracts.

`ProductField` and `VariantField` are explicit unions of supported input field
names, not arbitrary strings. Collect all detectable validation issues in one
failure, rather than stopping at the first invalid field. Variant indices are
zero-based positions in the submitted array, including update arrays; they do
not refer to a stored ordering. Keep those positions when mapping errors back
to the form. If a container is malformed, report that issue without attempting
unsafe validation of its children. The form associates issues with their fields and
shows `DUPLICATE_SKU` against the SKU input. Use typed `Result` failures for these
expected outcomes.

Define listing validation separately in `application/list.ts`:

```ts
type CriteriaField = "search" | "page" | "pageSize";

type CriteriaIssue = {
  readonly field: CriteriaField;
  readonly message: string;
} & CriteriaValidationReason;

type ListError = {
  readonly code: "VALIDATION_ERROR";
  readonly issues: readonly [CriteriaIssue, ...CriteriaIssue[]];
  readonly message: string;
};
```

The list use case returns `Promise<Result<ListOutput, ListError>>`. Its
validation issues do not belong to CreateError, UpdateError, or ValidationIssue. The
repository receives already validated Criteria and does not return criteria
validation errors; unexpected storage failures propagate to the server boundary.

`getProduct` returns a successful `null` for absence within the company;
`updateProduct` returns `PRODUCT_NOT_FOUND` when its target is absent. An image
outside the company is treated as unavailable through `IMAGE_NOT_FOUND`.
Unexpected technical failures reach the server boundary for diagnostic logging
and a safe user-facing response; do not misclassify them as business errors or
empty query results.

### Validation Reasons and User Messages

Every validation issue includes a typed `reason` identifying the failed rule.
ProductValidationReason and CriteriaValidationReason are operation-owned
discriminated unions with the data required by each reason. Keep them separate;
do not create a universal reason union that mixes product and listing concepts.
InputError likewise keeps its own presentation parsing reasons.

For example, a product text-length reason has the shape
`{ readonly reason: "TOO_LONG"; readonly maxLength: number }`. Combined with
the issue location, an overlong name is represented as:

```ts
{
  scope: "product",
  field: "name",
  reason: "TOO_LONG",
  maxLength: 200,
  message: "Name exceeds maximum length"
}
```

Reason-specific data must be required in its corresponding union member,
rather than added as unrelated optional fields. Presentation uses the error
code, issue field, reason, and typed parameters to choose the visible Spanish
message, such as "El nombre debe tener como máximo 200 caracteres". Never
identify failures by comparing message strings. Keep the required outer error
message for the existing Result contract; messages serve as technical
descriptions rather than the stable user-facing copy contract. No translation
framework is required for this release.

### Domain Structure

The domain types consolidate the agreed fields and relationships:

```ts
type ProductStock = {
  variantId: VariantId;
  quantity: number;
};

type ProductVariant = {
  id: VariantId;
  productId: ProductId;
  attributes: Readonly<Record<string, string>>;
  sku?: string;
  salePrice: Money;
  purchasePrice?: Money;
  qrCode: string;
  status: "active";
  stock: ProductStock;
};

type Product = {
  id: ProductId;
  companyId: CompanyId;
  name: string;
  description?: string;
  imageId?: ImageId;
  currency: Currency;
  qrCode: string;
  status: "active";
  createdAt: Date;
  updatedAt: Date;
  variants: readonly [ProductVariant, ...ProductVariant[]];
};
```

Reuse shared `Money` and `Currency`. All variant prices must use the product
currency. Numbers still require runtime validation for price precision and
nonnegative whole-unit stock. Each nested stock's variant ID must match its
parent, and each variant's product ID must match its product. Persistence maps
all child records within the same company even though the nested domain type
holds company identity at the product level. Timestamps are assigned by the
application use cases through the supplied clock and preserved by persistence.

`Product` contains its variants as a nonempty readonly tuple:
`readonly [ProductVariant, ...ProductVariant[]]`. This expresses the requirement
of at least one variant in the domain type, while the initial creation form
supplies exactly one.

Each `ProductVariant` contains its `ProductStock` as `stock`, rather than making
consumers join separate variant and stock arrays. `ProductStock` remains its own
entity and database table; the nested domain representation does not change
persistence ownership or the one-stock-record-per-variant relationship.

`Product` uses `ProductId` and `CompanyId`; `ProductVariant` uses `VariantId` and
references its parent through `ProductId`. Validate the nonempty collection when
constructing or mapping a product at runtime; a type assertion alone cannot
establish this invariant for external or persisted data.

### Currency Type

Define a shared currency type for the supported codes:

```ts
type Currency = "PEN" | "USD" | "COP" | "ARS" | "CLP" | "BRL";
```

Use it in product inputs and entities. Validate incoming values at the boundary
before passing them as `Currency`; do not use an unchecked type assertion.
Type the frontend country-to-currency mapping with the existing `Country` type
and this shared `Currency` type so every supported country has a valid currency.
Reuse the existing Money representation and keep its runtime currency validation
consistent with the shared supported codes.

### Optional Fields

Use optional properties for absent domain values: `description?: string`,
`sku?: string`, `purchasePrice?: Money`, and an optional image reference.
Persistence adapters map nullable database columns to absent domain properties.

Update inputs distinguish three states for each editable, clearable field:

| Input | Update behavior |
| --- | --- |
| Property omitted or `undefined` | Preserve the stored value; do not write this field |
| `null` | Clear the stored value by writing SQL `NULL` |
| A concrete value | Validate and replace the stored value |

For example, the update contract uses `sku?: string | null` and
`purchasePrice?: Money | null`. Required entity fields such as name and sale
price may be omitted in an update to leave them unchanged, but cannot be cleared
with `null`. Keep the update contract explicit rather than using `Partial<Product>`.

The form and parser must preserve this distinction: an explicit removal sends
`null`, while an omitted or unchanged field can be left out. An empty string is
not an implicit removal instruction at the use-case boundary; clearing a field
in the UI must be translated explicitly to `null`. Removing a photo sends a null
image reference. Never turn omitted update fields into database nulls.

Creation retains its separate contract: required fields must be supplied;
optional values may be omitted, and omitted initial stock defaults to zero.
Stock, currency, and QR identifiers remain excluded from editable fields.

### Nominal Identifiers

Use distinct branded string types for `ProductId`, `VariantId`, and `CompanyId`
so that the compiler rejects interchanging them. They remain strings at runtime
and do not require a new dependency or identifier class.

Use `ImageId` for image references in these product contracts as well, adapting
the existing image module's string identifiers at its boundary.

Construct these types at controlled boundaries after validating external values,
generating IDs, or mapping trusted persistence data. Branding does not establish
authorization: company scope and ownership checks remain necessary.

Adopt these identifiers in the core products module and its boundary adapters;
do not refactor unrelated modules to introduce branding. Existing string-based
company and persistence contracts are adapted at those boundaries. Avoid scattered
type assertions that bypass validation or hide incompatible contracts.

### Web Input Transport

Creation and editing submit JSON to their web route actions. These actions are
part of the web screens, not a new public product API for mobile. Image bytes
continue to use the existing upload flow; product JSON carries only the image ID.

An omitted object property or a value of undefined is omitted during JSON
serialization; an explicit null is preserved. Editing therefore submits only
the intended field changes, with null for removals. Do not fill omitted fields
with defaults or nulls while parsing updates.

`presentation/input.ts` treats decoded JSON as untrusted data, validates its
structure and field types, and produces the appropriate creation or update
input. Reject malformed JSON and invalid shapes as input failures without
executing writes. Preserve variant positions for validation messages and check
identifier formats at this boundary. Use cases independently enforce business
rules; parsing input does not establish company ownership or authorization.

Reject unknown properties and properties excluded from the operation contract;
do not silently strip them. Enforce allowed keys at the product and variant
object levels. For example, stock, currency, QR identifiers, and attributes
cannot be supplied as editable fields. Such requests fail at the input boundary
without invoking the use case or writing any data. The creation attributes
record intentionally accepts business-defined attribute names; those keys are
validated as attributes, not as fixed variant fields.

Input parsing has its own `InputError` contract in `presentation/input.ts` for
malformed JSON, incorrect input structure/types, and unknown or non-editable
properties. It is distinct from CreateError and UpdateError: a parsing failure
occurs before invoking the application operation. The web action handles input
failures and use-case failures at their respective boundaries and translates
them for the form without adding transport failures to domain error unions.
Presentation may show both kinds of failure using the same form controls;
shared rendering does not merge their source contracts.

### Image Upload and Association

Reuse the existing image module. When the user selects a photo, the frontend
uploads it and receives its identifier and URL for preview. Saving the product
submits the image identifier; the use case verifies that the image belongs to
the authenticated company before associating it.

Upload occurs before the product database transaction, never inside it. On
editing, an omitted or undefined image reference preserves the current image,
`null` removes the association, and a new identifier replaces it after ownership
validation. Removing an association does not delete the stored image file.

Canceling the form after uploading, or failing to save the product, can leave
an uploaded image without a product association. Automatic cleanup of these
images is outside this release.

### Timestamp Assignment

Creation and update use cases receive an explicit clock dependency:

```ts
type Clock = () => Date;
```

Creation reads the clock once and assigns that instant to both createdAt and
updatedAt on the new product. Update preserves the existing createdAt and
supplies a new updatedAt alongside the validated changes. The repository stores
these supplied timestamps rather than generating or overriding them.

Timestamps are server-controlled metadata, excluded from frontend input
contracts. An internally supplied updatedAt is distinct from user-editable
fields in the repository update contract. Pure domain rules do not read the
system clock. Tests supply a deterministic clock; composition supplies the real
clock. Treat Date values as immutable by convention and never modify an existing
date with setter methods.

### Identifier Generation

The creation use case generates product and variant IDs and their separate QR
identifiers before persistence, using an identifier-generation function received
as an explicit dependency. It constructs the complete product and passes it to
the repository for atomic storage.

Pure domain rules do not read randomness or generate IDs internally. Tests can
supply predictable identifiers through the same dependency. The repository
preserves the supplied IDs and QR identifiers rather than replacing them with
newly generated values. Editing never regenerates them.

### Repository Contract

Use one repository contract for Product, ProductVariant, and ProductStock,
defined in `application/repository.ts` and implemented in
`infrastructure/repository.ts`.

| Method | Responsibility |
| --- | --- |
| `create` | Atomically persist the product, all supplied variants, and their stock records |
| `update` | Atomically apply the supplied product and existing-variant changes |
| `get` | Read the product with its variants and each variant's stock |
| `list` | Read product summary rows and the total matching product count |

All methods receive the trusted `CompanyId` explicitly and return promises.
Read methods return their data directly: `get` represents absence with null,
and `list` receives validated criteria. The application use cases own DetailError
and ListError respectively; unexpected storage failures propagate to the server
boundary rather than becoming product-write errors.

| Method | Return type |
| --- | --- |
| `create` | `Promise<Result<ProductId, CreateError>>` |
| `update` | `Promise<Result<ProductId, UpdateError>>` |
| `get` | `Promise<Product \| null>` |
| `list` | `Promise<ListOutput>` |

Read through `repository.get(companyId, productId)` and
`repository.list(companyId, criteria)`. The list use case validates and
normalizes user criteria and resolves defaults before calling the repository.
The adapter does not interpret URL parameters or invent pagination defaults.

Define the repository's criteria in `application/repository.ts`:

```ts
type Criteria = {
  readonly search?: string;
  readonly page: number;
  readonly pageSize: number;
};
```

`ListInput` permits omitted pagination values; `Criteria` requires them. The
use case constructs a new criteria object with page 1 and page size 20 when
omitted, enforcing positive integers and a maximum page size of 100. Invalid
explicit values are rejected rather than silently replaced with defaults.
Trim search at its ends and omit it when empty. Preserve internal spaces;
matching remains partial and case-insensitive over product names and variant
SKUs. The adapter computes the offset from page and page size; do not also
pass an independently supplied offset that could disagree with them. Validate
that numeric pagination calculations remain within safe integer limits.

Company identity remains a separate trusted argument. Criteria does not contain
company, arbitrary SQL fields, or a configurable sort: use the agreed creation
date descending order with product ID as the tie-breaker. Apply the same
normalized criteria to both rows and total, without requiring a shared snapshot.

The repository's `get` returns the domain product; image resolution belongs to
the application use case that builds `Detail`. Returned data follows the
functional immutability contract above.

Use cases coordinate business rules and provide explicit persistence inputs.
The adapter guarantees atomic writes using the existing transaction mechanism
and scopes all reads and writes to the trusted company. Do not introduce separate
variant or stock repositories for this release. Repository methods must preserve
the update distinction between omitted fields and explicit nulls.

For creation, use `repository.create(companyId, product)`. The use case supplies
the complete, already constructed and validated product, including its variants,
stock records, IDs, and QR identifiers. The repository checks that ownership
matches the trusted company, persists the aggregate in one transaction, and
returns the product ID without mutating the supplied entity.

For updating, use `repository.update(companyId, productId, changes)`. The use
case loads the current product, checks the referenced variants and validates
the proposed changes, then constructs a new changes object without mutating
either the loaded product or the original input. The persistence contract
receives only validated editable changes, not a replacement product aggregate.

The repository writes only supplied fields: omitted/undefined values do nothing,
null clears a nullable value, and concrete values replace it. Stock, currency,
QR identifiers, and other immutable fields are excluded from this changes
contract. Variant IDs identify targets and are never rewritten.

### Dependency Composition

Use `features/products/composition.ts` to connect the four use cases to their
concrete repository, identifier generator, clock, and existing image capabilities.
It is an explicit composition point using ordinary functions and objects,
without a dependency-injection library or automatic dependency registry.

Route modules consume the connected operations. Pass the session-derived
company on each call; never capture request-specific company context in a
module-level singleton. Use cases continue to receive dependencies explicitly,
so tests can supply small fakes without loading concrete adapters.

Composition only wires capabilities: business validation stays in domain and
application, queries and atomic writes stay in infrastructure. It does not
introduce its own business rules or transaction mechanism.

### Feature Files

Use one file per use case. Within the products feature, omit redundant
`product-` prefixes and `-product`/`-products` suffixes from filenames. Retain
business names when they identify an entity or clarify a public symbol, such
as `product.ts`, `ProductId`, or `createProduct` at a call site.

```text
apps/core/src/features/products/
├── composition.ts             # Connect concrete dependencies to use cases
├── domain/
│   ├── product.ts              # Entities, nominal IDs, and pure rules
│   └── errors.ts               # Product/variant validation fields and issues
├── application/
│   ├── create.ts               # Creation input/output and use case
│   ├── update.ts               # Update input/output and use case
│   ├── get.ts                  # Detail input/output and use case
│   ├── list.ts                 # Listing input/output and use case
│   └── repository.ts           # Application-owned persistence contract
├── infrastructure/
│   └── repository.ts           # Persistence implementation and data mapping
└── presentation/
    ├── input.ts               # Web input parsing
    ├── routes/
    │   ├── list.tsx           # Listing and search
    │   ├── new.tsx            # Creation
    │   ├── detail.tsx         # Detail
    │   └── edit.tsx           # Editing
    └── components/
        └── form.tsx           # Shared creation/editing form
```

Each use case defines its own input and output types. The repository contract
uses module types; Prisma models remain inside infrastructure. Keep focused
tests beside the behavior they verify. The existing shared transaction and
tenant-isolation mechanisms are reused by the concrete adapter.

Product route modules and components belong to the feature's presentation
layer. Route modules contain their loaders/actions and connect the screens to
application use cases. The shared form receives values, errors, and submission
state; business rules remain in the domain/application layers.

`apps/core/app/routes.ts` registers the product route modules from their feature
location. Update `apps/core/app/routes/private-layout.tsx` to add Products to
navigation, reflect the active route, and preserve product URLs when resolving
the company's locale instead of redirecting every route to the dashboard.

### Existing Files to Modify

| File | Change |
| --- | --- |
| `apps/core/prisma/schema.prisma` | Add product, variant, and stock models, company relations, and the composite image reference key |
| `apps/core/prisma/migrations/<generated>/migration.sql` | Generated migration with reviewed constraints, indexes, and tenant policies |
| `apps/core/scripts/provision-role.sql` | Add the new tables to role grants and ownership checks |
| `apps/core/app/routes.ts` | Register the feature's presentation route files |
| `apps/core/app/routes/private-layout.tsx` | Products navigation and locale handling that preserves the requested route |
| `shared/money.ts` | Export Currency alongside the existing money contract and reuse supported currency codes for validation |
| `shared/country.ts` | Export the typed country-to-currency mapping for the frontend |

The new feature files are listed above. Reuse the existing image module and
transaction/isolation helpers through supplied capabilities. Mobile is not
modified by this delivery; check its existing consumers when changing shared
types. Shared changes must preserve the Money representation and arithmetic.

## Database Structure and Tenant Migration

| Table | Columns |
| --- | --- |
| `Product` | `id`, `companyId`, `name`, `description?`, `imageId?`, `currency`, `qrCode`, `status`, `createdAt`, `updatedAt` |
| `ProductVariant` | `id`, `companyId`, `productId`, `attributes`, `sku?`, `salePrice`, `purchasePrice?`, `qrCode`, `status` |
| `ProductStock` | `variantId`, `companyId`, `quantity` |

Here `?` denotes nullable database columns, mapped to optional domain properties.
Product and variant IDs are UUIDs. `ProductStock.variantId` is its primary key;
no additional stock ID is needed. A product can have multiple variants, and each
variant has one stock record. Creation persists every supplied variant; the
initial web form supplies one.

Store sale and purchase prices in exact decimal database columns with precision
11 and scale 2 (`DECIMAL(11,2)`), with a maximum of 999,999,999.99.
Domain contracts continue to use the shared `Money` type; the persistence adapter
maps between these representations without exposing database decimal types.
Reject input with more than two decimal places before writing; do not silently
round or truncate it. Enforce positive sale prices and nullable, nonnegative
purchase prices. Reject either price above 999,999,999.99 before persistence and
preserve precision when converting stored prices to domain values.

Store name as `VARCHAR(200)`, SKU as nullable `VARCHAR(100)`, and description as
nullable `VARCHAR(5000)`. These limits count characters, not bytes. The columns
use variable-length storage; the declared maximum is not preallocated per row.
Keep application length validation consistent with database character counting,
including non-BMP Unicode characters.

Store attributes as JSON with the domain type
`Readonly<Record<string, string>>`; the initial variant has `{}`. No attribute
tables are introduced in this release. Validate the JSON shape when crossing
the domain boundary.

All three tables require tenant isolation in their migration:

- A required UUID `companyId` referencing `Company` on every table.
- Both `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`.
- Policies with both `USING` and `WITH CHECK` comparing `companyId` to
  `NULLIF(current_setting('app.company_id', true), '')::uuid`.
- Company-scoped relationships between variant/product, stock/variant, and
  product/image, backed by composite foreign keys and the required referenced
  unique keys. These prevent cross-company associations as well as access.
- Company-scoped SKU uniqueness, ignoring case and permitting multiple absent
  values, as already specified.

Create the tables and their policies within the same short transaction before
granting application access. Generate the migration using the repository's
Prisma CLI workflow, then review and adapt its SQL; do not hand-create migration
directories or modify already applied migrations.

Update `apps/core/prisma/schema.prisma` and
`apps/core/scripts/provision-role.sql`, including the new tables in DML grants
and ownership checks. Keep `core_app` without ownership or `BYPASSRLS`.
Add the composite image reference key to the existing Image model as needed.

Reuse `withTenantIsolation` with the session-derived company and
`withinTransaction` for atomic writes, as described in `docs/rls-con-prisma.md`.
Do not add product-specific branches to the shared isolation mechanism.

## Test Cases

This section describes scenarios and expected outcomes only. It does not contain
executable tests or test implementation. Follow the repository testing conventions
and verify each behavior at the layer that owns it, without repeating all input
combinations through the browser.

### Unit Tests

Domain rules, application operations with controlled dependencies, and input
parsing are checked without a database, web server, or remote image provider.

| ID | Scenario | Expected outcome |
| --- | --- | --- |
| U01 | Create a valid product with one variant, omitting SKU, description, image, purchase price, and initial stock. | Creation succeeds; optional data remains absent, initial stock is zero, and product and variant are active. |
| U02 | Create a product with several distinct variants and different initial stocks. | All variants belong to the product, each has its own stock record, and every price uses the supplied product currency. |
| U03 | Submit an empty variants array. | Validation fails with a variants issue and no persistence effects. |
| U04 | Submit prices at and outside their boundaries: sale zero/negative, purchase zero/negative, maximum 999,999,999.99, above maximum, and more than two decimals. | Zero purchase price and the maximum are accepted; invalid sale prices, negative purchase prices, excessive amounts, and excessive precision are rejected without rounding. |
| U05 | Supply non-finite amounts or a price whose currency differs from the product's. | Validation rejects the value and identifies the affected variant and price field. |
| U06 | Submit zero, positive whole, negative, fractional, or unsafe integer stock quantities. | Zero and representable nonnegative whole quantities are accepted; invalid quantities are rejected. Omitted initial stock defaults to zero. |
| U07 | Submit an empty/whitespace name and texts at or above the limits of 200, 100, and 5,000 characters for name, SKU, and description. Include Unicode characters outside the basic multilingual plane. | Required-name and length rules are enforced using character counts consistent with the database. Optional blank creation SKU becomes absent. |
| U08 | Create two variants with SKUs differing only by case or surrounding spaces, and compare this with multiple absent SKUs. | Duplicate supplied SKUs are rejected; absent SKUs are allowed on variants with distinct attributes. |
| U09 | Repeat an attribute combination using different key order, letter case, or surrounding spaces; also repeat the empty combination. | Equivalent combinations are rejected, including two variants with empty attributes. |
| U10 | Supply colliding normalized attribute names, empty names/values, or invalid attribute value types. | Invalid attributes are rejected without silently overwriting values; malformed input is handled by the input boundary. |
| U11 | Supply supported and unsupported currency codes and use each supported country in the frontend currency mapping. | Supported codes are accepted, unsupported codes fail, and each country maps to its agreed currency. |
| U12 | Submit several invalid product and variant fields at once. | All safely detectable validation issues are returned with typed reasons and required parameters; variant indices refer to the submitted array. |
| U13 | Create with controlled identifier and clock dependencies. | The constructed product contains the supplied distinct IDs and QR identifiers; createdAt and updatedAt represent the same clock instant, without mutating input values. |
| U14 | Update optional fields using omission/undefined, null, and concrete values. | Omission preserves, null clears, and a value replaces; required fields cannot be cleared with null. Loaded product, patch, and nested values remain unchanged. |
| U15 | Update one of several variants by ID while omitting the rest. | Only the supplied fields of that variant change; other variants and stock, currency, attributes, and QR values are preserved. |
| U16 | Submit repeated variant IDs or IDs not belonging to the target product/company. | The entire update is rejected before writes; no variant is selected implicitly. |
| U17 | Update a missing product. | Update returns PRODUCT_NOT_FOUND; it does not return success merely because the patch is empty. |
| U18 | Submit an empty patch, unchanged normalized values, or removal of an already absent optional value. | The validated request returns the product ID without persistence or a changed updatedAt. Invalid fields/references are still rejected. |
| U19 | Perform a real edit using a controlled clock. | A new changes object carries the new updatedAt; createdAt is preserved and previous objects are not mutated. |
| U20 | Associate an existing company image, an absent image, or an image belonging to another company. | Only an available image owned by the company can be associated; other cases return IMAGE_NOT_FOUND without writes. |
| U21 | Query a missing product, a product without a photo, and a product with a photo. | Results are successful null, detail without image, and detail with resolved image respectively. Missing referenced image returns DetailError; technical failures are not disguised as absence. |
| U22 | Normalize listing criteria with omitted values, whitespace search, invalid pages, and invalid page sizes. | Defaults are page 1 and size 20; empty search is omitted; invalid explicit pagination yields ListError. A new readonly criteria value is produced without changing the input. |
| U23 | Parse valid JSON updates containing omitted values and explicit nulls. | The parser preserves patch semantics and variant order; it does not supply creation defaults to an update. |
| U24 | Parse malformed JSON, incorrect object/array/field shapes, unknown properties, and non-editable fields at product and variant levels. | InputError is returned before the use case runs. Arbitrary valid attribute names remain allowed inside the creation attributes record. |
| U25 | Render validation reasons with their parameters and business error codes. | Presentation chooses the appropriate Spanish message without comparing technical message strings; product, listing, detail, and parsing error contracts remain distinct. |

### Type Contract Checks

These are compile-time checks accompanying the unit-level verification, not
substitutes for runtime validation:

- Product, variant, company, and image identifiers cannot be interchanged.
- Product and creation input require a nonempty variants tuple.
- Entities, patches, collections, and nested values expose readonly contracts.
- Only nullable editable fields permit null; immutable entity fields are absent
  from update input.
- Each case of a reason union requires its own parameters, such as maxLength for
  TOO_LONG.
- Creation cannot return PRODUCT_NOT_FOUND; listing cannot return product-field
  issues; detail cannot return duplicate-SKU errors.

### Integration Tests

Exercise persistence and server composition against an isolated database using
the application role. These cases verify real constraints, mappings, queries,
and rollback; simulated repositories are not evidence of those guarantees.

| ID | Scenario | Expected outcome |
| --- | --- | --- |
| I01 | Apply the migration and application-role provisioning to a test database containing the existing core schema. | The three models and their relations exist, existing company/image data remains valid, RLS is enabled and forced, and the application role receives the intended permissions without ownership or bypass privileges. |
| I02 | Persist and reload a product with several variants, prices, attributes, optional fields, and stock. | The complete aggregate is preserved, with exact prices, supplied IDs/QRs/timestamps, correct relations, and nullable columns mapped to optional domain properties. |
| I03 | Trigger a constraint failure while creating a later variant or stock record. | The entire creation rolls back: no product, earlier variant, or stock record remains. |
| I04 | Fail a later write during an update affecting product data and several variants. | Every change, including updatedAt, rolls back; the original persisted state remains intact. |
| I05 | Store duplicate company SKUs with case/space normalization, multiple absent SKUs, and the same SKU in another company. | Normalized duplicates within one company fail with DUPLICATE_SKU; absent values and cross-company reuse are accepted. Editing one's own unchanged SKU remains valid. |
| I06 | Use company A to query, update, list, or count products owned by company B. | No B data is returned or modified. Reads/updates expose the same absence semantics as an unknown ID; list totals do not disclose B's records. |
| I07 | Attempt cross-company product/image, variant/product, and stock/variant associations. | Tenant-aware relationships reject them, with no partially persisted changes. |
| I08 | Access product persistence without an authorized company context. | No unscoped operation succeeds. Reuse the existing generic isolation coverage for policy mechanics rather than duplicating a suite for each table. |
| I09 | Save optional values, omit them in a subsequent patch, then clear them explicitly. | Omission preserves values; null clears them; reads expose absent optional properties. Zero purchase price is retained as a value. |
| I10 | Persist prices with nontrivial decimal values and the maximum, then read them back. | Mapping preserves the exact agreed monetary values and currency. Application writes reject excess scale/range before storage rather than relying on database rounding. |
| I11 | Exercise database constraints with invalid negative stock, fractional stock through the application boundary, invalid prices, and oversized texts. | Application validation rejects unsupported inputs; corresponding storage constraints protect values that the schema is responsible for. No rejected write is reported as successful. |
| I12 | Search by partial product name or any variant SKU with mixed case; make several variants of one product match. | Each matching product appears once. Price and stock summaries include all its variants, not just the matching ones. |
| I13 | List single-variant and multi-variant products with equal and differing prices and varied stocks. | Summaries supply variant count, single-variant SKU where applicable, minimum price, the different-prices flag, and total stock. |
| I14 | Paginate several matching products, including equal creation timestamps and an empty result. | Ordering has a deterministic ID tie-breaker; pages and totals apply the same search and company scope. An empty list returns zero matches when no product qualifies. No shared-snapshot guarantee is assumed. |
| I15 | Reload a product after an effective edit and after an empty/no-change edit. | Effective edits persist the supplied updatedAt and preserve createdAt, stock, currency, and QR. No-change edits leave the stored state and timestamp intact. |
| I16 | Exercise connected web actions with session-derived company context, including attempted client-supplied company identity. | Composition supplies the concrete capabilities correctly; the server derives company identity from the session and rejects unsupported payload fields. |
| I17 | Cause an unexpected database or image-resolution failure. | The error reaches the server boundary for diagnosis and a safe response; it is not transformed into an empty list, missing product, duplicate SKU, or successful save. |

### End-to-End Tests

Verify complete browser journeys against the running core web application and
an isolated database. Use a controlled image-storage boundary where needed;
these journeys verify the product/image flow, not live provider availability.

| ID | Scenario | Expected outcome |
| --- | --- | --- |
| E01 | Sign in and navigate from the dashboard to Products, creation, detail, and editing. | Product routes remain accessible under the company's locale, the active navigation is correct, and the private layout does not redirect them to the dashboard. |
| E02 | Create with only name and sale price. | The frontend submits the country's currency and one variant with empty attributes; save opens detail with stock zero and absent optional data. The product appears in the list. |
| E03 | Create with description, SKU, purchase price, initial stock, and an uploaded photo. | Preview appears after upload, saving associates the image, and detail displays the saved values. The list shows its agreed columns without a photo. |
| E04 | Submit several invalid fields, then correct them. | All applicable field messages appear together; entered values are preserved after rejection. Correcting them permits a successful save without a partially created product from the failed attempt. |
| E05 | Create or edit with a SKU already used by the same company. | The SKU field shows the duplicate message; the user can correct it and save. Existing products retain their previous values after the failed attempt. |
| E06 | Search by name and by variant SKU, navigate numbered pages, and perform a search with no matches. | The table displays matching products once, shows the total, supports pagination, and distinguishes no matches from a load failure. |
| E07 | Open detail for a product prepared with multiple variants. | All variants display their attributes, SKU, prices, and stock. The list shows Varias variantes, Desde only when prices differ, and summed stock. |
| E08 | Edit a single-variant product's name, description, SKU, and prices, including explicit removal of optional values. | Save opens the updated detail. Cleared values are absent, omitted values remain, and stock, currency, QR, and createdAt do not change. |
| E09 | Open editing for a product prepared with several variants. | General product fields can be edited; variant SKU and price editing is unavailable. Saving general changes preserves every variant. |
| E10 | Replace a photo and then remove its association. | Replacement displays the new image; removal leaves detail without a photo. No implicit deletion of stored image files is expected. |
| E11 | Make photo upload fail, and separately cancel after a successful upload. | A failed upload retains the form and permits retry without saving a broken reference. Cancel does not create or edit a product; an unassociated uploaded image is acceptable under the agreed scope. |
| E12 | Open a product URL belonging to another company and attempt a manipulated write using another company's product, variant, or image identifier. | No foreign data is disclosed or changed; unauthorized associations and target changes are rejected by the server. |
| E13 | Access product screens or submit their actions without an authenticated session. | Access is denied through the existing authentication flow and no product write occurs. |
| E14 | Manipulate an edit request to include stock, currency, QR, timestamps, or unknown fields. | The input boundary rejects the request and stored data remains unchanged, regardless of which controls the UI exposes. |
| E15 | Save an unchanged product and inspect it again. | The operation succeeds without changing persisted values or updatedAt. |
| E16 | Encounter a load/save failure, then retry. | The UI does not show success or an empty catalogue for a technical failure; a failed save preserves input and does not navigate to success. |
| E17 | Use the list and forms with keyboard navigation and at a narrow viewport. | Controls remain reachable with visible focus, field errors are associated with inputs, and the table remains usable through horizontal scrolling where needed. |

### Scope and Completion

Do not add tests requiring snapshot consistency, concurrent-edit conflict
resolution, category management, inventory adjustments, deletion/archiving,
mobile endpoints, or a multiple-variant form: those capabilities are excluded.
Multiple-variant data is still necessary to verify the application contracts,
listing summaries, detail, and the initial edit-screen restriction.

Completion requires successful relevant type checks and unit, integration, and
browser checks, plus the existing lint checks. Shared currency changes also
require verification of existing Money consumers. Execute database and migration
checks only with disposable development/test data. Report unavailable checks
explicitly instead of treating them as passed.

## Implementation Work

1. **Migration and persistence:** add Product, ProductVariant, and ProductStock
   with company isolation, their relationships, price/quantity constraints, and
   optional SKU uniqueness per company. Generate the migration through the
   repository's Prisma migration workflow. Save product, variant, and stock
   atomically using the existing transaction mechanism.
2. **Types and validation:** define creation, editing, detail, and listing
   contracts in the core products feature. Reuse shared Money and Result types.
   Enforce the rules above on the server and derive company identity from the
   authenticated session.
3. **Web operations:** implement creation, listing, detail, and editing through
   server loaders/actions. Associate images through the existing image module,
   verifying company ownership. Editing must preserve stock, currency, and QR.
4. **Screens and navigation:** add the product list, detail, and shared form;
   connect them to private navigation. Adapt the existing dashboard redirect so
   product routes remain accessible within the company's locale.
5. **Verification:** check creation and rollback, optional/duplicate SKUs,
   prices, initial stock, company isolation, and immutable fields on editing.
   Verify the create → list/search → detail → edit flow, image replacement and
   removal, and run the relevant existing core checks.
