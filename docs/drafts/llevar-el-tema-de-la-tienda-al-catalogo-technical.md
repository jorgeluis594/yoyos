# Store theme in the public catalog: technical design

**Status:** design closed, pending implementation. The questions were answered by the architecture review gate in round 1, see §17. Round 2 resolves the gate's blockers and suggestions. Based on `docs/drafts/llevar-el-tema-de-la-tienda-al-catalogo.md` (product definition closed at `e29afdfa`; rows 19 and 20 of its gate table were corrected by this gate). Base: branch `jorgeluis594/llevar-el-tema-de-la-tienda-al-catalogo`. Todoist 6hpwfg8pfvjxq9jV.

## 1. Technical goal

Every buyer page of a published catalog renders the company's stored theme and logo. It uses the same values, scoping and fixed color scheme as the checkout.

The checkout appearance becomes the store appearance: one core module and one shared contract. It is read and saved from two places:
- the web editor, through its React Router loader and action;
- a new mobile screen, through the new `GET`/`PUT /api/store-appearance`.

The web editor gains the publication card and a catalog view in its preview. Publication keeps its current API and moves out of Settings → Catálogo on both platforms. No table, column or stored value changes.

```text
                       shared/store-themes.ts (five theme definitions, single source)
                       shared/contracts/store-appearance.ts (mobile ⇄ core JSON)
                       shared/contracts/images.ts imageUploadLimits (server, web, mobile)
                                   │
 apps/core  features/store-appearance ──getPublic──▶ checkout route (unchanged behavior)
            │   get / save / getPreview             └▶ catalog routes (header, grid, product, cart)
            │                                           via catalogBrowse.storeAppearance
            ├── web editor route (loader/action) ── catalogSettings (publication card)
            │        ├─ preview iframe: surface "catalog" | "checkout"   (app/components/store-preview/)
            │        └─ catalog-cards resource route ◀── catalogBrowse.previewCards
            └── api-routes: GET/PUT /api/store-appearance ◀── apps/mobile features/store-appearance
                                                            + POST /api/images (logo, existing)
                                                            + GET/PUT /api/catalog/settings (existing)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Module name | Core `src/features/checkout-appearance/` becomes `src/features/store-appearance/`. Operations, types, components, CSS hooks, log events and E2E files take the store name (§12). `index.ts` is removed: importers use `composition.ts` and the files that define each type. |
| Stored data | Table `CompanyCheckoutAppearance`, enum `CheckoutTheme`, the RLS policy and the Prisma model keep their names. No migration, no data touched. |
| Theme values | `checkout-themes.ts` moves unchanged to `shared/store-themes.ts`, the single source consumed by core (CSS variables) and mobile (static samples). It imports nothing but types. |
| Theme value tests | The contrast, completeness and font tests stay in core as `apps/core/src/features/store-appearance/domain/store-themes.test.ts`, importing `@shared/store-themes`. Reason: mobile's `tsconfig.json` type-checks `../../shared/**/*.ts` with Jest types only, so a Vitest file under `shared/` breaks the mobile typecheck. |
| Image limits | `shared/contracts/images.ts` exports `imageUploadLimits = { maxBytes: 10_000_000, maxSide: 8000, maxPixels: 24_000_000 }`. Core image validation, the web editor pre-check and the mobile logo pre-check all read it, so no client checks a different number than the server. |
| Theme mechanism in the catalog | The catalog wraps its pages in the same `StoreTheme` scope the checkout uses: scoped CSS variables, the `html:has(scope)` background, and fonts imported by the component. It marks its elements with new `data-store-part` hooks. There is no second theming mechanism. |
| Fixed color scheme in the catalog | `handle.colorScheme` returns `"fixed"` when the loader resolved a published store: the catalog page, and the product page including «Este producto ya no está disponible». It returns `"system"` otherwise: «Catálogo no disponible» and the full-page load error. |
| Product no longer available | `getCatalogProduct` returns a discriminated success inside the published store it already read: `{ kind: "found"; storeName; product }` or `{ kind: "unavailable"; storeName }`. The loader returns the unavailable case as data with status 404, so the page keeps the store name, theme and fixed scheme. «Catálogo no disponible» and the load error stay in the `ErrorBoundary`, unthemed. |
| Buyer fallback | The rule is unchanged and now shared by both surfaces. No saved appearance → Clásico without logo. Unknown stored theme, invalid row or read failure → Clásico without logo, logged, never hiding the page. |
| Stored logo that cannot be resolved | Today's behavior is kept on every surface. Buyers see the stored theme without logo. The editor on web and mobile loads with that theme and «Sin logo», and keeps the stored `logoImageId` on save until the seller uploads a new logo. The contract carries the id with `url: null` so mobile cannot erase it. |
| Seller read | `getStoreAppearance` returns either a readable appearance or an unknown stored theme (`{ kind: "readable" } \| { kind: "unknown_theme" }`). Any other unusable row stays an error, which the editor shows as its load error. |
| Preview read | `getStorePreview` never fails because of the appearance or the payment methods. It does not read the appearance at all, since the iframe paints only the draft the editor sends. A failed payment-methods read gives `paymentMethods: null`, which shows labeled examples. Only a failed company-name read fails the route. |
| Mobile API | New `GET /api/store-appearance` and `PUT /api/store-appearance`, behind the existing `/api` bearer-or-cookie access and `requireApiCompany`. `/api/store-appearance` joins `isFeatureRequest` in `src/app.ts`, so malformed JSON answers `400 INVALID_INPUT`. Logo upload reuses `POST /api/images` unchanged. Publication reuses `GET`/`PUT /api/catalog/settings` unchanged. |
| Shared contract | `shared/contracts/store-appearance.ts` holds the response and the save body. Errors use the existing `{ code, error }` envelope. |
| Save response | The save use case resolves the logo with `resolvePublicImage` before writing. That call is both the availability check and the source of the URL, so the response needs no read after the commit, and a save that committed is never reported as failed. |
| Web editor transport | The editor stays on its React Router loader and action; it does not fetch the new API. The loader starts the appearance part and the publication part together (`Promise.all`); they fail independently. The action takes a discriminated JSON body (`save-appearance` \| `set-publication`). After a successful `set-publication`, `shouldRevalidate` returns false and the card trusts its own action result. |
| Web Settings → Catálogo | It keeps its loader; its action and switch are removed. On web, publication is saved only through the editor action. |
| Old editor URL | `settings/checkout-appearance` and `:locale/settings/checkout-appearance` redirect with 308 to the same prefix plus `settings/store-appearance`, keeping the query. The old preview path is removed without a redirect, because only the editor embeds it. |
| Catalog preview data | The editor fetches up to three catalog cards of the seller's company once per visit, from a resource route (`settings/store-appearance/catalog-cards`) with `useFetcher().load` on mount. The read skips the publication check. A failure or an empty list shows sample products. The cards are not part of the editor loader, so revalidating after a save never refetches them or shows the placeholders again. |
| Preview iframe | One iframe and one preview route (`settings/store-appearance/preview`) render both surfaces, and the message gains `surface` and `catalog`. Switching surface does not reload the iframe, so the device choice and the draft stay. The protocol, its schema and the frame live in `apps/core/app/components/store-preview/`, the app layer that composes catalog and store-appearance. |
| Mobile publication card | Extracted from the mobile catalog settings screen into `features/catalog/presentation/catalog-publication-card.tsx`. The route file `app/(tabs)/settings/appearance.tsx` composes it into the store appearance screen through a slot prop. Web does the same: `app/components/catalog-publication-card.tsx` is composed by the editor route. |
| Mobile logo files | PNG, JPEG and WEBP are uploaded byte for byte with their own MIME type, after a pre-check against `imageUploadLimits`. HEIC/HEIF and camera photos go through the JPEG fitter product photos use today, extracted to `apps/mobile/src/shared/infrastructure/jpeg-fitting.ts`. The fitter now takes its bounds as a parameter: logos use `logoJpegBounds = { maxSide: 1024 }` (initial value, adjustable), product photos keep theirs. The picker options for logos are fixed in §10. |
| Web dimension rejection | The web editor pre-checks `imageUploadLimits.maxBytes`, so a `413 IMAGE_TOO_LARGE` from `POST /api/images` can only mean dimensions. It shows the product's dimensions text. |
| «Agotado» badge | The badge uses an opaque `--warning-surface` with `--warning` text instead of today's translucent background over the photo, so its contrast can be computed per theme. |
| Theme CSS on buyer pages | `StoreTheme` generates the active theme's CSS on the client from `shared/store-themes.ts`, as the checkout does today. That adds every theme's values and the generator to the catalog bundle, a few KB gzipped. This cost is accepted, because the editor preview needs the same client-side generation for drafts and one mechanism serves all surfaces. |
| Logs | Every checkout appearance event and operation is renamed to the store name (§13). There is no production, so renaming loses no search. |
| Docs and memory | On merge, T6 moves the new rules into `docs/public-catalog.md` and `docs/checkout.md#appearance`, deletes both drafts, and reconciles the superseded memories. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Appearance domain: `CheckoutAppearance { logoImageId, theme }`, `parseCheckoutAppearance` (strict object, theme checked against the enum), `defaultCheckoutAppearance`, branded ids | `apps/core/src/features/checkout-appearance/domain/checkout-appearance.ts` | Reused, renamed |
| Theme definitions `checkoutThemeIds` and `checkoutThemes: Record<id, CheckoutThemeDefinition>` (42 color tokens, about 73 style tokens, fonts, logo plate, thumbnail), plus the contrast test | `…/domain/checkout-themes.ts`, `checkout-themes.test.ts` | Values move to `shared/`; the test stays in core |
| Use cases: `getCheckoutAppearance`, `saveCheckoutAppearance` (parse, then `imageAvailable`, then save), `getPublicCheckoutAppearance` (`default \| custom \| fallback`), `getCheckoutAppearancePreview` (fails on any appearance or payment-methods read error) | `…/application/checkout-appearance.ts` | Seller read, save and preview change |
| Composition `checkoutAppearance.{get, save, getPublic, getPreview}`. `save` logs `checkout_appearance_saved`. `index.ts` re-exports it | `…/composition.ts`, `index.ts` | Renamed to `storeAppearance`; `index.ts` removed |
| Repository: `loadCheckoutAppearance` (logs `invalid_stored_checkout_appearance` with `invalidFields` and returns `INVALID_STORED_DATA`; logs `unable_to_load_checkout_appearance` with `operation: "get_checkout"`), `persistCheckoutAppearance` (upsert; P2003 becomes `INVALID_IMAGE`; logs `unable_to_save_checkout_appearance`), `loadCompanyName` | `…/infrastructure/checkout-appearance-repository.ts` | Distinguishes unknown theme; events renamed |
| `findAvailablePublicImage` returns only the id. `resolvePublicImage` returns `{ id, url } \| null` | `apps/core/src/shared/images/index.ts` | The save switches to `resolvePublicImage` |
| Image limits `maxBytes = 10_000_000`, 8000 px, 24 MP | `apps/core/src/shared/images/application/images.ts`, `presentation/routes.ts` | Read from `imageUploadLimits` |
| Table `CompanyCheckoutAppearance`: `companyId` PK; `logoImageId` with a composite FK to `Image(companyId,id)` and `Restrict`; `theme CheckoutTheme`. RLS policy `company_checkout_appearance_isolation` | `apps/core/prisma/schema.prisma:291` | Unchanged |
| `CheckoutTheme` component (scope via `useId`; `<style>` from `checkoutThemeCss`; `data-checkout-theme`; `.dark` for Noche), `checkout-theme.css` (shadcn `data-slot` plus a closed `data-checkout-part` list), `checkout-theme-fonts.css` | `…/presentation/` | Renamed, extended with catalog parts |
| `CheckoutBrandHeader`, `ProductThumbnail` (both read `--checkout-logo-*` and `--checkout-thumb-*`) | `…/presentation/` | Reused by the catalog header and cart lines |
| Color scheme handle: `colorSchemeOf`, `applyColorPreference`. The checkout sets `"fixed"` when the order loaded | `apps/core/app/color-scheme.ts`, `app/root.tsx`, `app/routes/checkout.tsx` | Reused as is |
| Web editor: loader (throws 503 on any failure; an unresolved logo gives `logoUrl: null` and keeps `logoImageId`; «Sin logo» with **Subir logo** and no **Quitar logo**); JSON action answering 422 or 503; `clientAction` for lost saves; byte pre-check `10 * 1024 * 1024`; `EditorDraft` initialized once from the loader; `useBlocker`; `ThemePicker`; **Reintentar** reloads the page | `apps/core/app/routes/checkout-appearance-settings.tsx`, `…/presentation/editor-draft.ts` | Modified (T0, T3, T5) |
| Preview: route (`handle.colorScheme: "fixed"`, `no-store`, reads appearance, company name and payment methods), `postMessage` protocol and schema, frame, sample fixtures | `app/routes/checkout-appearance-preview.tsx`, `…/presentation/preview-protocol.ts`, `checkout-appearance-schemas.ts`, `checkout-preview-frame.tsx`, `checkout-preview-page.tsx`, `preview-fixtures.ts` | Renamed (T0); moved and extended (T5) |
| Routes `settings/checkout-appearance` and its `/preview`, plain and `:locale` | `apps/core/app/routes.ts:16,28,39,51` | Renamed, plus a redirect |
| Request-route patterns for the editor and preview; `OperationContext` | `apps/core/src/shared/infrastructure/logger.ts:6,58-61` | Renamed |
| `/api` JSON error handler: `isFeatureRequest` list, otherwise `INVALID_COMPANY` | `apps/core/src/app.ts:109-111` | T1 adds the new path |
| Catalog pages: `catalog.tsx`, `catalog-product.tsx` (an unavailable product is thrown as a 404 with data `"product"`), `catalog-cart.tsx` (resource route) | `apps/core/app/routes/` | Themed (T2) |
| `CatalogShell` (global tokens, uses `CheckoutBrandHeader`), `CatalogProductImage`, `CatalogMessage`, `CatalogLoadError` | `apps/core/app/components/catalog-sections.tsx` | Themed (T2) |
| `CatalogCartButton`, with its sheet portalled into a host inside the shell; thumbnails are raw `<img class="size-16 rounded-md">` | `apps/core/app/components/catalog-cart.tsx` | Themed (T2) |
| `catalogBrowse.{browse, getProduct, appearance}`. `appearance` returns only the logo URL and logs `unable_to_read_catalog` with `read_appearance` | `apps/core/src/features/catalog/browse-composition.ts` | Returns the whole public appearance |
| `browseCatalog`; `getCatalogProduct` (returns `PRODUCT_UNAVAILABLE` as an error without the store name); `readStore` (null when hidden); `products.listForCatalog`, returning `CatalogCard {id,name,imageUrl,price,soldOut}` | `src/features/catalog/application/browse-catalog.ts`, `infrastructure/catalog-store-repository.ts`, `src/features/products/composition.ts:175` | `getCatalogProduct` changes; preview read added |
| `catalogSettings.{get, setPublication}`; `GET`/`PUT /api/catalog/settings` | `src/features/catalog/composition.ts`, `presentation/api-routes.ts` | Unchanged |
| Web Settings → Catálogo: switch, hide confirmation, link, copy, view | `apps/core/app/routes/catalog-settings.tsx` | Switch removed |
| Panel navigation item `nav.checkoutAppearance`, `appearancePath` | `apps/core/app/routes/private-layout.tsx:58,127` | Renamed |
| Web texts: `const es` and `const pt` in one file, with no key-parity test (`locales.test.ts` covers authentication only) | `apps/core/app/locales.ts`, `locales.test.ts` | New keys plus a parity test |
| `/api` access (`loadApiAccess`, `requireApiCompany`) and the image API `POST /api/images` | `apps/core/src/app.ts`, `src/shared/images/` | Reused |
| Contracts `catalog.ts` (`catalogSettingsSchema`, `setCatalogPublicationSchema`) and `images.ts` (`imageResponseSchema`). No appearance contract exists | `shared/contracts/` | New `store-appearance.ts`; `imageUploadLimits` added |
| Mobile tsconfig includes `../../shared/**/*.ts` with Jest types | `apps/mobile/tsconfig.json` | Constrains the location of `shared/` files |
| Mobile catalog settings (switch, confirmation, link, copy, share, view) and `createCatalogSettingsApi` | `apps/mobile/src/features/catalog/` | Switch moves out |
| Mobile settings stack (`index`, `delivery`, `catalog`); `ListRow`, `ScreenState`, `showConfirmation`; the `usePreventRemove` pattern in delivery settings; key-parity test `"Spanish and Portuguese catalogs contain the same keys"` | `apps/mobile/src/app/(tabs)/settings/`, `src/components/ui/`, `src/features/delivery-settings/presentation/use-instant-delivery-settings.ts`, `src/i18n.test.ts` | Reused |
| Mobile `uploadImage(request, uri, mimeType)`. Product photos are picked with `quality: 1` and re-encoded to JPEG by a four-step fitter bounded at 8000 px and 24 MP | `apps/mobile/src/shared/infrastructure/image-api.ts`, `src/features/products/presentation/product-photo.tsx` | Fitter extracted and parameterized |
| E2E: `checkout-appearance.spec.ts`, `-buyer.spec.ts`, `-preview.spec.ts`, their fixtures (`saveCompanyAppearance`, `openEditor`), and `public-catalog.spec.ts` | `apps/core/tests/e2e/` | Renamed and extended |

