# Store theme in the public catalog: technical design

**Status:** draft with open questions. Based on `docs/drafts/llevar-el-tema-de-la-tienda-al-catalogo.md` (product definition closed, commit `e29afdfa`). Base: branch `jorgeluis594/llevar-el-tema-de-la-tienda-al-catalogo` at `e29afdfa`. Todoist 6hpwfg8pfvjxq9jV.

## 1. Technical goal

Every buyer page of a published catalog renders the company's stored theme and logo with the same values, scoping and fixed color scheme the checkout uses. The checkout appearance becomes the store appearance: one core module, one shared contract, read and saved from the web editor (React Router loader and action) and from a new mobile screen (new `GET`/`PUT /api/store-appearance`). The web editor gains the publication card and a catalog view in its preview; publication keeps its current API and moves out of Settings → Catálogo on both platforms. No table, column or stored value changes.

```text
                       shared/store-themes.ts (five theme definitions, single source)
                       shared/contracts/store-appearance.ts (mobile ⇄ core JSON)
                                   │
 apps/core  features/store-appearance ──getPublic──▶ checkout route (unchanged behavior)
            │   get / save / getPreview             └▶ catalog routes (header, grid, product, cart)
            │                                           via catalogBrowse.storeAppearance
            ├── web editor route (loader/action) ── catalogSettings (publication card)
            │        └─ preview iframe: surface "catalog" | "checkout" ◀── catalogBrowse.previewCards
            └── api-routes: GET/PUT /api/store-appearance ◀── apps/mobile features/store-appearance
                                                            + POST /api/images (logo, existing)
                                                            + GET/PUT /api/catalog/settings (existing)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Module name | Core `src/features/checkout-appearance/` becomes `src/features/store-appearance/`; operations, types, components and CSS hooks take the store name (see §12). Pending question 1. |
| Stored data | Table `CompanyCheckoutAppearance`, enum `CheckoutTheme`, the RLS policy and the Prisma model keep their names. No migration, no data touched. |
| Theme values | `checkout-themes.ts` moves unchanged to `shared/store-themes.ts`, the single source consumed by core (CSS variables) and mobile (static samples). The contrast test moves next to it and runs in core's unit project. |
| Theme mechanism in the catalog | The catalog wraps its pages in the same `StoreTheme` scope the checkout uses (scoped CSS variables, `html:has(scope)` background, fonts imported by the component) and marks its elements with new `data-store-part` hooks. No second theming mechanism. |
| Fixed color scheme in the catalog | `handle.colorScheme` returns `"fixed"` when the loader resolved a published store (catalog page, product page including «Este producto ya no está disponible»), `"system"` otherwise («Catálogo no disponible», full-page load error). |
| Product no longer available | The product loader returns it as data with status 404 (`{ kind: "product_unavailable", storeName, appearance }`), not as a thrown error, so the page keeps the store, its theme and the fixed scheme. «Catálogo no disponible» and the load error stay in the `ErrorBoundary`, unthemed. |
| Buyer fallback | Unchanged rule, now shared by both surfaces: no saved appearance → Clásico without logo; unknown stored theme, invalid row or read failure → Clásico without logo, logged, never hiding the page. |
| Seller read | `getStoreAppearance` distinguishes a readable appearance from an unknown stored theme (`{ kind: "readable" } \| { kind: "unknown_theme" }`); any other unusable row stays an error (load error in the editor). |
| Mobile API | New `GET /api/store-appearance` and `PUT /api/store-appearance` behind the existing `/api` bearer-or-cookie access and `requireApiCompany`. Logo upload reuses `POST /api/images` unchanged; publication reuses `GET`/`PUT /api/catalog/settings` unchanged. |
| Shared contract | `shared/contracts/store-appearance.ts`: response, save body. Error codes in the existing `{ code, error }` envelope. |
| Web editor transport | Stays on its React Router loader and action (no fetch to the new API). The loader returns appearance and publication as separate parts that fail independently; the action takes a discriminated JSON body (`save-appearance` \| `set-publication`). |
| Web Settings → Catálogo | Keeps its loader; its action and switch are removed. Publication on web is saved only through the editor action. |
| Old editor URL | `settings/checkout-appearance` and `:locale/settings/checkout-appearance` redirect with 308 to the same prefix plus `settings/store-appearance`, keeping the query. The old preview path is removed without redirect (only the editor embeds it). |
| Catalog preview data | The editor loader streams (promise in loader data, `<Await>`) up to three catalog cards of the seller's company, read without the publication check; the editor sends them to the iframe in the preview message. A failure resolves to sample products. |
| Preview iframe | One iframe and one preview route (`settings/store-appearance/preview`) render both surfaces; the message gains `surface` and `catalog`. Switching surface does not reload the iframe, so the device choice and draft stay. |
| Mobile publication card | Extracted from the mobile catalog settings screen into `features/catalog/presentation/catalog-publication-card.tsx`; the route file `app/(tabs)/settings/appearance.tsx` composes it into the store appearance screen through a slot prop. Same on web: `app/components/catalog-publication-card.tsx` is composed by the editor route. |
| Mobile logo files | PNG/JPEG/WEBP uploaded byte for byte with their own MIME; HEIC/HEIF and camera photos go through the JPEG fitter product photos use today, extracted to `apps/mobile/src/shared/infrastructure/jpeg-fitting.ts`. Limits 10 MB, 8000 px per side, 24 MP checked on device before uploading; the server stays the authority. |
| Web dimension rejection | A `413 IMAGE_TOO_LARGE` from `POST /api/images` on web means dimensions (bytes are checked before uploading) and shows the product's dimensions text. |
| «Agotado» badge | Opaque `--warning-surface` with `--warning` text instead of today's translucent background over the photo, so its contrast is computable per theme. |
| Logs | `checkout_appearance_saved` → `store_appearance_saved`, `invalid_stored_checkout_appearance` → `invalid_stored_store_appearance`, request operations `*_checkout_appearance` → `*_store_appearance`. There is no production, so renaming loses no search. |
| Docs | On merge, `docs/public-catalog.md` and `docs/checkout.md#appearance` take the new rules; the product and technical drafts are deleted (T6). |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Appearance domain: `CheckoutAppearance { logoImageId, theme }`, `parseCheckoutAppearance` (strict, enum theme), `defaultCheckoutAppearance`, branded ids | `apps/core/src/features/checkout-appearance/domain/checkout-appearance.ts` | Reused, renamed |
| Theme definitions `checkoutThemeIds`, `checkoutThemes: Record<id, CheckoutThemeDefinition>` (42 color tokens, ~73 style tokens, fonts, logo plate, thumbnail), contrast test | `…/domain/checkout-themes.ts`, `checkout-themes.test.ts` | Moved to `shared/`, values unchanged |
| Use cases `getCheckoutAppearance`, `saveCheckoutAppearance` (parse, `imageAvailable`, save), `getPublicCheckoutAppearance` (`default \| custom \| fallback`), `getCheckoutAppearancePreview` | `…/application/checkout-appearance.ts` | Seller read changes; rest renamed |
| Composition `checkoutAppearance.{get, save, getPublic, getPreview}`; `save` logs `checkout_appearance_saved` | `…/composition.ts`, `index.ts` | Renamed `storeAppearance` |
| Repository `loadCheckoutAppearance` (logs `invalid_stored_checkout_appearance`, returns `INVALID_STORED_DATA`), `persistCheckoutAppearance` (upsert; P2003 → `INVALID_IMAGE`) | `…/infrastructure/checkout-appearance-repository.ts` | Distinguishes unknown theme |
| Table `CompanyCheckoutAppearance` (`companyId` PK, `logoImageId` with composite FK to `Image(companyId,id)` `Restrict`, `theme CheckoutTheme`), RLS `company_checkout_appearance_isolation` | `apps/core/prisma/schema.prisma:291` | Unchanged |
| `CheckoutTheme` component (scope via `useId`, `<style>` from `checkoutThemeCss`, `data-checkout-theme`, `.dark` for Noche), `checkout-theme.css` (shadcn `data-slot` + closed `data-checkout-part` list), `checkout-theme-fonts.css` | `…/presentation/` | Renamed, extended with catalog parts |
| `CheckoutBrandHeader`, `ProductThumbnail` (read `--checkout-logo-*`, `--checkout-thumb-*`) | `…/presentation/` | Reused by catalog header and cart lines |
| Color scheme handle `colorSchemeOf`, `applyColorPreference`; checkout sets `"fixed"` when the order loaded | `apps/core/app/color-scheme.ts`, `app/root.tsx`, `app/routes/checkout.tsx` | Reused as is |
| Web editor: loader (throws 503 on any failure; unresolved logo → `logoUrl: null`), JSON action with 422/503, `clientAction` for lost saves, `EditorDraft`, `useBlocker`, `ThemePicker`, `CheckoutPreviewFrame` + `postMessage` protocol | `apps/core/app/routes/checkout-appearance-settings.tsx`, `…/presentation/editor-draft.ts`, `preview-protocol.ts`, `checkout-appearance-schemas.ts` | Modified (T0, T3, T5) |
| Preview route (`handle.colorScheme: "fixed"`, `no-store`, sample fixtures) | `app/routes/checkout-appearance-preview.tsx`, `…/presentation/checkout-preview-page.tsx`, `preview-fixtures.ts` | Renamed, gains catalog surface |
| Routes `settings/checkout-appearance` (+ `/preview`), plain and `:locale` | `apps/core/app/routes.ts:16,28,39,51` | Renamed + redirect |
| Request-route patterns for the editor and preview | `apps/core/src/shared/infrastructure/logger.ts:58-61`, `OperationContext` | Renamed |
| Catalog pages: `catalog.tsx`, `catalog-product.tsx` (product unavailable thrown as 404 `"product"`), `catalog-cart.tsx` (resource route) | `apps/core/app/routes/` | Themed (T2) |
| `CatalogShell` (global tokens, uses `CheckoutBrandHeader`), `CatalogProductImage`, `CatalogMessage`, `CatalogLoadError` | `apps/core/app/components/catalog-sections.tsx` | Themed (T2) |
| `CatalogCartButton` + sheet portalled into a host inside the shell; raw `<img class="size-16 rounded-md">` thumbnails | `apps/core/app/components/catalog-cart.tsx` | Themed (T2) |
| `catalogBrowse.{browse, getProduct, appearance}`; `appearance` returns only the logo URL and logs `unable_to_read_catalog` / `read_appearance` | `apps/core/src/features/catalog/browse-composition.ts` | Returns the whole public appearance |
| `browseCatalog`, `getCatalogProduct`, `readStore` (null when hidden), `products.listForCatalog` (`CatalogCard {id,name,imageUrl,price,soldOut}`) | `src/features/catalog/application/browse-catalog.ts`, `infrastructure/catalog-store-repository.ts`, `src/features/products/composition.ts:175` | Reused; preview read added |
| `catalogSettings.{get, setPublication}`, `GET`/`PUT /api/catalog/settings` | `src/features/catalog/composition.ts`, `presentation/api-routes.ts` | Unchanged |
| Web Settings → Catálogo (switch, confirm, link, copy, view) | `apps/core/app/routes/catalog-settings.tsx` | Switch removed |
| Panel navigation item `nav.checkoutAppearance`, `appearancePath` | `apps/core/app/routes/private-layout.tsx:58,127` | Renamed |
| Web texts es/pt in one file | `apps/core/app/locales.ts` | New keys |
| `/api` access (`loadApiAccess`, `requireApiCompany`), image API `POST /api/images` (10 MB, 8000 px, 24 MP, original bytes) | `apps/core/src/app.ts`, `src/shared/images/` | Reused unchanged |
| Contracts `catalog.ts` (`catalogSettingsSchema`, `setCatalogPublicationSchema`), `images.ts` (`imageResponseSchema`); no appearance contract | `shared/contracts/` | New `store-appearance.ts` |
| Mobile catalog settings (switch, confirm, link, copy, share, view), `createCatalogSettingsApi` | `apps/mobile/src/features/catalog/` | Switch moved out |
| Mobile settings stack (`index`, `delivery`, `catalog`), `ListRow`, `ScreenState`, `showConfirmation`, `usePreventRemove` pattern in delivery settings | `apps/mobile/src/app/(tabs)/settings/`, `src/components/ui/`, `src/features/delivery-settings/presentation/use-instant-delivery-settings.ts` | Reused |
| Mobile `uploadImage(request, uri, mimeType)`; product photos re-encode to JPEG with a 4-step fitter | `apps/mobile/src/shared/infrastructure/image-api.ts`, `src/features/products/presentation/product-photo.tsx` | Fitter extracted to shared |
| E2E: `checkout-appearance.spec.ts`, `-buyer.spec.ts`, `-preview.spec.ts`, fixtures (`saveCompanyAppearance`, `openEditor`); `public-catalog.spec.ts` | `apps/core/tests/e2e/` | Renamed / extended |

