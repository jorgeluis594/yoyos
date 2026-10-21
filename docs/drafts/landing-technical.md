# Yoyos landing page: technical design

**Status:** design closed, pending implementation. Based on [`docs/drafts/landing.md`](landing.md) (Todoist task 6hphRpcXVXJ62qP3 and its content comments v2.0). Base: `jorgeluis594/implementar-la-landing-page-de-yoyos-con` at `6f216440`.

References to the product draft use its section numbers: «§12» is section 12 of the content (Part B), «R4» is technical requirement 4 of the task (Part A).

## 1. Technical goal

`/landing` is an independent Astro package at the repository root that compiles the public Yoyos landing into static files (`dist/`): `/`, `/privacidad`, the 404, `robots.txt`, the sitemap and the manifest. Every contact value, URL and switch comes from `PUBLIC_*` environment variables parsed with Zod once at build time; an invalid value fails the build. The pages ship no client JavaScript except one small form-enhancement module (only when the demo form is enabled) and one analytics listener (only when analytics is enabled). The demo form posts natively to an external endpoint (task 6hphgH8GpgFhjvgV) under the contract in section 8. Deployment, Cloudflare and DNS are task 6hphXQVM879x2R2V.

```text
landing/.env  ──parseSiteConfig (Zod)──▶ SiteConfig ──▶ astro.config.ts (site, sitemap)
docs/design-tokens.json ──design-theme.ts──▶ CSS custom properties (light + prefers-color-scheme dark)
src/content/*.ts (literal copy) ─┐
SiteConfig ──────────────────────┼──▶ pages (/, /privacidad, 404) ──▶ dist/*.html
                                 └──▶ json-ld.ts, robots.txt.ts, manifest.webmanifest.ts
dist/ ──native POST──▶ PUBLIC_DEMO_FORM_ACTION (task 6hphgH8GpgFhjvgV) ──303──▶ /?demo=…#…
```

## 2. Decisions