Verified in the schema: the database enum restricts `theme` to the five ids. An unknown stored theme can therefore only happen if the code's id list and the enum diverge (memory 651a6544). The design still handles it, because the product requires it.

## 4. Gaps this design closes

1. The concept is named «checkout appearance» in code, routes, logs and texts, but it now covers the whole store (§12, T0).
2. Theme values live only in core, so mobile has no source for its samples (§6, T0).
3. Each client checks a different byte limit than the server (§2, T0).
4. The seller read cannot tell an unknown stored theme from other unusable data, and the preview read fails on either (§5.1, §5.6, T0).
5. A logo id with an unresolved URL cannot cross the boundary without being lost (§8, T0).
6. The catalog renders global tokens and reads only the logo. It has no theme scope and no fixed scheme, and the product-unavailable page carries no store data (§5.3, §5.7, T2).
7. Mobile has no API to read or save the appearance (§8, T1).
8. The web editor throws the whole page on a read failure. It has no publication card and no unknown-theme notice, and it lives at the old URL (§5.4, T3).
9. Settings → Catálogo still owns the switch, on web and on mobile (T3, T4).
10. The editor preview shows only the checkout, and there is no read of the seller's first catalog cards that ignores publication (§5.5, T5).
11. Mobile has no store appearance screen, no logo pipeline that keeps transparency, and no theme samples (§10, T4).

## 5. Use cases

### 5.1 `getStoreAppearance` (modified, store-appearance)

- `input`: none. `access`: `{ companyId }` from the seller session or the bearer token.
- `deps`:
  - `load: (companyId) => Promise<Result<StoreAppearance | null, StoreAppearanceFailure>>`
  - `findLogo: (imageId) => Promise<Result<{ url: string } | null, StoreAppearanceFailure>>`, backed by `resolvePublicImage`