Assumption verified in schema: the database enum restricts `theme` to the five ids, so an unknown stored theme only happens if the code's id list and the enum diverge. The design still handles it because the product requires it.

## 4. Gaps this design closes

1. The concept is named «checkout appearance» in code, routes and texts; it now covers the whole store (§12, T0).
2. Theme values live only in core; mobile has no source for its samples (§6, T0).
3. The seller read cannot tell an unknown stored theme from other unusable data (§5.1, T0).
4. The catalog renders global tokens and reads only the logo; it has no theme scope, no fixed scheme and no themed product-unavailable page (§5.3, §12, T2).
5. Mobile has no API to read or save the appearance and no contract for it (§8, T1).
6. The web editor throws the whole page on a read failure, has no publication card, no unknown-theme notice, and lives at the old URL (§5.4, T3).
7. Settings → Catálogo still owns the switch on web and mobile (T3, T4).
8. The editor preview shows only the checkout; there is no read of the seller's first catalog cards regardless of publication (§5.5, T5).
9. Mobile has no store appearance screen, logo pipeline for logos, or theme samples (§10, T4).

## 5. Use cases

### 5.1 `getStoreAppearance` (modified, store-appearance)

- `input`: none. `access`: `{ companyId }` from the seller session or bearer token.
- `deps`: `load: (companyId) => Promise<Result<StoredAppearance | null, StoreAppearanceFailure>>`; `imageUrl: (imageId, companyId) => Promise<Result<string | null, StoreAppearanceFailure>>`.
- Output: `Result<SellerStoreAppearance, StoreAppearanceFailure>`.
- Errors: `INVALID_STORED_DATA`, `PERSISTENCE_UNAVAILABLE`.
- Flow:
  1. Load the row. `null` → `{ kind: "readable", appearance: defaultStoreAppearance, logoUrl: null }`.
  2. The repository returns `UNKNOWN_STORED_THEME` when only the theme is outside `storeThemeIds` → `{ kind: "unknown_theme" }` (success, not an error).
  3. Any other invalid row → `INVALID_STORED_DATA` (error).
  4. Resolve the logo URL; an unresolved logo → `logoUrl: null`, appearance kept (pending question 2).
  5. Return.

