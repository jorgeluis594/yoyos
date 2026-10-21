# Fixed checkout themes: technical design

**Status:** design closed, pending implementation. Based on `docs/drafts/checkout-themes.md`. Base: `jorgeluis594/temas-de-checkout-fijos-el-comerciante-e` at `f2e8649b`.

## 1. Technical goal

The company's checkout appearance stores a logo and one theme identifier (`classic`, `boutique`, `antojo`, `suave`, `noche`) instead of a brand color and a background. Five theme definitions live in code as closed sets of colors, fonts, type, shape, shadow, spacing, logo plate and thumbnail values translated from `temas.css`, and their contrast is checked by a unit test. `CheckoutTheme` emits the active theme's values as variables scoped to the checkout subtree, with a fixed light or dark mode. One static stylesheet maps those variables onto the existing checkout parts. Each product row of the public checkout gains the current photo of the product, resolved by products and exposed by the orders read projection. The public catalog stops reading color and background and keeps the default Yoyos look with logo and name.

```text
Seller editor ──POST {logoImageId, theme}──▶ checkout-appearance ──▶ CompanyCheckoutAppearance(theme, logoImageId)
                                                    │
Buyer /checkout/:companyId/:orderId                 ▼ getPublic → { logoUrl, theme }
  ├─ orders.getCheckout ──findItemPhotos──▶ products.findVariantPhotos ──▶ images (batch URLs)
  └─ CheckoutShell ─▶ CheckoutTheme(theme) ─▶ scoped variables + checkout-theme.css + theme fonts
Public catalog ──getPublic──▶ logoUrl only (default Yoyos tokens)
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Stored model | `CompanyCheckoutAppearance` keeps `logoImageId` and gains `theme` (Postgres enum `CheckoutTheme`, `NOT NULL DEFAULT 'classic'`). `brandColor`, `background` and their enums are removed. |
| When old columns and enums are dropped | In the same migration that adds `theme`. The product discards the old values (nothing is converted or kept), the old columns are `NOT NULL` without default so new inserts would fail if they stayed, and the deploy runs the migration before starting the new `web`. The only exposure is the deploy window, in which an old `web` process reading the dropped columns gets `PERSISTENCE_UNAVAILABLE`: the checkout falls back to the default look and still confirms and pays, and the editor shows its retryable error. |
| Existing companies | Every existing row gets `classic` through the column default; its `logoImageId` is untouched. Companies without a row keep reading `null`, which means Clásico without logo. No color-to-theme mapping. |
| Theme identifiers | `classic`, `boutique`, `antojo`, `suave`, `noche`, fixed by the CTO. The visible names (Clásico, Boutique, Antojo, Suave, Noche) are proper names stored in the theme catalog, not in translations. |
| Where theme values live | `apps/core/src/features/checkout-appearance/domain/checkout-themes.ts`, as typed data. Every color is an opaque HEX so contrast is computable; the translucent values of `temas.css` (Boutique separators, Suave card) are pre-composited over the theme background. |
| How themes reach the checkout | `CheckoutTheme` emits the active theme's variables in a `<style>` scoped to its own subtree, as today. A static stylesheet `presentation/checkout-theme.css` maps the variables onto the checkout's existing `data-slot` attributes (shadcn) and onto a closed list of `data-checkout-part` attributes. Shared UI components in `app/components/ui/` are not changed. |
| Fixed mode | Applies only to pages that render a theme: the themed buyer checkout and the editor preview. Their routes export `handle.colorScheme`, a function of the route's loader data that returns `"fixed"` or `"system"`. `root.tsx` calls it for the matched route; on `"fixed"` it renders `<html data-color-scheme="fixed">` and its head script leaves `.dark` off. `CheckoutTheme` adds `.dark` and `color-scheme: dark` to its own subtree only for Noche. On a themed page, neither the buyer's system preference nor the stored `yoyos-theme` preference has any effect. |
| «Enlace no disponible» | Keeps today's behavior: default Yoyos tokens, no branding, light or dark per the buyer's system preference (or `yoyos-theme`). The checkout route's `handle.colorScheme` returns `"system"` when there is no loader data (the loader threw for an invalid, unknown or not-enabled link) or the data has no checkout. |
| Fonts | Self-hosted variable fonts from `@fontsource-variable/*`: Playfair Display, Fredoka, Nunito and Outfit, added to `apps/core/package.json`; Inter is already global. Their `@font-face` rules are imported by the checkout presentation; the browser downloads a font file only when rendered text uses its family, and only the Latin subset, so a buyer downloads only the active theme's fonts. Clásico uses the system sans stack. `font-display: swap` (the Fontsource default) shows the fallback stack while a font loads or when it fails. |
| Boutique serif | Only the `heading` family is serif; labels, fields, prices, totals and buttons use the `body` family. Product names use `productName`, which is the serif family in Boutique, as in `temas.css`. |
| Contrast adjustments | Adjusted in the catalog during implementation with one rule: keep hue and chroma (OKLCH), move lightness in the direction that increases contrast until the floor passes, round to HEX. Each adjusted value carries a comment with its `temas.css` original. The PR lists every one with before/after captures. |
| Antojo button | `primary` `#FF5A4E`, `primary-foreground` `#2A1A12`. |
| Mockup structure not copied | Section numbering («01»), the 390 px body and the mockup's section order are not reproduced. Only values are translated. |
| Thumbnail photo | The current photo of the product of each order item, resolved through the item's `variantId` regardless of product or variant status. A deleted variant or a product without photo shows the marker. Not copied into the order. |
| Thumbnail data path | Products owns the photo: new capability `products.findVariantPhotos(variantIds)` returns public URLs using the existing batch image resolution. Orders injects it into `getOrderCheckout`; the presentation projects it as `imageUrl` per item. |
| Photo failure | Decorative: if the lookup fails, the checkout loads with markers in every row. One log entry per failure, owned by the adapter that knows it. |
| Public checkout contract | `publicCheckoutSchema.items[]` gains `imageUrl: string (http/https URL) | null`. Web only; mobile does not consume this schema. |
| Public appearance contract | `publicCheckoutAppearanceSchema` becomes `{ logoUrl, theme }`. The preview message drops `mode`. |
| Public catalog | `CatalogShell` stops wrapping its page in `CheckoutTheme`; it uses the global Yoyos tokens and receives only `logoUrl`. `catalogPalette` and `surface="catalog"` are removed. |
| Logo plate | Always white `#FFFFFF`; the theme sets height, placement (`start` or `center`), radius, border and shadow. The logo keeps `object-contain`, so it is never cropped or distorted. The catalog uses the same header with the default plate values, which equal today's look. |
| Payment and QR images | Shown on a white plate with padding in every theme, by marking the image container as a `payment-image` part. Receipts are text links today and stay so. |
| Html background | `CheckoutTheme` also paints `html:has([data-checkout-theme="<scope>"])` with the theme background, so overscroll on a phone never shows a white band around Noche. The selector only matches a page that contains that checkout. |
| Preview sample photo | A static same-origin file `apps/core/public/checkout-preview/sample-product.svg` used by the first sample item; the second has no photo. |
| Observability | `checkout_appearance_saved` replaces `brandColor` and `background` with `theme`. The checkout request is tagged with `checkoutTheme`. New `order_checkout_photos_unavailable`. |
| Stories | One story per theme in `checkout-theme.stories.tsx`, plus one with the three test logos per theme. |
| Docs | In a separate documentation step after verification, outside this plan: `docs/checkout.md` «Appearance» is rewritten for themes and its public projection mentions the photo URL; `docs/public-catalog.md` stops saying the catalog uses color and background; both drafts and `checkout-themes-reference/` are deleted. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Appearance model | `apps/core/src/features/checkout-appearance/domain/checkout-appearance.ts` | `CheckoutAppearance = { logoImageId, brandColor, background }`, `checkoutBrandColors` (9), `checkoutBackgrounds` (3), `defaultCheckoutAppearance = { null, "yoyos", "medium" }`, strict Zod `parseCheckoutAppearance`, `isDefaultCheckoutAppearance`. Replaced. |
| Color catalog | `checkout-appearance/domain/checkout-colors.ts` (+ test, 268 lines) | Nine palettes, 15 tones per mode expanded to 19 tokens; `catalogPalette` for the public catalog; contrast test over 54 variants. Deleted; the contrast helpers of its test are reused in the themes test. |
| Use cases | `checkout-appearance/application/checkout-appearance.ts` | `getCheckoutAppearance`, `saveCheckoutAppearance` (parse, check logo image, upsert), `getPublicCheckoutAppearance` → `default | custom | fallback`, `getCheckoutAppearancePreview`. Kept; types change. |
| Repository | `checkout-appearance/infrastructure/checkout-appearance-repository.ts` | `loadCheckoutAppearance` selects `logoImageId, brandColor, background` and parses; `persistCheckoutAppearance` upserts the whole appearance; P2003 → `INVALID_IMAGE`. Select and write change to `theme`. |
| Composition | `checkout-appearance/composition.ts`, `index.ts` | Logs `checkout_appearance_saved` with `brandColor`, `background`, `isDefault`; `getPublic` runs in `withTenantIsolation`. `index.ts` re-exports color catalog items. |
| Theme rendering | `checkout-appearance/presentation/checkout-theme.tsx` | `CheckoutTheme({ appearance, surface })` emits `[data-checkout-theme=scope]{light}` and `.dark [scope]{dark}`; no style when `appearance` is `null`. Rewritten. |
| Brand header | `checkout-appearance/presentation/checkout-brand-header.tsx` | White box with border, `h-10 max-w-40`, `object-contain`, hides itself when the logo fails. Kept, values become variables. |
| Editor | `apps/core/app/routes/checkout-appearance-settings.tsx`, `presentation/brand-color-dialog.tsx`, `presentation/editor-draft.ts` | Logo card, `BrandColorDialog`, background `ToggleGroup`, reset, save via fetcher JSON, leave blocker, phone tabs/desktop grid. Color and background controls replaced by a theme list. |
| Preview | `presentation/checkout-preview-frame.tsx`, `preview-protocol.ts`, `checkout-preview-page.tsx`, `preview-fixtures.ts`, `app/routes/checkout-appearance-preview.tsx` | Iframe, device/mode/state switches; route toggles `.dark` from `draft.mode`. Mode removed. |
| Schemas | `presentation/checkout-appearance-schemas.ts` | `publicCheckoutAppearanceSchema { logoUrl, brandColor, background }`, preview message with `mode`. Changed. |
| Checkout route | `apps/core/app/routes/checkout.tsx` | `loadAppearance` parses `getPublic` and tags `checkoutAppearance`; `serialize` parses `CheckoutView` with `publicCheckoutSchema`. |
| Checkout sections | `apps/core/app/components/checkout-sections.tsx` | `CheckoutShell`, `CheckoutOrderSummary` (rows without photo), `CheckoutReviewFields`, `CheckoutConfirmAction`, `CheckoutBuyerDetails`, `CheckoutPayment`. Shared by checkout and preview. |
| Delivery fields | `apps/core/app/components/checkout-delivery-fields.tsx` | Radio list of methods in a bordered group, agency cascade. |
| Payment content | `apps/core/src/features/orders/presentation/buyer-payment-content.tsx` | Payment images `object-contain` inside a `bg-card` section (no white plate); receipts are links. Used only by `checkout-sections.tsx`. |
| Catalog shell | `apps/core/app/components/catalog-sections.tsx`, `src/features/catalog/browse-composition.ts` | `CatalogShell` wraps in `CheckoutTheme surface="catalog"`; `appearance()` returns the custom appearance. `CatalogProductImage` already shows the initial marker. |
| Checkout read | `orders/application/checkout.ts` `getOrderCheckout`, `orders/domain/checkout.ts` `checkoutView`, `orders/infrastructure/checkout-repository.ts` | View items are `Pick<OrderItem, productName, variantAttributes, sku, quantity, unitPrice, subtotal>`; `variantId` exists on `OrderItem` but is dropped. No product or image read. |
| Order item → photo | `prisma/schema.prisma` `OrderItem.variantId` → `ProductVariant.productId` → `Product.imageId` → `Image` | Composite company-scoped foreign keys. One photo per product. |
| Batch image URLs | `products/composition.ts` `listImages` (`resolveListImages` + `reportListImageFailures`), `shared/images/application/images.ts` `getImages` | Batch resolution with per-image failures, one log per listing. `shared/images/index.ts` exports only single-image helpers. |
| Variant lookup | `products/infrastructure/order-stock.ts` `findSellableVariants` | Returns `imageId` but filters active variants and products. Not reused: an inactive product must still show its photo. |
| Fonts and tokens | `app/app.css`, `app/design-theme.ts`, `docs/design-tokens.json`, `app/root.tsx` | Inter Variable global; tokens injected as `:root{…}.dark{…}`; `@custom-variant dark (&:is(.dark *))`; head script toggles `.dark` on every route from `yoyos-theme` or the system. |
| Semantic tokens | `docs/design-tokens.json` | `destructive*`, `success`, `success-surface`, `warning`, `warning-surface`, `error`, `error-surface`, `info`, `info-surface` per mode. |
| Persistence | `prisma/schema.prisma` `CompanyCheckoutAppearance`; migration `20261010142043_add_company_checkout_appearance` | RLS `company_checkout_appearance_isolation`, FK to `Image(companyId, id)` `ON DELETE RESTRICT`; access through `scripts/provision-role.sql`. |
| Translations | `apps/core/app/locales.ts` (`es` line 73, `pt` line 213) | Color and background keys, `invalidAppearance`, `description`. |
| Tests | `tests/e2e/checkout-appearance*.spec.ts`, `checkout-appearance-fixtures.ts`, `app/routes/checkout.test.ts`, `app/components/catalog-sections.test.tsx`, feature unit and integration tests | Written for colors and backgrounds. Updated or replaced as listed in section 14. |
| Deploy | Compose `migrate` service completes before `web` and `worker` start (repository memory) | Single stack, no rolling deploy. Production exists at yoyos.lat. |

## 4. Gaps this design closes

1. The appearance stores color and background instead of a theme (§6, §7).
2. No closed theme definitions with fonts, shape, spacing, logo plate and thumbnail values exist (§6.2).
3. The checkout follows the buyer's system dark mode; themes need a fixed mode (§12.3).
4. The checkout parts have no hook to receive non-color values without touching shared UI components (§12.2).
5. The checkout read projection has no product photo (§5.4, §8).
6. The editor offers colors and backgrounds and the preview a light/dark switch (§12.4).
7. The public catalog depends on the retired color and background (§12.5).
8. Payment images have no white plate on a dark theme (§12.2).

## 5. Use cases

### 5.1 `saveCheckoutAppearance` (checkout-appearance, modified)

- **input:** `value: unknown` (request body), parsed to `CheckoutAppearance = { logoImageId: ImageId | null; theme: CheckoutThemeId }`.
- **access:** `companyId: CompanyId` and `userId: UserId` from the session (unchanged).
- **deps:** unchanged: `save(companyId, appearance): Promise<Result<null, StorageFailure>>`, `imageAvailable(companyId, imageId): Promise<Result<boolean, StorageFailure>>`.
- **output:** `Result<CheckoutAppearance, CheckoutAppearanceFailure>`.
- **errors:** `INVALID_CHECKOUT_APPEARANCE` (unknown theme, `brandColor` or `background` sent, extra keys), `INVALID_IMAGE`, `PERSISTENCE_UNAVAILABLE`.
- **flow:** 1) parse strictly; 2) if there is a logo, check it is an available image of the company; 3) upsert logo and theme together; 4) return the saved appearance.

### 5.2 `getPublicCheckoutAppearance` (checkout-appearance, modified)

- **input:** `companyId`. **deps:** `load`, `imageUrl` (unchanged).
- **output:** `PublicAppearanceResult = { kind: "default" } | { kind: "custom"; appearance: { logoUrl: string | null; theme: CheckoutThemeId } } | { kind: "fallback" }`.
- **flow:** unchanged. `default` and `fallback` render Clásico without logo.

### 5.3 `getCheckoutAppearance`, `getCheckoutAppearancePreview` (checkout-appearance)

Unchanged signatures; they carry the new `CheckoutAppearance`. The default is `{ logoImageId: null, theme: "classic" }`.

### 5.4 `getOrderCheckout` (orders, modified)

- **input:** none beyond access. **access:** `CheckoutAccess = { companyId, orderId }` (unchanged).
- **deps:**

```ts
export type CheckoutPhotoError = Readonly<{ code: "PHOTOS_UNAVAILABLE"; message: string }>;
export type GetOrderCheckoutDependencies = Pick<CheckoutDependencies, "findOrder"> & Readonly<{
  /** Public URL of the current photo of each variant's product; variants without photo are absent. */
  findItemPhotos: (variantIds: readonly VariantId[]) => Promise<Result<ReadonlyMap<VariantId, string>, CheckoutPhotoError>>;
}>;
export async function getOrderCheckout(access: CheckoutAccess, deps: GetOrderCheckoutDependencies): Promise<Result<CheckoutPage, CheckoutError>>
```

- **output:** `CheckoutPage = Readonly<{ checkout: CheckoutView; photos: ReadonlyMap<VariantId, string> }>`.
- **errors:** unchanged (`CHECKOUT_UNAVAILABLE`, `INVALID_CHECKOUT`, `PERSISTENCE_UNAVAILABLE`). A photo failure is never an error of this use case.
- **flow:** 1) validate access; 2) load the order; 3) verify ownership and build `checkoutView`; 4) call `findItemPhotos` with the distinct `variantId`s of the items; 5) if it fails, use an empty map (photos are decorative); 6) return view and photos.
- `confirmOrderCheckout` and `confirmCheckoutDelivery` do not change: their results are not rendered (the route redirects to the loader on success; on `TOTAL_CHANGED` it reloads with `orders.getCheckout`).

### 5.5 `findVariantPhotos` (products, new)

- **input:** `variantIds: readonly VariantId[]` (at most the items of one order). **access:** the company is the active tenant context (`withTenantIsolation` of `orders.getCheckout`); RLS scopes the query.
- **deps:**

```ts
export type VariantPhotoRow = Readonly<{ variantId: VariantId; imageId: ImageId | null }>;
export type VariantPhotoDependencies = Readonly<{
  findVariantImages: (variantIds: readonly VariantId[]) => Promise<Result<readonly VariantPhotoRow[], ProductReadError>>;
  images: ListImageDependencies; // existing batch resolve + report
}>;
export async function findVariantPhotos(variantIds: readonly VariantId[], deps: VariantPhotoDependencies): Promise<Result<ReadonlyMap<VariantId, string>, ProductReadError>>
```

- **errors:** `ProductReadError` from the variant query (`PERSISTENCE_UNAVAILABLE`).
- **flow:** 1) return an empty map for no ids; 2) load `{ variantId, product.imageId }` for the ids, any status; 3) resolve distinct image ids with `images.resolve`; 4) report image failures with `images.report` (existing `product_list_images_unavailable`); 5) map each variant with a resolved URL. A variant whose image fails or is missing is absent.
- Owner of the photo concept: products (4.8). It reuses `withImages`' rule: unresolved photos degrade to absence, they do not fail the call.

## 6. Domain and typing

### 6.1 Appearance (`checkout-appearance/domain/checkout-appearance.ts`)

```ts
export type CheckoutAppearance = Readonly<{ logoImageId: ImageId | null; theme: CheckoutThemeId }>;
export const defaultCheckoutAppearance: CheckoutAppearance = { logoImageId: null, theme: defaultCheckoutTheme };
const appearanceSchema = z.strictObject({ logoImageId: z.uuid().nullable(), theme: z.enum(checkoutThemeIds) });
```

- `checkoutBrandColors`, `checkoutBackgrounds`, `CheckoutBrandColor`, `CheckoutBackground` and `HexColor` move out: `HexColor` moves to `checkout-themes.ts`, the others are deleted.
- `isDefaultCheckoutAppearance` compares logo and theme. `CheckoutAppearanceError` is unchanged; `invalidFields` names `theme` for an unknown theme and the extra key names for `brandColor` or `background`.

### 6.2 Theme catalog (`checkout-appearance/domain/checkout-themes.ts`, new)

New file because no existing type holds non-color values; it replaces `checkout-colors.ts`.

```ts
export const checkoutThemeIds = ["classic", "boutique", "antojo", "suave", "noche"] as const;
export type CheckoutThemeId = (typeof checkoutThemeIds)[number];
export const defaultCheckoutTheme: CheckoutThemeId = "classic";
export type HexColor = string & { readonly __brand: "HexColor" };
/** A CSS value written in this file only; never seller data. */
export type CssValue = string & { readonly __brand: "CssValue" };
export type CheckoutFontFamily = "system" | "inter" | "playfair-display" | "fredoka" | "nunito" | "outfit";