- Output: `Result<SellerStoreAppearance, StoreAppearanceFailure>`.
- Errors: `INVALID_STORED_DATA`, `PERSISTENCE_UNAVAILABLE`.
- Flow:
  1. Load the row. If there is none, return `{ kind: "readable", appearance: defaultStoreAppearance, logoUrl: null }`.
  2. If the repository answers `UNKNOWN_STORED_THEME` (only the theme falls outside `storeThemeIds`), return `{ kind: "unknown_theme" }` as success, not as an error.
  3. If the repository answers `INVALID_STORED_DATA` (any other invalid row), return it as an error.
  4. Resolve the logo. A missing image or a failed resolution gives `logoUrl: null`, keeps `appearance.logoImageId`, and logs nothing new: the image module already logs its own technical failures.
  5. Return.

### 5.2 `saveStoreAppearance` (modified)

- `input`: the body, already parsed by presentation into `{ theme, logoImageId }`. `access`: `{ companyId, userId }`.
- `deps`:
  - `save` (unchanged)
  - `findLogo` (as in §5.1), replacing `imageAvailable`
- Output: `Result<{ appearance: StoreAppearance; logoUrl: string | null }, StoreAppearanceFailure>`.
- Errors:
  - `INVALID_STORE_APPEARANCE` (renamed from `INVALID_CHECKOUT_APPEARANCE`; it carries `invalidFields`)
  - `INVALID_IMAGE`
  - `PERSISTENCE_UNAVAILABLE`
- Flow:
  1. Parse.
  2. If there is a logo, call `findLogo`. `null` gives `INVALID_IMAGE`; a technical failure gives `PERSISTENCE_UNAVAILABLE` before anything is written.
  3. Upsert.
  4. Log `store_appearance_saved` after the write.
  5. Return the saved appearance with the URL from step 2.

  Saving over an unknown-theme row replaces it like any other save. A body that keeps the stored `logoImageId` keeps the logo even when its URL did not resolve at load time. If it still does not resolve at save time, the save answers `INVALID_IMAGE`, and the seller uploads a new logo, as with any invalid logo.

### 5.3 `getPublicStoreAppearance` (renamed, unchanged) and its catalog consumer

- The output stays `PublicAppearanceResult = { kind: "default" } | { kind: "custom"; appearance: { logoUrl; theme } } | { kind: "fallback" }`. An unknown theme reaches it as a repository error and resolves to `fallback`. An unresolved logo stays `custom` with `logoUrl: null`.
- `catalogBrowse.appearance` becomes `catalogBrowse.storeAppearance(companyId): Promise<PublicStoreAppearance>`. It always returns `{ logoUrl, theme }`:
  - `default` and `fallback` give `{ logoUrl: null, theme: "classic" }`.
  - `custom` gives its value, re-validated with `publicStoreAppearanceSchema`.

  It keeps logging `unable_to_read_catalog` with `operation: "read_appearance"` and never fails, so the loaders keep reading it in parallel with the products.

### 5.4 Web editor loader, action and retries (presentation, modified)

- The loader starts both parts at once (`Promise.all`) and throws for neither:
  - `appearance: { kind: "readable"; published: StoreAppearance; logoUrl } | { kind: "unknown_theme" } | { kind: "failed" }`
  - `publication: { kind: "loaded"; published: boolean } | { kind: "failed" }`, from `catalogSettings.get`
- The action body is JSON, validated with a presentation schema:
  ```ts
  const editorActionSchema = z.discriminatedUnion("intent", [
    z.strictObject({ intent: z.literal("save-appearance"), appearance: z.unknown() }),
    z.strictObject({ intent: z.literal("set-publication"), published: z.boolean() }),
  ]);
  ```
  - `save-appearance` calls `storeAppearance.save` and answers 422 or 503, as today.
  - `set-publication` calls `catalogSettings.setPublication` and answers 503 on failure.
  - A body without a known intent answers 400.
  - Each result carries its `intent`, so the card and the draft each read only their own result.
  - `clientAction` keeps turning a lost response into a 503 with the same `intent`.
- Revalidation (`shouldRevalidate`):
  - After a failed submission it returns false, which the 503 already does today.
  - After a successful `set-publication` it returns false. The card shows the `published` value from its action result.
  - After a successful `save-appearance` it returns true, so the published baseline refreshes. That re-runs the appearance and publication reads, about 3 queries.
  - The draft is component state initialized once, so no revalidation resets it. The catalog preview cards are fetched separately (§5.5), so they are never refetched.
- **Reintentar**:
  - For the appearance part: `useRevalidator().revalidate()`, which re-reads both parts and leaves the draft as it is. It replaces today's `window.location.reload()`.
  - For a failed publication load: the same revalidation.
  - For a failed publication save: it resubmits `set-publication` with the same value.

### 5.5 `previewCatalogCards` (new, catalog)

Why new: `browseCatalog` rejects a hidden catalog, and the preview must show the look while the catalog is hidden.

```ts
export type PreviewCatalogCardsDependencies = Readonly<{
  readStoreCurrency: (companyId: CompanyId) => Promise<Result<Currency, BrowseCatalogError>>;
  listCatalogProducts: (criteria: CatalogCriteria) => Promise<Result<CatalogPage, BrowseCatalogError>>;
}>;
export async function previewCatalogCards(access: CatalogAccess, deps: PreviewCatalogCardsDependencies):
  Promise<Result<readonly CatalogCard[], BrowseCatalogError>>
```

- `access`: `{ companyId }` from the seller session, through the resource route `settings/store-appearance/catalog-cards` (plain and `:locale`, private middleware, `no-store`), under `withTenantIsolation`.
- Flow:
  1. Read the company currency without checking publication.
  2. List `{ currency, search: null, offset: 0, limit: previewCardCount }`, with `previewCardCount = 3`.
  3. Return the items in catalog order.

  The filters and order match the buyer catalog, because it is the same `listForCatalog`.
- Errors: `PERSISTENCE_UNAVAILABLE`, `ProductReadError`. The resource route answers `200 { kind: "products", cards }` for one to three cards and `200 { kind: "samples" }` for an empty list. Any failure is a 503, which the editor shows as samples.

### 5.6 `getStorePreview` (modified, store-appearance)

- `access`: `{ companyId }` from the seller session.
- `deps`:
  - `companyName: (companyId) => Promise<Result<string, StoreAppearanceFailure>>`
  - `paymentMethods: (companyId) => Promise<Result<PreviewPaymentMethod[] | null, StoreAppearanceFailure>>`
- Output: `Result<{ companyName: string; paymentMethods: PreviewPaymentMethod[] | null }, StoreAppearanceFailure>`.
- Flow:
  1. Read the company name. A failure is the only error, and the preview route answers it with 503.
  2. Read the payment methods. A failure is logged by its adapter and gives `null`, which shows the labeled example methods.
  3. Return.

  The appearance is not read. The iframe renders a neutral blank page until the first draft message, which the editor sends as soon as the iframe says it is ready. The unknown-theme starting point and an unreadable appearance row therefore never break the preview.

### 5.7 `getCatalogProduct` (modified, catalog)

```ts
export type CatalogProductResult =
  | Readonly<{ kind: "found"; storeName: string; product: CatalogProduct }>
  | Readonly<{ kind: "unavailable"; storeName: string }>;
export async function getCatalogProduct(productId: ProductId | null, access: CatalogAccess, deps: GetCatalogProductDependencies):
  Promise<Result<CatalogProductResult, BrowseCatalogError>>
```

- Flow:
  1. Read the published store, once. A hidden catalog or an unknown company gives `CATALOG_UNAVAILABLE`.
  2. A malformed id (`null`), or a product that is not found, gives `{ kind: "unavailable", storeName }` from the store already read.
  3. Otherwise return `found`.
- `PRODUCT_UNAVAILABLE` leaves `BrowseCatalogError`.

### 5.8 Mobile operations (mobile application layer)

- `loadStoreAppearance()` returns `Result<StoreAppearanceState, TransportError>`, from `GET /api/store-appearance`.
- `saveStoreAppearance({ theme, logoImageId })` returns `Result<StoreAppearanceState, SaveStoreAppearanceError>`. The errors are `INVALID_STORE_APPEARANCE`, `INVALID_IMAGE` or transport errors. The `PUT` response becomes the new baseline, with no `GET` after it.
- `uploadStoreLogo(asset)` returns `Result<{ id; url }, LogoUploadError>`. It classifies the asset (§6), converts it when required, and uploads it with `uploadImage(request, uri, mimeType)`.
- Publication keeps `catalogSettings.get` and `setPublished`.

## 6. Domain and typing