### 5.2 `saveStoreAppearance` (renamed, behavior unchanged)

- `input`: `unknown` body already parsed by presentation into `{ theme, logoImageId }`; `access`: `{ companyId, userId }`.
- `deps`: `save`, `imageAvailable` (unchanged).
- Output: `Result<StoreAppearance, StoreAppearanceFailure>`; errors `INVALID_STORE_APPEARANCE` (renamed from `INVALID_CHECKOUT_APPEARANCE`, carries `invalidFields`), `INVALID_IMAGE`, `PERSISTENCE_UNAVAILABLE`.
- Flow unchanged: parse, verify the logo is an available public image of the company, upsert, log `store_appearance_saved` after the write. Saving over an unknown-theme row replaces it like any save.

### 5.3 `getPublicStoreAppearance` (renamed, unchanged) and its catalog consumer

- Output `PublicAppearanceResult = { kind: "default" } | { kind: "custom"; appearance: { logoUrl; theme } } | { kind: "fallback" }`, as today. An unknown theme reaches it as a repository error and resolves to `fallback`.
- `catalogBrowse.appearance` becomes `catalogBrowse.storeAppearance(companyId): Promise<PublicStoreAppearance>` and returns `{ logoUrl, theme }` always: `default` and `fallback` → `{ logoUrl: null, theme: "classic" }`; `custom` → its value re-validated with `publicStoreAppearanceSchema`. It keeps logging `unable_to_read_catalog` with `operation: "read_appearance"` and never fails, so the loaders keep reading it in parallel with the products.

### 5.4 Web editor loader and action (presentation, modified)

- Loader returns two independent parts and never throws for them:
  - `appearance: { kind: "readable"; published: StoreAppearance; logoUrl } | { kind: "unknown_theme" } | { kind: "failed" }`.
  - `publication: { kind: "loaded"; published: boolean } | { kind: "failed" }` from `catalogSettings.get`.
  - `catalogPreview: Promise<CatalogPreviewCards>` (T5, streamed).
- Action body (JSON, validated with a presentation schema):
  ```ts
  const editorActionSchema = z.discriminatedUnion("intent", [
    z.strictObject({ intent: z.literal("save-appearance"), appearance: z.unknown() }),
    z.strictObject({ intent: z.literal("set-publication"), published: z.boolean() }),
  ]);
  ```
  `save-appearance` → `storeAppearance.save` (422/503 as today). `set-publication` → `catalogSettings.setPublication` (503 on failure). Each result carries its `intent` so the card and the draft read only their own result. `clientAction` keeps converting a lost response into a 503 of the same `intent`.
- `shouldRevalidate` skips revalidation after a failed submission (as the 503 already does today); a successful `set-publication` revalidates, which leaves the draft intact because the draft is component state initialized once.

### 5.5 `previewCatalogCards` (new, catalog)

Why new: `browseCatalog` rejects a hidden catalog, and the preview must show the look while hidden.

```ts
export type PreviewCatalogCardsDependencies = Readonly<{
  readStoreCurrency: (companyId: CompanyId) => Promise<Result<Currency, BrowseCatalogError>>;
  listCatalogProducts: (criteria: CatalogCriteria) => Promise<Result<CatalogPage, BrowseCatalogError>>;
}>;
export async function previewCatalogCards(access: SellerCatalogAccess, deps: PreviewCatalogCardsDependencies):
  Promise<Result<readonly CatalogCard[], BrowseCatalogError>>
```

- `access`: `{ companyId }` from the seller session (the editor loader), under `withTenantIsolation`.
- Flow: read the company currency without checking publication; list `{ currency, search: null, offset: 0, limit: previewCardCount }` with `previewCardCount = 3`; return the items in catalog order. Same filters and order as the buyer catalog because it is the same `listForCatalog`.
- Errors: `PERSISTENCE_UNAVAILABLE`, `ProductReadError`. The editor maps any failure and an empty list to `{ kind: "samples" }`; one to three cards to `{ kind: "products", cards }`.

### 5.6 Mobile operations (mobile application layer)

- `loadStoreAppearance()` → `Result<StoreAppearanceState, TransportError>` from `GET /api/store-appearance`.
- `saveStoreAppearance({ theme, logoImageId })` → `Result<StoreAppearanceState, SaveStoreAppearanceError>` with `INVALID_STORE_APPEARANCE`, `INVALID_IMAGE` or transport errors.
- `uploadStoreLogo(asset)` → `Result<{ id; url }, LogoUploadError>`: classify the asset (§6), convert when required, upload with `uploadImage(request, uri, mimeType)`.
- Publication keeps `catalogSettings.get` / `setPublished`.

## 6. Domain and typing