export const checkoutColorTokens = [/* list in the table below */] as const;
export type CheckoutColorToken = (typeof checkoutColorTokens)[number];
export const checkoutStyleTokens = [/* list in the table below */] as const;
export type CheckoutStyleToken = (typeof checkoutStyleTokens)[number];

export type CheckoutThemeDefinition = Readonly<{
  id: CheckoutThemeId;
  name: string;                       // Clásico, Boutique, Antojo, Suave, Noche
  mode: "light" | "dark";             // Noche dark, the rest light
  colors: Readonly<Record<CheckoutColorToken, HexColor>>;
  /** Page background image painted over `background` (Suave's gradient), or null. */
  backgroundImage: Readonly<{ css: CssValue; stops: readonly HexColor[] }> | null;
  fonts: Readonly<{ body: CheckoutFontFamily; heading: CheckoutFontFamily; productName: CheckoutFontFamily; button: CheckoutFontFamily }>;
  style: Readonly<Record<CheckoutStyleToken, CssValue>>;
  logo: Readonly<{ placement: "start" | "center"; height: CssValue; radius: CssValue; border: CssValue; shadow: CssValue }>;
  thumbnail: Readonly<{ width: CssValue; ratio: "1 / 1" | "4 / 5"; radius: CssValue; border: CssValue; filter: CssValue }>;
}>;
export const checkoutThemes: Readonly<Record<CheckoutThemeId, CheckoutThemeDefinition>>;
```

`Record` over closed token lists makes a missing value a type error, so no theme can inherit a value from another. `stops` lists the gradient colors so contrast is checked against each.

The payment chips' own border (`payment-border`) is decorative and not part of the 3:1 floor in Boutique and Noche, where it takes the card border `--border`, because each chip holds a radio whose own border passes (`control`) and the selected chip adds its outline or fill.

**Color tokens.** Every theme defines all of them as opaque HEX. Sources are `temas.css` variables of the same theme; the semantic tokens start from `docs/design-tokens.json` of the theme's mode.

| Token | Used for | `temas.css` source |
| --- | --- | --- |
| `background` | Page | `--bg-solid` |
| `foreground`, `card-foreground`, `popover-foreground`, `secondary-foreground` | Body text | `--text` |
| `heading` | Titles, store name | `--heading` |
| `card`, `popover` | Section surfaces | `--card-bg` (composited) |
| `muted`, `secondary` | Muted surfaces, hover | derived: `--sel-bg` or a tone between card and background |
| `muted-foreground` | Secondary text, variant, quantity | `--muted` |
| `label` | Field labels | `--label` |
| `placeholder` | Input placeholders | `--placeholder` |
| `input-surface` | Field background | `--input-bg` (composited) |
| `input` | Field boundary: border, underline (Boutique) or group border (Noche) | `--input-border` / `--input-shadow` / `--group-border` |
| `control` | Radio and unselected option boundary | `--radio-border`, `--opt-border` |
| `selected`, `selected-surface` | Selected option boundary and surface | `--sel-border` (or `--accent` when transparent), `--sel-bg` |
| `border` | Decorative separators and card borders | `--card-border`, `--row-sep`, `--header-border` |
| `primary`, `primary-foreground`, `primary-hover`, `primary-pressed` | Main button | `--btn-bg`, `--btn-text`; hover and pressed one lightness step each |
| `accent`, `accent-foreground` | Soft highlight surface (select highlight, hover) and its text; they keep the shadcn meaning | `accent` is `selected-surface`; `accent-foreground` is `foreground` |
| `accent-strong` | Radio dot | `--accent` |
| `link` | Text links on the card (receipts link) | `--accent`, adjusted to 4.5:1 on `card` |
| `ring` | Keyboard focus | `--accent` (or `--text` when the accent fails 3:1) |
| `free` | «Gratis» | `--free` |
| `thumbnail-surface` | Marker block | `--tb` |
| `destructive`, `destructive-foreground`, `destructive-hover`, `destructive-pressed`, `success`, `success-surface`, `warning`, `warning-surface`, `error`, `error-surface`, `info`, `info-surface` | Semantic states | `design-tokens.json`, light for four themes and dark for Noche, adjusted only if they fail on the theme surfaces |

**Style tokens.** CSS values, one per token, all from the same theme in `temas.css`.

| Group | Tokens | `temas.css` source |
| --- | --- | --- |
| Type sizes | `text-body`, `text-small`, `text-section-title`, `text-order-title`, `text-store`, `text-product-name`, `text-price`, `text-label`, `text-option`, `text-total-label`, `text-total`, `text-button` | `--fs-*`; `text-order-title` follows `--fs-h2` scaled like the current `text-2xl` heading |
| Weights | `weight-body`, `weight-heading`, `weight-product-name`, `weight-price`, `weight-strong`, `weight-label`, `weight-total`, `weight-button` | `--fw-*` |
| Letter case and spacing | `tracking-heading`, `tracking-label`, `tracking-button`, `case-label`, `case-button` | `--ls-*`, `--tt-*` |
| Radius | `radius-card`, `radius-input`, `radius-option`, `radius-button`, `radius-chip`, `radius-group` | `--radius-*` |
| Borders | `card-border`, `card-border-top`, `header-border`, `row-separator`, `option-border`, `input-border`, `input-shadow`, `group-border`, `field-separator`, `total-separator` | `--card-border*`, `--header-border`, `--row-sep`, `--opt-border*`, `--input-border`, `--input-shadow`, `--group-border`, `--field-sep`, `--total-sep` (colors written as the matching color token) |
| Shadows | `card-shadow`, `selected-shadow`, `button-shadow` | `--card-shadow`, `--sel-shadow`, `--btn-shadow` |
| Spacing | `page-padding-x`, `header-padding-y`, `section-gap`, `card-padding`, `title-gap`, `row-gap`, `row-separator-padding`, `field-gap`, `label-gap`, `field-padding`, `option-gap`, `option-padding`, `input-height`, `input-padding-x`, `button-height`, `button-gap` | `--page-pad`, `--header-pad`, `--section-gap`, `--card-pad`, `--title-mb`, `--row-gap`, `--row-sep-pad`, `--field-gap`, `--label-gap`, `--field-pad`, `--opt-gap`, `--opt-pad`, `--input-h`, `--input-pad`, `--btn-h`, `--btn-mt` |
| Header | `header-justify` | `--header-justify` |

Beyond the table, the catalog also holds the temas.css values the table omitted: `option-separator`, `option-separator-last` (`--opt-border-b`, `--opt-border-last`), `selected-outline` (`--sel-outline`), `button-border` (`--btn-border`), `option-surface` (`--opt-bg`), `group-surface` (`--group-bg`), `header-margin-bottom` (`--header-mb`) and `header-padding-x`. Where a temas.css decorative border has its own color (Clásico thumbnail, Noche header, option, field and thumbnail separators), the value is written as that opaque HEX instead of `border`. The logo definition also carries `direction` (`row` or `column`, Boutique stacks) and `padding` (pill plates need wider horizontal padding), and its plate `height` is the `--logo-size` of the theme.

Logo plate and thumbnail values come from `--logo-*` and `--thumb-*` / `--radius-thumb`, except the plate color, which is always white (product rule). `name` comes from the product draft.

**Contrast pairs** checked by the unit test for each theme (4.5:1 text, 3:1 non-text), against `background`, every gradient stop and `card` unless stated:

| Kind | Pairs |
| --- | --- |
| Text 4.5:1 | `foreground`, `heading`, `muted-foreground`, `label`, `placeholder`, `free`, `accent` (as link) on background and card; `foreground` and `placeholder` on `input-surface`; `foreground` on `selected-surface`; `primary-foreground` on `primary`, `primary-hover`, `primary-pressed`; `accent-foreground` on `accent`; `muted-foreground` on `thumbnail-surface`; `link` on card; `muted-foreground` and `free` on `selected-surface` (a checked option or payment method); `foreground` on `accent`; each semantic text on its surface and on card |
| Non-text 3:1 | `input` on `input-surface`, card and background; `control` on card and background; `selected` on card, background and `selected-surface`; `ring` on card, background and `input-surface` (focus); `accent-strong` (radio dot) on card, background and `input-surface`; `destructive` (invalid field border) on card, background and `input-surface` |

Decorative tokens (`border`, separators, shadows) are not checked.

### 6.3 Layers

| Layer | Types and authority |
| --- | --- |
| Domain (checkout-appearance) | `CheckoutThemeId`, `CheckoutThemeDefinition`, `checkoutThemes`, `CheckoutAppearance`; the only source of theme values. |
| Presentation (checkout-appearance) | Zod `publicCheckoutAppearanceSchema { logoUrl, theme }`, preview message `{ type, appearance, state }`; `checkoutThemeCss(theme, scope)` turns a definition into CSS text; font family stacks per `CheckoutFontFamily`. |
| Domain (orders) | `CheckoutView` items gain `variantId` (internal, never serialized). `CheckoutPage` pairs the view with current photos; it exists because the photos are current product data, not part of the order. |
| Application (products) | `findVariantPhotos` returns `ReadonlyMap<VariantId, string>`. |
| Shared contract | `publicCheckoutSchema.items[].imageUrl`. |

## 7. Persistence

**Schema** (`apps/core/prisma/schema.prisma`):

```prisma
enum CheckoutTheme {
  classic
  boutique
  antojo
  suave
  noche
}