| Type | Where | Justification |
| --- | --- | --- |
| `StoreThemeId`, `storeThemeIds`, `StoreThemeDefinition`, `storeThemes`, `defaultStoreTheme` | `shared/store-themes.ts` | The checkout theme types, renamed and moved, because both apps consume them. No value changes. |
| `imageUploadLimits` | `shared/contracts/images.ts` | One limit for the server and both clients, instead of three copies that already disagree. |
| `StoreAppearance { logoImageId: ImageId \| null; theme: StoreThemeId }`, `parseStoreAppearance`, `defaultStoreAppearance` | `store-appearance/domain/store-appearance.ts` | The renamed `CheckoutAppearance`, with the same rules. |
| `SellerStoreAppearance = { kind: "readable"; appearance: StoreAppearance; logoUrl: string \| null } \| { kind: "unknown_theme" }` | `store-appearance/application/store-appearance.ts` | The editor and the API must render the unknown-theme starting point, which an error code cannot carry as success. It replaces `StoreAppearance \| null` and the loader's own logo resolution. |
| `StoreAppearanceFailure`: the domain error, plus `INVALID_IMAGE \| INVALID_STORED_DATA \| UNKNOWN_STORED_THEME \| PERSISTENCE_UNAVAILABLE` | same | `UNKNOWN_STORED_THEME` is a repository data error. The seller read turns it into the union above, and the public read treats it as fallback. |
| `CatalogProductResult` | `catalog/application/browse-catalog.ts` | The themed unavailable page needs the store name the use case already read. A discriminated success replaces the bare `PRODUCT_UNAVAILABLE` error. |
| `PublicStoreAppearance { logoUrl; theme }` | `store-appearance/presentation/store-appearance-schemas.ts` | The renamed `PublicCheckoutAppearance`. |
| `CatalogPreviewCards = { kind: "products"; cards: readonly PreviewCard[] } \| { kind: "samples" }` and `previewCardSchema` (`id`, `name`, `imageUrl`, `price`, `soldOut`) | `apps/core/app/components/store-preview/store-preview-schemas.ts` | The editor and the iframe need to know where the cards came from, for the label, and must never mix the two kinds. It lives at the app layer, so store-appearance never imports catalog. `{ kind: "loading" }` exists only in the message, while the fetch is pending. |
| `StorePreviewMessage { type: "store-appearance:update"; appearance; surface: "catalog" \| "checkout"; state: "review" \| "payment"; catalog: CatalogPreviewCards \| { kind: "loading" } }` | same file | Extends today's preview message. It is validated on both sides. |
| Mobile `LogoAssetDecision = { kind: "upload_as_is"; mimeType: "image/png" \| "image/jpeg" \| "image/webp" } \| { kind: "convert_to_jpeg" } \| { kind: "rejected"; reason: "format" \| "size" \| "dimensions" }` | `apps/mobile/src/features/store-appearance/domain/logo-file.ts` | A pure rule over `{ mimeType, fileName, fileSize, width, height, source: "library" \| "camera" }`, so the screen can show one text per reason. |
| Mobile `StoreAppearanceDraft { theme; logo: { id; url: string \| null } \| null }` and `StoreAppearanceState` (`readable` with the published baseline, or `unknown_theme`) | `apps/mobile/src/features/store-appearance/application/` | Mobile's own model, with core's names. `url: null` keeps an unresolved stored logo. |

| Layer | Types and authority |
| --- | --- |
| shared | Theme ids and values, image limits, the JSON contract. No app imports. |
| core domain and application | Parsing, logo ownership, persistence, fallback. The authority for every rule. |
| core presentation and app layer | Public projection, editor parts, preview message, HTTP status. |
| mobile | Draft, logo file pre-checks (user feedback only), screen state. |

## 7. Persistence

- No schema change and no migration. The Prisma model `CompanyCheckoutAppearance` and the enum `CheckoutTheme` keep their names. Only the repository file is renamed, to `store-appearance-repository.ts`.
- `loadStoreAppearance` parses the row in two steps:
  1. The theme against `storeThemeIds`. A theme outside the list gives `UNKNOWN_STORED_THEME`, logged once as `invalid_stored_store_appearance`.
  2. The whole row. An invalid row gives `INVALID_STORED_DATA`, logged with `invalidFields`.
- New `readStoreCurrency(companyId)` in `catalog/infrastructure/catalog-store-repository.ts`. It returns the currency of the company's country without the publication filter, under RLS. An invalid country gives `INVALID_STORED_DATA`, logged as `unable_to_read_catalog` with `operation: "read_preview_store"`.
- The catalog query plan is inherited: `Product` has only `@@index([companyId])`, so each list reads and sorts the company's products. The preview adds one such query per editor visit, capped at 3 rows returned (§15).

## 8. Contracts between applications

`shared/contracts/store-appearance.ts` (new, version 1):

```ts
import { z } from "zod";
import { storeThemeIds } from "@shared/store-themes";

const httpUrl = z.url({ protocol: /^https?$/ });
export const storeThemeIdSchema = z.enum(storeThemeIds);
// `url` is null when the stored logo exists but cannot be resolved; the id is kept so a save does not erase it.
export const storeLogoSchema = z.strictObject({ id: z.uuid(), url: httpUrl.nullable() });
export const storeAppearanceSchema = z.strictObject({ theme: storeThemeIdSchema, logo: storeLogoSchema.nullable() });
export const storeAppearanceResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("readable"), appearance: storeAppearanceSchema }),
  z.strictObject({ kind: z.literal("unknown_theme") }),
]);
export const saveStoreAppearanceSchema = z.strictObject({ theme: storeThemeIdSchema, logoImageId: z.uuid().nullable() });
export type StoreAppearanceResponse = z.infer<typeof storeAppearanceResponseSchema>;
export type SaveStoreAppearanceBody = z.infer<typeof saveStoreAppearanceSchema>;
```

`shared/contracts/images.ts` adds `export const imageUploadLimits = { maxBytes: 10_000_000, maxSide: 8000, maxPixels: 24_000_000 } as const;`.

| Operation | Request | Success | Errors (`{ code, error }`) |
| --- | --- | --- | --- |
| `GET /api/store-appearance` | — | `200 StoreAppearanceResponse` | `503 INVALID_STORED_DATA` (another kind of unusable row); `503 SERVICE_UNAVAILABLE` |
| `PUT /api/store-appearance` | `SaveStoreAppearanceBody` | `200 { kind: "readable", appearance }` | `415 UNSUPPORTED_MEDIA_TYPE`; `400 INVALID_INPUT` (malformed JSON, through `isFeatureRequest`); `413 PAYLOAD_TOO_LARGE` (body over 100 kB); `400 INVALID_STORE_APPEARANCE` (body against the schema: unknown theme, unknown key, bad id); `422 INVALID_IMAGE` (logo missing or of another company); `503 SERVICE_UNAVAILABLE` |
| `POST /api/images` | unchanged | unchanged | unchanged (`413 IMAGE_TOO_LARGE`, `400 INVALID_IMAGE`) |
| `GET`/`PUT /api/catalog/settings` | unchanged | unchanged | unchanged |

- Core validates the body with `saveStoreAppearanceSchema`, and the response with `storeAppearanceResponseSchema` before sending it. `companyId` and `userId` come only from access. Both responses send `Cache-Control: no-store`.
- Mobile validates every response with the same schemas. An unexpected shape is a transport error, not a default appearance.
- The web editor does not consume this contract; it uses its loader projection. Its draft keeps `logoImageId` on its own, as today. Both clients use the same `storeThemeIdSchema`.

## 9. Events and cross-feature integration

There are no domain events. Cross-feature capabilities:

| Consumer | Capability | Owner |
| --- | --- | --- |
| catalog `browse-composition.ts` | `storeAppearance.getPublic(companyId)` | store-appearance |
| Catalog pages and preview (app) | The `StoreTheme`, `StoreBrandHeader` and `ProductThumbnail` components | store-appearance presentation |
| Web editor route and the catalog-cards resource route (app) | `catalogSettings.get`, `catalogSettings.setPublication`, `catalogBrowse.previewCards` | catalog |
| `app/components/store-preview/` (app) | The preview protocol and its schema, built from store-appearance's `publicStoreAppearanceSchema` and its own `previewCardSchema` | app layer |
| Mobile route `settings/appearance.tsx` | `CatalogPublicationCard` (catalog), composed into `StoreAppearanceScreen` (store-appearance) | route file |

store-appearance never imports catalog, while catalog imports store-appearance's composition and presentation components. Every piece that combines both lives in `apps/core/app/` or in a mobile route file.

## 10. Mobile

| Layer | File | Change |
| --- | --- | --- |
| domain | `src/features/store-appearance/domain/logo-file.ts` | `decideLogoAsset` per §6. The limits come from `imageUploadLimits`. When `mimeType` is missing, the type is taken from the extension of `fileName` or `uri`. |
| domain | `src/features/store-appearance/domain/theme-sample.ts` | Maps a `StoreThemeDefinition` to the sample's numeric styles: background (or the stops of Suave's gradient), card, border, primary and its text, button radius and shape, thumbnail ratio and radius. It parses `px` values and fails on any other unit. It never maps fonts. |
| application | `src/features/store-appearance/application/store-appearance.ts` | The operations of §5.8, with injected API functions, plus the draft comparison (`sameDraft`). |
| infrastructure | `src/features/store-appearance/infrastructure/store-appearance-api.ts` | `get()` and `save(body)` against `/api/store-appearance`, parsed with the shared schemas. Maps `400 INVALID_STORE_APPEARANCE` and `422 INVALID_IMAGE`. |
| infrastructure | `src/features/store-appearance/infrastructure/logo-upload.ts` | Picks with `launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: false, allowsMultipleSelection: false, quality: 1, exif: false, preferredAssetRepresentationMode: UIImagePickerPreferredAssetRepresentationMode.Current })` and `launchCameraAsync({ mediaTypes: ["images"], allowsEditing: false, quality: 1, exif: false })`. Editing is off and the original representation is kept, so iOS hands over the original PNG, WEBP or HEIC instead of a re-encoded file. Reads size and dimensions as product photos do. Converts with `fitJpeg(uri, width, height, logoJpegBounds)` for `convert_to_jpeg`. Uploads with `uploadImage(request, uri, mimeType)`, keeping the original MIME for `upload_as_is`. |
| infrastructure | `src/shared/infrastructure/jpeg-fitting.ts` (new) and `src/features/products/presentation/product-photo.tsx` | The scaling and the four-step quality loop of `preparePhoto` move to `fitJpeg(uri, width, height, bounds: { maxSide; maxPixels?; maxBytes })`. Product photos call it with `{ maxSide: 8000, maxPixels: 24_000_000, maxBytes: 10_000_000 }`, which leaves their behavior unchanged. Logos call it with `logoJpegBounds = { maxSide: 1024, maxBytes: imageUploadLimits.maxBytes }`. |
| presentation | `src/features/store-appearance/presentation/store-appearance-screen.tsx`, `use-store-appearance.ts`, `theme-list.tsx`, `logo-section.tsx`, `save-bar.tsx`, `translations.ts` | The screen of the product draft:<br>• the appearance and the `publication` slot load independently<br>• the unknown-theme notice<br>• «Sin logo» with **Subir logo** for an unresolved stored logo<br>• the save bar above the tab bar<br>• the leave confirmation with `usePreventRemove`, following the delivery settings pattern<br>• a polite live region for «Apariencia actualizada»<br>• a theme list with `accessibilityRole="radiogroup"`<br>• the logo image announced as «Logo de tu tienda»<br>Texts in es and pt-BR. |
| presentation | `src/features/catalog/presentation/catalog-publication-card.tsx` (new), `catalog-settings-screen.tsx`, `translations.ts` | The card is extracted with its own load, switch, confirmation and error, plus «Este cambio se guarda al momento.». Catálogo keeps the link, copy, view and share only while the catalog is published. It adds the notice and **Ir a Apariencia de la tienda**, and re-reads the state with `useFocusEffect`, keeping the last known state meanwhile. |
| composition | `src/features/store-appearance/composition.ts`, `src/i18n.ts` | The `storeAppearance` operations with the shared `request`; translations merged. |
| routes | `src/app/(tabs)/settings/appearance.tsx` (new), `settings/index.tsx` | The new route composes the screen and the card. The menu row sits between delivery and Catálogo. |