| Type | Where | Justification |
| --- | --- | --- |
| `StoreThemeId`, `storeThemeIds`, `StoreThemeDefinition`, `storeThemes`, `defaultStoreTheme` | `shared/store-themes.ts` | Rename and move of the checkout theme types; both apps consume them. No value changes. |
| `StoreAppearance { logoImageId: ImageId \| null; theme: StoreThemeId }`, `parseStoreAppearance`, `defaultStoreAppearance` | `store-appearance/domain/store-appearance.ts` | Rename of `CheckoutAppearance`; same rules. |
| `SellerStoreAppearance = { kind: "readable"; appearance: StoreAppearance; logoUrl: string \| null } \| { kind: "unknown_theme" }` | `store-appearance/application/store-appearance.ts` | The editor and the API must render the unknown-theme starting point, which an error code cannot carry as success. Replaces `StoreAppearance \| null` plus the loader's own logo resolution. |
| `StoreAppearanceFailure` = domain error \| `INVALID_IMAGE \| INVALID_STORED_DATA \| UNKNOWN_STORED_THEME \| PERSISTENCE_UNAVAILABLE` | same | `UNKNOWN_STORED_THEME` is a repository data error the seller read turns into the union above; the public read treats it as fallback. |
| `PublicStoreAppearance { logoUrl; theme }` | `store-appearance/presentation/store-appearance-schemas.ts` | Rename of `PublicCheckoutAppearance`. |
| `CatalogPreviewCards = { kind: "products"; cards: readonly CatalogCard[] } \| { kind: "samples" }` | `store-appearance/presentation/store-appearance-schemas.ts` (preview message) | The editor and the iframe need the origin of the cards for the label and never mix kinds. `{ kind: "loading" }` exists only in the message while the promise is pending. |
| `StorePreviewMessage { type: "store-appearance:update"; appearance; surface: "catalog" \| "checkout"; state: "review" \| "payment"; catalog: CatalogPreviewCards \| { kind: "loading" } }` | same | Extends today's preview message; validated on both sides. |
| Mobile `LogoAssetDecision = { kind: "upload_as_is"; mimeType: "image/png" \| "image/jpeg" \| "image/webp" } \| { kind: "convert_to_jpeg" } \| { kind: "rejected"; reason: "format" \| "size" \| "dimensions" }` | `apps/mobile/src/features/store-appearance/domain/logo-file.ts` | Pure rule from `{ mimeType, fileSize, width, height, source: "library" \| "camera" }`; the screen shows one text per reason. |
| Mobile `StoreAppearanceDraft { theme; logo: { id; url } \| null }` and `StoreAppearanceState` (`readable` with published + draft baseline, or `unknown_theme`) | `apps/mobile/src/features/store-appearance/application/` | Mobile's own model with core's names. |

| Layer | Types and authority |
| --- | --- |
| shared | Theme ids and values; JSON contract. No app imports. |
| core domain/application | Parsing, logo ownership, persistence, fallback. Authority for every rule. |
| core presentation | Public projection, editor parts, preview message, HTTP status. |
| mobile | Draft, logo file pre-checks (feedback only), screen state. |

## 7. Persistence

- No schema change and no migration. The Prisma model `CompanyCheckoutAppearance` and enum `CheckoutTheme` keep their names; only the repository file is renamed (`store-appearance-repository.ts`).
- `loadStoreAppearance` parses the row with a strict schema in two steps: theme against `storeThemeIds` (outside → `UNKNOWN_STORED_THEME`, logged once as `invalid_stored_store_appearance`), then the whole row (invalid → `INVALID_STORED_DATA`, logged).
- New `readStoreCurrency(companyId)` in `catalog/infrastructure/catalog-store-repository.ts`: the company's country currency without the publication filter, under RLS; invalid country → `INVALID_STORED_DATA` logged as `unable_to_read_catalog` with `operation: "read_preview_store"`.

## 8. Contracts between applications

`shared/contracts/store-appearance.ts` (new, version 1):

```ts
import { z } from "zod";
import { storeThemeIds } from "@shared/store-themes";
import { imageResponseSchema } from "@shared/contracts/images";

export const storeThemeIdSchema = z.enum(storeThemeIds);
export const storeAppearanceSchema = z.strictObject({ theme: storeThemeIdSchema, logo: imageResponseSchema.nullable() });
export const storeAppearanceResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("readable"), appearance: storeAppearanceSchema }),
  z.strictObject({ kind: z.literal("unknown_theme") }),
]);
export const saveStoreAppearanceSchema = z.strictObject({ theme: storeThemeIdSchema, logoImageId: z.uuid().nullable() });
export type StoreAppearanceResponse = z.infer<typeof storeAppearanceResponseSchema>;
export type SaveStoreAppearanceBody = z.infer<typeof saveStoreAppearanceSchema>;
```

| Operation | Request | Success | Errors (`{ code, error }`) |
| --- | --- | --- | --- |
| `GET /api/store-appearance` | — | `200 StoreAppearanceResponse` | `503 INVALID_STORED_DATA` (other unusable row), `503 SERVICE_UNAVAILABLE` |
| `PUT /api/store-appearance` | `SaveStoreAppearanceBody` | `200 { kind: "readable", appearance }` | `415 UNSUPPORTED_MEDIA_TYPE`, `400 INVALID_STORE_APPEARANCE` (bad body or unknown theme, unknown keys), `422 INVALID_IMAGE` (logo missing or of another company), `503 SERVICE_UNAVAILABLE` |
| `POST /api/images` | unchanged | unchanged | unchanged (`413 IMAGE_TOO_LARGE`, `400 INVALID_IMAGE`) |
| `GET`/`PUT /api/catalog/settings` | unchanged | unchanged | unchanged |

- Core validates the body with `saveStoreAppearanceSchema` and the response with `storeAppearanceResponseSchema` before sending; `companyId` and `userId` come only from access. Both responses send `Cache-Control: no-store`.
- Mobile validates every response with the same schemas; an unexpected shape is a transport error, not a default appearance.
- The web editor does not consume this contract; it uses its loader projection. The theme id enum both use is the same `storeThemeIdSchema`.

## 9. Events and cross-feature integration

No domain events. Cross-feature capabilities:

| Consumer | Capability | Owner |
| --- | --- | --- |
| catalog `browse-composition.ts` | `storeAppearance.getPublic(companyId)` | store-appearance |
| catalog pages and preview (app) | `StoreTheme`, `StoreBrandHeader`, `ProductThumbnail` components | store-appearance presentation |
| web editor route (app) | `catalogSettings.get`, `catalogSettings.setPublication`, `catalogBrowse.previewCards` | catalog |
| mobile route `settings/appearance.tsx` | `CatalogPublicationCard` (catalog) composed into `StoreAppearanceScreen` (store-appearance) | route file |

store-appearance never imports catalog; catalog imports store-appearance's composition and presentation components only. The cycle stays out because the editor route (app layer) composes both.

## 10. Mobile