model CompanyCheckoutAppearance {
  companyId   String        @id @default(dbgenerated("(NULLIF(current_setting('app.company_id'::text, true), ''::text))::uuid")) @db.Uuid
  company     Company       @relation(fields: [companyId], references: [id], onDelete: Cascade)
  logoImageId String?       @db.Uuid
  logoImage   Image?        @relation(fields: [companyId, logoImageId], references: [companyId, id], onDelete: Restrict)
  theme       CheckoutTheme @default(classic)
  updatedAt   DateTime      @updatedAt
}
```

`CheckoutBrandColor` and `CheckoutBackground` are removed.

**Migration** `replace_checkout_colors_with_themes`, generated with `pnpm exec prisma migrate dev --create-only` and reviewed with the Database Migrations skill. The reviewed SQL has this shape:

```sql
SET lock_timeout = '5s';
CREATE TYPE "CheckoutTheme" AS ENUM ('classic', 'boutique', 'antojo', 'suave', 'noche');
ALTER TABLE "CompanyCheckoutAppearance"
  ADD COLUMN "theme" "CheckoutTheme" NOT NULL DEFAULT 'classic',
  DROP COLUMN "brandColor",
  DROP COLUMN "background";
DROP TYPE "CheckoutBrandColor";
DROP TYPE "CheckoutBackground";
```

- Adding a `NOT NULL` column with a constant default is a metadata change in PostgreSQL 11+; the table has at most one row per company. The single `ALTER TABLE` takes one short exclusive lock, bounded by `lock_timeout`.
- No backfill: the default places every existing row on Clásico and `logoImageId` is untouched.
- RLS policy, foreign keys and grants are unchanged; `provision-role.sql` grants the table, not columns.
- Existing volumes are preserved; no reset.

**Reads.** `loadCheckoutAppearance` selects `logoImageId, theme` and parses the row with `parseCheckoutAppearance`; an invalid row is `INVALID_STORED_DATA` (logged once, as today). `persistCheckoutAppearance` upserts `{ logoImageId, theme }`.

**Products query.** `findVariantImages` (new, `products/infrastructure/`) reads `ProductVariant` by `id in variantIds` selecting `id` and `product.imageId`, with no status filter, inside the caller's tenant transaction; rows are validated with a Zod schema (`variantId` and nullable `imageId` UUIDs) before use.

## 8. Contracts between applications

`shared/contracts/order-checkout.ts`, `publicCheckoutSchema.items[]`:

```ts
z.strictObject({
  productName: z.string(), variantAttributes: z.record(z.string(), z.string()), sku: z.string().nullable(),
  // `z.httpUrl()` rejects IP and localhost hosts, which local storage endpoints use.
  imageUrl: z.url({ protocol: /^https?$/ }).nullable(),
  quantity: z.number().int().positive().safe(), unitPrice: checkoutMoneySchema, subtotal: checkoutMoneySchema,
})
```

- Core validates the projection with this schema in `serialize`, which builds each item without `variantId` and with `imageUrl: photos.get(variantId) ?? null`.
- Mobile does not consume `publicCheckoutSchema`; only the web checkout and the preview read it.
- No new HTTP status or error code.

`checkout-appearance/presentation/checkout-appearance-schemas.ts` (web only):

```ts
export const publicCheckoutAppearanceSchema = z.strictObject({ logoUrl: z.url({ protocol: /^https?$/ }).nullable(), theme: z.enum(checkoutThemeIds) });
export const checkoutPreviewMessageSchema = z.strictObject({
  type: z.literal("checkout-appearance:update"), appearance: publicCheckoutAppearanceSchema, state: z.enum(["review", "payment"]),
});
```

The editor action keeps its statuses: `INVALID_CHECKOUT_APPEARANCE` 422, `INVALID_IMAGE` 422, `INVALID_STORED_DATA` and `PERSISTENCE_UNAVAILABLE` 503.

## 9. Events and cross-feature integration

No event. Cross-feature capabilities:

| Capability | Exposed by | Consumed by | Failure |
| --- | --- | --- | --- |
| `products.findVariantPhotos(variantIds)` | `products/composition.ts` | `orders/composition.ts` as `findItemPhotos` of `getCheckout` | The orders composition adapter logs `order_checkout_photos_unavailable` once and returns `err({ code: "PHOTOS_UNAVAILABLE" })`; the use case shows markers. |
| `checkoutAppearance.getPublic(companyId)` | `checkout-appearance/composition.ts` | `checkout.tsx`, `catalog/browse-composition.ts` | Unchanged: `fallback` renders Clásico (checkout) or no logo (catalog). |

## 11. Transactions and concurrency

- **Save:** one upsert of `{ logoImageId, theme }` per company; the last completed save wins; no lock or version (unchanged rule). A retried save writes the same values.
- **Checkout read:** `orders.getCheckout` already runs inside `withTenantIsolation(companyId)`; the photo query runs in the same scoped transaction, read only. A photo replaced between two loads shows the new one on the next load.
- **Migration window:** the Compose `migrate` service completes before the new `web` starts. A request served by the old `web` after the drop gets `PERSISTENCE_UNAVAILABLE` from the appearance read: the checkout falls back to the default look, the editor shows its retry message.

## 12. Code organization

### 12.1 Files

| File | Change |
| --- | --- |
| `checkout-appearance/domain/checkout-themes.ts` (+ `.test.ts`) | New: ids, catalog of five themes, token lists, types. Test: contrast pairs, completeness, fixed values. |
| `checkout-appearance/domain/checkout-colors.ts` (+ test) | Deleted. |
| `checkout-appearance/domain/checkout-appearance.ts` (+ test) | `theme` replaces color and background. |
| `checkout-appearance/application/checkout-appearance.ts` (+ test) | `PublicAppearance = { logoUrl, theme }`. |
| `checkout-appearance/infrastructure/checkout-appearance-repository.ts` (+ integration test) | Select and write `theme`. |
| `checkout-appearance/composition.ts` (+ test), `index.ts` | Log `theme`; export `checkoutThemeIds`, `checkoutThemes`, `CheckoutThemeId`; drop color exports. |
| `checkout-appearance/presentation/checkout-theme-style.ts` (+ test) | New: `checkoutThemeCss(theme: CheckoutThemeId, scope: string): string` and `checkoutFontStacks`. |
| `checkout-appearance/presentation/checkout-theme.css` | New: static rules under `[data-checkout-theme]` mapping variables onto `data-slot` and `data-checkout-part` (§12.2). Not in a cascade layer, so it wins over utilities inside the scope only. |
| `checkout-appearance/presentation/checkout-theme-fonts.css` | New: imports `@fontsource-variable/{playfair-display,fredoka,nunito,outfit}/wght.css`. |
| `checkout-appearance/presentation/checkout-theme.tsx` (+ test, stories) | `CheckoutTheme({ appearance, children })`: theme from `appearance?.theme ?? defaultCheckoutTheme`; imports both stylesheets; sets `data-checkout-theme={scope}`, `data-checkout-theme-id={theme}`, `.dark` and `color-scheme` for Noche; paints `html:has(...)`. `surface` prop removed. |
| `checkout-appearance/presentation/checkout-brand-header.tsx` (+ test) | Plate and placement read `--checkout-logo-*` variables with fallbacks equal to today's look; marks `data-checkout-part="header-brand"`. |
| `checkout-appearance/presentation/product-thumbnail.tsx` (+ test) | New: `ProductThumbnail({ name, url })`: photo or marker with the capitalized initial, `alt=""`, `aria-hidden` on the marker, falls back to the marker on load error (including before hydration, as `CatalogProductImage` does); size and shape from `--checkout-thumb-*`. |
| `checkout-appearance/presentation/theme-sample.tsx` | New: static sample painted with a definition's values (background, a card, primary button, thumbnail shape), `aria-hidden`. |
| `checkout-appearance/presentation/theme-picker.tsx` (+ test) | New: `ThemePicker({ value, onChange, label, descriptions: Readonly<Record<CheckoutThemeId, string>> })`, a Radix `RadioGroup` of the five themes in catalog order with sample, name, description and check mark; `min-h-touch`; selecting the selected one changes nothing. The route passes the translated descriptions, so the component owns no translation keys. |
| `checkout-appearance/presentation/brand-color-dialog.tsx` | Deleted. |
| `checkout-appearance/presentation/editor-draft.ts` | `sameAppearance` compares logo and theme; `resetDraft` uses Clásico. |
| `checkout-appearance/presentation/checkout-appearance-schemas.ts` | §8. |
| `checkout-appearance/presentation/checkout-preview-frame.tsx` (+ test) | Mode switch, `mode` prop and `onModeChange` removed. |
| `checkout-appearance/presentation/preview-protocol.ts` tests | Messages without `mode`. |
| `checkout-appearance/presentation/preview-fixtures.ts` | Items carry `imageUrl`; the first uses `/checkout-preview/sample-product.svg`, the second `null`. |
| `apps/core/public/checkout-preview/sample-product.svg` | New static sample photo. |
| `app/routes/checkout-appearance-settings.tsx` (+ test) | «Tema» section with `ThemePicker` replaces color and background; payload `{ logoImageId, theme }`; no mode state. |
| `app/routes/checkout-appearance-preview.tsx` | Exports `handle = { colorScheme: () => "fixed" }`; no `.dark` toggle; loader returns `{ logoUrl, theme }`. |
| `app/routes/checkout.tsx` (+ test) | Exports `handle = { colorScheme: (data) => data?.checkout ? "fixed" : "system" }`, so «Enlace no disponible» keeps following the system; `serialize(page: CheckoutPage)` projects `imageUrl`; tags `checkoutTheme`. |
| `app/root.tsx` | Calls the deepest matched route's `handle.colorScheme(loaderData)` (no handle means `"system"`); when `"fixed"`, renders `data-color-scheme="fixed"` on `<html>` and the head script skips the `.dark` toggle. |
| `app/components/checkout-sections.tsx` (+ test) | Marks parts (§12.2); `ProductThumbnail` at the left of each row; groups the buyer fields in a `field-group` part. |
| `app/components/checkout-delivery-fields.tsx` | Marks `option-group`, `option`, `option-cost`, `free`. |
| `orders/presentation/buyer-payment-content.tsx` | Marks `payment-method`, `payment-image` (white plate). |
| `app/components/catalog-sections.tsx` (+ test), `catalog/browse-composition.ts` | No `CheckoutTheme`; `CatalogShell({ logoUrl, storeName, cart, children })`; `appearance()` returns `logoUrl` or `null`. Catalog routes pass `logoUrl`. |
| `app/locales.ts` | `es` and `pt`: `themeTitle`, `themeOptions` (aria label), five `theme<Id>Description`, new `description` and `invalidAppearance`; color, background, dialog and mode keys removed. |
| `orders/domain/checkout.ts`, `orders/application/checkout.ts` (+ tests), `orders/composition.ts` | `CheckoutView` items keep `variantId`; `CheckoutPage`; `getOrderCheckout` with `findItemPhotos`; composition wires `products.findVariantPhotos` and logs its failure. |
| `products/application/variant-photos.ts` (+ test), `products/infrastructure/variant-photo-repository.ts` (+ integration test), `products/composition.ts` | New capability `findVariantPhotos`. |
| `shared/contracts/order-checkout.ts` | `imageUrl` per item. |
| `apps/core/package.json`, `pnpm-lock.yaml` | Four `@fontsource-variable/*` packages. |
| `tests/e2e/checkout-appearance*.spec.ts`, `checkout-appearance-fixtures.ts` | Rewritten for themes. |
| `docs/checkout.md`, `docs/public-catalog.md`, drafts | Promoted in the separate documentation step (§2 «Docs»); not part of this plan. |

### 12.2 Styling contract between the stylesheet and the checkout markup

`CheckoutTheme` writes every color token as `--<token>` (the 19 shadcn names keep their names, so `bg-card`, `border-input`, `ring` and the `Button` variants follow the theme without changes) and every other value as `--checkout-<token>`, plus `--checkout-font-{body,heading,product-name,button}`, `--checkout-logo-*` and `--checkout-thumb-*`. The root element sets `font-family`, `font-size`, `font-weight` and the page background from them.

`checkout-theme.css` styles only these hooks, always under `[data-checkout-theme]`:

| Hook | What it gets |
| --- | --- |
| `data-slot="button"` | radius and button font; with `data-variant="default"` also height, border, shadow, size, weight, tracking, case |
| `data-slot="input"`, `data-slot="select-trigger"` | height, padding, radius, border (`input`), `input-shadow`, `input-surface`, placeholder color, body font at 16 px (prevents iOS zoom) |
| `data-slot="field-label"`, `data-slot="label"` | label size, weight, tracking, case, color, body font |
| `data-slot="radio-group-item"` | `control` border, `selected` border when checked, `accent-strong` dot |
| `:focus-visible` of buttons, fields, selects and radios, and of an option or payment method that contains the focus | `outline: 2px solid var(--ring)` with offset; the unlayered rules would otherwise replace the utilities' ring |
| `[aria-invalid="true"]` of fields and selects | `destructive` border and an inner `destructive` underline (themes without a field border) |
| `data-checkout-part="header"` | header padding, border, justify |
| `data-checkout-part="header-brand"` | placement, store name in heading font and `text-store`; the store name element takes `--checkout-font-heading` and `--checkout-weight-heading` itself, with today's semibold as fallback |
| `data-checkout-part="order-title"` | heading font, `text-order-title` |
| `data-checkout-part="card"` | surface, border, top border, radius, shadow, padding |
| `data-checkout-part="section-title"` | heading font, size, weight, tracking, `heading` color, gap |
| `data-checkout-part="product-row"`, `"product-name"`, `"product-meta"`, `"price"` | row gap and separator; product-name font; small text; price weight in body font with tabular numbers |
| `data-checkout-part="field-group"`, `"field"` | Noche's grouped fields: group border, radius, surface, field separator and padding; other themes set them to none |
| `data-checkout-part="option-group"`, `"option"`, `"option-cost"`, `"free"` | option gap, padding, radius, border, selected border, surface, shadow, outline and `foreground` text color (`[data-state=checked]` / `:has(:checked)`), «Gratis» color |
| `data-checkout-part="total"`, `"total-label"`, `"total-amount"` | separator, label in heading font, amount size and weight in body font |
| `data-checkout-part="payment-method"` | chip radius, border and surface; checked state as `.pay.selected` (selected border, surface, shadow, outline, `foreground` text) |
| `data-checkout-part="payment-image"` | white background, padding, radius from the theme; image keeps its colors |
| `data-checkout-part="status"` | semantic surfaces keep their tokens; radius from the theme |

Semantic utilities (`bg-[var(--error-surface)]` and similar) need no hook: the theme writes the semantic tokens. Text links use the `--link` variable (`text-[var(--link)]`), which passes 4.5:1 on the card in every theme. The stylesheet never sets content, order or visibility.

### 12.3 Fixed mode

`root.tsx` keeps one source of truth for the scheme of a page: a route that can render a theme declares `handle.colorScheme(loaderData): "fixed" | "system"`. The checkout route returns `"fixed"` only when its loader produced a checkout; when the loader threw (invalid, unknown or not-enabled link), `loaderData` is undefined and the result is `"system"`, so «Enlace no disponible» follows the buyer's preference as today. The preview route always returns `"fixed"`. Routes without the handle are unchanged. With `"fixed"`, `<html>` gets no `.dark`, so `dark:` variants in shared components never match outside a Noche scope. Inside Noche, `.dark` on the scope element activates them for its descendants, and the scope writes Noche's dark values for every token it uses. The seller panel and its stored preference are untouched.

### 12.4 Editor and preview

- The «Tema» section sits between Logo and Restablecer, in a `CardContent` like the others, title «Tema», with `ThemePicker`; selecting a theme calls `update({ theme })`.
- `ThemePicker` uses `ThemeSample` from the catalog values, so samples never drift from the real theme. It does not load theme fonts.
- The preview frame keeps device and state switches; the iframe receives `{ appearance: { logoUrl, theme }, state }`.

### 12.5 Public catalog

`CatalogShell` renders the global tokens with `CheckoutBrandHeader` (default plate). `catalog-sections.test.tsx` asserts the global look and that no checkout theme variables are written.

## 13. Observability

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `checkout_appearance_saved` | info | `checkout-appearance/composition.ts` after save | `["companyId", "userId", "logoImageId?", "hasLogo", "theme", "isDefault"]` |
| `invalid_stored_checkout_appearance` | error | appearance repository | `["companyId", "errorCode", "invalidFields"]` (unchanged) |
| `unable_to_load_checkout_appearance`, `unable_to_save_checkout_appearance` | error | appearance repository | unchanged |
| `http_request_completed` (`get_checkout`) | info | request logger | adds `checkoutTheme` (`classic` … `noche`) next to `checkoutAppearance` |
| `order_checkout_photos_unavailable` | error | `orders/composition.ts`, `findItemPhotos` adapter | `["companyId", "errorCode", "variantCount"]` |
| `unable_to_read_variant_photos` | error | `products/infrastructure/variant-photo-repository.ts` | `["companyId", "errorCode", "err?"]`; infrastructure event, as in the other products repositories, alongside the orders event above |
| `product_list_images_unavailable` | error | products composition (existing report) | unchanged: `["count", "codes", "imageIds"]` |

Never logged: order ids together with company ids, checkout URLs, photo or logo URLs, buyer data, amounts.

## 14. Tests

### Unit (core)

`domain/checkout-themes.test.ts`
- `test("defines the five themes in the order Clásico, Boutique, Antojo, Suave, Noche with Clásico as default")`
- `test("defines every color and style token in every theme")`
- `test("makes Noche dark and the other four themes light")`
- `test("meets 4.5:1 for every text pair of every theme, including each stop of Suave's gradient")`
- `test("meets 3:1 for field, control, selected and focus boundaries against card and background in every theme")`
- `test("keeps Antojo's coral button with dark brown text")`
- `test("uses a serif family only for Boutique headings and product names")`
- `test("sets the thumbnail size and ratio of each theme")`
- `test("writes only opaque HEX colors")`

`domain/checkout-appearance.test.ts`
- `test("accepts a logo with each of the five themes")`
- `test("rejects an unknown theme naming the theme field")`
- `test("rejects a brand color or background sent with the appearance")`
- `test("uses Clásico without logo as the default appearance")`

`application/checkout-appearance.test.ts`
- `test("saves logo and theme together")`
- `test("returns the theme and logo URL without identifiers for the public checkout")`
- `test("returns default when the company has no saved appearance")`
- `test("returns fallback when the appearance cannot be read")`

`composition.test.ts`
- `test("logs checkout_appearance_saved with the theme")`

`presentation/checkout-theme-style.test.ts`
- `test("scopes every value of the chosen theme to the checkout subtree")`
- `test("writes no value of another theme")`
- `test("writes only catalog values in the style")`
- `test("paints the page background behind the checkout")`

`presentation/checkout-theme.test.tsx`
- `test("renders Clásico when the company has no appearance")`
- `test("renders Noche dark even when the page prefers light")`
- `test("renders a light theme light even inside a dark page")`

`app/root.test.tsx` (new)
- `test("leaves the dark class off on a themed checkout whatever the system prefers")`
- `test("follows the system preference on «Enlace no disponible»")`
- `test("follows the stored preference on routes without a color scheme handle")`
- `test("keeps each theme inside its own checkout")`

`presentation/checkout-brand-header.test.tsx` (moved from the theme test)
- `test("shows the whole logo on a white plate next to the company name")`
- `test("shows only the company name when there is no logo")`
- `test("hides the logo and keeps the name when the image fails to load")`

`presentation/product-thumbnail.test.tsx`
- `test("shows the product photo as a decorative image")`
- `test("shows the capitalized initial when the product has no photo")`
- `test("shows the initial when the photo fails to load")`

`presentation/theme-picker.test.tsx`
- `test("lists the five themes in order with their sample and description")`
- `test("marks the selected theme and changes the draft when another is chosen")`
- `test("keeps the selection when the selected theme is chosen again")`

`presentation/checkout-preview-frame.test.tsx`
- `test("sends the theme draft and its own state to the preview")`
- `test("offers phone and desktop and review and payment, and no light or dark switch")`

`presentation/checkout-preview-page.test.tsx`
- `test("shows one sample product with photo and one with the marker")`

`app/routes/checkout-appearance-settings.test.ts`
- `test("loads Clásico without logo for a company without appearance")`
- `test("rejects a theme outside the five with 422")`

`app/routes/checkout.test.ts`
- `test("exposes only the logo URL and the theme")`
- `test("projects each item's current photo URL and no variant id")`
- `test("loads the checkout with markers when the photos cannot be read")`
- `test("tags the request with the checkout theme")`

`app/components/checkout-sections.test.tsx`
- `test("shows a thumbnail at the left of each product row before name, variant, quantity and subtotal")`
- `test("keeps the same sections, fields and texts in every theme")`

`app/components/catalog-sections.test.tsx`
- `test("paints the public catalog with the global Yoyos tokens and the company logo")`

`orders/application/checkout.test.ts`
- `test("returns the checkout with the current photo of each item's product")`
- `test("returns the checkout without photos when the photos cannot be read")`
- `test("asks for the photos of each variant once")`

`products/application/variant-photos.test.ts`
- `test("returns the photo URL of each variant's product")`
- `test("leaves out variants whose product has no photo or whose image cannot be resolved")`
- `test("reports image failures once")`
- `test("asks for nothing when there are no variants")`

### Integration (core, real database)

`checkout-appearance-repository.integration.test.ts`
- `test("returns the saved theme and logo of the company")`
- `test("replaces the whole appearance on later saves")`
- `test("rejects a theme outside the five at the database")`
- `test("keeps one appearance per company and never returns another company's")` (existing titles that still apply stay)

`variant-photo-repository.integration.test.ts`
- `test("returns the product image of each variant, including inactive products")`
- `test("does not return variants of another company")`

### E2E (web, happy path)

`tests/e2e/checkout-appearance.spec.ts`
- `test("publishes logo and theme together when saving and the buyer sees the theme on the next load")`
- `test("offers the five themes and no color, background or light and dark control")`

`tests/e2e/checkout-appearance-buyer.spec.ts`
- `test("shows each theme in every order state with thumbnails and markers")`
- `test("shows Clásico for a company without appearance")`

`tests/e2e/checkout-appearance-preview.spec.ts`
- `test("applies the theme draft to the preview without changing the public checkout")`

### Pending manual checks

- Each theme on a real phone (390 px) and desktop: pending, agency delivery, confirmed with payment instructions and receipt upload, cancelled; labels above fields, total visible before the payment action, «Envío a agencia» with its cost.
- Real logos: transparent dark PNG on Noche, long horizontal on Suave and Antojo, square on Boutique.
- Real product photos, with and without photo; a deleted photo URL.
- Network panel on a Boutique checkout: only Inter and Playfair Display files are downloaded; on Clásico, no font file.
- Before/after captures of every theme with an adjusted value, listed in the PR.
- Migration against a copy of a database with companies on several colors and backgrounds: all rows on Clásico with their logo.

## 15. Limits and checks during implementation

- Left out: themes in the catalog or the seller panel, per-company values, photo per variant, lead time, mobile editor (product draft).
- Verify the four `@fontsource-variable/*` package names and that each ships a `wght.css` with Latin `unicode-range`; if one has no variable build, use its static weights actually used by the theme.
- Verify that `checkout-theme.css` is emitted unlayered by the Vite/Tailwind build so it wins over utilities inside the scope, and that it never matches outside `[data-checkout-theme]`.
- Verify that Radix `Select` and `Dialog` content rendered in a portal inside the checkout (agency cascade) still receives the theme; if a portal escapes the scope, set its container to the scope element.
- Verify `html:has()` support on the target browsers (Safari 15.4+, Chrome 105+); without it only the overscroll band stays white.
- Verify no other caller of `orders.getCheckout` depends on its previous return type.
- `CheckoutView.items[].variantId` must never reach the public response; the strict schema rejects it.

## 16. Implementation plan

### Order and parallelism

```text
Wave 1 (parallel):  T1 Theme catalog and kit        T2 Product photos in the checkout data
                          │                               │
Wave 2 (parallel):  T3 Themes end to end (model,    T4 Themed checkout parts and thumbnails
                       migration, editor, preview,       (needs T1 and T2)
                       buyer wiring, catalog)
                       (needs T1; touches checkout.tsx after T2)
                          │                               │
Wave 3:             T5 Visual verification and contrast evidence (needs T3 and T4)
```

File ownership is disjoint inside each wave. Shared files touched by more than one task, always in different waves: `app/routes/checkout.tsx` and its test (T2, then T3), `preview-fixtures.ts` (T2 adds `imageUrl: null`, then T4 sets the sample photo), `checkout-theme.css` (T1, then tuned by T5).

### T1. Theme catalog and rendering kit

**Scope:** `domain/checkout-themes.ts` with the five definitions translated from `temas.css` and every value adjusted to pass the floor (§2 rule, original in a comment), and its test; `presentation/checkout-theme-style.ts` (`checkoutThemeCss`, font stacks) and test; `checkout-theme.css` with every hook of §12.2; `checkout-theme-fonts.css` and the four font packages; `ProductThumbnail`, `ThemeSample`, `ThemePicker` and their tests; `CheckoutBrandHeader` plate variables with today's values as fallbacks and its test file. Only new files plus `checkout-brand-header.tsx`, `apps/core/package.json` and the lockfile.
**Out of scope:** changing `CheckoutAppearance`, the schema, `CheckoutTheme`, any route, checkout sections or catalog.
**Acceptance criteria:**
1. `checkoutThemes.antojo.colors.primary` is `#FF5A4E` and `primary-foreground` `#2A1A12`; the contrast test passes for all five themes.
2. `checkoutThemeCss("noche", "s1")` contains Noche's `--background` and no value that only another theme has.
3. A theme definition missing one token fails `typecheck`.
4. `ProductThumbnail` with `url: null` and name «Taza blanca» renders «T» and no `<img>`.
5. The catalog header looks as before (existing catalog test green without edits).
6. Every adjusted value is listed with original and new HEX in the task's report.
**Tests:** §14 `checkout-themes.test.ts`, `checkout-theme-style.test.ts`, `product-thumbnail.test.tsx`, `theme-picker.test.tsx`, `checkout-brand-header.test.tsx`.
**Depends on:** nothing.

### T2. Product photos in the checkout data

**Scope:** `products` `findVariantPhotos` (application, infrastructure query, composition) with tests; `orders` `CheckoutView` items keep `variantId`, `CheckoutPage`, `getOrderCheckout` with `findItemPhotos`, composition wiring and `order_checkout_photos_unavailable`; `shared/contracts/order-checkout.ts` `imageUrl`; `checkout.tsx` `serialize` projection and its tests; `preview-fixtures.ts` items with `imageUrl: null`.
**Out of scope:** rendering the thumbnail, any appearance change, the confirm use cases.
**Acceptance criteria:**
1. An order with «Polo básico» (product with photo) and «Taza blanca» (no photo) loads with `imageUrl` = the polo's public URL and `null` respectively.
2. After the seller replaces the polo photo, reloading the checkout returns the new URL; the order's stored product name is unchanged.
3. With the variant query failing, the checkout loads with `imageUrl: null` on every item and one `order_checkout_photos_unavailable` log.
4. The response contains no `variantId`.
5. A variant of another company is never resolved.
**Tests:** §14 `variant-photos.test.ts`, `variant-photo-repository.integration.test.ts`, orders `checkout.test.ts` titles, `checkout.test.ts` photo titles.
**Depends on:** nothing.

### T3. Themes end to end: model, migration, editor, preview and buyer wiring

**Scope:** Prisma schema and migration `replace_checkout_colors_with_themes` (Database Migrations skill); appearance domain, application, repository, composition, `index.ts` and their tests; schemas; `CheckoutTheme` rewrite with fixed mode, `html:has` background and both stylesheets; `root.tsx` fixed color scheme and `handle` in `checkout.tsx` and `checkout-appearance-preview.tsx`; `checkout.tsx` appearance tag and tests; editor route with `ThemePicker`, `editor-draft.ts`, preview frame without mode, preview route; `locales.ts`; catalog decoupling (`catalog-sections.tsx`, `browse-composition.ts`, catalog routes, test); delete `checkout-colors.ts`, `brand-color-dialog.tsx` and their tests; stories per theme; e2e appearance specs and fixtures.
**Out of scope:** markup of checkout sections, delivery fields and payment content; thumbnails in rows; promotion of docs.
**Acceptance criteria:**
1. After `prisma migrate dev` on a database with companies on «Ciruela/De marca» and «Bosque/Suave», every row has `theme = classic` and keeps its `logoImageId`; their checkouts open and confirm.
2. The editor shows Logo, Tema (five options in order with sample and description) and Restablecer; no color, background or light/dark control.
3. Selecting Antojo changes the preview and shows «Cambios sin guardar»; the buyer still sees Clásico until **Guardar cambios**, then Antojo on reload.
4. `POST` with `{ "logoImageId": null, "theme": "neon" }` returns 422 `INVALID_CHECKOUT_APPEARANCE` and stores nothing.
5. A buyer with system dark mode opening a Boutique checkout gets a light page; with light mode on Noche, a dark page; the same buyer in dark mode opening an unknown link sees «Enlace no disponible» in dark, as today; the seller panel follows its preference as before.
6. The public catalog of a company that had a brand color shows the global Yoyos tokens with its logo.
7. Reading the appearance fails: the checkout renders Clásico and can be confirmed.
**Tests:** §14 appearance domain, application, composition, theme, root color scheme, preview frame, settings route, checkout route appearance, catalog and repository titles; e2e `checkout-appearance.spec.ts`, `checkout-appearance-preview.spec.ts`, `checkout-appearance-buyer.spec.ts` «Shows Clásico for a company without appearance».
**Depends on:** T1 (catalog, kit, stylesheets). Merged after T2 because both edit `checkout.tsx`.

### T4. Themed checkout parts and thumbnails

**Scope:** `checkout-sections.tsx` marks every hook of §12.2, groups the buyer fields in `field-group`, adds `ProductThumbnail` at the left of each row; `checkout-delivery-fields.tsx` and `buyer-payment-content.tsx` marks, payment image plate; `preview-fixtures.ts` sample photo and `public/checkout-preview/sample-product.svg`; section and preview page tests.
**Out of scope:** `CheckoutTheme`, theme values, the stylesheet, routes, appearance model.
**Acceptance criteria:**
1. A pending checkout with «Polo básico» (photo) and «Taza blanca» (none) shows the polo photo and a «T» block at the left of each row, with name, variant, quantity × price and subtotal unchanged.
2. A photo URL that fails to load shows the marker, never a broken image.
3. The DOM text of every section, field and button is identical to before the task except the thumbnails.
4. Each payment image sits on a white plate; a QR keeps its colors.
5. The preview's review state shows one sample photo and one marker.
**Tests:** §14 `checkout-sections.test.tsx`, `checkout-preview-page.test.tsx`; e2e `checkout-appearance-buyer.spec.ts` «Shows each theme in every order state with thumbnails and markers» is completed by T5 once T3 is merged.
**Depends on:** T1 (`ProductThumbnail`, hook names), T2 (`imageUrl`).

### T5. Visual verification and contrast evidence

**Scope:** run every theme against the real checkout in all states on 390 px and desktop; tune `checkout-theme.css` and catalog values where the rendering differs from `temas.css`; complete the buyer e2e across the five themes; before/after captures of adjusted values for the PR.
**Out of scope:** new behavior; promoting docs, deleting the drafts or the reference folder, and memory updates (separate documentation step).
**Acceptance criteria:**
1. Product acceptance criteria 1 to 20 hold on the integration branch.
2. In a Boutique checkout, field labels, typed values, prices and «S/ 120.00» use Inter; section titles and the store name use Playfair Display.
3. Typecheck, lint, unit, integration and the checkout and checkout-appearance e2e pass.
4. The PR lists every adjusted value with captures.
**Tests:** e2e `checkout-appearance-buyer.spec.ts` «Shows each theme in every order state with thumbnails and markers»; the full suites.
**Depends on:** T3, T4.

### Final verification

The pending manual checks of §14, with results and captures in the pull request description.