| Situation | Decision |
| --- | --- |
| A save gets no response | The draft is kept, and the bar shows the save error with **Reintentar**. Repeating sends the same body, an idempotent upsert. |
| An upload fails | Only the logo section shows the error and **Reintentar**, with the same prepared file. The theme is untouched. |
| The seller leaves with a logo uploaded but not saved | The uploaded image stays orphaned, as on web (images module rule). |
| Account switch | Nothing is cached. The screen reads on mount; after a save it uses the `PUT` response. |
| The stored logo cannot be resolved | The draft keeps `{ id, url: null }`, so a theme-only save sends the same `logoImageId`. |

There is no local SQLite change.

## 11. Transactions and concurrency

1. Save appearance: one upsert by `companyId` under `withTenantIsolation`. The composite foreign key guarantees in the same statement that the logo belongs to the company. There is no lock: the last completed save wins across web and mobile (product rule).
2. Set publication: the same single update as today.
3. Appearance and publication are independent writes. Neither touches the other's column or row.
4. Repeating either request writes the same values, so there are no duplicates to resolve.

## 12. Code organization

**Rename map (T0).**

- Directory: `src/features/checkout-appearance/` becomes `src/features/store-appearance/`, and `index.ts` is deleted.
- Renamed files:
  - `checkout-appearance.ts` → `store-appearance.ts` (domain and application)
  - `checkout-appearance-repository.ts` → `store-appearance-repository.ts`
  - `checkout-appearance-schemas.ts` → `store-appearance-schemas.ts`
  - `checkout-theme.tsx`, `.css`, `-style.ts`, `-fonts.css` → `store-theme.*`
  - `checkout-brand-header.tsx` → `store-brand-header.tsx`
  - `checkout-preview-frame.tsx` → `store-preview-frame.tsx`
  - `domain/checkout-themes.ts` → `shared/store-themes.ts`, with its test becoming `domain/store-themes.test.ts`
- Files that keep their names: `checkout-preview-page.tsx`, `product-thumbnail.tsx`, `theme-picker.tsx`, `theme-sample.tsx`, `editor-draft.ts`, `preview-protocol.ts`, `preview-fixtures.ts`.
- Symbols: `checkoutAppearance` → `storeAppearance`, `CheckoutAppearance*` → `StoreAppearance*`, `checkoutTheme*` → `storeTheme*`, `CheckoutTheme` (the component) → `StoreTheme`, `checkoutThemeCss` → `storeThemeCss`, `getCheckoutAppearancePreview` → `getStorePreview`.
- CSS:
  - `data-checkout-theme(-id)` → `data-store-theme(-id)`
  - `data-checkout-part` → `data-store-part`; checkout part names stay the same (e.g. `total`)
  - variables `--checkout-*` → `--store-*`
  - shadcn color token names are unchanged
- Message types: `checkout-appearance:*` → `store-appearance:*`.
- Logs:
  - `checkout_appearance_saved` → `store_appearance_saved`
  - `invalid_stored_checkout_appearance` → `invalid_stored_store_appearance`
  - `unable_to_load_checkout_appearance` → `unable_to_load_store_appearance`, with `operation: "get_checkout"` → `"get_store_appearance"`
  - `unable_to_save_checkout_appearance` → `unable_to_save_store_appearance`
  - request operations `get_checkout_appearance`, `save_checkout_appearance`, `get_checkout_preview` → `get_store_appearance`, `save_store_appearance`, `get_store_preview`, with `set_catalog_publication` added
  - `OperationContext` fields `checkoutAppearance` and `checkoutTheme` → `storeAppearance` and `storeTheme`
- E2E files: `checkout-appearance*.ts` → `store-appearance*.ts`.
- Not changed in T0: URL paths, texts and locale keys.

**New and modified files after T0**