| Layer | File | Change |
| --- | --- | --- |
| domain | `src/features/store-appearance/domain/logo-file.ts` | `decideLogoAsset` per §6; limits `maxLogoBytes = 10_000_000`, `maxLogoSide = 8000`, `maxLogoPixels = 24_000_000` (same as the server; adjustable together with it). |
| domain | `src/features/store-appearance/domain/theme-sample.ts` | Maps a `StoreThemeDefinition` to the sample's numeric styles (background or Suave's gradient stops, card, border, primary and its text, button radius and shape, thumbnail ratio and radius); parses `px` values, never fonts. |
| application | `src/features/store-appearance/application/store-appearance.ts` | Operations of §5.6 with injected API functions; draft comparison (`sameDraft`). |
| infrastructure | `src/features/store-appearance/infrastructure/store-appearance-api.ts` | `get()` and `save(body)` against `/api/store-appearance`, parsed with the shared schemas; maps `400 INVALID_STORE_APPEARANCE`, `422 INVALID_IMAGE`. |
| infrastructure | `src/features/store-appearance/infrastructure/logo-upload.ts` | Reads size and dimensions as product photos do, converts with `fitJpeg` when `convert_to_jpeg`, uploads with `uploadImage(request, uri, mimeType)` keeping the original MIME for `upload_as_is`. |
| infrastructure | `src/shared/infrastructure/jpeg-fitting.ts` (new) and `src/features/products/presentation/product-photo.tsx` | `preparePhoto`'s scaling and four-step quality loop moves to `fitJpeg(uri, width, height)`; product photos call it with unchanged behavior. |
| presentation | `src/features/store-appearance/presentation/store-appearance-screen.tsx`, `use-store-appearance.ts`, `theme-list.tsx`, `logo-section.tsx`, `save-bar.tsx`, `translations.ts` | Screen of the product draft: independent loading of appearance and the `publication` slot, unknown-theme notice, save bar above the tab bar, `usePreventRemove` leave confirmation (delivery settings pattern), polite live region for «Apariencia actualizada», `accessibilityRole="radiogroup"` theme list. es and pt-BR. |
| presentation | `src/features/catalog/presentation/catalog-publication-card.tsx` (new), `catalog-settings-screen.tsx`, `translations.ts` | Card extracted with its own load, switch, confirmation, error and «Este cambio se guarda al momento.»; Catálogo keeps link/copy/view/share only while published, adds the notice and **Ir a Apariencia de la tienda**, re-reads with `useFocusEffect` keeping the last known state. |
| composition | `src/features/store-appearance/composition.ts`, `src/i18n.ts` | `storeAppearance` operations with the shared `request`; translations merged. |
| routes | `src/app/(tabs)/settings/appearance.tsx` (new), `settings/index.tsx` | New route composing screen + card; menu row between delivery and Catálogo. |

| Situation | Decision |
| --- | --- |
| Save gets no response | Draft kept, bar shows the save error with **Reintentar**; repeating sends the same body (idempotent upsert). |
| Upload fails | Only the logo section shows the error and **Reintentar** with the same prepared file; the theme is untouched. |
| Leaving with a logo uploaded but not saved | The uploaded image stays orphaned, as on web (images module rule). |
| Account switch | Nothing is cached; the screen reads on mount and after each save. |

No local SQLite change.

## 11. Transactions and concurrency

1. Save appearance: one upsert by `companyId` under `withTenantIsolation`; the composite foreign key guarantees the logo belongs to the company in the same statement. No lock; the last completed save wins across web and mobile (product rule).
2. Set publication: unchanged single update.
3. Appearance and publication are independent writes; neither touches the other's column or row.
4. Repeating either request writes the same values; there are no duplicates to resolve.

## 12. Code organization

**Rename map (T0).** `src/features/checkout-appearance/` → `src/features/store-appearance/` with file and symbol renames: `checkout-appearance.ts` → `store-appearance.ts` (domain, application), `checkout-appearance-repository.ts` → `store-appearance-repository.ts`, `checkout-appearance-schemas.ts` → `store-appearance-schemas.ts`, `checkout-theme.tsx`/`.css`/`-style.ts`/`-fonts.css` → `store-theme.*`, `checkout-brand-header.tsx` → `store-brand-header.tsx`, `checkout-preview-frame.tsx` → `store-preview-frame.tsx`; `checkout-preview-page.tsx`, `product-thumbnail.tsx`, `theme-picker.tsx`, `theme-sample.tsx`, `editor-draft.ts`, `preview-protocol.ts`, `preview-fixtures.ts` keep their names. Symbols: `checkoutAppearance` → `storeAppearance`, `CheckoutAppearance*` → `StoreAppearance*`, `CheckoutTheme` (component) → `StoreTheme`, `checkoutThemeCss` → `storeThemeCss`. CSS: `data-checkout-theme(-id)` → `data-store-theme(-id)`, `data-checkout-part` → `data-store-part` (checkout part names unchanged, e.g. `total`), variables `--checkout-*` → `--store-*`; shadcn color token names unchanged. Message types `checkout-appearance:*` → `store-appearance:*`. `domain/checkout-themes.ts` → `shared/store-themes.ts`, `checkoutTheme*` → `storeTheme*`. E2E files `checkout-appearance*.ts` → `store-appearance*.ts`. URL paths, texts and locale keys do not change in T0.

**New and modified files after T0**

| File | Task | Change |
| --- | --- | --- |
| `shared/store-themes.ts`, `shared/store-themes.test.ts`, `apps/core/vitest.config.ts` | T0 | Moved definitions and contrast test; unit include adds `../../shared/store-themes.test.ts` (precedent: `peru-geography.spec.mjs`). |
| `shared/contracts/store-appearance.ts` | T0 | Contract of §8. |
| `store-appearance/application/store-appearance.ts`, `infrastructure/store-appearance-repository.ts` | T0 | `SellerStoreAppearance`, `UNKNOWN_STORED_THEME`, logo resolution inside the use case. |
| `apps/core/src/shared/infrastructure/logger.ts` | T0 | Renamed operations and fields: `get_store_appearance`, `save_store_appearance`, `get_store_preview`, `set_catalog_publication`; `storeAppearance`, `storeTheme`. The request-path patterns are updated by T3. |
| `store-appearance/presentation/api-routes.ts`, `apps/core/src/app.ts` | T1 | `storeAppearanceRoutes()` mounted at `/api/store-appearance` after `requireApiCompany`. |
| `store-appearance/presentation/store-theme.css`, `store-theme-style.ts` | T2 | Catalog parts: `catalog-search`, `catalog-card`, `catalog-card-photo`, `catalog-sold-out`, `catalog-more`, `catalog-empty`, `catalog-product-photo`, `catalog-quantity`, `cart-button`, `cart-sheet`, `cart-line`, `catalog-notice`; reuses `header`, `header-brand`, `product-name`, `price`, `option`, `status`. Card photo: square, no own radius, `filter: var(--store-thumb-filter)`, clipped by the card's `overflow: hidden` and `--store-radius-card`. Product photo: `--store-radius-card`, card border, no filter. |
| `app/components/catalog-sections.tsx`, `catalog-cart.tsx`, `app/routes/catalog.tsx`, `catalog-product.tsx`, `src/features/catalog/browse-composition.ts` | T2 | `CatalogShell` takes `appearance` and wraps in `StoreTheme`; exported presentational `CatalogProductCard` and `CatalogCartButtonFace({ units })` for the preview; cart lines use `ProductThumbnail`; `handle.colorScheme`; product-unavailable as 404 data. |
| `app/routes.ts`, `app/routes/store-appearance-settings.tsx` (renamed from `checkout-appearance-settings.tsx`), `store-appearance-preview.tsx` (renamed), `legacy-store-appearance-redirect.ts` (new), `catalog-settings.tsx`, `private-layout.tsx`, `app/components/catalog-publication-card.tsx` (new), `app/locales.ts`, `logger.ts` path patterns | T3 | Editor of §5.4 without the catalog preview. |
| `src/features/catalog/application/preview-catalog-cards.ts`, `infrastructure/catalog-store-repository.ts`, `browse-composition.ts` | T5 | §5.5; `catalogBrowse.previewCards`. |
| `store-appearance/presentation/store-appearance-schemas.ts`, `preview-protocol.ts`, `store-preview-frame.tsx`, `preview-fixtures.ts` (three sample catalog cards), `app/components/catalog-preview.tsx` (new), `app/routes/store-appearance-settings.tsx`, `store-appearance-preview.tsx`, `app/locales.ts` | T5 | Surface selector, label, catalog view. |

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `store_appearance_saved` | info | store-appearance composition, after the upsert | `["companyId", "userId", "theme", "hasLogo", "isDefault"]` |
| `invalid_stored_store_appearance` | error | store-appearance repository | `["companyId", "errorCode"]` (`UNKNOWN_STORED_THEME` \| `INVALID_STORED_DATA`) |
| `unable_to_read_catalog` (existing) | error | catalog `browse-composition.ts`, `catalog-store-repository.ts` | `["companyId", "operation", "errorCode", "err"]`; operations `read_appearance`, `read_store`, new `read_preview_store` |
| `catalog_publication_changed` (existing) | info | catalog composition | unchanged |
| Request operation (`bindRequestOperation`) | — | API routes, editor loader/action, catalog loaders | `operation`: `get_store_appearance`, `save_store_appearance`, `set_catalog_publication`, `get_store_preview`, `browse_catalog`, `get_catalog_product`; `outcome`; catalog loaders add `storeAppearance` (`default \| custom \| fallback`) and `storeTheme` |