| Topic | Decision |
| --- | --- |
| Location | `landing/` at the repository root, beside `apps/` and `shared/`, per the founder's decision of 20-oct-2026. It is not `apps/landing`. |
| Package | Its own `package.json`, `pnpm-lock.yaml` and single-package `pnpm-workspace.yaml` (for `allowBuilds`), installed with `pnpm --dir landing install --frozen-lockfile`. There is no root pnpm workspace: `apps/core` and `apps/mobile` each carry their own single-package `pnpm-workspace.yaml` for settings only, and the landing follows that pattern. `packageManager: pnpm@12.5.1`, Node 24 as CI. |
| Framework | Astro 7 (`astro@^7.4`), `output: 'static'`, `trailingSlash: 'never'`, `build.format: 'file'` (so `/privacidad` is `privacidad.html` and the canonical has no slash), `build.inlineStylesheets: 'always'`. No React or any UI framework; no islands. |
| Client JavaScript | Zero by default. Exceptions: the demo-form enhancement module (section 5.6), emitted only when the form is enabled; the analytics listener (section 9), emitted only when `PUBLIC_ANALYTICS_ENABLED=true`. Both are Astro-processed `<script>` modules (TypeScript, bundled and hashed, `type="module"`, non-blocking). The mobile menu and the FAQ use native `<details>`; the demo success and error states use CSS `:target` on the redirect fragments of section 8. |
| Environment | All `PUBLIC_*` variables of §17.1, parsed by one pure function `parseSiteConfig` with Zod into `SiteConfig`. Called by `astro.config.ts` (for `site`) and by `src/config/site.ts` (for pages). An invalid or missing required value fails the build listing the variable names. Astro's `astro:env` schema is not used: it validates fields one by one but not the cross-field defaults (call number falls back to WhatsApp) nor the hidden-when-empty variants, so it would be a second validator at the same boundary. |
| Defaults | `PUBLIC_INDEXING` empty → `false` (an unconfigured build is never indexable). `PUBLIC_ANALYTICS_ENABLED` empty → `false`. `PUBLIC_PHONE_NUMBER` empty → `+{PUBLIC_WHATSAPP_NUMBER}`. `PUBLIC_PHONE_DISPLAY` empty → the call number as is. `PUBLIC_WHATSAPP_DEMO_TEXT` empty → `wa.me` link without `text`. Any other optional variable empty → its element is not rendered. `PUBLIC_SITE_URL` and `PUBLIC_WHATSAPP_NUMBER` are required. |
| Shared code | The landing imports `@shared/result` (`Result`, `ok`, `err`) and `@shared/phone` (`internationalPhonePattern`) through a path alias, like core. Both files import nothing, so CI does not install `shared`. |
| Brand tokens | Single source: `src/styles/design-theme.ts` imports `../../../docs/design-tokens.json` and builds the CSS custom properties, the model of `apps/core/app/design-theme.ts`. Dark theme under `@media (prefers-color-scheme: dark)` (no toggle, §17.7). `theme-color` metas and the manifest colors also come from the tokens. Values are never copied. Missing landing dimensions are added to the token file (row below). |
| Landing tokens | Additive keys in `docs/design-tokens.json`, documented in a "Landing" recipe in `DESIGN.md` in the same change: typography roles `display` 40/48 and `display-wide` 56/64 (H1), `headline` 28/36 and `headline-wide` 40/48 (H2), all weight 500; spacing steps `16: 64` and `24: 96` for section rhythm; `radius.pill: 9999` for CTAs and pill labels; landing cards use the existing `overlay` radius 12; `layout.landingMaxWidth: 1200`. The `-wide` roles apply from the desktop breakpoint. No existing key changes. |
| Skip link | A visually hidden link «Ir al contenido» to `#contenido`, visible on focus, first in every page (WCAG 2.4.1). |
| Font | `@fontsource-variable/inter` (same package and major as core, pinned by the lockfile). The landing declares its own `@font-face` for the latin `wght` file only, `font-display: swap`, preloads that one file, and declares an `Inter Fallback` face over a local system font with `size-adjust` and metric overrides. Astro's fonts API is not used: its Fontsource provider downloads from a remote CDN at build, not the lockfile-pinned package core uses. |
| Icons | Lucide outline icons (DESIGN.md) through `@lucide/astro`, rendered to inline SVG at build (no JS). |
| Brand assets | The Yoyos logos (`yoyos-logo-light.svg`, `yoyos-logo-dark.svg`, `yoyos-isotipo.svg`), `favicon.ico` and `apple-touch-icon.png` are copied from `apps/core` into the landing, as `apps/mobile` already does: the landing builds and deploys alone and does not reach into another app's tree. `icon-192.png`, `icon-512.png` and `logo-512.png` (JSON-LD `logo`) are rendered once from the isotipo and committed. |
| Partner logos | Shalom, Olva, Yape and Plin logos are not in the repository. Until the founder supplies the official SVGs in `src/assets/logos/`, each renders as the brand name in a neutral badge marked provisional, with the literal alt text of §8. No logo is downloaded from the web by the implementer. |
| Screenshots | Every screenshot slot of §2, §6 and §7 is typed as provisional or real. A provisional slot renders a token-styled box with a fixed aspect ratio, the literal alt as its accessible name and the visible text «Imagen provisional». A real slot renders `astro:assets` `<Picture formats={['avif','webp']}>` with `widths`/`sizes`, explicit `width`/`height`, `loading="lazy"` below the fold, and for the hero `loading="eager"`, `fetchpriority="high"` and a preload link. |
| OG image | `public/og/yoyos-1200x630.png` (< 300 KB) with the text of §16 and the logo, rendered once from a committed SVG source and marked provisional in the README until Marketing approves it. |
| Content | Literal copy lives once, in typed data modules under `src/content/` (one per section) and, for the privacy prose, in `src/content/privacy-policy.astro`. Components contain no copy. The FAQ module feeds both the visible FAQ and the `FAQPage` JSON-LD, so their texts are equal by construction. |
| Hidden content | FAQ 6 is a `hidden` entry without answer: not rendered, not in JSON-LD. The testimonials component renders nothing while `testimonials.length === 0`. Terms and Libro de Reclamaciones links are absent until their URLs exist (they are not variables in §17.1; they are added as content when they exist). |
| Section pill labels | The reference opens each section with a pill label, but the content gives none except the hero eyebrow. Sections reached from the navigation reuse the literal nav label («Cómo funciona», «Funciones», «Envíos y pagos», «Precio», «Preguntas»); the others have no pill. No copy is invented. |
| Sitemap and robots | `@astrojs/sitemap` with `filter` excluding the 404 → `/sitemap-index.xml` with `/` and `/privacidad`. It is generated in both indexing modes. `src/pages/robots.txt.ts` returns the text of §17.4; the `Sitemap:` line appears only when indexing is on. |
| Robots meta | Every page carries `<meta name="robots">` from `PUBLIC_INDEXING`. The 404 is always `noindex, nofollow`. |
| Cache headers | `public/_headers` sets `Cache-Control: public, max-age=31536000, immutable` for `/_astro/*` (hashed CSS, JS, fonts, images). Only the file; applying it is the deployment task. |
| Demo form | Native `POST` to `PUBLIC_DEMO_FORM_ACTION` with the contract of section 8. Hidden when the variable is empty, together with the separator «o agenda una demo» and every «Agenda una demo» button. Works without JS (HTML5 validation); with JS shows the literal messages inline. |
| Analytics | `data-event`/`data-location` attributes on every CTA of §17.6 are always rendered (inert). With `PUBLIC_ANALYTICS_ENABLED=true` one delegated listener calls `track()`, which forwards to an adapter on `window` if one is installed; no tool is installed or loaded by this task. |
| Lint | ESLint 10 flat config: `@eslint/js`, `typescript-eslint`, `eslint-plugin-astro` recommended and its `jsx-a11y-strict` config (with `eslint-plugin-jsx-a11y`). ESLint 10 because `eslint-plugin-astro@3` requires it; core stays on its version. |
| Typecheck | `astro check` (with `@astrojs/check` and `typescript@~6.0`, same as core; `@astrojs/check` does not accept TypeScript 7). It checks `.astro` and `.ts` files with the same `tsconfig`; a separate `tsc --noEmit` would repeat it and cannot read `.astro` imports. |
| Tests | Vitest 4 (same major as core). Unit tests next to the pure helpers. A build-output suite (`tests/build-output/`) builds two env variants once in a `globalSetup` and asserts on `dist`. Both run in CI. |
| CI | New `landing` job in `.github/workflows/ci.yml`: install, lint, typecheck, unit tests, build, build-output tests. The `core` and `mobile` jobs do not change. |
| Docker and deploy | `landing` is added to `.dockerignore` so the core image build context and `compose.prod.yaml` are unaffected. No compose file changes. |
| Lighthouse, Core Web Vitals, WCAG AA | Automated where deterministic (JS and critical-byte budgets, headings, alt, noindex, a11y lint); Lighthouse mobile ×4 ≥ 95, CWV and keyboard/contrast reviews are manual checks recorded in the PR (section 14). Lighthouse CI is deferred. |

## 3. Verified current state

| Piece | Location | State |
| --- | --- | --- |
| Landing / Astro | — | Does not exist. No `landing/`, no Astro dependency anywhere. |
| Package layout | `apps/core/pnpm-workspace.yaml`, `apps/mobile/pnpm-workspace.yaml`, `shared/package.json` | Each package has its own lockfile; the `pnpm-workspace.yaml` files are single-package settings (`allowBuilds`, `overrides`, `patchedDependencies`). No root `package.json` or workspace. |
| CI | `.github/workflows/ci.yml` | Jobs `core` and `mobile`, Node 24, `pnpm/action-setup@v6` with 12.5.1, `actions/checkout@v7`, `actions/setup-node@v7`, `permissions: contents: read`. |
| Tokens | `docs/design-tokens.json` | Colors light/dark, typography roles (largest `page-title` 24/32), spacing up to 48, radius badge 4 / control 6 / card 8 / overlay 12 / avatar 9999, layout and sizing. No display typography, no spacing above 48, no pill radius role. |
| Token adapter model | `apps/core/app/design-theme.ts` (used by `app/root.tsx`) | Imports the JSON and emits `:root{…}` and `.dark{…}` custom properties with rem conversion. |
| Design rules | `DESIGN.md` | Restricts pills to specific recipes, cards without shadow, `card` radius 8, "no oversized hero headings in management views", tokens added in the same change that documents them. |
| Font | `apps/core/package.json` (`@fontsource-variable/inter@^5.3.0`), `apps/core/app/app.css` | Core imports `@fontsource-variable/inter/wght.css` (all subsets). |
| Brand logos | `apps/core/app/assets/brand/*.svg`, identical copies in `apps/mobile/assets/images/brand/` | Light/dark wordmark SVG (≈79 KB, ≈29 KB gzip), isotipo SVG and PNG. |
| Favicon | `apps/core/public/favicon.ico` (16+32), `apps/core/public/apple-touch-icon.png` (180×180) | Exist. No 192/512 icons, no `logo-512.png`, no manifest. |
| Partner logos | — | Shalom, Olva, Yape and Plin logos are not in the repository. |
| Shared helpers | `shared/result.ts`, `shared/phone.ts` | `Result`/`ok`/`err` and `internationalPhonePattern` (`^\+[1-9]\d{7,14}$`); neither imports a package. |
| Docker | `apps/core/Dockerfile`, `compose.prod.yaml`, `.dockerignore` | Build context is the repo root; the Dockerfile copies explicit paths, so `landing/` would only enlarge the context. |
| CRM endpoint | Task 6hphgH8GpgFhjvgV | Does not exist; contract defined in section 8. |
| Package versions (npm, 21-oct-2026) | — | `astro` 7.4.1, `@astrojs/sitemap` 3.7.4, `@astrojs/check` 0.9.11 (TS ^5 ∥ ^6), `eslint-plugin-astro` 3.2.1 (ESLint ≥ 10), `@fontsource-variable/inter` 5.3.0, `@lucide/astro` 1.60.0, `zod` 4.6.7, `vitest` 4.1.12. |