| File | Task | Change |
| --- | --- | --- |
| `shared/store-themes.ts`, `apps/core/src/features/store-appearance/domain/store-themes.test.ts` | T0 | Moved definitions; the test stays in core (§2). |
| `shared/contracts/store-appearance.ts`, `shared/contracts/images.ts`, `apps/core/src/shared/images/application/images.ts`, `presentation/routes.ts` | T0 | The contract of §8. `imageUploadLimits` replaces core's own constants. |
| `store-appearance/application/store-appearance.ts`, `infrastructure/store-appearance-repository.ts`, `composition.ts` | T0 | The seller read (§5.1), the save with `findLogo` (§5.2), and the preview read (§5.6). |
| `app/routes/checkout-appearance-preview.tsx` (path kept until T3) | T0 | Uses `getStorePreview`, which no longer reads the appearance. It renders blank until the first message. |
| `apps/core/src/shared/infrastructure/logger.ts` | T0 | The renamed operations and fields. T3 updates the request-path patterns. |
| `store-appearance/presentation/api-routes.ts`, `apps/core/src/app.ts` | T1 | `storeAppearanceRoutes()`, mounted at `/api/store-appearance` after `requireApiCompany`. The path joins `isFeatureRequest`. |
| `store-appearance/presentation/store-theme.css`, `store-theme-style.ts` | T2 | Catalog parts:<br>• new: `catalog-search`, `catalog-card`, `catalog-card-photo`, `catalog-sold-out`, `catalog-more`, `catalog-empty`, `catalog-product-photo`, `catalog-quantity`, `cart-button`, `cart-sheet`, `cart-line`, `catalog-notice`<br>• reused: `header`, `header-brand`, `product-name`, `price`, `option`, `status`<br>The card photo is square, has no rounding of its own and uses `filter: var(--store-thumb-filter)`; the card's `overflow: hidden` and `--store-radius-card` clip it. The product photo uses `--store-radius-card` and the card border, with no filter. |
| `app/components/catalog-sections.tsx`, `catalog-cart.tsx`, `app/routes/catalog.tsx`, `catalog-product.tsx`, `src/features/catalog/browse-composition.ts`, `application/browse-catalog.ts` | T2 | `CatalogShell` takes `appearance` and wraps the page in `StoreTheme`. `CatalogProductCard` and `CatalogCartButtonFace({ units })` are exported as presentational components for T5. Cart lines use `ProductThumbnail`. Adds `handle.colorScheme` and `CatalogProductResult` (§5.7), with the unavailable product as 404 data. |
| `app/routes.ts`, `app/routes/store-appearance-settings.tsx` (renamed from `checkout-appearance-settings.tsx`), `store-appearance-preview.tsx` (renamed), `legacy-store-appearance-redirect.ts` (new), `catalog-settings.tsx`, `private-layout.tsx`, `app/components/catalog-publication-card.tsx` (new), `app/locales.ts`, `app/locales.test.ts`, the path patterns in `logger.ts` | T3 | The editor of §5.4 and a key-parity test for `es` and `pt`. |
| `src/features/catalog/application/preview-catalog-cards.ts`, `infrastructure/catalog-store-repository.ts`, `catalog/browse-composition.ts`, `app/routes/store-appearance-catalog-cards.ts` (new resource route), `app/routes.ts` | T5 | §5.5, plus `catalogBrowse.previewCards`. |
| `app/components/store-preview/` (new: `store-preview-schemas.ts`, `preview-protocol.ts`, `store-preview-frame.tsx` moved from store-appearance presentation), `app/components/catalog-preview.tsx` (new), `store-appearance/presentation/preview-fixtures.ts` (three sample catalog cards), `app/routes/store-appearance-settings.tsx`, `store-appearance-preview.tsx`, `app/locales.ts` | T5 | The surface selector, the label and the catalog view. |

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `store_appearance_saved` | info | store-appearance composition, after the upsert | `["companyId", "userId", "theme", "hasLogo", "isDefault"]` |
| `invalid_stored_store_appearance` | error | store-appearance repository | `["companyId", "errorCode", "invalidFields"]` (`errorCode`: `UNKNOWN_STORED_THEME` \| `INVALID_STORED_DATA`; `invalidFields` holds field names only) |
| `unable_to_load_store_appearance` | error | store-appearance repository | `["companyId", "operation", "errorCode", "err"]` (operations `get_store_appearance`, `get_company_name`) |
| `unable_to_save_store_appearance` | error | store-appearance repository | `["companyId", "logoImageId", "errorCode", "err"]` (the fields of today's event) |
| `unable_to_read_catalog` (existing) | error | catalog `browse-composition.ts`, `catalog-store-repository.ts` | `["companyId", "operation", "errorCode", "err"]`. Operations `read_appearance` and `read_store`, plus the new `read_preview_store` |
| `catalog_publication_changed` (existing) | info | catalog composition | unchanged |
| Request operation (`bindRequestOperation`) | — | API routes, editor loader and action, resource route, catalog loaders | `operation`: `get_store_appearance`, `save_store_appearance`, `set_catalog_publication`, `get_store_preview`, `get_catalog_preview_cards`, `browse_catalog`, `get_catalog_product`. `outcome`. The catalog loaders add `storeAppearance` (`default \| custom \| fallback`) and `storeTheme`. |

Never logged: logo URLs, image ids on public routes, store names, product names, request bodies.

## 14. Tests

### Core unit

store-appearance:
- `test("returns the unknown-theme starting point when the stored theme is not one of the five")`
- `test("returns Clásico without logo as a readable appearance when the company never saved one")`
- `test("keeps the stored theme and logo id with no logo url when the logo cannot be resolved")`
- `test("reports other unusable stored data as an error, not as the unknown-theme starting point")`
- `test("the public read falls back to Clásico without logo for an unknown stored theme")`
- `test("saving returns the logo url from the same lookup that checked the logo")`
- `test("saving rejects a logo that no longer resolves with INVALID_IMAGE without writing")`
- `test("the preview read succeeds without reading the appearance")`
- `test("the preview read shows example payment methods when the payment methods read fails")`
- `test("the store appearance contract accepts the unknown-theme response and a logo without url, and rejects a theme outside the five or an unknown key")`
- The moved `store-themes.test.ts`: the existing contrast, token-completeness, opaque-HEX and serif tests, with unchanged titles.

catalog:
- `test("catalog appearance is Clásico without logo when the read fails and the failure is logged")`
- `test("catalog appearance keeps the theme and logo of a custom appearance")`
- `test("a missing product inside a published catalog is unavailable with the store name")`
- `test("a malformed product id inside a published catalog is unavailable with the store name, and inside a hidden one the catalog is unavailable")`
- `test("preview cards list the first three catalog products of a hidden catalog in catalog order")`
- `test("preview cards fail without blocking when the store currency cannot be read")`

Theme style:
- `test("scopes the catalog parts to the store theme subtree")`
- `test("reads only variables that every theme writes, also in catalog parts")`
- `test("hooks only the closed list of store parts")`
- `test("applies the theme photo filter to card photos and cart thumbnails, never to the product page photo")`
- `test("clips the square card photo with the card's rounding in Suave")`
- `test("meets 4.5:1 for the sold-out badge and 3:1 for the catalog search border in every theme")`

Catalog pages:
- `test("the catalog page declares the fixed color scheme when the store loaded and the system scheme when unavailable")`
- `test("the product page shows Este producto ya no está disponible inside the store theme with the store name and status 404")`
- `test("Catálogo no disponible and the catalog load error render without a theme scope")`
- `test("cart lines show the theme thumbnail shape with the product initial when the photo is missing")`

Web editor and Settings → Catálogo:
- `test("editor loader returns the publication state when the appearance read fails")`
- `test("editor loader returns the appearance when the publication read fails")`
- `test("editor action saves the publication without touching the appearance")`
- `test("editor action rejects a body without a known intent with 400")`
- `test("a lost publication save returns a 503 of the set-publication intent")`
- `test("the editor does not revalidate after a successful publication change")`
- `test("redirects the old checkout appearance address to the store appearance editor, plain and localized, keeping the query")`
- `test("the publication card asks before hiding, never shows Cambios sin guardar, and returns to on with No pudimos guardar el cambio when the save fails")`
- `test("the editor offers Guardar cambios without a draft at the unknown-theme starting point and hides Restablecer apariencia")`
- `test("leaving the editor at the unknown-theme starting point without changes asks nothing")`
- `test("Descartar at the unknown-theme starting point returns to Clásico without logo and keeps the notice")`
- `test("an unresolved stored logo shows Sin logo with Subir logo and a theme-only save keeps the logo id")`
- `test("Reintentar after an appearance load failure re-reads without reloading the page and keeps the publication card")`
- `test("Settings → Catálogo shows the link only while published and points to Apariencia de la tienda in both states")`
- `test("a 413 from the image API on web shows the logo dimensions text")`
- `test("web rejects a logo over the shared byte limit before uploading")`
- `test("Spanish and Portuguese panel texts contain the same keys")` (new; `locales.test.ts` has no parity test today)

Preview:
- `test("the preview message rejects mixed sample and real catalog cards")`
- `test("the catalog preview shows three placeholders while cards load, then the real cards")`
- `test("the catalog preview shows samples when the catalog-cards route fails")`
- `test("saving the appearance does not refetch the catalog preview cards")`
- `test("the catalog preview cart button stands for the first product that is not sold out and shows no units when all are")`
- `test("the catalog preview is inert and hidden from screen readers")`
- `test("the preview label reads Tema Boutique · Tus productos with real cards and Datos de ejemplo with samples")`
- `test("the preview page stays blank until the first draft message")`

### Core integration (real database)

- `test("GET store appearance returns the saved theme and logo of the token's company only")`
- `test("GET store appearance returns Clásico without logo for a company that never saved one")`
- `test("PUT store appearance publishes theme and logo together and returns them with the logo url")`
- `test("PUT store appearance rejects a logo of another company with 422 INVALID_IMAGE and keeps the published appearance")`
- `test("PUT store appearance rejects an unknown theme or an unknown key with 400 INVALID_STORE_APPEARANCE")`
- `test("PUT store appearance answers malformed JSON with 400 INVALID_INPUT")`
- `test("store appearance API requires a session or bearer token with an active company")`
- `test("repeating the same PUT leaves one row with the same values")`
- `test("saving the appearance never changes catalog publication and publishing never changes the appearance")`
- `test("preview cards read a hidden catalog's products only for the seller's company")`
- `test("the repository reports an invalid stored row as INVALID_STORED_DATA without returning a default")` (existing title, renamed)
- `test("the image API rejects a file over the shared byte limit with 413")` (existing image test, now reading `imageUploadLimits`)

### Mobile (Jest)

- `test("uploads a PNG from the gallery with its own type and without re-encoding")`
- `test("picks logos without editing and with the original asset representation")`
- `test("converts a HEIC gallery photo and a camera photo to a JPG of at most 1024 px on its longest side")`
- `test("classifies a library asset without mimeType by its file extension")`
- `test("rejects a GIF before uploading with the format message")`
- `test("rejects a 12 MB PNG with the size message and a 9000 px PNG with the dimensions message")`
- `test("disables Guardar cambios while the logo uploads")`
- `test("shows the save bar with Cambios sin guardar after choosing a theme and hides it after saving")`
- `test("uses the saved appearance from the PUT response without reading again")`
- `test("announces Apariencia actualizada after a successful save")`
- `test("keeps the draft and offers Reintentar in the bar when the save fails")`
- `test("asks before leaving the settings stack with unsaved changes and not when switching tabs")`
- `test("starts on Clásico without logo with the notice and only Guardar cambios for an unknown stored theme")`
- `test("keeps an unresolved stored logo id when saving only a theme change")`
- `test("shows the appearance load error and keeps the publication card working")`
- `test("shows the publication load error inside its card and keeps logo and theme working")`
- `test("announces the logo as Logo de tu tienda and shows the logo hint")`
- `test("announces the theme list as Temas de la tienda with each theme's selected state")`
- `test("publication card asks for confirmation before hiding and restores the switch when saving fails")` (moved)
- `test("Catálogo re-reads the publication on focus and never offers Compartir for a hidden catalog")`
- `test("Catálogo opens Apariencia de la tienda from the published and the hidden state")`
- `test("store appearance API maps 400 and 422 to theme and logo errors and rejects an unexpected response shape")`
- `test("theme samples use each theme's colors, button radius and thumbnail shape")`
- `test("theme samples fail on a sampled value that is not in px")`
- The existing `product-photo` tests stay green after the fitter moves, and the existing parity test `"Spanish and Portuguese catalogs contain the same keys"` covers the new mobile keys.

### Web E2E (happy path only)

- `test("seller saves Noche in Apariencia de la tienda and the buyer sees the catalog, product page, cart and checkout in Noche")`
- `test("buyer with a dark system preference sees a Boutique catalog in light mode and downloads only the Boutique font families")`
- `test("seller compares Catálogo and Checkout previews with the same draft and publishes the catalog from the editor")`
- `test("opening the old checkout appearance address lands on Apariencia de la tienda")`
- The existing `store-appearance*.spec.ts` (renamed) and `public-catalog.spec.ts` stay green with the new paths.

### Pending manual checks

- On an iPhone:
  - A transparent PNG logo picked from the gallery shows without a box on the catalog and the checkout.
  - A HEIC photo and a 48 MP camera photo are accepted, and their stored files are at most 1024 px on the longest side.
- On Android:
  - The save bar sits above the tab bar without scrolling.
  - TalkBack reads «Temas de la tienda», «Logo de tu tienda» and «Apariencia actualizada».
- On a phone browser: each of the five themes in the catalog, the product page and the cart.

## 15. Limits and checks during implementation

- **Unknown theme coverage.** The unknown-theme path cannot be reached while the database enum and `storeThemeIds` match. It is covered by unit tests with fakes, not by integration or E2E tests (memory 651a6544).
- **Cart sheet portal.** The cart sheet must keep portalling into the host inside the theme scope. A portal to `body` would lose the theme.
- **Picker MIME type.** `expo-image-picker` must report `mimeType` for HEIC on iOS and for library assets on Android. When it is missing, the extension decides the type. Verify that `preferredAssetRepresentationMode` exists in the installed `expo-image-picker` version.
- **Mobile theme samples.** The theme values that mobile samples are `px` strings today. A non-`px` value must fail the sample test rather than render wrong.
- **Large PNG or WEBP logos.** A PNG or WEBP logo is uploaded as chosen, up to the server limits, so a seller can still upload a heavy file on purpose, from web as today and now from mobile. Buyers download what was stored, because the images module has no derivatives. That is accepted by the product rule that these formats are never altered.
- **Catalog query plan.** The catalog query reads and sorts all of a company's products to return 3 to 25 rows (`Product` has only `@@index([companyId])`), and the preview inherits that. If a large catalog appears, the fix is an index on `(companyId, status, currency, createdAt DESC, id)` created through the migrations skill with `CREATE INDEX CONCURRENTLY`, as its own task.
- **Appearance reads per navigation.** Every catalog navigation (search, «Ver más», list ⇄ product) re-reads the appearance in parallel with the products, the same cost as today. Moving the store and appearance reads into a parent route would remove it, but that changes the catalog route structure and stays out of scope.
- **Font loading.** Theme fonts are discovered from CSS and swap after first paint on slow networks, as in the checkout today. There is no preload; the layout is kept by the fallback stack.
- **Out of scope:**
  - a live preview in mobile
  - `Restablecer apariencia` on mobile
  - recovery of other unusable stored data
  - any table rename
  - a batched payment-image read in the preview

## 16. Implementation plan

### Order and parallelism

```text
Wave 0:  T0 rename + shared themes, limits and contract + seller, save and preview reads
Wave 1:  T1 mobile API (core) ┐
         T2 themed catalog    ├─ parallel, all after T0
         T3 web editor        │
         T4 mobile screen     ┘
Wave 2:  T5 editor catalog preview (after T2 and T3)
Wave 3:  T6 docs, memory and final verification (after all)
```

File ownership inside wave 1:

| Task | Owns |
| --- | --- |
| T1 | `src/app.ts`, `store-appearance/presentation/api-routes*` |
| T2 | `store-theme.css`, `store-theme-style.ts` and their tests; `app/components/catalog-*.tsx` (except the new publication card); `app/routes/catalog*.tsx`; `catalog/browse-composition.ts`; `catalog/application/browse-catalog.ts`; the new `tests/e2e/public-catalog-theme.spec.ts` |
| T3 | `app/routes.ts`; the editor and preview routes; `catalog-settings.tsx`; `private-layout.tsx`; `app/locales.ts` and `locales.test.ts`; `logger.ts`; `app/components/catalog-publication-card.tsx`; `tests/e2e/store-appearance*.ts` |
| T4 | everything under `apps/mobile/` |

T2 reads `tests/e2e/store-appearance-fixtures.ts` but does not edit it.

### T0. Store appearance rename, shared themes, limits and contract, seller reads

**Scope:**
- The rename map of §12 across core: module, symbols, CSS hooks and variables, E2E file names, every log event, operation and field in `logger.ts` and in the repository. `index.ts` is removed.
- `checkout-themes.ts` moves to `shared/store-themes.ts`; its test stays in core.
- `imageUploadLimits` is added and used by core's image validation.
- `shared/contracts/store-appearance.ts` is added.
- The use cases change: the seller read (§5.1), the save with `findLogo` (§5.2), and the preview read (§5.6). The preview route renders blank until the first message.
- The editor loader is adapted minimally, so `unknown_theme` keeps today's load error until T3.

**Out of scope:** URL paths, texts, locale keys, catalog styling, API endpoints, mobile code, Prisma.

**Acceptance criteria:**
1. `grep -rniE "checkout[-_]?appearance|checkout[-_]?theme|data-checkout-|--checkout-" apps/core/src apps/core/app apps/core/tests shared` finds only these:
   - URL paths in `app/routes.ts`, `logger.ts` patterns and E2E specs
   - `companyCheckoutAppearance` in the repository
   - `CheckoutTheme` and `CompanyCheckoutAppearance` in `prisma/`
   - the `checkoutAppearance.*` and `nav.checkoutAppearance` locale keys and their `t(...)` calls
2. `pnpm --dir apps/core typecheck`, `pnpm --dir apps/mobile typecheck`, core unit, integration and E2E all pass. No screen changes visibly: checkout, editor and catalog render as before.
3. A repository fake returning `UNKNOWN_STORED_THEME` makes `getStoreAppearance` return `{ kind: "unknown_theme" }`. A preview read with failing payment methods returns `paymentMethods: null`. `prisma migrate diff` reports no change.
4. `shared/contracts/store-appearance.ts` parses `{ kind: "readable", appearance: { theme: "noche", logo: { id: <uuid>, url: null } } }` and rejects `{ theme: "rojo", logoImageId: null }`.

**Tests:** the store-appearance unit titles of §14, the moved `store-themes.test.ts`, and the image API byte-limit integration title.

**Depends on:** nothing.

### T1. Store appearance API for mobile

**Scope:** `GET`/`PUT /api/store-appearance` per §8, with request operations; `isFeatureRequest` entry; integration tests.

**Out of scope:** the web editor, the mobile client, image API changes.

**Acceptance criteria:**
1. With a mobile bearer token of company A, `PUT { theme: "suave", logoImageId: <A's image> }` returns 200 with the logo URL. `GET` then returns Suave with that logo, and the checkout of an A order shows Suave.
2. `PUT` with B's image id returns 422 `INVALID_IMAGE`. With `theme: "rojo"` or an extra `color` key it returns 400 `INVALID_STORE_APPEARANCE`. With a malformed JSON body it returns 400 `INVALID_INPUT`. In every case the published appearance is unchanged.
3. Without a token the API returns 401; without a company, 403 (the existing `/api` behavior).

**Tests:** every core integration title of §14 about the store appearance API, plus the publication-independence title.

**Depends on:** T0.

### T2. Themed public catalog

**Scope:**
- The catalog pages in the store theme: header, grid, cards, search, «Ver más», the empty and no-results messages, the product page, «Este producto ya no está disponible», and the cart button, sheet, lines and notices.
- `catalogBrowse.storeAppearance`; `CatalogProductResult` (§5.7); the fixed color scheme handles.
- The catalog parts in `store-theme.css`.
- The presentational `CatalogProductCard` and `CatalogCartButtonFace`, exported for T5.
- The buyer E2E.

**Out of scope:** the editor, the preview, texts, layout, cart rules. «Catálogo no disponible» and the load error stay unthemed.

**Acceptance criteria:**
1. A company on Noche: `/catalogo/:id` is dark with a light system preference. Header, cards, product page and cart use Noche values, and the checkout after **Continuar** is Noche.
2. A company on Suave:
   - Card photos are square, clipped by 16 px card corners.
   - The product page photo has 16 px corners and no filter.
   - Cart thumbnails use Suave's round thumbnail with its filter.
3. The appearance read fails: the catalog renders in Clásico without logo and logs `unable_to_read_catalog` with `read_appearance`. The buyer can still add a product and continue.
4. A deactivated product of a Noche catalog shows «Este producto ya no está disponible» in Noche, with the store name in the header and status 404. A hidden catalog shows «Catálogo no disponible», following the system scheme.
5. The theme-style tests pass for every catalog part in the five themes, including the contrast rows for the sold-out badge and the search border.
6. Opening a Boutique catalog downloads the Playfair Display and Inter files and no Fredoka, Nunito or Outfit file.

**Tests:** the catalog, theme-style and catalog-page unit titles of §14, and the first two E2E titles.

**Depends on:** T0.

### T3. «Apariencia de la tienda» web editor and Settings → Catálogo

**Scope:**
- Routes and navigation:
  - new paths `settings/store-appearance` and its preview path, plain and localized
  - a 308 redirect from the old editor path
  - the menu item text and the logger path patterns
- Editor:
  - the loader, action, revalidation and retries of §5.4
  - the appearance and publication parts loading and failing independently, each with its own error and **Reintentar**
  - the publication card (`app/components/catalog-publication-card.tsx`), outside the draft
  - the unknown-theme notice and starting point
  - «Sin logo» for an unresolved stored logo
  - the new logo hint, the pre-check against `imageUploadLimits.maxBytes`, and the dimensions text
- Settings → Catálogo without the switch, with the notice and the link.
- es and pt-BR texts with a key-parity test.
- The renamed editor E2E specs.

**Out of scope:** the «Catálogo | Checkout» selector, the catalog view and the checkout preview label (all T5).

**Acceptance criteria:**
1. `/es-PE/settings/checkout-appearance?x=1` and `/settings/checkout-appearance` answer 308 to the store appearance editor, with the same prefix and query.
2. Turning off **Publicar catálogo** asks «¿Ocultar tu catálogo?» and hides the catalog, without showing «Cambios sin guardar» and without another loader request. With the network down, the switch returns to on with «No pudimos guardar el cambio».
3. With `catalogSettings.get` failing, the editor still edits and saves logo and theme. With the appearance read failing, the card still publishes and hides, and **Reintentar** re-reads without a page reload.
4. With the read returning `unknown_theme`:
   - The editor shows Clásico, no logo and the notice.
   - There is no badge, no **Descartar** and no **Restablecer apariencia**; **Guardar cambios** is enabled.
   - Leaving asks nothing.
   - Saving stores Clásico and removes the notice.
5. Settings → Catálogo:
   - Published: it shows the link, **Copiar link**, **Ver catálogo** and the notice.
   - Hidden: it shows only «Tu catálogo está oculto…».
   - Both states show **Ir a Apariencia de la tienda**.

   With the panel in pt-BR, every new text is in Portuguese.

**Tests:** the editor and Settings → Catálogo unit titles of §14 (including the parity test), the redirect E2E title, and the renamed existing editor specs.

**Depends on:** T0.

### T4. Mobile «Apariencia de la tienda»

**Scope:** everything in §10:
- the store-appearance feature
- the logo picker options, logo decision and upload
- the parameterized JPEG fitter
- theme samples from `@shared/store-themes`
- the save bar and the leave confirmation
- the unknown-theme start and an unresolved logo kept
- independent loading of the appearance and the card
- extraction of the publication card
- the Settings menu row
- Settings → Catálogo, with a re-read on focus
- es and pt-BR texts

**Out of scope:** a live preview, **Restablecer apariencia**, any core change.

**Acceptance criteria:**
1. Uploading a transparent PNG sends `image/png` with the original bytes. Choosing Suave and saving sends `PUT { theme: "suave", logoImageId }`, shows «Apariencia actualizada» under the description, and sends no `GET` afterwards.
2. A GIF, a 12 MB PNG and a 9000 px PNG show their texts without any request. A HEIC and a 48 MP camera photo upload as JPEGs of at most 1024 px on the longest side.
3. With a stored logo whose URL is `null`, changing only the theme and saving sends the same `logoImageId`.
4. Hiding from the new screen asks for confirmation. Going back to Catálogo then shows the hidden state, without the link or **Compartir**.
5. With an unsaved theme, switching to Pedidos and back keeps the draft without asking. Going back out asks **Seguir editando** / **Descartar y salir**.
6. With the device language in pt-BR, every new text is in Portuguese.

**Tests:** every mobile Jest title of §14.

**Depends on:** T0 (contract, themes and limits). Testing end to end on a device needs T1 merged.

### T5. Catalog view in the editor preview

**Scope:**
- Data:
  - `previewCatalogCards` and `readStoreCurrency` (§5.5, §7)
  - `catalogBrowse.previewCards` and the `catalog-cards` resource route
  - the editor's one-time `useFetcher().load` of the cards
- Preview protocol:
  - move the protocol, the schemas and the frame to `app/components/store-preview/`
  - add `surface` and `catalog` to the message
  - make the preview route render both surfaces
- Catalog view (`app/components/catalog-preview.tsx`):
  - header, search, up to three cards and the cart button face
  - inert and `aria-hidden`
  - three sample catalog cards in the fixtures
- Editor UI:
  - the **Catálogo** | **Checkout** selector, opening on Catálogo
  - labels for both views, replacing «Vista previa · Datos de ejemplo»
  - es and pt-BR texts
- The E2E.

**Out of scope:** the real catalog styling (T2) and the editor sections (T3).

**Acceptance criteria:**
1. The cards shown depend on the company:
   - Five visible products: its three newest, with «Tema Clásico · Tus productos», and the cart button «Carrito» with badge «1».
   - Two visible products: those two.
   - No products, or a failed read: three samples, with «Datos de ejemplo».
2. While the cards load, the view shows the draft theme with three placeholders and «Cargando productos». It never shows samples first.
3. Choosing Noche repaints the catalog view at once. Switching to **Checkout** shows Noche and keeps the device choice; switching back keeps the draft. The published catalog stays Clásico. After **Guardar cambios**, the cards are not fetched again.
4. A hidden catalog still shows the catalog view.

**Tests:** the preview unit titles, the preview-card unit and integration titles, and the third E2E title of §14.

**Depends on:** T2, T3.

### T6. Docs, memory and final verification

**Scope:**
- Docs:
  - Rewrite `docs/public-catalog.md`: theme, fixed scheme, the themed product-unavailable page, where publication lives.
  - Rewrite `docs/checkout.md#appearance`: store appearance, editor path, preview selector, mobile editor, API, theme values in `shared/`, logo-size bound for converted mobile logos, unresolved-logo behavior.
  - Delete both drafts.
- Memory, with happy-memory-maintainer:
  - supersede memory ea395f68 (the catalog does not adopt themes)
  - update 7a6e8c5e (no appearance API or mobile screen) and 477d7fc1 (path of the theme values)
  - record the closed decisions of this design
- Run every suite.

**Out of scope:** code changes beyond fixes found by the run.

**Acceptance criteria:**
- The permanent docs follow the documentation skill.
- Memory reflects the merged state.
- All core and mobile suites and both typechecks pass.
- The manual checks of §14 are reported in the pull request.

**Depends on:** T1, T2, T3, T4, T5.

### Final verification

The manual checks listed at the end of §14, on an iPhone, an Android phone and a phone browser. The results go in the pull request description.

## 17. Questions decided by the review gate

These were decided by the architecture review gate in round 1 (design reviewer and performance reviewer, consolidated by the coordinator). The founder confirms them in the final pull request.

| # | Question | Answer | Who decided | Reason | Discarded alternatives |
| --- | --- | --- | --- | --- | --- |
| 1 | How far does the rename to «store appearance» go in code? | Module, symbols, CSS hooks and variables, log events and E2E files. The table, enum and RLS policy are unchanged and need no migration. | Both reviewers | One name per concept from day one, at no runtime or database cost, done once before the parallel waves | Renaming module and symbols only (two names on the catalog hooks); also renaming the table, enum and RLS with a migration (an exclusive lock and policy churn for no visible gain) |
| 2 | A stored logo whose image cannot be resolved | Keep today's behavior: buyers see the stored theme without logo, and the editor on web and mobile shows the theme and «Sin logo» and keeps the logo id on save. The contract carries `url: null`. The product draft was corrected (its gate table, row 19). | Both reviewers, conditional on the contract fix (design blocker B3) | The checkout stays unchanged, a valid theme is not dropped over an image URL, and no client erases the logo | An editor load error with Clásico without logo for buyers (changes checkout behavior) |
| 3 | Size of HEIC and camera logos converted on mobile | At most 1024 px on the longest side, through the same four-step quality loop. The product draft was corrected (row 20). | Performance reviewer (blocker), accepted by the design reviewer | The logo renders at header size on every buyer page; the product-photo bounds produce multi-MB files | Scaling only to the server limits (8000 px / 24 MP) |

### Gate round 1 findings and how they are addressed

| Finding | Decision | Reason |
| --- | --- | --- |
| Design B1: contrast test under `shared/` breaks the mobile typecheck | Accepted | The test stays in core, importing `@shared/store-themes`, and the T0 criteria include the mobile typecheck. |
| Design B2: the preview breaks at the unknown-theme start and when the payment methods fail | Accepted | `getStorePreview` (§5.6) no longer reads the appearance and tolerates a payment-methods failure. Test titles added. |
| Design B3: a mobile save would erase an unresolved logo | Accepted | `storeLogoSchema.url` is nullable and the mobile draft keeps the id; the product draft is corrected. |
| Design B4: no store name for the themed unavailable product | Accepted | `CatalogProductResult` (§5.7). |
| Performance blocker: multi-MB converted logos | Accepted | `logoJpegBounds = { maxSide: 1024 }`; the product draft is corrected. |
| Design S1: web byte limit differs from the server's | Accepted | `imageUploadLimits` in `shared/contracts/images.ts` for the server, web and mobile. |
| Design S2: the preview message makes store-appearance depend on catalog | Accepted | Protocol, schema and frame move to `app/components/store-preview/`. |
| Design S3: the PUT response URL comes after the commit | Accepted | `findLogo` resolves the URL before writing (§5.2). |
| Design S4: incomplete rename and a weak grep | Accepted | Every event, operation and field is in §12 and §13; the T0 grep covers kebab, snake and camel case; `invalidFields` is kept. |
| Design S5: malformed JSON answers `INVALID_COMPANY` | Accepted | The path joins `isFeatureRequest`; §8 lists `400 INVALID_INPUT` and `413 PAYLOAD_TOO_LARGE`. |
| Design S6: picker options can re-encode the logo | Accepted | The picker calls are fixed in §10, with a test title. |
| Design S7: revalidation restarts the preview stream; retries undefined | Accepted | The cards come from a separate fetch once per visit; there is no revalidation after `set-publication`; **Reintentar** is defined per part (§5.4). |
| Design S8: acceptance criteria without test titles | Accepted | Titles added for the publication card UI, the unknown-theme leave and **Descartar**, the logo announcement and hint, and web key parity (mobile already has a parity test). |
| Design S9: T6 should maintain memory | Accepted | T6 supersedes ea395f68 and updates 7a6e8c5e and 477d7fc1. |
| Design S10: drop `index.ts` | Accepted | It is removed in T0. |
| Performance 1 | Accepted | See the blocker above. |
| Performance 2: start the editor parts concurrently | Accepted | `Promise.all` (§5.4). The cards are a separate fetch. |
| Performance 3: revalidation after `set-publication` | Accepted | `shouldRevalidate` returns false; the card trusts its action result. |
| Performance 4: the unavailable product reads the store twice | Accepted | `CatalogProductResult` reuses the store already read. |
| Performance 5: theme machinery in the buyer bundle | Rejected | A few KB gzipped; the preview needs client-side generation, and one mechanism serves all surfaces. The cost is recorded in §2. |
| Performance 6: catalog index | Accepted as a note | §7 and §15; the index is its own task if a large catalog appears. |
| Performance 7: font preload and font check | Partly accepted | The font check is T2 criterion 6 and an E2E assertion. Preloading is rejected for parity with the checkout and because the fallback stack keeps the layout (§15). |
| Performance 8: GET after the save | Accepted | The `PUT` response is the new baseline. |
| Performance 9: one query for check and URL | Accepted | `findLogo` uses `resolvePublicImage` for both. |
| Performance 10: appearance read per navigation | Accepted as a note | §15; a parent route is out of scope. |
| Performance 11: payment images read one by one in the preview | Rejected | Bounded by the handful of methods, once per editor visit; T5 does not touch that composition. |

No open questions remain.