Never logged: logo URLs, image ids in public routes, store names, product names, the request body.

## 14. Tests

### shared (core unit project)

- `shared/store-themes.test.ts`: the existing contrast, token-completeness, opaque-HEX and serif tests, unchanged titles, against the moved file.
- `test("the store appearance contract accepts the unknown-theme response and rejects a theme outside the five or an unknown key")` (in `store-appearance/presentation/api-routes.test.ts`, core unit).

### Core unit

- `test("returns the unknown-theme starting point when the stored theme is not one of the five")`
- `test("returns Clásico without logo as a readable appearance when the company never saved one")`
- `test("keeps the stored theme and shows no logo when the logo cannot be resolved")`
- `test("reports other unusable stored data as an error, not as the unknown-theme starting point")`
- `test("the public read falls back to Clásico without logo for an unknown stored theme")`
- `test("catalog appearance is Clásico without logo when the read fails and the failure is logged")`
- `test("catalog appearance keeps the theme and logo of a custom appearance")`
- `test("preview cards list the first three catalog products of a hidden catalog in catalog order")`
- `test("preview cards fail without blocking when the store currency cannot be read")`
- `test("scopes the catalog parts to the store theme subtree")`
- `test("reads only variables that every theme writes, also in catalog parts")`
- `test("hooks only the closed list of store parts")`
- `test("applies the theme photo filter to card photos and cart thumbnails, never to the product page photo")`
- `test("clips the square card photo with the card's rounding in Suave")`
- `test("meets 4.5:1 for the sold-out badge and 3:1 for the catalog search border in every theme")`
- `test("the catalog page declares the fixed color scheme when the store loaded and the system scheme when unavailable")`
- `test("the product page shows Este producto ya no está disponible inside the store theme with status 404")`
- `test("Catálogo no disponible and the catalog load error render without a theme scope")`
- `test("cart lines show the theme thumbnail shape with the product initial when the photo is missing")`
- `test("editor loader returns the publication state when the appearance read fails")`
- `test("editor loader returns the appearance when the publication read fails")`
- `test("editor action saves the publication without touching the appearance")`
- `test("editor action rejects a body without a known intent with 400")`
- `test("a lost publication save returns a 503 of the set-publication intent")`
- `test("redirects the old checkout appearance address to the store appearance editor, plain and localized, keeping the query")`
- `test("the editor offers Guardar cambios without a draft at the unknown-theme starting point and hides Restablecer apariencia")`
- `test("Settings → Catálogo shows the link only while published and points to Apariencia de la tienda in both states")`
- `test("the preview message rejects mixed sample and real catalog cards")`
- `test("the catalog preview shows three placeholders while cards load, then the real cards")`
- `test("the catalog preview cart button stands for the first product that is not sold out and shows no units when all are")`
- `test("the catalog preview is inert and hidden from screen readers")`
- `test("the preview label reads Tema Boutique · Tus productos with real cards and Datos de ejemplo with samples")`
- `test("a 413 from the image API on web shows the logo dimensions text")`

### Core integration (real database)

- `test("GET store appearance returns the saved theme and logo of the token's company only")`
- `test("GET store appearance returns Clásico without logo for a company that never saved one")`
- `test("PUT store appearance publishes theme and logo together and returns them")`
- `test("PUT store appearance rejects a logo of another company with 422 INVALID_IMAGE and keeps the published appearance")`
- `test("PUT store appearance rejects an unknown theme or an unknown key with 400 INVALID_STORE_APPEARANCE")`
- `test("store appearance API requires a session or bearer token with an active company")`
- `test("repeating the same PUT leaves one row with the same values")`
- `test("saving the appearance never changes catalog publication and publishing never changes the appearance")`
- `test("preview cards read a hidden catalog's products only for the seller's company")`
- `test("the repository reports an invalid stored row as INVALID_STORED_DATA without returning a default")` (existing title renamed)

### Mobile (Jest)

- `test("uploads a PNG from the gallery with its own type and without re-encoding")`
- `test("converts a HEIC gallery photo and a camera photo to JPG before uploading")`
- `test("rejects a GIF before uploading with the format message")`
- `test("rejects a 12 MB PNG with the size message and a 9000 px PNG with the dimensions message")`
- `test("disables Guardar cambios while the logo uploads")`
- `test("shows the save bar with Cambios sin guardar after choosing a theme and hides it after saving")`
- `test("announces Apariencia actualizada after a successful save")`
- `test("keeps the draft and offers Reintentar in the bar when the save fails")`
- `test("asks before leaving the settings stack with unsaved changes and not when switching tabs")`
- `test("starts on Clásico without logo with the notice and only Guardar cambios for an unknown stored theme")`
- `test("shows the appearance load error and keeps the publication card working")`
- `test("shows the publication load error inside its card and keeps logo and theme working")`
- `test("announces the theme list as Temas de la tienda with each theme's selected state")`
- `test("publication card asks for confirmation before hiding and restores the switch when saving fails")` (moved)
- `test("Catálogo re-reads the publication on focus and never offers Compartir for a hidden catalog")`
- `test("Catálogo opens Apariencia de la tienda from the published and the hidden state")`
- `test("store appearance API maps 400 and 422 to theme and logo errors and rejects an unexpected response shape")`
- `test("theme samples use each theme's colors, button radius and thumbnail shape")`
- `test("product photos still re-encode to JPEG within the limits after the fitter moved")` (existing product-photo tests stay green)

### Web E2E (happy path only)

- `test("seller saves Noche in Apariencia de la tienda and the buyer sees the catalog, product page, cart and checkout in Noche")`
- `test("buyer with a dark system preference sees a Boutique catalog in light mode")`
- `test("seller compares Catálogo and Checkout previews with the same draft and publishes the catalog from the editor")`
- `test("opening the old checkout appearance address lands on Apariencia de la tienda")`
- Existing `store-appearance*.spec.ts` (renamed) and `public-catalog.spec.ts` stay green with the new paths.