## 4. Gaps this design closes

1. No package, tooling or CI for a static site (sections 2, 12, 16 T0).
2. No validated build-time configuration for the `PUBLIC_*` variables (sections 5.1, 6).
3. No SEO base: layout head, canonical, hreflang, robots meta, robots.txt, sitemap, JSON-LD, manifest (sections 5.2–5.5).
4. No token adapter for a static, class-less dark mode, and no tokens for landing-scale typography, section spacing and pills (section 2, "Landing tokens").
5. No landing sections, privacy page or 404 (section 16 T1–T3).
6. No contract between the demo form and the CRM endpoint (section 8).
7. No analytics hook (section 9).
8. No automated check of indexing modes, headings and budgets (section 14).

## 5. Use cases

The landing has no runtime server. Its intentions are build-time operations (pure functions) and one browser-side enhancement.

### 5.1 `parseSiteConfig`

- **Owner:** `landing/src/config/site-config.ts`.
- **Input:** `env: Readonly<Record<string, string | undefined>>` (`import.meta.env` in pages, Vite `loadEnv` in `astro.config.ts`).
- **Access / deps:** none (pure).
- **Output:** `Result<SiteConfig, SiteConfigError>`.
- **Errors:** `{ code: "INVALID_SITE_CONFIG"; message: string; variables: readonly SiteVariableName[] }`.
- **Flow:**
  1. Trim every value; an empty string is absent.
  2. `safeParse` with the `siteEnvSchema` (section 6).
  3. On failure, return `INVALID_SITE_CONFIG` with every failing variable name (values are not secret but are not echoed).
  4. Apply defaults (section 2) and build the variants (`demoForm`, nullable links).
  5. Return `ok(config)`.
- `src/config/site.ts` calls it once with `import.meta.env` and throws `Error(message)` on failure, which stops `astro build`. `astro.config.ts` does the same with `loadEnv(mode, process.cwd(), "PUBLIC_")`.

### 5.2 Contact links

`whatsappUrl(whatsapp: SiteConfig["whatsapp"]): string` → `https://wa.me/{number}` plus `?text={encodeURIComponent(demoText)}` when there is text. `telUrl(phone: SiteConfig["phone"]): string` → `tel:{number}`. Pure, in `src/lib/contact.ts`. Expected example: `https://wa.me/51977909427?text=Hola%2C%20quiero%20una%20demo%20de%20Yoyos`, `tel:+51977909427`.

### 5.3 Page SEO

In `src/lib/seo.ts`:

```ts
export type PagePath = "/" | `/${string}`;
export type PageSeo = Readonly<{
  path: PagePath;
  title: string;
  description: string;
  socialTitle: string;          // og:title
  twitterTitle: string;
  twitterDescription: string;
  image: Readonly<{ path: `/${string}`; alt: string; width: number; height: number }>;
  indexable: boolean;           // false only for the 404
}>;
export function robotsMeta(indexing: boolean, page: Pick<PageSeo, "indexable">): "index, follow" | "noindex, nofollow";
export function canonicalUrl(siteUrl: SiteUrl, path: PagePath): string; // "{SITE}/" for "/", "{SITE}/privacidad" otherwise
export function buildRobotsTxt(input: Readonly<{ indexing: boolean; siteUrl: SiteUrl }>): string;
```

`base-layout.astro` receives `seo: PageSeo` and an optional `structuredData` and `preloadImage`, and renders `lang="es-PE"`, title, description, canonical, hreflang `es-PE` and `x-default`, robots, both `theme-color` metas, Open Graph and Twitter tags of §17.2, favicon, apple-touch-icon, manifest and the font preload. Canonical never carries query parameters.

### 5.4 Structured data

`buildHomeStructuredData(config: SiteConfig, faq: readonly FaqEntry[]): JsonLdGraph` in `src/lib/json-ld.ts` returns the `@graph` of §17.3 with `{SITE}` and the phone substituted, `FAQPage` built from the `published` entries only, `email` added to `Organization` only when `contactEmail` is set and `sameAs` only with the configured social URLs. The layout serializes it with `JSON.stringify` into `<script type="application/ld+json">`, escaping `<` as `<`. No Zod schema: nothing in Yoyos parses this JSON; the fixture test and the external validators check it.

### 5.5 Manifest and robots endpoints

- `src/pages/robots.txt.ts`: static `GET` returning `buildRobotsTxt(...)` as `text/plain`.
- `src/pages/manifest.webmanifest.ts`: static `GET` returning `buildManifest(tokens)`: `name` and `short_name` «Yoyos», `lang: "es-PE"`, `start_url: "/"`, `display: "browser"`, `background_color` and `theme_color` from `colors.light.background`, icons 192 and 512.

### 5.6 Demo form enhancement (browser)

`src/scripts/demo-form.ts`, loaded only by `demo-form.astro`:

1. Set `form.noValidate = true` (only when the script runs; without JS the browser validates natively and shows its own messages).
2. On `submit`, check each field with `checkValidity()`; for each invalid one, show its literal message (read from the field's `data-error` attribute, rendered from `src/content/demo-form.ts`) in the `<p id="{name}-error">` referenced by `aria-describedby`, set `aria-invalid="true"`, focus the first invalid field, `track({ name: "demo_form_error", reason: "validation" })`, and cancel the submit.
3. When valid: change the button label to «Enviando…», ignore further submits (the button stays enabled, §12), `track({ name: "demo_form_submit", rubro, contacto_preferido })` and let the native POST proceed.
4. Clear a field's error on `input`/`change`.

The script carries no copy and no personal data. Budget: ≤ 2 KB minified (checked by the JS budget test).

## 6. Domain and typing

```ts
// src/config/site-config.ts
export type SiteVariableName =
  | "PUBLIC_SITE_URL" | "PUBLIC_INDEXING" | "PUBLIC_WHATSAPP_NUMBER" | "PUBLIC_WHATSAPP_DEMO_TEXT"
  | "PUBLIC_PHONE_NUMBER" | "PUBLIC_PHONE_DISPLAY" | "PUBLIC_APP_LOGIN_URL" | "PUBLIC_DEMO_FORM_ACTION"
  | "PUBLIC_CONTACT_EMAIL" | "PUBLIC_TIKTOK_URL" | "PUBLIC_INSTAGRAM_URL" | "PUBLIC_ANALYTICS_ENABLED";

export type SiteUrl = string & z.BRAND<"SiteUrl">;               // absolute http(s) origin, no path, no trailing slash
export type WhatsappNumber = string & z.BRAND<"WhatsappNumber">; // ^[1-9]\d{7,14}$, digits only
export type CallNumber = string & z.BRAND<"CallNumber">;         // internationalPhonePattern from @shared/phone

export type DemoFormConfig =
  | Readonly<{ kind: "enabled"; action: string }>
  | Readonly<{ kind: "disabled" }>;

export type SiteConfig = Readonly<{
  siteUrl: SiteUrl;
  indexing: boolean;
  whatsapp: Readonly<{ number: WhatsappNumber; demoText: string | null }>;
  phone: Readonly<{ number: CallNumber; display: string }>;
  appLoginUrl: string | null;
  demoForm: DemoFormConfig;
  contactEmail: string | null;
  social: Readonly<{ tiktok: string | null; instagram: string | null }>;
  analyticsEnabled: boolean;
}>;
```

| Type | Why it exists |
| --- | --- |
| `SiteConfig` | The only validated shape of the build boundary; pages never read `import.meta.env` directly. |
| `SiteUrl`, `WhatsappNumber`, `CallNumber` | Each has a distinct rule and a distinct use (`wa.me` takes digits, `tel:` takes E.164); the brand stops passing one where the other is expected. |
| `DemoFormConfig` | The form, separator and demo buttons depend on one variant; a discriminated union instead of a nullable URL plus a boolean. |
| `PageSeo` | Per-page head values required by R4; one prop object for the layout. |
| `FaqEntry` | Shared by the FAQ section and JSON-LD; the hidden variant has no answer. |
| `ScreenshotSlot`, `PartnerLogo` | Provisional vs real asset, so a placeholder can never ship as if it were real. |
| `AnalyticsEvent` | Fixed event names and props of §17.6; no free-form props, so personal data cannot be sent. |

Validation rules of `siteEnvSchema`: URLs with `z.url()` restricted to `https:` (also `http:` for `localhost` in development); `PUBLIC_SITE_URL` must have no path, query or fragment and loses a trailing slash; booleans accept only `true`/`false`; email with `z.email()`; social URLs `https:`.

```ts
// src/content/faq.ts
export type FaqEntry = Readonly<{ number: number; question: string } & (
  | { visibility: "published"; answer: string }
  | { visibility: "hidden" }
)>;

// src/components/screenshot.astro props
export type ScreenshotSlot = Readonly<{ alt: string; aspectRatio: `${number}/${number}` } & (
  | { kind: "provisional" }
  | { kind: "image"; image: ImageMetadata }
)>;

// src/content/sections/integrations.ts
export type PartnerLogo = Readonly<{ name: "Shalom" | "Olva" | "Yape" | "Plin"; alt: string } & (
  | { kind: "provisional" }
  | { kind: "image"; svg: ImageMetadata }
)>;

// src/content/sections/testimonials.ts — empty until real testimonials with permission exist
export type Testimonial = Readonly<{ quote: string; name: string; business: string; category: string; city: string; photo: ImageMetadata }>;

// src/lib/analytics.ts
export type CtaLocation = "header" | "hero" | "precio" | "cta_final" | "footer" | "404";
export type AnalyticsEvent =
  | Readonly<{ name: "whatsapp_click"; location: CtaLocation }>
  | Readonly<{ name: "call_click"; location: Exclude<CtaLocation, "precio" | "404"> }>
  | Readonly<{ name: "demo_form_open"; location: "hero" | "precio" }>
  | Readonly<{ name: "demo_form_submit"; location: "cta_final"; rubro: Rubro; contacto_preferido: ContactMethod }>
  | Readonly<{ name: "demo_form_error"; location: "cta_final"; reason: "validation" | "server" }>
  | Readonly<{ name: "faq_open"; location: "faq"; q: number }>;
export function track(event: AnalyticsEvent): void; // forwards to window.yoyosAnalytics?.track(name, props); no-op otherwise
```

`Rubro` and `ContactMethod` are the option value unions of section 8, declared in `src/content/demo-form.ts` with their literal labels.

## 8. Contracts between applications

The demo form and the CRM endpoint (task 6hphgH8GpgFhjvgV) meet on this HTML form contract. The landing renders it; the endpoint validates it with its own Zod schema and only adds behavior.

| Aspect | Contract |
| --- | --- |
| Request | `POST {PUBLIC_DEMO_FORM_ACTION}`, `enctype="application/x-www-form-urlencoded"`, `accept-charset="UTF-8"`. Native navigation, no `fetch`, no CORS. |
| `nombre` | Required, trimmed, 1–100 characters. |
| `telefono` | Required. The form pattern accepts 9 national digits starting with 9 with an optional single space between the 3-3-3 groups (`9\d{2} ?\d{3} ?\d{3}`). With JS the enhancement removes the spaces before submitting; without JS the value is sent as typed. The endpoint removes spaces, then validates `^9\d{8}$` and stores `+51` + digits. |
| `rubro` | Required, one of `ropa`, `zapatillas`, `joyeria_accesorios`, `mascotas`, `cosmeticos`, `otro` (labels «Ropa» … «Otro» of §12). |
| `contacto_preferido` | Required, `whatsapp` (default checked) or `llamada`. |
| `consentimiento` | Required, value `acepto`; absent means no consent. |
| `consent_text_version` | Hidden, `privacidad-v1-2026-10`; changes when the privacy text changes. |
| `website` | Honeypot; must be empty. If filled, the endpoint creates no lead and still answers success. |
| Consent time | Recorded by the endpoint at reception (server clock); the form sends no timestamp. |
| Success | `303 See Other` to `{landing URL}/?demo=ok#demo-ok-whatsapp` or `#demo-ok-llamada`, matching `contacto_preferido`. CSS `:target` shows the matching message and `:has()` hides the form. |
| Failure (validation or technical) | `303 See Other` to `{landing URL}/?demo=error#demo-error`. |
| Return URL | The landing URL is configuration of the endpoint. The form sends no return URL, so the endpoint cannot be used as an open redirect. |

Option values and field names are defined once in `src/content/demo-form.ts`. No schema goes to `shared/contracts`: the landing does not exchange JSON and does not parse this payload.

## 9. Events and cross-feature integration

Analytics events of §17.6 are the landing's only events.

| Event | Trigger | Props |
| --- | --- | --- |
| `whatsapp_click` | click on any element with `data-event="whatsapp_click"` | `location` |
| `call_click` | click on `data-event="call_click"` | `location` |
| `demo_form_open` | click on «Agenda una demo» links | `location` (`hero`, `precio`) |
| `demo_form_submit` | valid submit (section 5.6) | `rubro`, `contacto_preferido`, `location: cta_final` |
| `demo_form_error` | client validation failure, or page loaded with `#demo-error` | `reason`, `location: cta_final` |
| `faq_open` | `toggle` to open on a FAQ `<details>` (captured on `document`, since `toggle` does not bubble) | `q`, `location: faq` |

`src/components/analytics-listener.astro` is included by the layout only when `analyticsEnabled`; it holds one delegated `click` listener and one captured `toggle` listener that build an `AnalyticsEvent` from `data-*` attributes and call `track`. `track` sends nothing unless an adapter exists on `window.yoyosAnalytics`; choosing and installing a tool (lightweight, cookieless) needs the founder's OK and, if it used cookies, a consent notice and an update of §14 section 10. No event carries `nombre`, `telefono` or any free text.

## 12. Code organization

The landing is a static site, not a feature-layered app: it has no domain state, persistence or use cases with effects. Pure helpers live in `src/config/` and `src/lib/` with colocated tests; presentation in `src/layouts/`, `src/components/` and `src/pages/`; copy in `src/content/`. Filenames are kebab-case like the rest of the repository.

| File | Change |
| --- | --- |
| `landing/package.json` | New. Scripts: `dev` (`astro dev`), `build` (`astro build`), `preview`, `lint` (`eslint .`), `typecheck` (`astro check`), `test` (`vitest run --project unit`), `test:build` (`vitest run --project build-output`). `packageManager`, `devEngines` as core. |
| `landing/pnpm-lock.yaml`, `landing/pnpm-workspace.yaml` | New. `allowBuilds` for `esbuild` and `sharp`. |
| `landing/astro.config.ts` | New. `site` from `parseSiteConfig`, static output, `trailingSlash`, `build.format`, `inlineStylesheets`, sitemap with 404 filter, `@shared` alias, `vite.server.fs.allow` for `../docs` and `../shared` if dev requires it. |
| `landing/tsconfig.json` | New. Extends `astro/tsconfigs/strict`; `paths` `@shared/*` → `../shared/*`. |
| `landing/eslint.config.js`, `landing/vitest.config.ts` | New. Vitest projects `unit` (`src/**/*.test.ts`, `tests/source/*.test.ts`) and `build-output` (`tests/build-output/*.test.ts` with `globalSetup`). |
| `landing/.env.example` | New. The variables of §17.1 with their example values and one comment line each. |
| `landing/.gitignore` | New. `dist/`, `.astro/`, `.env`, `tests/build-output/.dist/`. |
| `landing/README.md` | New. Install, dev, build, preview, tests, every variable and its default, "rebuild after changing a variable", provisional assets list. |
| `landing/public/` | `favicon.ico`, `apple-touch-icon.png` (copied), `icon-192.png`, `icon-512.png`, `logo-512.png`, `og/yoyos-1200x630.png`, `_headers`. |
| `landing/assets-src/og-image.svg` | Editable source of the OG image. |
| `landing/src/config/site-config.ts`, `site.ts` | Env schema, `parseSiteConfig`, resolved `siteConfig`. |
| `landing/src/lib/contact.ts`, `seo.ts`, `json-ld.ts`, `manifest.ts`, `analytics.ts` | Pure helpers of sections 5 and 9. |
| `landing/src/styles/design-theme.ts`, `global.css`, `fonts.css` | Token adapter, base styles, `@font-face`. |
| `landing/src/layouts/base-layout.astro` | Head (section 5.3), skip link «Ir al contenido» (visually hidden until focused), header, `<main id="contenido">`, footer, analytics listener. |
| `landing/src/components/` | `header.astro` (sticky; `<details>` menu below the desktop breakpoint), `footer.astro`, `cta-link.astro`, `section-heading.astro`, `screenshot.astro`, `partner-logo.astro`, `demo-form.astro`, `analytics-listener.astro`, `sections/*.astro` (one per content section). |
| `landing/src/content/` | `site.ts` (nav, header, footer, CTA labels, page SEO of §0, §14, §15), `faq.ts`, `demo-form.ts`, `not-found.ts`, `privacy-policy.astro`, `sections/*.ts`. |
| `landing/src/scripts/demo-form.ts` | Section 5.6. |
| `landing/src/pages/` | `index.astro`, `privacidad.astro`, `404.astro`, `robots.txt.ts`, `manifest.webmanifest.ts`. |
| `landing/src/assets/` | `brand/` (copied logos), `logos/` (partner SVGs when supplied), `screenshots/` (real captures when supplied). |
| `landing/tests/build-output/` | `global-setup.ts` (two builds), `html.ts` (parse helpers with `node-html-parser`), `*.test.ts`. |
| `landing/tests/source/hardcoded-values.test.ts` | Source scan of section 14. |
| `.github/workflows/ci.yml` | New `landing` job (below). |
| `.dockerignore` | Adds `landing`. |
| `AGENTS.md` | One line for `landing/` in "Project Structure & Module Organization" (founder-approved). |
| `README.md` | Lines for `landing/` in the structure and its install/build commands. |
| `docs/design-tokens.json`, `DESIGN.md` | Landing tokens and a "Landing" recipe (section 2). Additive: no existing key changes. |

Not touched: `apps/core`, `apps/mobile`, `shared` (only read through the alias), compose files.

CI job (contract):

```yaml
  landing:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: 24
      - uses: pnpm/action-setup@v6
        with:
          version: 12.5.1
      - run: pnpm --dir landing install --frozen-lockfile
      - run: cp .env.example .env
        working-directory: landing
      - run: pnpm lint
        working-directory: landing
      - run: pnpm typecheck
        working-directory: landing
      - run: pnpm test
        working-directory: landing
      - run: pnpm build
        working-directory: landing
      - run: pnpm test:build
        working-directory: landing
```

The build-output `globalSetup` runs `astro build --outDir tests/build-output/.dist/<variant>` in child processes with explicit env, so it does not depend on `.env`:

| Variant | Env |
| --- | --- |
| `minimal` | Required variables only; `PUBLIC_INDEXING=false`; every optional variable empty. |
| `full` | `PUBLIC_INDEXING=true`, `PUBLIC_ANALYTICS_ENABLED=true`, and test values for login, form action, email, TikTok and Instagram. |

## 13. Observability

There is no server, so there are no runtime logs. The build is observable through its exit code and one message:

| Event | Level | Where | Fields |
| --- | --- | --- | --- |
| `invalid_site_config` | error (build fails) | `site.ts` / `astro.config.ts` | `["code", "variables"]` |

Product signals are the analytics events of section 9, sent only when an adapter is installed. Never sent or logged: name, phone, free text, the form payload, IP or any identifier.

## 14. Tests

### Unit (Vitest, `pnpm test`)

`src/config/site-config.test.ts`
- `test("parses the variables of .env.example into the site configuration")`
- `test("fails with INVALID_SITE_CONFIG naming PUBLIC_SITE_URL when it is missing, relative or has a path")`
- `test("removes the trailing slash from PUBLIC_SITE_URL")`
- `test("rejects a WhatsApp number with a plus sign, spaces or letters")`
- `test("uses + and the WhatsApp number as the call number when PUBLIC_PHONE_NUMBER is empty")`
- `test("rejects a call number that is not in international format")`
- `test("shows the call number when PUBLIC_PHONE_DISPLAY is empty")`
- `test("treats empty login URL, form action, email and social URLs as absent")`
- `test("disables the demo form when PUBLIC_DEMO_FORM_ACTION is empty and enables it with its URL")`
- `test("turns indexing and analytics off when their variables are empty")`
- `test("rejects PUBLIC_INDEXING values other than true or false")`
- `test("lists every invalid variable in one error")`

`src/lib/contact.test.ts`
- `test("builds the wa.me link with the demo text URL-encoded")` (expects `https://wa.me/51977909427?text=Hola%2C%20quiero%20una%20demo%20de%20Yoyos`)
- `test("builds the wa.me link without text when the demo text is absent")`
- `test("builds the tel link from the international call number")`

`src/lib/seo.test.ts`
- `test("returns noindex, nofollow when indexing is off and index, follow when it is on")`
- `test("returns noindex, nofollow for a non-indexable page even when indexing is on")`
- `test("builds the home canonical with a slash and subpage canonicals without one")`
- `test("allows crawling and points to the sitemap index when indexing is on")`
- `test("disallows all crawling and omits the sitemap line when indexing is off")`

`src/lib/json-ld.test.ts`
- `test("matches the approved JSON-LD graph for the example configuration")` (fixture transcribed from §17.3)
- `test("includes the ten published questions in FAQPage and leaves out question 6")`
- `test("adds email to Organization only when the contact email is set")`
- `test("adds sameAs with only the configured social URLs and omits it when none is set")`
- `test("uses the call number as the contact point telephone")`

`src/lib/manifest.test.ts`
- `test("builds the manifest with the token background color and the 192 and 512 icons")`

`src/lib/analytics.test.ts`
- `test("forwards the event name and props to the installed adapter")`
- `test("does nothing when no adapter is installed")`

`tests/source/hardcoded-values.test.ts`
- `test("no source file contains the sales phone number or the site domain")` (scans `src/` and `astro.config.ts` for `977909427` and `yoyos.lat`)

### Build output (Vitest, `pnpm test:build`, two builds)

`tests/build-output/seo.test.ts`
- `test("with indexing off every page carries noindex, nofollow and robots.txt disallows all")`
- `test("with indexing on every indexable page carries index, follow and robots.txt allows all and names the sitemap index")`
- `test("the 404 page is noindex in both variants")`
- `test("the sitemap lists / and /privacidad and not the 404")`
- `test("every page has exactly one h1 and no skipped heading level")`
- `test("every page has lang es-PE, a self-referencing canonical, og:url and hreflang es-PE and x-default on the site URL")`
- `test("the home JSON-LD parses and holds Organization, WebSite, SoftwareApplication and FAQPage")`
- `test("the manifest, favicon, apple-touch-icon and OG image referenced by the head exist in dist")`
- `test("the shipped JavaScript stays within 50 KB and the home HTML with its CSS within 100 KB gzip")`
- `test("the minimal variant ships no JavaScript and the analytics listener appears only in the full variant")`
- `test("every img has alt text and explicit width and height")`

`tests/build-output/home-sections.test.ts`
- `test("the home renders the anchors and H2 headings of the content structure in order")` (§17.5)
- `test("every provisional screenshot shows «Imagen provisional» and carries its literal alt as accessible name")`
- `test("without a login URL «Ingresar» is absent from header and footer, and with it both link to it")`

`tests/build-output/demo-form.test.ts`
- `test("without a form action the form, the separator and every «Agenda una demo» link are absent")`
- `test("with a form action the form posts to it with the contract field names, honeypot and consent version")`
- `test("the consent checkbox is required, unchecked and links to /privacidad in a new tab")`
- `test("the telefono field requires 9 digits starting with 9")`
- `test("the success and error blocks exist with their target ids and literal messages")`
- `test("FAQ 6 and the testimonials section are not rendered")`
- `test("without email and social variables their footer links and sentences are absent; with them they render")`

`tests/build-output/privacy.test.ts`
- `test("/privacidad renders the policy with the configured phone display and the email placeholder")`
- `test("/privacidad keeps every bracketed placeholder of the approved text visible")`

### Pending manual checks (results in the PR)

1. Lighthouse mobile (Slow 4G) on `astro preview` of the production build: Performance, Accessibility, Best Practices and SEO ≥ 95, LCP ≤ 2.5 s (internal goal 2.0 s), CLS ≤ 0.1, TBT as INP proxy; first view ≤ 500 KB in the network panel.
2. Rich Results Test (code snippet) and validator.schema.org on the home JSON-LD.
3. 360, 768 and 1280 px, light and dark, 200% text zoom: no overflow, no clipped text.
4. Keyboard only: skip link, header menu open/close, every CTA, FAQ, form fields and errors, visible focus ring everywhere.
5. axe DevTools on `/`, `/privacidad` and the 404: no contrast or ARIA violations.
6. Demo form without JS (scripts disabled) and with JS against a local stub endpoint that answers the 303s of section 8: native messages, literal messages, «Enviando…», success and error states.
7. WhatsApp link preview of the OG image: deferred to the deployment task (needs a public URL).

## 15. Limits and checks during implementation

- Out: deployment, Cloudflare, DNS, the value of `PUBLIC_INDEXING` for `landing.yoyos.lat` (task 6hphXQVM879x2R2V); the CRM endpoint (task 6hphgH8GpgFhjvgV); choosing an analytics tool; real screenshots, partner logos, company data, email and social URLs (provisional until supplied); terms and Libro de Reclamaciones pages; publishing `/privacidad` in production before the founder's final review.
- Deferred with real risk, each already owned by a Todoist task: `/privacidad` must not reach production before the founder's final review and with its placeholders filled (deployment task 6hphXQVM879x2R2V); the value of `PUBLIC_INDEXING` for `landing.yoyos.lat` (same task); the endpoint must implement the section 8 contract, including the `+51` prefix and the fragment redirects, or the form shows no confirmation (task 6hphgH8GpgFhjvgV).
- Verify with Astro 7: `build.format: 'file'` with `trailingSlash: 'never'` produces `privacidad.html` and sitemap URLs without slash; `@astrojs/sitemap` `filter` signature; whether Astro inlines the small processed scripts; `getImage()` for the hero preload `imagesrcset`.
- Verify that importing `../../../docs/design-tokens.json` and `../shared/*.ts` works in `astro dev` (Vite `server.fs.allow`) and in `astro check`.
- Verify the latin `wght` file path inside `@fontsource-variable/inter@5.3` and import it with `?url` so it is hashed into `_astro/`.
- Compute the `Inter Fallback` metric overrides (`size-adjust`, `ascent-override`, `descent-override`) for the chosen local font; initial values are adjustable and are checked by CLS in Lighthouse.
- `aria-hidden="true"` plus `tabindex="-1"` on the honeypot must not raise an axe `aria-hidden-focus` violation; keep it off-screen, not `display: none`.
- The `:target` success state needs `:has()` to hide the form; verify on the browsers of the 360 px check.
- 404 status: Astro emits `404.html`; the real 404 status depends on the host (deployment task verifies).
- Run every pnpm command for the landing from `landing/` with pnpm 12.5.1; its lockfile has two YAML documents, which is valid.
- After the token change, run `pnpm --dir apps/core typecheck` and `pnpm --dir apps/mobile typecheck` to confirm the additive keys break nothing.

## 16. Implementation plan

### Order and parallelism

```text
T0 (scaffold, tooling, CI, config, SEO, layout, tokens)
 ├─▶ T1 (home sections: hero → features)
 ├─▶ T2 (integrations, pricing, FAQ, final CTA and demo form)
 └─▶ T3 (/privacidad content)
```

T1, T2 and T3 run in parallel; they own disjoint files. `src/pages/index.astro` is written by T0 with every section already imported (stub components), so no later task edits it.

### T0. Scaffold `/landing` with tooling, CI, configuration, SEO base and layout

**Scope:** everything in section 12 except the files owned by T1–T3: package, lockfile, configs, `.env.example`, README, CI job, `.dockerignore`, the `landing/` line in `AGENTS.md` (Project Structure section) and the root `README.md` lines; `site-config`, `contact`, `seo`, `json-ld`, `manifest`, `analytics` with unit tests; token adapter, fonts, global CSS, landing tokens in `docs/design-tokens.json` and the "Landing" recipe in `DESIGN.md` (section 2); `base-layout`, `header`, `footer`, `cta-link`, `section-heading`, `analytics-listener`; `src/content/site.ts`, `faq.ts` (full literal FAQ 1–11), `not-found.ts`; pages `index` (H1 hero heading from content and stub sections), `privacidad` (layout, H1, SEO, stub policy component), `404`, `robots.txt`, `manifest.webmanifest`; public assets and `_headers`; build-output `global-setup`, `html.ts`, `seo.test.ts`; source scan test.
**Out of scope:** section content and styling beyond stubs, demo form, privacy text.
**Files owned:** all of the above, plus stub files for T1–T3 that those tasks then own.
**Acceptance criteria:**
1. `pnpm --dir landing install --frozen-lockfile`, `lint`, `typecheck`, `test`, `build`, `test:build` pass locally and in the new CI job; `core` and `mobile` jobs unchanged and green.
2. `PUBLIC_INDEXING=false pnpm build`: `dist/index.html`, `dist/privacidad.html` and `dist/404.html` carry `noindex, nofollow`; `dist/robots.txt` is `User-agent: *` / `Disallow: /`.
3. `PUBLIC_INDEXING=true`: `index, follow` on `/` and `/privacidad`, robots allows all and ends with `Sitemap: https://landing.yoyos.lat/sitemap-index.xml`; the sitemap lists exactly `/` and `/privacidad`.
4. Removing `PUBLIC_SITE_URL` makes `astro build` fail with `INVALID_SITE_CONFIG` naming it.
5. The header shows the logo, the five anchors, «Escríbenos por WhatsApp» linking to `https://wa.me/51977909427?text=…` and «Llámanos» with `tel:+51977909427` and aria-label «Llamar a Yoyos al +51 977 909 427»; «Ingresar» is absent with an empty login URL.
6. In dark system mode the page uses `colors.dark` values; no color, radius or size literal appears in CSS outside the token adapter.
**Tests:** every unit test of section 14 and `seo.test.ts`.
**Depends on:** nothing.

### T1. Home sections from hero to features

**Scope:** `hero`, `value-strip`, `problem`, `benefits`, `how-it-works`, `features` sections with their content modules (§2–§7), `screenshot.astro` with provisional and `<Picture>` variants, hero LCP handling, reference style (two-column hero, 2-column features grid, 3-column benefits grid, mobile first).
**Out of scope:** sections after features, the demo form.
**Files owned:** `src/components/sections/{hero,value-strip,problem,benefits,how-it-works,features}.astro`, `src/components/screenshot.astro`, `src/content/sections/{hero,value-strip,problem,benefits,how-it-works,features}.ts`, `src/assets/screenshots/`, `tests/build-output/home-sections.test.ts`.
**Acceptance criteria:**
1. The hero shows the eyebrow, the H1 «Sistema de pedidos por WhatsApp para vendedores de TikTok LIVE», the bajada, the WhatsApp CTA, «Agenda una demo» → `#demo` only when the form is enabled, «¿Prefieres hablar? Llámanos» and the microcopy, literally.
2. The hero image slot is provisional, shows «Imagen provisional» and its accessible name is the literal alt of §2; switching the slot to a real image renders AVIF and WebP sources with `fetchpriority="high"` and a preload link.
3. «Cómo funciona» has five H3 in order; «Funciones» has six H3 cards in two columns at 1280 px and one at 360 px.
4. No heading level is skipped and no copy differs from the product draft.
**Tests:** `home-sections.test.ts`.
**Depends on:** T0.

### T2. Integrations, pricing, FAQ, final CTA and demo form

**Scope:** `integrations` (partner logos provisional), `testimonials` (hidden while empty), `pricing`, `faq` (rendering `faq.ts`, `<details>`), `final-cta` with the demo form, its `:target` success/error states (section 8), `demo-form.ts` enhancement script, the section 8 contract.
**Out of scope:** the CRM endpoint; analytics tool.
**Files owned:** `src/components/sections/{integrations,testimonials,pricing,faq,final-cta}.astro`, `src/components/{demo-form,partner-logo}.astro`, `src/scripts/demo-form.ts`, `src/content/sections/{integrations,testimonials,pricing,final-cta}.ts`, `src/content/demo-form.ts`, `src/assets/logos/`, `tests/build-output/demo-form.test.ts`.
**Acceptance criteria:**
1. With `PUBLIC_DEMO_FORM_ACTION` empty, `#demo` shows the H2, bajada, WhatsApp and «Llámanos» with «+51 977 909 427», and no separator, form or «Agenda una demo» anywhere on the page.
2. With `PUBLIC_DEMO_FORM_ACTION=https://crm.example.test/demo`, submitting without JS and with «telefono» `91234567` is blocked by the browser; with JS the message «Escribe un celular de 9 dígitos que empiece con 9.» appears under the field and focus moves to it.
3. Submitting without consent shows «Para enviar tus datos necesitamos que aceptes la Política de privacidad.»; a valid submit changes the button to «Enviando…» and posts the fields of section 8.
4. Opening `/?demo=ok#demo-ok-llamada` shows «¡Listo! Te contactaremos pronto por llamada. …» with the WhatsApp link, and `/?demo=error#demo-error` shows the general error message, without JS.
5. FAQ shows questions 1–5 and 7–11 as `<details>` with H3 questions; FAQ 6 and `#testimonios` are absent from the HTML.
6. The pricing card shows «S/ 50» «/ mes + IGV», «Los precios no incluyen IGV.» and the eight «Incluye» items.
**Tests:** `demo-form.test.ts`.
**Depends on:** T0.

### T3. Privacy policy page content

**Scope:** the literal policy text of §14 in `src/content/privacy-policy.astro`, rendered by `privacidad.astro` with the reader width; `{PUBLIC_PHONE_DISPLAY}` and `[CORREO]` from configuration (bracketed placeholder kept when the email is empty), tables as semantic tables.
**Out of scope:** filling company placeholders; publishing.
**Files owned:** `src/content/privacy-policy.astro`, `tests/build-output/privacy.test.ts`.
**Acceptance criteria:**
1. `/privacidad` has one H1 «Política de privacidad» and the twelve numbered sections as H2 in order, with the providers and deadlines tables.
2. With `PUBLIC_PHONE_DISPLAY=+51 977 909 427` and no email, sections 1, 7 and 12 show the phone and keep «[CORREO]»; with an email they show it.
3. Every bracketed placeholder («[RAZÓN SOCIAL]», «[RUC]», …) remains visible.
**Tests:** `privacy.test.ts`.
**Depends on:** T0.

### Coverage of requirements and acceptance criteria

| Requirement / criterion | Slice | Verification |
| --- | --- | --- |
| R1 Stack, `/landing`, static, no UI framework, zero JS | T0 | CI job; `the minimal variant ships no JavaScript…` |
| R2 Brand, tokens, Inter, reference style | T0, T1, T2 | token adapter; manual check 3 |
| R3 Performance and budget | T0, T1 | `the shipped JavaScript stays within 50 KB…`; manual check 1 |
| R4 Technical SEO | T0 | `src/lib/seo.test.ts`, `json-ld.test.ts`, `tests/build-output/seo.test.ts`; manual check 2 |
| R5 WCAG AA | T0–T3 | a11y lint; `every img has alt…`; manual checks 4–5 |
| R6 360/768/1280 | T1, T2 | manual check 3 |
| R7 CTAs from env, `.env.example` | T0 | `site-config.test.ts`, `contact.test.ts`, source scan |
| R8 Analytics hook | T0 | `analytics.test.ts`; listener only in the full variant |
| R9 Demo form | T2 | `demo-form.test.ts`; manual check 6 |
| R10 Site URL from env | T0 | `site-config.test.ts`; canonical/OG test |
| Lives in `/landing`, builds statically, core/mobile unbroken | T0 | CI jobs |
| Lighthouse ≥ 95 ×4 | all | manual check 1 |
| sitemap, robots, canonical, OG, JSON-LD valid | T0 | `seo.test.ts`; manual check 2 |
| Indexing off/on | T0 | indexing tests (unit and build output) |
| Sections as defined, `/privacidad`, hidden FAQ and testimonials | T1, T2, T3 | `home-sections`, `demo-form`, `privacy` tests |
| README | T0 | review |
| WhatsApp, phone and URL from env, no hard-coded values | T0 | source scan test |
| lint, typecheck, build in CI | T0 | CI job |

### Final verification

Manual checks 1–6 of section 14 on the integrated branch, with Lighthouse reports and screenshots at 360, 768 and 1280 px (light and dark) in the pull request description.