### Pending manual checks

- On an iPhone: a transparent PNG logo picked from the gallery shows without a box on the catalog and checkout; a HEIC photo and a 48 MP camera photo are accepted.
- On Android: the save bar sits above the tab bar without scrolling; TalkBack reads «Temas de la tienda» and «Apariencia actualizada».
- On a phone browser: each of the five themes in catalog, product page and cart, fonts downloaded only for the active theme (network panel).

## 15. Limits and checks during implementation

- The unknown-theme path is unreachable while the database enum and `storeThemeIds` match; it is covered by unit tests with fakes, not by integration or E2E.
- React Router streaming of a promise in loader data must work with the current single-fetch setup and with `clientAction`; verify before building T5 and fall back to a resource-route fetch from the editor if it does not.
- The cart sheet must keep portalling into the host inside the theme scope; a portal to `body` would lose the theme.
- `expo-image-picker` must report `mimeType` for HEIC on iOS and for library assets on Android; when missing, classify by file extension.
- Theme CSS values parsed by mobile samples are `px` strings today; a non-`px` value in a sampled token must fail the sample test rather than render wrong.
- Out of scope: live preview in mobile, `Restablecer apariencia` on mobile, recovery of other unusable stored data, any table rename.

## 16. Implementation plan

### Order and parallelism

```text
Wave 0:  T0 rename + shared themes + contract + seller read
Wave 1:  T1 mobile API (core) ┐
         T2 themed catalog    ├─ parallel, all after T0
         T3 web editor        │
         T4 mobile screen     ┘
Wave 2:  T5 editor catalog preview (after T2 and T3)
Wave 3:  T6 docs promotion and final verification (after all)
```

File ownership inside wave 1: T1 owns `src/app.ts` and `store-appearance/presentation/api-routes*`; T2 owns `store-theme.css`, `store-theme-style.ts` and their tests, `app/components/catalog-*.tsx` (except the new publication card), `app/routes/catalog*.tsx`, `catalog/browse-composition.ts`, new `tests/e2e/public-catalog-theme.spec.ts`; T3 owns `app/routes.ts`, the editor and preview routes, `catalog-settings.tsx`, `private-layout.tsx`, `app/locales.ts`, `logger.ts`, `app/components/catalog-publication-card.tsx`, `tests/e2e/store-appearance*.ts`; T4 owns everything under `apps/mobile/`. T2 reads but does not edit `tests/e2e/store-appearance-fixtures.ts`.

### T0. Store appearance rename, shared themes and contract

**Scope:** rename map of §12 across core (module, symbols, CSS hooks and variables, e2e file names, log events and operations in `logger.ts`); move `checkout-themes.ts` and its test to `shared/store-themes.ts` and add it to core's unit include; add `shared/contracts/store-appearance.ts`; change the seller read to `SellerStoreAppearance` with `UNKNOWN_STORED_THEME` and logo resolution inside the use case; adapt the editor loader minimally so `unknown_theme` keeps today's load error until T3.
**Out of scope:** URL paths, texts, locale keys, catalog styling, API endpoints, mobile code, Prisma.
**Acceptance criteria:**
1. `grep -r "checkout-appearance\|data-checkout-\|--checkout-" apps/core shared` finds nothing except URL paths, `CompanyCheckoutAppearance`/`CheckoutTheme` in Prisma, and locale keys.
2. Core unit, integration and E2E suites pass with the renamed titles; no screen changes visibly (checkout, editor and catalog render as before).
3. A repository fake returning `UNKNOWN_STORED_THEME` makes `getStoreAppearance` return `{ kind: "unknown_theme" }`; `prisma migrate diff` reports no change.
4. `shared/contracts/store-appearance.ts` parses `{ kind: "readable", appearance: { theme: "noche", logo: null } }` and rejects `{ theme: "rojo", logoImageId: null }`.
**Tests:** the first four core unit titles of §14 and the moved `shared/store-themes.test.ts`.
**Depends on:** nothing.

### T1. Store appearance API for mobile

**Scope:** `GET`/`PUT /api/store-appearance` per §8 with request operations; integration tests.
**Out of scope:** web editor, mobile client, image API changes.
**Acceptance criteria:**
1. With a mobile bearer token of company A, `PUT { theme: "suave", logoImageId: <A's image> }` returns 200 and `GET` returns Suave with that logo URL; the checkout of an A order shows Suave.
2. `PUT` with B's image id returns 422 `INVALID_IMAGE`; with `theme: "rojo"` or an extra `color` key returns 400 `INVALID_STORE_APPEARANCE`; the published appearance is unchanged.
3. Without a token returns 401; without a company 403 (existing `/api` behavior).
**Tests:** every core integration title of §14 whose subject is the store appearance API, plus the publication-independence title.
**Depends on:** T0.

### T2. Themed public catalog

**Scope:** catalog pages, header, grid, cards, search, «Ver más», empty and no-results messages, product page, «Este producto ya no está disponible», cart button, sheet, lines and notices in the store theme; `catalogBrowse.storeAppearance`; fixed color scheme handles; catalog parts in `store-theme.css`; presentational `CatalogProductCard` and `CatalogCartButtonFace` exported for T5; buyer E2E.
**Out of scope:** editor, preview, texts, layout, cart rules, «Catálogo no disponible» and the load error (stay unthemed).
**Acceptance criteria:**
1. A company on Noche: `/catalogo/:id` is dark with a light system preference; header, cards, product page and cart use Noche values; the checkout after **Continuar** is Noche.
2. A company on Suave: card photos are square, clipped by 16 px card corners; product page photo has 16 px corners and no filter; cart thumbnails use Suave's round thumbnail with its filter.
3. Appearance read fails: the catalog renders in Clásico without logo, logs `unable_to_read_catalog` with `read_appearance`, and the buyer can add and continue.
4. A deactivated product of a Noche catalog shows «Este producto ya no está disponible» in Noche with 404; a hidden catalog shows «Catálogo no disponible» following the system scheme.
5. The theme-style tests pass for every catalog part in the five themes, including the contrast rows of the sold-out badge and search border.
**Tests:** the catalog-related core unit titles of §14 and the first two E2E titles.
**Depends on:** T0.

### T3. «Apariencia de la tienda» web editor and Settings → Catálogo

**Scope:** new paths `settings/store-appearance` (+ preview path) plain and localized, 308 redirect from the old editor path, menu item text, editor loader/action of §5.4 without `catalogPreview`, independent appearance and publication parts with their errors and **Reintentar**, publication card (`app/components/catalog-publication-card.tsx`) outside the draft, unknown-theme notice and starting point, new hint and dimension text for logo uploads, Settings → Catálogo without switch with notice and link, es and pt-BR texts, logger path patterns, renamed editor E2E specs.
**Out of scope:** the «Catálogo | Checkout» selector and the catalog view (T5); the checkout preview label change (T5).
**Acceptance criteria:**
1. `/es-PE/settings/checkout-appearance?x=1` and `/settings/checkout-appearance` answer 308 to the store appearance editor with the same prefix and query.
2. Turning off **Publicar catálogo** asks «¿Ocultar tu catálogo?», hides the catalog, and shows no «Cambios sin guardar»; with the network down the switch returns to on with «No pudimos guardar el cambio».
3. With `catalogSettings.get` failing, the editor edits and saves logo and theme; with the appearance read failing, the card publishes and hides.
4. With the read returning `unknown_theme`, the editor shows Clásico, no logo, the notice, no badge, no **Descartar**, no **Restablecer apariencia**, and **Guardar cambios** enabled; saving stores Clásico and removes the notice.
5. Settings → Catálogo published shows link, **Copiar link**, **Ver catálogo** and the notice; hidden shows only «Tu catálogo está oculto…»; both with **Ir a Apariencia de la tienda**. pt-BR panel shows every new text in Portuguese.
**Tests:** the editor, redirect, Settings → Catálogo and web 413 core unit titles of §14; the redirect E2E title; renamed existing editor specs.
**Depends on:** T0.

### T4. Mobile «Apariencia de la tienda»

**Scope:** everything in §10: store-appearance feature, logo decision and upload, JPEG fitter extraction, theme samples from `@shared/store-themes`, save bar, leave confirmation, unknown-theme start, independent loading, publication card extraction, Settings menu row, Settings → Catálogo changes with focus re-read, es and pt-BR.
**Out of scope:** live preview, **Restablecer apariencia**, any core change.
**Acceptance criteria:**
1. Uploading a transparent PNG sends `image/png` with the original bytes; choosing Suave and saving sends `PUT { theme: "suave", logoImageId }` and shows «Apariencia actualizada» under the description.
2. A GIF, a 12 MB PNG and a 9000 px PNG show their texts without any request; a HEIC and a 48 MP camera photo upload as JPEG within the limits.
3. Hiding from the new screen asks for confirmation; going back to Catálogo shows the hidden state without link or **Compartir**.
4. With unsaved theme, switching to Pedidos and back keeps the draft without asking; going back out asks **Seguir editando** / **Descartar y salir**.
5. Device language pt-BR shows every new text in Portuguese.
**Tests:** every mobile Jest title of §14.
**Depends on:** T0 (contract and themes). End-to-end on device needs T1 merged.

### T5. Catalog view in the editor preview

**Scope:** `previewCatalogCards` and `readStoreCurrency` (§5.5, §7); `catalogBrowse.previewCards`; streamed `catalogPreview` in the editor loader; preview message with `surface` and `catalog`; preview route rendering both surfaces; `app/components/catalog-preview.tsx` with header, search, up to three cards and the cart button face, inert and `aria-hidden`; three sample catalog cards in fixtures; selector **Catálogo** | **Checkout** opening on Catálogo, labels for both views (replacing «Vista previa · Datos de ejemplo»), es and pt-BR; E2E.
**Out of scope:** real catalog styling (T2), editor sections (T3).
**Acceptance criteria:**
1. A company with five visible products sees its three newest with «Tema Clásico · Tus productos» and the cart button «Carrito» with badge «1»; one with two sees two; one with none, or whose read fails, sees three samples with «Datos de ejemplo».
2. While the cards load the view shows the draft theme with three placeholders and «Cargando productos», never samples first.
3. Choosing Noche repaints the catalog view at once; switching to **Checkout** shows Noche with the device choice kept; switching back keeps the draft; the published catalog stays Clásico.
4. A hidden catalog still shows the catalog view.
**Tests:** the preview-related core unit titles, the preview-cards unit and integration titles, and the third E2E title of §14.
**Depends on:** T2, T3.

### T6. Docs promotion and final verification

**Scope:** rewrite `docs/public-catalog.md` (theme, fixed scheme, product-unavailable themed, publication location) and `docs/checkout.md#appearance` (store appearance, editor path, preview selector, mobile editor, API, theme values in `shared/`), delete both drafts; run every suite.
**Out of scope:** code changes beyond fixes found by the run.
**Acceptance criteria:** permanent docs follow the documentation skill; all core and mobile suites pass; the manual checks of §14 are reported in the pull request.
**Depends on:** T1, T2, T3, T4, T5.

### Final verification

The manual checks listed at the end of §14, on an iPhone, an Android phone and a phone browser; results go in the pull request description.

## 17. Open items and questions

Questions (answer with the option number):

1. How far does the rename from «checkout appearance» to «store appearance» go in code?
   (1) Module, symbols, CSS hooks and variables, log events and e2e files; database table and enum unchanged. Recommended: one name per concept in code and contracts, no migration, done once as the mechanical T0 before parallel work.
   (2) Module and symbols only; keep `--checkout-*`, `data-checkout-*` and log names. Smaller T0 (about 25 files fewer), but catalog elements carry `data-checkout-part` hooks and two names coexist.
   (3) Also rename the table, enum and RLS policy with a migration (`ALTER … RENAME`, no data loss). Fully consistent, but adds a migration task the product did not ask for.

2. A stored logo whose image cannot be resolved: the product draft says the editor shows the load error «as today» and buyers see Clásico without logo, but today the editor shows the stored theme with no logo and buyers keep the theme without logo. The composite foreign key makes a missing image record impossible; only a URL-resolution failure reaches this case.
   (1) Keep today's code behavior and correct the product wording on promotion. Recommended: the checkout stays unchanged as the change map requires, and the seller can upload the logo again.
   (2) Follow the product text: editor load error, buyers Clásico without logo. Changes checkout behavior and needs the public read to treat an unresolved logo as fallback.

Decided unless objected:
- Theme values move unchanged to `shared/store-themes.ts` as the single source for core and mobile; the contrast test moves with it.
- No migration: `CompanyCheckoutAppearance`, `CheckoutTheme` and the RLS policy keep their names.
- Mobile endpoints are `GET`/`PUT /api/store-appearance`; logo upload and publication reuse `POST /api/images` and `/api/catalog/settings` unchanged.
- The web editor keeps its loader/action transport; the action takes an `intent` (`save-appearance` \| `set-publication`); Settings → Catálogo loses its action.
- The product-unavailable page is loader data with status 404 so it keeps the theme; «Catálogo no disponible» and the load error stay in the error boundary, unthemed.
- The catalog preview reads up to three cards without the publication check (`previewCatalogCards`), streamed from the editor loader into one iframe that renders both surfaces.
- The publication card is a catalog component composed by the route files on web and mobile, so store-appearance never imports catalog.
- Mobile logo limits match the server (10 MB, 8000 px, 24 MP); HEIC and camera photos reuse the product-photo JPEG fitter, extracted to `apps/mobile/src/shared/infrastructure/jpeg-fitting.ts`.
- On web, a 413 from the image API shows the dimensions text, since bytes are checked before uploading.
- «Agotado» uses the theme's opaque warning tone so its contrast is tested.
- Log events and request operations are renamed to the store name (no production to keep searches for).
- Five implementation tasks in three waves plus a docs task; T5 waits for T2 and T3.
